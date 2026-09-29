/**
 * Storage Repository — sync/local layered storage with caching and versioned writes.
 *
 * Responsibilities:
 * - Sync config repository (slots, rules, global strategy, configVersion)
 * - Local runtime repository (bindings, cursors, recovery, overrides, icons, diagnostics)
 * - Worker memory cache with storage.onChanged invalidation
 * - Single-write service with optimistic version conflict detection
 * - Startup validation and cleanup (stale tabIds, expired recovery sessions)
 */

import type { BrowserAdapter, StorageChange } from '@adapters/contract';
import type {
  SyncState,
  LocalState,
  SlotDefinition,
  PageRule,
  MatchStrategy,
  SlotBinding,
  CycleCursor,
  RecoverySession,
  TabOverride,
  DiagnosticEntry,
  DomainErrorCode,
} from '@shared/types';
import { DEFAULT_STRATEGY } from '@shared/types';
import { urlsMatch } from '@shared/url-utils';

// ─── Storage Keys ────────────────────────────────────────────────────────────

const SYNC_KEY = 'syncState';
const LOCAL_KEY = 'localState';
/** Fallback key in local storage when chrome.storage.sync is unavailable */
const SYNC_FALLBACK_KEY = 'syncStateFallback';
/** Dedicated local key holding the single-slot undo snapshot (B2) */
const PENDING_UNDO_KEY = 'pendingUndo';

/** How long an undo snapshot stays valid (mirrors the sidebar's 5-second undo bar). */
export const PENDING_UNDO_TTL_MS = 5000;

/**
 * Single-slot undo snapshot, stored in its own `storage.local` key.
 * `expiresAt` is validated lazily on read so a sleeping service worker
 * cannot lose the expiry (the timer alone is not sufficient).
 */
export interface PendingUndoSnapshot {
  slotId: number;
  /**
   * T34: identity of THIS capture.
   *
   * `slotId` alone is not enough to decide ownership: two overwrites of the same
   * slot in quick succession produce two captures, and the first capture's
   * cleanup timer used to match on `slotId` and delete the second, still-valid
   * one. The timer now proves ownership by capture identity.
   */
  captureId: number;
  slotSnapshot: SlotDefinition;
  bindingSnapshot: SlotBinding | null;
  expiresAt: number;
}

// ─── Icon Offloading ─────────────────────────────────────────────────────────

/** Threshold (bytes) above which data URI icons are offloaded to local storage */
export const ICON_OFFLOAD_THRESHOLD = 6 * 1024; // 6KB
const ICON_REF_PREFIX = 'local-icon:';
const ICON_STORAGE_PREFIX = 'icon:';

/** Delay between retry attempts for transient storage failures */
const RETRY_DELAY_MS = 200;

// ─── Default States ──────────────────────────────────────────────────────────

export function createDefaultSyncState(): SyncState {
  return {
    configVersion: 0,
    globalStrategy: DEFAULT_STRATEGY,
    slots: [],
    rules: [],
  };
}

export function createDefaultLocalState(): LocalState {
  return {
    bindings: [],
    cycleCursors: [],
    lastSuccessSlotId: null,
    recoverySessions: [],
    recoverySnapshots: [],
    tabOverrides: [],
    iconCache: {},
    diagnostics: [],
  };
}

// ─── Result Types ────────────────────────────────────────────────────────────

export type WriteResult =
  | { success: true; configVersion: number }
  | { success: false; errorCode: DomainErrorCode; message: string };

// ─── Storage Repository ──────────────────────────────────────────────────────

export class StorageRepository {
  private syncCache: SyncState | null = null;
  private localCache: LocalState | null = null;
  private cacheValid = false;
  /** Serial write queue for local storage — prevents read-modify-write race conditions (Problem 5) */
  private localWriteQueue: Promise<void> = Promise.resolve();
  /** Serial write queue for sync storage — prevents concurrent version conflicts */
  private syncWriteQueue: Promise<unknown> = Promise.resolve({ success: true, configVersion: 0 });
  /** Whether chrome.storage.sync is available. If false, "sync" data is stored in local. */
  private syncAvailable = true;
  /**
   * Memoized `local-icon:<key>` → data URI resolutions (B7a / T10).
   * Instance-scoped on purpose: a service-worker restart is expected to drop it.
   * A `null` value records "resolved but absent" so misses are not retried.
   */
  private iconResolutionCache = new Map<string, string | null>();

  constructor(private adapter: BrowserAdapter) {}

  // ─── Initialization ──────────────────────────────────────────────────────

  /**
   * Initialize repository: load from storage, run migrations, setup change listener.
   */
  async initialize(): Promise<void> {
    await this.hydrate();
    this.adapter.storage.onChanged(this.handleStorageChange.bind(this));
  }

  /**
   * Load state from storage into cache.
   * Probes chrome.storage.sync availability; falls back to local if unavailable.
   */
  async hydrate(): Promise<void> {
    // Probe sync availability with a lightweight read
    if (this.syncAvailable) {
      try {
        await this.adapter.storage.get('sync', SYNC_KEY);
      } catch {
        console.warn('[StorageRepository] chrome.storage.sync unavailable, falling back to local storage');
        this.syncAvailable = false;
      }
    }

    if (this.syncAvailable) {
      const [syncData, localData] = await Promise.all([
        this.adapter.storage.get('sync', SYNC_KEY),
        this.adapter.storage.get('local', LOCAL_KEY),
      ]);
      this.syncCache = this.migrateSyncState(
        (syncData[SYNC_KEY] as SyncState) ?? createDefaultSyncState()
      );
      this.localCache = (localData[LOCAL_KEY] as LocalState) ?? createDefaultLocalState();
    } else {
      // Fallback: read both sync config and local runtime from storage.local
      const localData = await this.adapter.storage.get('local', [SYNC_FALLBACK_KEY, LOCAL_KEY]);
      this.syncCache = this.migrateSyncState(
        (localData[SYNC_FALLBACK_KEY] as SyncState) ?? createDefaultSyncState()
      );
      this.localCache = (localData[LOCAL_KEY] as LocalState) ?? createDefaultLocalState();
    }
    this.cacheValid = true;
  }

  /**
   * Migrate sync state to current version if needed.
   */
  private migrateSyncState(state: SyncState): SyncState {
    // Ensure all required fields exist
    return {
      configVersion: state.configVersion ?? 0,
      globalStrategy: state.globalStrategy ?? DEFAULT_STRATEGY,
      slots: state.slots ?? [],
      rules: state.rules ?? [],
    };
  }

  // ─── Cache Invalidation ──────────────────────────────────────────────────

  private handleStorageChange(changes: Record<string, StorageChange>, areaName: string): void {
    // Sync area changes (normal mode)
    if (areaName === 'sync' && changes[SYNC_KEY]) {
      this.cacheValid = false;
      if (changes[SYNC_KEY].newValue) {
        this.syncCache = changes[SYNC_KEY].newValue as SyncState;
        this.cacheValid = true;
      }
    }
    // Local area changes: runtime state + fallback sync config
    if (areaName === 'local') {
      // B7a: any local-area write may have rewritten an offloaded icon blob
      // (including our own `setIconCache`), so drop the resolution cache
      // wholesale rather than trying to diff individual icon keys.
      this.iconResolutionCache.clear();
      if (changes[LOCAL_KEY]?.newValue) {
        this.localCache = changes[LOCAL_KEY].newValue as LocalState;
      }
      // Fallback mode: sync config stored in local
      if (!this.syncAvailable && changes[SYNC_FALLBACK_KEY]?.newValue) {
        this.syncCache = changes[SYNC_FALLBACK_KEY].newValue as SyncState;
        this.cacheValid = true;
      }
    }
  }

  // ─── Read Operations ─────────────────────────────────────────────────────

  async getSyncState(): Promise<SyncState> {
    if (!this.cacheValid || !this.syncCache) {
      await this.hydrate();
    }
    // Resolve any offloaded icon references to actual data URIs
    return this.resolveIconReferences({ ...this.syncCache! });
  }

  async getLocalState(): Promise<LocalState> {
    if (!this.localCache) {
      await this.hydrate();
    }
    return { ...this.localCache! };
  }

  getConfigVersion(): number {
    return this.syncCache?.configVersion ?? 0;
  }

  // ─── Single Write Service (Sync) ────────────────────────────────────────

  /**
   * Write sync state with optimistic version check.
   * All sync writes MUST go through this method.
   * Serialized through a queue to prevent concurrent version conflicts (Problem 5).
   * Includes one retry for transient storage failures and specific error messages.
   *
   * @param expectedVersion - The configVersion the caller believes is current
   * @param updater - Function that produces the new sync state
   */
  async writeSync(
    expectedVersion: number,
    updater: (current: SyncState) => SyncState,
  ): Promise<WriteResult> {
    const operation: Promise<WriteResult> = this.syncWriteQueue.then(async (): Promise<WriteResult> => {
      // Wrap entire operation in try-catch to prevent queue from permanently
      // rejecting if getSyncState() or updater() throws (queue resilience fix).
      try {
        const current = await this.getSyncState();

        // Optimistic version check
        if (current.configVersion !== expectedVersion) {
          return {
            success: false,
            errorCode: 'CONFIG_CONFLICT',
            message: `Version conflict: expected ${expectedVersion}, current is ${current.configVersion}`,
          };
        }

        // Apply update and increment version
        const updated = updater(current);
        updated.configVersion = current.configVersion + 1;

        // Offload large data URI icons to local storage before writing to sync.
        // Non-fatal: if offloading fails, proceed with original data (may hit quota,
        // but that will be reported as a specific quota error rather than a generic failure).
        try {
          await this.offloadLargeIcons(updated);
        } catch (offloadErr) {
          console.warn('[StorageRepository] Icon offloading failed, proceeding without:', offloadErr);
        }

        // Attempt write with one retry for transient failures
        await this.setSyncWithRetry({ [SYNC_KEY]: updated });
        this.syncCache = updated;
        this.cacheValid = true;
        return { success: true, configVersion: updated.configVersion };
      } catch (e) {
        return this.classifyWriteError(e);
      }
    });
    // Queue stays alive regardless of this operation's outcome
    this.syncWriteQueue = operation.catch(() => ({ success: false, errorCode: 'INTERNAL_ERROR', message: 'write failed' } as WriteResult));
    return operation;
  }

  /**
   * Attempt storage.set with one retry after a short delay for transient failures.
   * If sync storage is persistently unavailable, automatically falls back to local storage.
   */
  private async setSyncWithRetry(items: Record<string, unknown>): Promise<void> {
    if (!this.syncAvailable) {
      // Already in fallback mode — write to local storage
      await this.adapter.storage.set('local', { [SYNC_FALLBACK_KEY]: items[SYNC_KEY] });
      return;
    }

    try {
      await this.adapter.storage.set('sync', items);
    } catch (firstError) {
      // Quota errors won't be fixed by retrying or falling back
      if (this.isQuotaError(firstError)) {
        throw firstError;
      }

      // Transient failure — wait and retry once
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      try {
        await this.adapter.storage.set('sync', items);
      } catch (secondError) {
        if (this.isQuotaError(secondError)) {
          throw secondError;
        }
        // Sync is persistently unavailable — switch to local fallback
        console.warn('[StorageRepository] chrome.storage.sync failed twice, switching to local fallback');
        this.syncAvailable = false;
        await this.adapter.storage.set('local', { [SYNC_FALLBACK_KEY]: items[SYNC_KEY] });
      }
    }
  }

  /**
   * Classify a storage write error into a user-actionable message.
   * Includes the original error detail for debugging.
   */
  private classifyWriteError(e: unknown): WriteResult {
    const msg = e instanceof Error ? e.message : String(e);
    // Log the real error for debugging
    console.error('[StorageRepository] writeSync failed:', e);

    if (this.isQuotaError(e)) {
      return {
        success: false,
        errorCode: 'BROWSER_API_ERROR',
        message: 'Storage quota exceeded. Try removing unused rules or using smaller icons.',
      };
    }

    // Check if sync storage is unavailable (user not signed in, sync disabled)
    if (/sync/i.test(msg) && (/unavailable|not supported|disabled|sign/i.test(msg) || /access/i.test(msg))) {
      return {
        success: false,
        errorCode: 'BROWSER_API_ERROR',
        message: 'Browser sync storage is unavailable. Check that you are signed in and sync is enabled.',
      };
    }

    return {
      success: false,
      errorCode: 'BROWSER_API_ERROR',
      message: `Storage write failed: ${msg}`,
    };
  }

  /**
   * Detect if an error is a chrome.storage.sync quota error.
   */
  private isQuotaError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /quota/i.test(msg) || /QUOTA_BYTES/i.test(msg) || /bytes_per_item/i.test(msg);
  }

  // ─── Icon Offloading ────────────────────────────────────────────────────

  /**
   * Offload data URI icons larger than ICON_OFFLOAD_THRESHOLD to local storage.
   * Replaces the value in sync state with a reference key (local-icon:xxx).
   * This prevents chrome.storage.sync 8KB per-item quota from being exceeded.
   */
  private async offloadLargeIcons(state: SyncState): Promise<void> {
    for (const rule of state.rules) {
      if (!rule.favicon) continue;
      const value = rule.favicon.value;
      // Only offload data: URIs that exceed the threshold
      if (!value.startsWith('data:') || value.length <= ICON_OFFLOAD_THRESHOLD) continue;

      const iconKey = `${ICON_STORAGE_PREFIX}${rule.id}`;
      // Store the actual data URI in local storage
      await this.adapter.storage.set('local', { [iconKey]: value });
      // Replace with a reference in sync state
      rule.favicon = { ...rule.favicon, value: `${ICON_REF_PREFIX}${iconKey}` };
    }

    // Also offload slot icons
    for (const slot of state.slots) {
      const iconValue = slot.uiMarker?.icon?.value;
      if (!iconValue) continue;
      if (!iconValue.startsWith('data:') || iconValue.length <= ICON_OFFLOAD_THRESHOLD) continue;

      const iconKey = `${ICON_STORAGE_PREFIX}slot-${slot.id}`;
      await this.adapter.storage.set('local', { [iconKey]: iconValue });
      slot.uiMarker = { ...slot.uiMarker, icon: { ...slot.uiMarker.icon!, value: `${ICON_REF_PREFIX}${iconKey}` } };
    }
  }

  /**
   * Resolve icon references back to actual data URIs when reading sync state.
   * Called after hydrate/getSyncState to transparently restore offloaded icons.
   */
  private async resolveIconReferences(state: SyncState): Promise<SyncState> {
    const resolved = { ...state, rules: [...state.rules], slots: [...state.slots] };

    for (let i = 0; i < resolved.rules.length; i++) {
      const rule = resolved.rules[i];
      const ref = rule.favicon?.value;
      if (ref?.startsWith(ICON_REF_PREFIX)) {
        const actualUri = await this.resolveIconRef(ref);
        if (actualUri) {
          resolved.rules[i] = { ...rule, favicon: { ...rule.favicon!, value: actualUri } };
        }
      }
    }

    for (let i = 0; i < resolved.slots.length; i++) {
      const slot = resolved.slots[i];
      const ref = slot.uiMarker?.icon?.value;
      if (ref?.startsWith(ICON_REF_PREFIX)) {
        const actualUri = await this.resolveIconRef(ref);
        if (actualUri) {
          const icon = slot.uiMarker.icon;
          if (icon) {
            resolved.slots[i] = {
              ...slot,
              uiMarker: { ...slot.uiMarker, icon: { ...icon, value: actualUri } },
            };
          }
        }
      }
    }

    return resolved;
  }

  /**
   * Resolve a single `local-icon:<key>` reference, memoized (B7a / T10).
   *
   * Without the cache every `getSyncState()` re-issued one `storage.get` per
   * offloaded icon — an N-IPC fan-out on a hot read path. A miss is cached as
   * `null` too, so a broken reference is not retried on every read.
   *
   * Entries are dropped wholesale by `handleStorageChange` on any `local` area
   * event, so an external write (or a `setIconCache`) can never serve stale data.
   */
  private async resolveIconRef(reference: string): Promise<string | null> {
    const cached = this.iconResolutionCache.get(reference);
    if (cached !== undefined) {
      return cached;
    }

    const iconKey = reference.slice(ICON_REF_PREFIX.length);
    let resolved: string | null = null;
    try {
      const data = await this.adapter.storage.get('local', iconKey);
      const actualUri = data[iconKey];
      if (typeof actualUri === 'string' && actualUri) {
        resolved = actualUri;
      }
    } catch {
      // Local read failed — leave unresolved (icon will show placeholder)
    }

    this.iconResolutionCache.set(reference, resolved);
    return resolved;
  }

  // ─── Local Write Operations ──────────────────────────────────────────────

  /**
   * Write local state (no version check — local is device-specific).
   * Serialized through a queue to prevent concurrent read-modify-write races (Problem 5).
   *
   * Queue resilience (B1): the queue tail never adopts a rejected promise, so a
   * single failed write cannot poison every subsequent local write. The error is
   * still surfaced to the caller via the returned `run` promise.
   */
  async writeLocal(updater: (current: LocalState) => LocalState): Promise<void> {
    const run = this.localWriteQueue.then(async () => {
      const current = await this.getLocalState();
      const updated = updater(current);
      await this.adapter.storage.set('local', { [LOCAL_KEY]: updated });
      this.localCache = updated;
    });
    // Keep the queue alive regardless of this operation's outcome.
    this.localWriteQueue = run.catch(() => undefined);
    // Propagate the real error (if any) to the caller.
    return run;
  }

  // ─── Simple Rule Mutators (no version check — single-user local extension) ──

  /**
   * Add a new rule. No version check — this is a single-user local extension.
   *
   * Duplicate detection is performed ATOMICALLY inside the serialized write queue:
   * the store re-reads the latest rules within the same synchronized mutation, so
   * concurrent CREATE_RULE calls (e.g. a UI double-submit or sidebar+settings
   * racing) cannot both pass a stale duplicate check and append two identical rules.
   * Returns true if the rule was appended, false if an identical rule already exists.
   */
  async addRule(rule: PageRule): Promise<boolean> {
    let added = false;
    await this.mutateSync((state) => {
      const isDuplicate = state.rules.some((r) => {
        if (r.urlMatch.type !== rule.urlMatch.type) return false;
        if (rule.urlMatch.type === 'exact') {
          return urlsMatch(r.urlMatch.value, rule.urlMatch.value);
        }
        return r.urlMatch.value === rule.urlMatch.value;
      });
      if (isDuplicate) return;
      state.rules.push(rule);
      added = true;
    });
    return added;
  }

  /**
   * Update an existing rule by ID. Returns the updated rule or null if not found.
   */
  async updateRuleById(ruleId: string, updates: Partial<PageRule>): Promise<PageRule | null> {
    let updated: PageRule | null = null;
    await this.mutateSync((state) => {
      const idx = state.rules.findIndex((r) => r.id === ruleId);
      if (idx >= 0) {
        state.rules[idx] = { ...state.rules[idx], ...updates, id: ruleId, updatedAt: new Date().toISOString() };
        updated = state.rules[idx];
      }
    });
    return updated;
  }

  /**
   * Remove a rule by ID. Returns true if the rule existed and was removed.
   */
  async removeRuleById(ruleId: string): Promise<boolean> {
    let found = false;
    await this.mutateSync((state) => {
      const len = state.rules.length;
      state.rules = state.rules.filter((r) => r.id !== ruleId);
      found = state.rules.length < len;
    });
    return found;
  }

  // ─── Core: Version-less sync write (serialized queue) ─────────────────────

  /**
   * Serialize a mutation to sync state. No optimistic version check.
   * Increments configVersion internally for change tracking.
   * Falls back to local storage if sync is unavailable.
   * Queue is resilient: errors propagate to caller but don't break subsequent writes.
   */
  private async mutateSync(mutator: (state: SyncState) => void): Promise<void> {
    const operation = this.syncWriteQueue.then(async (): Promise<void> => {
      const current = await this.getSyncState();
      const draft = structuredClone(current);
      mutator(draft);
      draft.configVersion = current.configVersion + 1;

      // Offload large icons (non-fatal)
      await this.offloadLargeIcons(draft).catch(() => {});

      // Persist to sync or fallback local
      await this.persistSyncState(draft);
      this.syncCache = draft;
      this.cacheValid = true;
    });

    // Keep the queue alive even if this operation fails
    this.syncWriteQueue = operation.catch(() => {});
    // Propagate error to caller
    return operation;
  }

  /**
   * Persist sync state to chrome.storage.sync or fallback to local.
   */
  private async persistSyncState(state: SyncState): Promise<void> {
    if (!this.syncAvailable) {
      await this.adapter.storage.set('local', { [SYNC_FALLBACK_KEY]: state });
      return;
    }
    try {
      await this.adapter.storage.set('sync', { [SYNC_KEY]: state });
    } catch (e) {
      if (this.isQuotaError(e)) throw e;
      // Sync unavailable — degrade to local fallback
      console.warn('[StorageRepository] sync write failed, falling back to local:', e);
      this.syncAvailable = false;
      await this.adapter.storage.set('local', { [SYNC_FALLBACK_KEY]: state });
    }
  }

  // ─── Legacy Versioned Mutators (slots still use version check) ─────────────

  async saveSlot(slot: SlotDefinition, expectedVersion: number): Promise<WriteResult> {
    return this.writeSync(expectedVersion, (state) => {
      const existingIdx = state.slots.findIndex((s) => s.id === slot.id);
      if (existingIdx >= 0) {
        state.slots[existingIdx] = slot;
      } else {
        state.slots.push(slot);
      }
      return state;
    });
  }

  async removeSlot(slotId: number, expectedVersion: number): Promise<WriteResult> {
    return this.writeSync(expectedVersion, (state) => {
      state.slots = state.slots.filter((s) => s.id !== slotId);
      return state;
    });
  }

  async setGlobalStrategy(strategy: MatchStrategy, expectedVersion: number): Promise<WriteResult> {
    return this.writeSync(expectedVersion, (state) => {
      state.globalStrategy = strategy;
      return state;
    });
  }

  // ─── Local State Mutators ────────────────────────────────────────────────
  //
  // B6: every mutator returns a NEW LocalState object and replaces the affected
  // collection instead of mutating it in place. The updater contract is "pure
  // function of `current`" — callers that hold a previously returned snapshot
  // (e.g. the sidebar's `state.local`) must never observe later writes.

  async setBinding(binding: SlotBinding): Promise<void> {
    await this.writeLocal((state) => {
      const idx = state.bindings.findIndex((b) => b.slotId === binding.slotId);
      const bindings =
        idx >= 0
          ? state.bindings.map((b, i) => (i === idx ? binding : b))
          : [...state.bindings, binding];
      return { ...state, bindings };
    });
  }

  async removeBinding(slotId: number): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      bindings: state.bindings.filter((b) => b.slotId !== slotId),
    }));
  }

  async removeBindingByTabId(tabId: number): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      bindings: state.bindings.filter((b) => b.tabId !== tabId),
      tabOverrides: state.tabOverrides.filter((o) => o.tabId !== tabId),
    }));
  }

  async setCycleCursor(cursor: CycleCursor): Promise<void> {
    await this.writeLocal((state) => {
      const idx = state.cycleCursors.findIndex((c) => c.slotId === cursor.slotId);
      const cycleCursors =
        idx >= 0
          ? state.cycleCursors.map((c, i) => (i === idx ? cursor : c))
          : [...state.cycleCursors, cursor];
      return { ...state, cycleCursors };
    });
  }

  async setLastSuccessSlot(slotId: number): Promise<void> {
    await this.writeLocal((state) => ({ ...state, lastSuccessSlotId: slotId }));
  }

  async addRecoverySession(session: RecoverySession): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      recoverySessions: [...state.recoverySessions, session],
    }));
  }

  async removeRecoverySession(recoveryId: string): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      recoverySessions: state.recoverySessions.filter((s) => s.recoveryId !== recoveryId),
    }));
  }

  async setTabOverride(override: TabOverride): Promise<void> {
    await this.writeLocal((state) => {
      const idx = state.tabOverrides.findIndex((o) => o.tabId === override.tabId);
      const tabOverrides =
        idx >= 0
          ? state.tabOverrides.map((o, i) => (i === idx ? override : o))
          : [...state.tabOverrides, override];
      return { ...state, tabOverrides };
    });
  }

  async removeTabOverride(tabId: number): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      tabOverrides: state.tabOverrides.filter((o) => o.tabId !== tabId),
    }));
  }

  async setIconCache(cacheKey: string, dataUri: string): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      iconCache: { ...state.iconCache, [cacheKey]: dataUri },
    }));
    // B7a write-through: an offloaded icon is referenced as `local-icon:<key>`,
    // so seed the resolution cache for that exact reference too.
    this.iconResolutionCache.set(`${ICON_REF_PREFIX}${cacheKey}`, dataUri);
  }

  async addDiagnostic(entry: DiagnosticEntry): Promise<void> {
    await this.writeLocal((state) => {
      const appended = [...state.diagnostics, entry];
      // Keep max 500 entries
      const diagnostics = appended.length > 500 ? appended.slice(-500) : appended;
      return { ...state, diagnostics };
    });
  }

  async clearDiagnostics(): Promise<void> {
    await this.writeLocal((state) => ({ ...state, diagnostics: [] }));
  }

  // ─── Pending Undo Snapshot (B2) ──────────────────────────────────────────

  /**
   * Store the single-slot undo snapshot under its own local storage key.
   *
   * Kept OUT of `LocalState` on purpose: it is transient device-local data with
   * a 5s TTL, and isolating it avoids polluting the persisted runtime state
   * shape (and its export surface).
   */
  async setPendingUndo(snapshot: PendingUndoSnapshot): Promise<void> {
    await this.adapter.storage.set('local', { [PENDING_UNDO_KEY]: snapshot });
  }

  /**
   * Read the pending undo snapshot for `slotId`.
   *
   * Returns `null` when the snapshot is missing, belongs to another slot, or has
   * expired. Expiry is evaluated lazily here so a service-worker restart that
   * drops the cleanup timer still cannot resurrect a stale snapshot.
   */
  async getPendingUndo(slotId: number): Promise<PendingUndoSnapshot | null> {
    let raw: unknown;
    try {
      const data = await this.adapter.storage.get('local', PENDING_UNDO_KEY);
      raw = data[PENDING_UNDO_KEY];
    } catch {
      return null;
    }

    if (typeof raw !== 'object' || raw === null) return null;
    const candidate = raw as Record<string, unknown>;

    if (candidate.slotId !== slotId) return null;
    if (typeof candidate.expiresAt !== 'number' || candidate.expiresAt < Date.now()) return null;
    if (typeof candidate.slotSnapshot !== 'object' || candidate.slotSnapshot === null) return null;

    return {
      slotId,
      // T34: surface the capture identity so callers can clear precisely the
      // snapshot they consumed. Legacy snapshots without one fall back to 0.
      captureId: typeof candidate.captureId === 'number' ? candidate.captureId : 0,
      slotSnapshot: candidate.slotSnapshot as SlotDefinition,
      bindingSnapshot: (candidate.bindingSnapshot ?? null) as SlotBinding | null,
      expiresAt: candidate.expiresAt,
    };
  }

  /**
   * Clear the pending undo snapshot (own key — never goes through the local queue).
   *
   * T25 (N2): when `slotId` is supplied the key is removed **only if** the stored
   * snapshot still belongs to that slot. The cleanup timer used to remove the
   * shared key unconditionally, so an older slot's timer could delete a newer
   * slot's still-valid snapshot — silently destroying the user's undo.
   *
   * The ownership check reads the raw value rather than going through
   * `getPendingUndo`, because that helper filters out *expired* snapshots and an
   * expired snapshot is exactly what the timer is meant to clean up.
   */
  async clearPendingUndo(slotId?: number, captureId?: number): Promise<void> {
    try {
      if (slotId !== undefined) {
        const data = await this.adapter.storage.get('local', PENDING_UNDO_KEY);
        const raw = data[PENDING_UNDO_KEY] as { slotId?: unknown; captureId?: unknown } | undefined;
        // Never clobber a snapshot owned by a different slot.
        if (!raw || raw.slotId !== slotId) return;
        // T34: and never clobber a NEWER capture of the same slot. When a
        // `captureId` is supplied (always, for timers and restores) ownership
        // must match exactly. Matching on `slotId` alone let the first of two
        // rapid overwrites destroy the second, still-valid undo snapshot.
        if (captureId !== undefined && raw.captureId !== captureId) return;
      }
      await this.adapter.storage.remove('local', PENDING_UNDO_KEY);
    } catch {
      // Removal is best-effort; an expired snapshot is ignored on read anyway.
    }
  }

  // ─── Startup Cleanup ─────────────────────────────────────────────────────

  /**
   * Validate saved tabIds still exist and clean expired recovery sessions.
   * Called on Service Worker startup.
   */
  async startupCleanup(): Promise<{ removedBindings: number; removedSessions: number }> {
    const local = await this.getLocalState();
    let removedBindings = 0;
    let removedSessions = 0;

    // B12: ONE bulk query replaces the previous N+1 `tabs.get` fan-out.
    const allTabs = await this.adapter.tabs.query({});
    const liveTabIds = new Set(allTabs.map((t) => t.id));

    // Validate tabIds
    const validBindings: SlotBinding[] = [];
    for (const binding of local.bindings) {
      if (liveTabIds.has(binding.tabId)) {
        validBindings.push(binding);
      } else {
        removedBindings++;
      }
    }

    // Clean expired recovery sessions (5 min TTL)
    const now = Date.now();
    const validSessions = local.recoverySessions.filter((s) => {
      const expired = new Date(s.expiresAt).getTime() < now;
      if (expired) removedSessions++;
      return !expired;
    });

    // Also clean tab overrides for non-existent tabs
    const validOverrides: TabOverride[] = local.tabOverrides.filter((override) =>
      liveTabIds.has(override.tabId)
    );

    if (removedBindings > 0 || removedSessions > 0 || validOverrides.length !== local.tabOverrides.length) {
      await this.writeLocal((state) => {
        state.bindings = validBindings;
        state.recoverySessions = validSessions;
        state.tabOverrides = validOverrides;
        return state;
      });
    }

    return { removedBindings, removedSessions };
  }

  /**
   * Atomic cleanup for tabs.onRemoved event.
   */
  async cleanupForRemovedTab(tabId: number): Promise<void> {
    await this.removeBindingByTabId(tabId);
  }

  // ─── External Change Detection ───────────────────────────────────────────

  /**
   * Check if sync state was changed externally (by another device).
   * Returns the new config version if changed.
   * In fallback mode (sync unavailable), external changes are not possible.
   */
  async checkExternalChange(): Promise<{ changed: boolean; newVersion: number }> {
    if (!this.syncAvailable) {
      return { changed: false, newVersion: this.syncCache?.configVersion ?? 0 };
    }

    try {
      const data = await this.adapter.storage.get('sync', SYNC_KEY);
      const remote = data[SYNC_KEY] as SyncState | undefined;
      const currentVersion = this.syncCache?.configVersion ?? 0;

      if (remote && remote.configVersion !== currentVersion) {
        this.syncCache = remote;
        this.cacheValid = true;
        return { changed: true, newVersion: remote.configVersion };
      }
      return { changed: false, newVersion: currentVersion };
    } catch {
      // Sync became unavailable during check — switch to fallback
      this.syncAvailable = false;
      return { changed: false, newVersion: this.syncCache?.configVersion ?? 0 };
    }
  }
}
