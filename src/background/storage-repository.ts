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
      if (rule.favicon?.value.startsWith(ICON_REF_PREFIX)) {
        const iconKey = rule.favicon.value.slice(ICON_REF_PREFIX.length);
        try {
          const data = await this.adapter.storage.get('local', iconKey);
          const actualUri = data[iconKey] as string | undefined;
          if (actualUri) {
            resolved.rules[i] = { ...rule, favicon: { ...rule.favicon, value: actualUri } };
          }
        } catch {
          // Local read failed — keep the reference as-is (icon will show placeholder)
        }
      }
    }

    for (let i = 0; i < resolved.slots.length; i++) {
      const slot = resolved.slots[i];
      const iconValue = slot.uiMarker?.icon?.value;
      if (iconValue?.startsWith(ICON_REF_PREFIX)) {
        const iconKey = iconValue.slice(ICON_REF_PREFIX.length);
        try {
          const data = await this.adapter.storage.get('local', iconKey);
          const actualUri = data[iconKey] as string | undefined;
          if (actualUri) {
            resolved.slots[i] = {
              ...slot,
              uiMarker: { ...slot.uiMarker, icon: { ...slot.uiMarker.icon!, value: actualUri } },
            };
          }
        } catch {
          // Local read failed — keep the reference as-is
        }
      }
    }

    return resolved;
  }

  // ─── Local Write Operations ──────────────────────────────────────────────

  /**
   * Write local state (no version check — local is device-specific).
   * Serialized through a queue to prevent concurrent read-modify-write races (Problem 5).
   */
  async writeLocal(updater: (current: LocalState) => LocalState): Promise<void> {
    this.localWriteQueue = this.localWriteQueue.then(async () => {
      const current = await this.getLocalState();
      const updated = updater(current);
      await this.adapter.storage.set('local', { [LOCAL_KEY]: updated });
      this.localCache = updated;
    });
    return this.localWriteQueue;
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

  async setBinding(binding: SlotBinding): Promise<void> {
    await this.writeLocal((state) => {
      const idx = state.bindings.findIndex((b) => b.slotId === binding.slotId);
      if (idx >= 0) {
        state.bindings[idx] = binding;
      } else {
        state.bindings.push(binding);
      }
      return state;
    });
  }

  async removeBinding(slotId: number): Promise<void> {
    await this.writeLocal((state) => {
      state.bindings = state.bindings.filter((b) => b.slotId !== slotId);
      return state;
    });
  }

  async removeBindingByTabId(tabId: number): Promise<void> {
    await this.writeLocal((state) => {
      state.bindings = state.bindings.filter((b) => b.tabId !== tabId);
      state.tabOverrides = state.tabOverrides.filter((o) => o.tabId !== tabId);
      return state;
    });
  }

  async setCycleCursor(cursor: CycleCursor): Promise<void> {
    await this.writeLocal((state) => {
      const idx = state.cycleCursors.findIndex((c) => c.slotId === cursor.slotId);
      if (idx >= 0) {
        state.cycleCursors[idx] = cursor;
      } else {
        state.cycleCursors.push(cursor);
      }
      return state;
    });
  }

  async setLastSuccessSlot(slotId: number): Promise<void> {
    await this.writeLocal((state) => {
      state.lastSuccessSlotId = slotId;
      return state;
    });
  }

  async addRecoverySession(session: RecoverySession): Promise<void> {
    await this.writeLocal((state) => {
      state.recoverySessions.push(session);
      return state;
    });
  }

  async removeRecoverySession(recoveryId: string): Promise<void> {
    await this.writeLocal((state) => {
      state.recoverySessions = state.recoverySessions.filter((s) => s.recoveryId !== recoveryId);
      return state;
    });
  }

  async setTabOverride(override: TabOverride): Promise<void> {
    await this.writeLocal((state) => {
      const idx = state.tabOverrides.findIndex((o) => o.tabId === override.tabId);
      if (idx >= 0) {
        state.tabOverrides[idx] = override;
      } else {
        state.tabOverrides.push(override);
      }
      return state;
    });
  }

  async removeTabOverride(tabId: number): Promise<void> {
    await this.writeLocal((state) => {
      state.tabOverrides = state.tabOverrides.filter((o) => o.tabId !== tabId);
      return state;
    });
  }

  async setIconCache(cacheKey: string, dataUri: string): Promise<void> {
    await this.writeLocal((state) => {
      state.iconCache[cacheKey] = dataUri;
      return state;
    });
  }

  async addDiagnostic(entry: DiagnosticEntry): Promise<void> {
    await this.writeLocal((state) => {
      state.diagnostics.push(entry);
      // Keep max 500 entries
      if (state.diagnostics.length > 500) {
        state.diagnostics = state.diagnostics.slice(-500);
      }
      return state;
    });
  }

  async clearDiagnostics(): Promise<void> {
    await this.writeLocal((state) => {
      state.diagnostics = [];
      return state;
    });
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

    // Validate tabIds
    const validBindings: SlotBinding[] = [];
    for (const binding of local.bindings) {
      try {
        await this.adapter.tabs.get(binding.tabId);
        validBindings.push(binding);
      } catch {
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
    const validOverrides: TabOverride[] = [];
    for (const override of local.tabOverrides) {
      try {
        await this.adapter.tabs.get(override.tabId);
        validOverrides.push(override);
      } catch {
        // Tab no longer exists
      }
    }

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
