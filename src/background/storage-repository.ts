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
  MatchRuleSettings,
  SwitchDirection,
  SlotBinding,
  CycleCursor,
  RecoverySession,
  TabOverride,
  DiagnosticEntry,
  DomainErrorCode,
  SiteSnapshotEntry,
  TagDefinition,
} from '@shared/types';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';
import { urlsMatch } from '@shared/url-utils';
// The prefix has exactly ONE owner (`icon-ref.ts`); this alias keeps the local
// name while importing the constant, so the literal is never re-spelled here.
import { LOCAL_ICON_REF_PREFIX as ICON_REF_PREFIX } from '@shared/icon-ref';
import { RecipeRenderer } from './recipe-renderer';

// ─── Storage Keys ────────────────────────────────────────────────────────────

const SYNC_KEY = 'syncState';
const LOCAL_KEY = 'localState';
/** Fallback key in local storage when chrome.storage.sync is unavailable */
const SYNC_FALLBACK_KEY = 'syncStateFallback';
/**
 * Dedicated local key holding the STACK of pending undo snapshots (B2/U5).
 *
 * The key's VALUE string is unchanged; only what lives INSIDE it changed: a
 * single snapshot became an array of them (U5). One entry = one undoable action,
 * so a swap carries BOTH slots' state (Z1) instead of needing a parallel key.
 */
const PENDING_UNDO_KEY = 'pendingUndo';

/**
 * How long an undo snapshot stays valid in the worker.
 *
 * Deliberately LONGER than the UI's 5-second bar (`UNDO_DEFAULT_MS`), because the
 * two clocks start at different moments: the worker stamps `expiresAt` when it
 * CAPTURES, while the user only sees the bar once the response has travelled back.
 * With both set to 5s the round trip was charged to the user's 5 seconds, so on a
 * slow first action (cold service-worker start) the bar arrived with almost none
 * of its life left and vanished before it could be read — reported defect 1,
 * "the first swap shows no undo bar".
 *
 * The worker keeps its snapshot for longer than it shows the bar, which is
 * harmless: the entry is reclaimed lazily and its only job is to keep the capture
 * addressable for as long as any bar could still be on screen.
 */
export const PENDING_UNDO_TTL_MS = 20_000;

/**
 * One undoable action, stored in its own `storage.local` key (U5/Z1).
 *
 * `expiresAt` is validated lazily PER ENTRY on read, so a sleeping service worker
 * cannot lose an expiry (the timer alone is not sufficient).
 *
 * Discriminated on `kind`: an ordinary overwrite restores ONE slot, while a slot
 * swap must restore TWO (content + binding) — hence the `swap` variant (Z1).
 * `id` is the stack-local identity the UI uses to say "undo the bar I clicked";
 * `captureId` is the backend identity that proves capture ownership (T34). They
 * are deliberately NOT the same thing.
 */
export type PendingUndoSnapshot =
  | {
      kind: 'single';
      id: string;
      /**
       * T34: identity of THIS capture.
       *
       * `slotId` alone is not enough to decide ownership: two overwrites of the same
       * slot in quick succession produce two captures, and the first capture's
       * cleanup timer used to match on `slotId` and delete the second, still-valid
       * one. The timer now proves ownership by capture identity.
       */
      captureId: number;
      slotId: number;
      slotSnapshot: SlotDefinition | null;
      bindingSnapshot: SlotBinding | null;
      expiresAt: number;
    }
  | {
      kind: 'swap';
      id: string;
      captureId: number;
      sourceSlotId: number;
      targetSlotId: number;
      sourceSnapshot: SlotDefinition | null;
      sourceBinding: SlotBinding | null;
      targetSnapshot: SlotDefinition | null;
      targetBinding: SlotBinding | null;
      expiresAt: number;
    };

/**
 * Tolerant read of one stack entry (U5).
 *
 * Legacy archives stored a SINGLE object (no `kind`, no `id`) under the same key;
 * it is read back as a one-element `single` stack entry. Returns `null` for
 * anything that cannot be attributed to a slot (so a corrupt entry is dropped
 * rather than resurrected).
 */
function normalizePendingUndoSnapshot(raw: unknown): PendingUndoSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.expiresAt !== 'number') return null;

  const captureId = typeof candidate.captureId === 'number' ? candidate.captureId : 0;
  const kind = candidate.kind === 'swap' ? 'swap' : 'single';

  if (kind === 'swap') {
    if (typeof candidate.sourceSlotId !== 'number' || typeof candidate.targetSlotId !== 'number') return null;
    return {
      kind: 'swap',
      id: typeof candidate.id === 'string' ? candidate.id : `swap-${String(captureId)}`,
      captureId,
      sourceSlotId: candidate.sourceSlotId,
      targetSlotId: candidate.targetSlotId,
      sourceSnapshot: (candidate.sourceSnapshot ?? null) as SlotDefinition | null,
      sourceBinding: (candidate.sourceBinding ?? null) as SlotBinding | null,
      targetSnapshot: (candidate.targetSnapshot ?? null) as SlotDefinition | null,
      targetBinding: (candidate.targetBinding ?? null) as SlotBinding | null,
      expiresAt: candidate.expiresAt,
    };
  }

  if (typeof candidate.slotId !== 'number') return null;
  // Same validation the single-slot read used: an entry with no usable slot
  // snapshot is not restorable (UNDO_SAVE then degrades to deletion).
  if (typeof candidate.slotSnapshot !== 'object' || candidate.slotSnapshot === null) return null;
  return {
    kind: 'single',
    id: typeof candidate.id === 'string' ? candidate.id : `single-${String(captureId)}`,
    captureId,
    slotId: candidate.slotId,
    slotSnapshot: candidate.slotSnapshot as SlotDefinition,
    bindingSnapshot: (candidate.bindingSnapshot ?? null) as SlotBinding | null,
    expiresAt: candidate.expiresAt,
  };
}

/**
 * Whether a raw stack entry should be removed by `clearPendingUndo` (U5/T4).
 *
 * `captureId` is the ONLY identity that applies to both variants (a `swap` entry
 * carries no `slotId`) and is globally unique (the `slot-service` module
 * counter), so it is the exact-ownership test. A legacy `slotId`-only call can
 * only ever match `single` entries. No identity at all → clear the whole stack.
 */
function shouldClearPendingUndo(raw: unknown, slotId?: number, captureId?: number): boolean {
  if (typeof raw !== 'object' || raw === null) return slotId === undefined && captureId === undefined;
  const candidate = raw as Record<string, unknown>;
  if (captureId !== undefined) return candidate.captureId === captureId;
  if (slotId !== undefined) return candidate.kind !== 'swap' && candidate.slotId === slotId;
  // R5: with NO identity at all this is the legacy "clear everything" behaviour,
  // kept only as a last-resort drain. Every production caller passes at least one
  // identity (`slot-service` passes both — see the four call sites), so this branch
  // is unreachable from the app; it exists so a future caller that genuinely wants
  // to drop the whole stack does not have to loop. Do NOT call `clearPendingUndo()`
  // with no arguments casually: it empties the stack for every pending action.
  return true;
}

// ─── Icon Offloading ─────────────────────────────────────────────────────────

/** Threshold (bytes) above which data URI icons are offloaded to local storage */
export const ICON_OFFLOAD_THRESHOLD = 6 * 1024; // 6KB
const ICON_STORAGE_PREFIX = 'icon:';

/** Delay between retry attempts for transient storage failures */
const RETRY_DELAY_MS = 200;

// ─── Default States ──────────────────────────────────────────────────────────

export function createDefaultSyncState(): SyncState {
  return {
    configVersion: 0,
    matchSettings: DEFAULT_MATCH_SETTINGS,
    switchDirection: 'next',
    autoBindGlobal: true,
    slots: [],
    rules: [],
    tags: [],
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
  /**
   * Serial write queue for the pending-undo stack (F4 finding).
   *
   * `setPendingUndo` is a read-modify-write over a key that is deliberately kept
   * OUTSIDE `LocalState` (see its doc comment), so it cannot ride
   * `localWriteQueue` without also dragging in that state's invariants. Once the
   * snapshot became an ARRAY (U5), two concurrent captures could interleave
   * get → push → set and the later `set` would DISCARD the earlier entry — a
   * silently lost undo bar. A single-slot layout could not lose anything, so
   * this window was introduced by the stack change and is closed here.
   */
  private pendingUndoWriteQueue: Promise<void> = Promise.resolve();
  /** Whether chrome.storage.sync is available. If false, "sync" data is stored in local. */
  private syncAvailable = true;
  /**
   * Memoized `local-icon:<key>` → data URI resolutions (B7a / T10).
   * Instance-scoped on purpose: a service-worker restart is expected to drop it.
   * A `null` value records "resolved but absent" so misses are not retried.
   */
  private iconResolutionCache = new Map<string, string | null>();

  /**
   * R2: the single recipe renderer (`OffscreenCanvas` → PNG). Owned here because
   * the render happens on the READ path (`resolveIconReferences`), so delivery
   * and the UI share one rendered result through `getSyncState()`.
   */
  private recipeRenderer: RecipeRenderer = new RecipeRenderer(this);

  constructor(private adapter: BrowserAdapter) {}

  /** Test seam: inject a renderer stub (jsdom has no `OffscreenCanvas`). */
  setRecipeRenderer(renderer: RecipeRenderer): void {
    this.recipeRenderer = renderer;
  }

  /**
   * R2 companion invariant: a recipe's stored `value` must stay EMPTY.
   *
   * `resolveIconReferences` renders a recipe INTO `value` (so the synchronous
   * chain and the delivery path can use it), but the write path re-reads
   * through `getSyncState()` and persists that object — which would silently
   * promote the derived render to the durable truth. That is the design's
   * explicitly REJECTED alternative ("store the recipe AND the first render"),
   * rejected because the two can drift and then silently deliver a stale icon;
   * past the 6KB threshold it would also be offloaded, bloating sync storage.
   *
   * The invariant is unambiguous: for `type:'template'` the value is only ever
   * the derived render, so it is normalized back to `''` before any mutate or
   * persist. Legitimate recipe writes already carry `value:''` and are untouched
   * (the recipe fields and the `type` are preserved).
   */
  private stripDerivedRecipeValues(state: SyncState): void {
    for (const rule of state.rules) {
      if (rule.favicon?.type === 'template' && rule.favicon.value !== '') {
        rule.favicon = { ...rule.favicon, value: '' };
      }
    }
    for (const slot of state.slots) {
      const icon = slot.uiMarker?.icon;
      if (icon?.type === 'template' && icon.value !== '') {
        slot.uiMarker = { ...slot.uiMarker, icon: { ...icon, value: '' } };
      }
    }
  }

  /**
   * FIX-B: the LOCAL twin of `stripDerivedRecipeValues`.
   *
   * A `tabOverride` lives in `LocalState`, and `writeLocal` re-reads through
   * `getLocalState()` — which now materializes an override recipe into `value`.
   * Persisting that object would promote the derived render to the durable
   * truth, exactly the R2 hazard on the other storage area.
   *
   * Scope: ONLY `LocalState`. `pendingUndo` is a separate storage key (not part
   * of `LocalState`), so it is deliberately outside this invariant.
   */
  private stripDerivedLocalRecipeValues(state: LocalState): LocalState {
    // B6: RETURN a new state rather than mutating in place. `getLocalState()`
    // shallow-copies the cache, so its `tabOverrides` array is SHARED with
    // `localCache` — an in-place edit would silently pollute the cache. Callers
    // must USE this return value (a discarded return would make this a no-op).
    let changed = false;
    const tabOverrides = state.tabOverrides.map((override) => {
      if (override.favicon?.type === 'template' && override.favicon.value !== '') {
        changed = true;
        return { ...override, favicon: { ...override.favicon, value: '' } };
      }
      return override;
    });
    return changed ? { ...state, tabOverrides } : state;
  }

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
   * Normalize persisted sync state to the current shape.
   *
   * NO MIGRATION (design ruling 2026-09-30): legacy data is ignored and silently
   * falls back to the new defaults (`exists + match + tabId`). We deliberately
   * do NOT read the old strategy field, do NOT sniff shapes, and do NOT bump
   * `configVersion`.
   */
  private migrateSyncState(state: Partial<SyncState>): SyncState {
    return {
      configVersion: state.configVersion ?? 0,
      matchSettings: state.matchSettings ?? DEFAULT_MATCH_SETTINGS,
      switchDirection: state.switchDirection ?? 'next',
      autoBindGlobal: state.autoBindGlobal ?? true,
      slots: state.slots ?? [],
      // P2: an archive predating tags reads as an EMPTY table with empty
      // per-rule `tagIds`, per the SAME lenient `??` stance every other top
      // field already takes (`tags` is not a special case). No migration branch
      // is written — strictness is reserved for import PACKAGES (C9-②).
      rules: (state.rules ?? []).map((r) => ({ ...r, tagIds: r.tagIds ?? [] })),
      tags: state.tags ?? [],
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
    // B6: snapshots must not share mutable ARRAYS with the cache. A shallow
    // spread would leave `bindings` / `tabOverrides` as the cache's own arrays,
    // so a caller editing a snapshot (or `writeLocal`'s updater) would corrupt
    // `localCache`. The element objects are still shared — callers treat them as
    // immutable and copy on write, which every local write already does.
    const cache = this.localCache!;
    const snapshot: LocalState = {
      ...cache,
      bindings: [...cache.bindings],
      cycleCursors: [...cache.cycleCursors],
      recoverySessions: [...cache.recoverySessions],
      recoverySnapshots: [...cache.recoverySnapshots],
      tabOverrides: [...cache.tabOverrides],
      diagnostics: [...cache.diagnostics],
    };
    // FIX-B: materialize a `tabOverrides` recipe into `value`, mirroring R2 on
    // the sync reads. The override is the HIGHEST priority tier, so without this
    // an override recipe stayed `''` → the chain read `null` → the delivery fell
    // back to `restore` and the current page's icon never changed.
    return this.resolveLocalIconReferences(snapshot);
  }

  /**
   * FIX-B: local twin of `resolveIconReferences` — the read-time materialization
   * for the ONE local record kind that carries an `IconSource`. Reuses the SAME
   * `RecipeRenderer` (no second renderer) and the SAME memoization.
   *
   * Never yields SVG: on failure the value is left as-is (`''`), so the chain
   * reads `null` and the delivery restores — the recipe fields stay editable.
   */
  private async resolveLocalIconReferences(state: LocalState): Promise<LocalState> {
    const overrides = state.tabOverrides;
    let changed = false;
    const resolvedOverrides = [...overrides];

    for (let i = 0; i < resolvedOverrides.length; i++) {
      const override = resolvedOverrides[i];
      if (override.favicon?.type !== 'template') continue;

      const rendered = await this.recipeRenderer.renderForResolution({
        backgroundColor: override.favicon.backgroundColor,
        text: override.favicon.text,
        textColor: override.favicon.textColor,
      });
      if (!rendered) continue; // leave `''` → the chain falls through

      resolvedOverrides[i] = { ...override, favicon: { ...override.favicon, value: rendered } };
      changed = true;
    }

    return changed ? { ...state, tabOverrides: resolvedOverrides } : state;
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
        // R2: the updater may have carried a read-time render back (the object it
        // received already had recipe values materialized) — keep the recipe's
        // own value empty so the render never becomes the durable truth.
        this.stripDerivedRecipeValues(updated);
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
    this.syncWriteQueue = operation.catch(() => ({ success: false, errorCode: 'INTERNAL_ERROR', message: 'write failed' }));
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
   *
   * R2 also materializes `type:'template'` recipes HERE — the read boundary, so
   * it happens BEFORE the (synchronous, value-only) field chain. The chain, the
   * delivery path and the UI all read `getSyncState()`, so they share this one
   * rendered PNG (the promise R1 never actually delivered). The recipe fields
   * and the `type` are left intact so the UI can still EDIT the recipe and the
   * export can still ship it as a reproducible recipe.
   *
   * Same shape as the pre-existing `local-icon:` dereferencing: "parse then
   * materialize at read time" is the established pattern here, not a new one.
   */
  private async resolveIconReferences(state: SyncState): Promise<SyncState> {
    const resolved = { ...state, rules: [...state.rules], slots: [...state.slots] };

    for (let i = 0; i < resolved.rules.length; i++) {
      const rule = resolved.rules[i];

      // R2: a recipe is materialized to a PNG data URI in `value`. The renderer
      // never yields SVG (a failure degrades to the PNG placeholder, or leaves
      // the value unset so the chain reads `null` and the delivery restores).
      if (rule.favicon?.type === 'template') {
        const rendered = await this.recipeRenderer.renderForResolution({
          backgroundColor: rule.favicon.backgroundColor,
          text: rule.favicon.text,
          textColor: rule.favicon.textColor,
        });
        if (rendered) {
          resolved.rules[i] = { ...rule, favicon: { ...rule.favicon, value: rendered } };
        }
        continue;
      }

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
      const icon = slot.uiMarker?.icon;

      // R2: same read-time materialization for a slot's recipe icon.
      if (icon?.type === 'template') {
        const rendered = await this.recipeRenderer.renderForResolution({
          backgroundColor: icon.backgroundColor,
          text: icon.text,
          textColor: icon.textColor,
        });
        if (rendered) {
          resolved.slots[i] = {
            ...slot,
            uiMarker: { ...slot.uiMarker, icon: { ...icon, value: rendered } },
          };
        }
        continue;
      }

      const ref = icon?.value;
      if (ref?.startsWith(ICON_REF_PREFIX)) {
        const actualUri = await this.resolveIconRef(ref);
        if (actualUri && icon) {
          resolved.slots[i] = {
            ...slot,
            uiMarker: { ...slot.uiMarker, icon: { ...icon, value: actualUri } },
          };
        }
      }
    }

    return resolved;
  }

  /**
   * T12/R1: read a memoized recipe-render result from the SAME
   * `iconResolutionCache` the `local-icon:` dereferencer uses (one cache, two
   * key spaces — recipes are keyed `recipe:<sig>`).
   *
   * Returns `undefined` on a cold miss, `null` for "known-bad" (render failed —
   * do not retry on every read), or the cached `data:image/png…` string.
   */
  getRecipeResolution(signature: string): string | null | undefined {
    return this.iconResolutionCache.get(signature);
  }

  /** T12/R1: memoize a recipe render (or a `null` failure) against the signature. */
  cacheRecipeResolution(signature: string, value: string | null): void {
    this.iconResolutionCache.set(signature, value);
  }

  /**
   * T6: resolve a `local-icon:<key>` reference for a READ path, memoized.
   *
   * Exposed so a consumer can distinguish "resolved" from "unresolvable" — the
   * latter is a MISSING icon (C9), not a value to keep as a literal. Returns
   * `null` when the reference has no local blob.
   */
  async resolveIconReference(reference: string): Promise<string | null> {
    return this.resolveIconRef(reference);
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
      // `getLocalState()` materializes override recipes (FIX-B); the object it
      // returns must never be persisted with a derived render in `value`.
      // Both calls USE the returned (new) state — discarding it would be a
      // silent no-op.
      const current = this.stripDerivedLocalRecipeValues(await this.getLocalState());
      const updated = this.stripDerivedLocalRecipeValues(updater(current));
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

  /**
   * A-g: the tag table, read through the ordinary sync snapshot path.
   *
   * Returns a COPY of the array. `getSyncState` already hands back a shallow
   * copy, and the array itself is cloned here so a caller cannot append to the
   * live table by holding onto what a read gave it.
   */
  async getTags(): Promise<TagDefinition[]> {
    const state = await this.getSyncState();
    return state.tags.map((tag) => ({ ...tag }));
  }

  /**
   * A-g/A-h: the ONE write primitive for tags and their references.
   *
   * A THIN wrapper over the existing private `mutateSync` (same shape as
   * `addRule`/`updateRuleById`/`removeRuleById`) — deliberately not a public
   * `mutateSync`, so the exposed surface stays minimal (R4).
   *
   * Why it takes a whole mutator rather than a tag-shaped operation: the caller
   * must be able to change the tag TABLE and N rules' `tagIds` in ONE call. That
   * single call is one `mutateSync` operation, which is one version bump and one
   * serialized storage write — the atomicity that C5's batch snapshot and undo
   * depend on. Splitting a cascade into two calls would produce two bumps and
   * two write windows (A-g).
   *
   * Business rules (trim, dedupe, limits, cascade SEMANTICS) stay in
   * `TagService`; this layer only moves bytes (P4).
   */
  async mutateSyncTags(mutator: (draft: SyncState) => void): Promise<void> {
    await this.mutateSync(mutator);
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
      // R2: never let a read-time render become the durable truth (see below).
      this.stripDerivedRecipeValues(draft);
      mutator(draft);
      // MEDIUM-A: strip AGAIN after the mutator. `writeSync` already does this,
      // but `updateRuleById` spreads caller-supplied `updates` over the record,
      // so a mutator could inject a materialized value. Stripping on both sides
      // makes the invariant independent of "the mutator keeps type intact".
      this.stripDerivedRecipeValues(draft);
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

  async setMatchSettings(settings: MatchRuleSettings, expectedVersion: number): Promise<WriteResult> {
    return this.writeSync(expectedVersion, (state) => {
      state.matchSettings = settings;
      return state;
    });
  }

  async setSwitchDirection(direction: SwitchDirection, expectedVersion: number): Promise<WriteResult> {
    return this.writeSync(expectedVersion, (state) => {
      state.switchDirection = direction;
      return state;
    });
  }

  async setAutoBindGlobal(enabled: boolean, expectedVersion: number): Promise<WriteResult> {
    return this.writeSync(expectedVersion, (state) => {
      state.autoBindGlobal = enabled;
      return state;
    });
  }

  /**
   * Per-slot auto-bind override (D14). `override: null` clears the override so
   * the slot follows `autoBindGlobal` again.
   */
  async setSlotAutoBindOverride(
    slotId: number,
    override: boolean | null,
    expectedVersion: number,
  ): Promise<WriteResult> {
    return this.writeSync(expectedVersion, (state) => {
      const idx = state.slots.findIndex((s) => s.id === slotId);
      if (idx < 0) return state;
      const next = { ...state.slots[idx] };
      if (override === null) {
        delete next.autoBindOverride;
      } else {
        next.autoBindOverride = override;
      }
      state.slots = state.slots.map((s, i) => (i === idx ? next : s));
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

  /**
   * Patch a recovery session in place (immutably). Used to persist the browse
   * cursor and to backfill the recovery window id (T6 / A11 / DT2).
   */
  async updateRecoverySession(
    recoveryId: string,
    patch: Partial<Pick<RecoverySession, 'candidateCursor' | 'windowId'>>,
  ): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      recoverySessions: state.recoverySessions.map((s) =>
        s.recoveryId === recoveryId ? { ...s, ...patch } : s,
      ),
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

  // ─── Site Snapshot (A7 — strictly local, never exported) ────────────────

  /**
   * Persist the site's captured original value for a tab. Strictly sealed to
   * `local`: this data never enters `sync`, export, import or diagnostics.
   */
  async setSiteSnapshot(entry: SiteSnapshotEntry): Promise<void> {
    await this.writeLocal((state) => {
      const existing = state.siteSnapshot ?? [];
      const idx = existing.findIndex((s) => s.tabId === entry.tabId);
      const siteSnapshot =
        idx >= 0
          ? existing.map((s, i) => (i === idx ? entry : s))
          : [...existing, entry];
      return { ...state, siteSnapshot };
    });
  }

  /** Drop a tab's captured original value (chain no longer rewrites / tab closed). */
  async removeSiteSnapshot(tabId: number): Promise<void> {
    await this.writeLocal((state) => ({
      ...state,
      siteSnapshot: (state.siteSnapshot ?? []).filter((s) => s.tabId !== tabId),
    }));
  }

  /**
   * T11 / C10: clear the LOCAL icon blobs belonging to records that were just
   * REPLACED, and restore them if the sync write fails.
   *
   * Why this is needed (§3.7): a reference key is derived from the record id
   * (`icon:slot-3`). If the target machine happens to have slot 3 AND its icon
   * was offloaded, a replaced record's stale blob would make the reference
   * resolve against the TARGET's own icon — a "false success" that is WORSE than
   * a broken image, because the user sees a working icon and never re-selects.
   * Clearing first makes the reference unresolvable, so it lands in "missing".
   *
   * Atomicity (§3.6): there is no cross-area transaction, so this is
   * snapshot → clear → write → (on failure) restore.
   *
   * Scope is strict: only the passed keys are touched; a `keep existing` record
   * is never in the set (C10-①).
   */
  async clearAndWriteWithCompensation(
    keysToClear: string[],
    expectedVersion: number,
    updater: (current: SyncState) => SyncState,
  ): Promise<WriteResult> {
    const storage = this.adapter.storage;

    // ① Snapshot the original local values (in memory) — ONLY the keys in scope.
    const snapshot = new Map<string, unknown>();
    for (const key of keysToClear) {
      try {
        const data = await storage.get('local', key);
        if (data[key] !== undefined) snapshot.set(key, data[key]);
      } catch {
        // Unreadable ⇒ nothing to restore; the clear below is still safe.
      }
    }

    // ② Clear the local icon keys.
    if (keysToClear.length > 0) {
      try {
        await storage.remove('local', keysToClear);
      } catch {
        // A failed clear means the reference stays resolvable (the pre-C10
        // behaviour) — a degradation, not corruption, so proceed to the write.
      }
    }
    // The resolution memo may now be stale for these keys (a clear arrives as a
    // `remove`, which does not broadcast `onChanged` in every adapter). Dropping
    // it is a CONTRACT, not redundancy: the T22 judgment test
    // (`tests/integration/import-apply-result.test.ts`, a REPLACED record whose
    // key is also present on the target) fails if this line is removed. Run that
    // file, not just the caller's, when refactoring this method.
    this.iconResolutionCache.clear();

    // ③ Write the sync config through the single version-bound writer.
    const result = await this.writeSync(expectedVersion, updater);

    // ③ failed → ④ restore the touched local keys so the attempt is a no-op.
    if (!result.success && snapshot.size > 0) {
      try {
        await storage.set('local', Object.fromEntries(snapshot));
      } catch {
        console.warn('[StorageRepository] icon-slot compensation failed to restore local keys');
      }
      this.iconResolutionCache.clear();
    }

    return result;
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
   * Append an undo snapshot to the stack under its own local storage key (U5).
   *
   * Kept OUT of `LocalState` on purpose: it is transient device-local data with
   * a 5s TTL, and isolating it avoids polluting the persisted runtime state
   * shape (and its export surface).
   *
   * Appends rather than overwrites: every undoable action earns its own stack
   * entry (U1/U7 — unbounded, reclaimed one-by-one by per-entry expiry).
   */
  async setPendingUndo(snapshot: PendingUndoSnapshot): Promise<void> {
    // Read-modify-write; the write itself is a direct `storage.set` (never the
    // local queue) so the stack stays isolated from `LocalState`.
    //
    // F4: serialized on its OWN queue. Without this, two concurrent captures
    // interleave and the later write discards the earlier snapshot — a lost undo
    // bar, a failure mode the single-slot layout could not have.
    const run = this.pendingUndoWriteQueue.then(async () => {
      let stack: PendingUndoSnapshot[] = [];
      try {
        const data = await this.adapter.storage.get('local', PENDING_UNDO_KEY);
        stack = this.readPendingUndoStack(data[PENDING_UNDO_KEY]);
      } catch {
        stack = [];
      }
      stack.push(snapshot);
      await this.adapter.storage.set('local', { [PENDING_UNDO_KEY]: stack });
    });
    // Keep the queue alive regardless of this operation's outcome (same
    // resilience contract as `writeLocal`).
    this.pendingUndoWriteQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Read the pending undo stack (U5).
   *
   * With `captureId` → the ONE entry carrying that identity (or `null`). This is
   * the form the APP uses: `restoreSlot` needs exactly the capture the bar named.
   * Without it → every unexpired entry, newest last.
   *
   * R4: the no-argument form is NOT how the UI builds its bars — a surface pushes
   * an entry as it performs the action, so it never needs to reconstruct the stack
   * by reading it back. The array form exists so the stack can be OBSERVED as a
   * whole (tests assert on it, and a future drain/repair path would need it); it
   * has no production caller today. Do not mistake it for a UI contract.
   *
   * Expiry is evaluated lazily PER ENTRY so a service-worker restart that drops
   * the cleanup timers still cannot resurrect a stale snapshot.
   */
  async getPendingUndo(): Promise<PendingUndoSnapshot[]>;
  async getPendingUndo(captureId: number): Promise<PendingUndoSnapshot | null>;
  async getPendingUndo(captureId?: number): Promise<PendingUndoSnapshot | PendingUndoSnapshot[] | null> {
    let raw: unknown;
    try {
      const data = await this.adapter.storage.get('local', PENDING_UNDO_KEY);
      raw = data[PENDING_UNDO_KEY];
    } catch {
      return captureId === undefined ? [] : null;
    }

    const now = Date.now();
    const live = this.readPendingUndoStack(raw).filter((entry) => entry.expiresAt >= now);

    if (captureId === undefined) return live;
    return live.find((entry) => entry.captureId === captureId) ?? null;
  }

  /**
   * Remove entries from the pending undo stack (own key — never the local queue).
   *
   * T25 (N2) / T4: the cleanup timer used to remove the WHOLE key. With a stack
   * that would let any one entry's timer (or any one undo) destroy every other
   * entry's still-valid undo. Matching is by `captureId` when supplied — the only
   * identity shared by both entry variants and globally unique (T34) — then falls
   * back to the legacy `slotId` match for `single` entries. The key is removed
   * only once the stack is empty (no empty-array residue).
   *
   * The ownership check reads the raw value rather than going through
   * `getPendingUndo`, because that helper filters out *expired* entries and an
   * expired entry is exactly what the timer is meant to clean up.
   */
  async clearPendingUndo(slotId?: number, captureId?: number): Promise<void> {
    // F4: same read-modify-write race as `setPendingUndo` — shares its queue so a
    // cleanup cannot interleave with a capture and resurrect a cleared entry (or
    // drop a fresh one).
    const run = this.pendingUndoWriteQueue.then(async () => {
      try {
        const data = await this.adapter.storage.get('local', PENDING_UNDO_KEY);
        const rawStack = this.readPendingUndoStack(data[PENDING_UNDO_KEY]);
        const remaining = rawStack.filter(
          (entry) => !shouldClearPendingUndo(entry, slotId, captureId),
        );
        if (remaining.length === rawStack.length) return; // nothing matched — leave the stack alone
        if (remaining.length === 0) {
          await this.adapter.storage.remove('local', PENDING_UNDO_KEY);
          return;
        }
        await this.adapter.storage.set('local', { [PENDING_UNDO_KEY]: remaining });
      } catch {
        // Removal is best-effort; an expired entry is ignored on read anyway.
      }
    });
    this.pendingUndoWriteQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Tolerant stack reader (U5): a legacy single object reads back as a
   * one-element stack; a malformed entry is dropped rather than resurrected.
   */
  private readPendingUndoStack(raw: unknown): PendingUndoSnapshot[] {
    if (raw === undefined || raw === null) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const out: PendingUndoSnapshot[] = [];
    for (const item of list) {
      const normalized = normalizePendingUndoSnapshot(item);
      if (normalized) out.push(normalized);
    }
    return out;
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

    // A7: a site snapshot for a tab that no longer exists is stale by definition.
    const validSnapshots = (local.siteSnapshot ?? []).filter((s) => liveTabIds.has(s.tabId));

    if (
      removedBindings > 0 ||
      removedSessions > 0 ||
      validOverrides.length !== local.tabOverrides.length ||
      validSnapshots.length !== (local.siteSnapshot ?? []).length
    ) {
      await this.writeLocal((state) => {
        state.bindings = validBindings;
        state.recoverySessions = validSessions;
        state.tabOverrides = validOverrides;
        state.siteSnapshot = validSnapshots;
        return state;
      });
    }

    return { removedBindings, removedSessions };
  }

  /**
   * Atomic cleanup for tabs.onRemoved event.
   *
   * The site snapshot is dropped here too (A7): a closed tab's captured value
   * must never survive, or a reused tabId would restore an unrelated page.
   */
  async cleanupForRemovedTab(tabId: number): Promise<void> {
    await this.removeBindingByTabId(tabId);
    await this.removeSiteSnapshot(tabId);
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
