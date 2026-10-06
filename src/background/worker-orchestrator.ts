/**
 * Service Worker — lifecycle, message routing, command dispatch, cleanup events.
 *
 * - Startup: cache hydrate + cleanup (stale tabIds, expired recovery)
 * - commands.onCommand: 21 command dispatch
 * - UI/content request routing to services
 * - tabs.onRemoved: atomic cleanup
 * - Recovery TTL cleanup
 * - Rule computation + content script delivery
 * - Notification and domain error translation
 *
 * Does NOT: depend on long-lived Worker/port, let UI call browser APIs directly
 */

import type { BrowserAdapter } from '@adapters/contract';
import { StorageRepository } from './storage-repository';
import { SlotService } from './slot-service';
import { RecoveryService } from './recovery-service';
import { RuleService } from './rule-service';
import { IconService } from './icon-service';
import { ImportExportService } from './import-export-service';
import { DiagnosticsService, NotificationService, IncognitoService } from './diagnostics-service';
import { SidebarAdapter } from './sidebar-adapter';
import type { AnyRequest, ResponseBase } from '@shared/messages';
import { openOrReusePage } from '@shared/open-page';
import { isProtectedUrl, isFaviconWriteSafe, matchesUrl, validateRegex } from '@shared/url-utils';
import { resolveFieldChain } from '@shared/field-chain';
import { FieldDeliveryService } from './field-delivery-service';
import { SiteSnapshotStore } from './site-snapshot-store';

// ─── Worker Orchestrator ─────────────────────────────────────────────────────

/** T21: how long a routed action may take before the caller gets a TIMEOUT. */
export const RESPONSE_TIMEOUT_MS = 10_000;

/**
 * T21: the action whitelist used to decide whether the message port is claimed.
 *
 * T17-③c: `KNOWN_ACTIONS` is the WORKER RECEIPT DOMAIN — it equals `AnyRequest`
 * (UiRequest + ContentRequest), NOT a UI-only list. The `CONTENT_*` /
 * `SITE_SNAPSHOT_REPORT` entries are therefore REQUIRED; dropping them for being
 * "not UI actions" would correctly break the bidirectional guard below.
 *
 * T17-③b: N4's known limitation ("adding a new contract action without adding it
 * here compiles fine, and is then rejected as unknown") is CLOSED by that guard.
 * This is also why the declaration is `as const` rather than annotated: literal
 * element types are what make the check non-vacuous — a wide
 * `ReadonlyArray<AnyRequest['action']>` annotation erases them, making
 * `Exclude<…>` collapse to `never` and the guard silently pass. Kept as an
 * explicit list rather than derived from the switch because the guard runs
 * before dispatch.
 */
const KNOWN_ACTIONS = [
  'SAVE_SLOT',
  'SWITCH_SLOT',
  'NEXT_MATCH',
  'NEXT_MATCH_SLOT',
  'PREV_MATCH_SLOT',
  'NEXT_MATCH_CURRENT',
  'PREV_MATCH_CURRENT',
  'UNBIND_SLOT',
  'UNDO_SAVE',
  'CREATE_RULE',
  'UPDATE_RULE',
  'DELETE_RULE',
  'SET_TAB_OVERRIDE',
  'REMOVE_TAB_OVERRIDE',
  'SET_GLOBAL_STRATEGY',
  'SET_SLOT_STRATEGY',
  'SET_SWITCH_DIRECTION',
  'SET_AUTO_BIND_GLOBAL',
  'SET_SLOT_AUTO_BIND',
  'POSITION_CURRENT_PREV',
  'POSITION_CURRENT_NEXT',
  'UPDATE_SLOT_UI_MARKER',
  'UPDATE_SLOT_URL',
  'RECOVERY_OPEN_URL',
  'RECOVERY_NEXT_MATCH',
  'RECOVERY_PREV_MATCH',
  'RECOVERY_DISMISS',
  'EXPORT_CONFIG',
  'IMPORT_PREVIEW',
  'IMPORT_COMMIT',
  // T14a: the redesigned trio. Registered here in the same change as the union
  // (G-D) so a message is not "compiled in the union but rejected at runtime".
  // The legacy trio above is deleted in T14b (merged into T21).
  'EXPORT_PACKAGE',
  'IMPORT_INSPECT',
  'IMPORT_APPLY',
  'GET_DIAGNOSTICS',
  'CLEAR_DIAGNOSTICS',
  'EXPORT_DIAGNOSTICS',
  'GET_STATE',
  'GET_DASHBOARD',
  'GET_IMPACT_PREVIEW',
  'RESOLVE_MATCH_URL',
  'GET_COMMANDS',
  'DOWNLOAD_ICON',
  'UPLOAD_ICON',
  'OPEN_PAGE',
  'OPEN_SIDEBAR',
  'CONFLICT_CANCEL',
  'CONFLICT_OVERWRITE',
  'CONTENT_NAVIGATION',
  'CONTENT_READY',
  'SITE_SNAPSHOT_REPORT',
] as const satisfies readonly AnyRequest['action'][];

// T17-③b: keep the hand-written whitelist in sync with the union IN BOTH
// DIRECTIONS, at compile time. The literal element types (see the declaration
// note) are what make this non-vacuous.
//   _Unknown     — a union member missing from the whitelist (whitelist too small)
//   _NotAnAction — a whitelist entry that is not a real action (ghost entry)
type _Unknown = Exclude<AnyRequest['action'], (typeof KNOWN_ACTIONS)[number]>;
type _NotAnAction = Exclude<(typeof KNOWN_ACTIONS)[number], AnyRequest['action']>;
const _bidirectional: [_Unknown, _NotAnAction] extends [never, never] ? true : never = true;
void _bidirectional;

/** T21: whether an inbound message carries an action this worker handles. */
function isKnownAction(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const action = (message as { action?: unknown }).action;
  // T17-③a: `as const` narrows KNOWN_ACTIONS to a literal-element tuple, so the
  // parameter of `includes` is that 50-literal union. Widen back to the action
  // union before the call (passing the wider type narrows without a cast).
  return typeof action === 'string'
    && (KNOWN_ACTIONS as readonly AnyRequest['action'][]).includes(action as AnyRequest['action']);
}

export class WorkerOrchestrator {
  readonly repo: StorageRepository;
  readonly slotService: SlotService;
  readonly recoveryService: RecoveryService;
  readonly ruleService: RuleService;
  readonly iconService: IconService;
  readonly importExportService: ImportExportService;
  readonly diagnostics: DiagnosticsService;
  readonly notifications: NotificationService;
  readonly incognito: IncognitoService;
  /** B11c / T18: sole owner of OPEN_SIDEBAR capability + opening. */
  readonly sidebarAdapter: SidebarAdapter;
  /** A2: the write-side delivery coordinator (single entry, coalesced). */
  readonly delivery: FieldDeliveryService;
  /** A7: the site-original value store (strictly local). */
  readonly siteSnapshots: SiteSnapshotStore;

  private initialized = false;

  constructor(private adapter: BrowserAdapter) {
    this.repo = new StorageRepository(adapter);
    this.slotService = new SlotService(adapter, this.repo);
    this.recoveryService = new RecoveryService(adapter, this.repo);
    this.ruleService = new RuleService(adapter, this.repo);
    this.iconService = new IconService(this.repo);
    this.importExportService = new ImportExportService(this.repo, this.iconService);
    this.diagnostics = new DiagnosticsService(adapter, this.repo);
    this.notifications = new NotificationService(adapter);
    this.incognito = new IncognitoService(adapter);
    this.sidebarAdapter = new SidebarAdapter(adapter);
    this.delivery = new FieldDeliveryService(adapter, this.repo);
    this.siteSnapshots = new SiteSnapshotStore(this.repo);
    // A2/A3: every rule write routes through the single delivery entry.
    this.ruleService.setDelivery((tabIds) => this.delivery.recomputeAndRedeliver(tabIds));
  }

  /**
   * Initialize: register event listeners FIRST (cold-start safety), then hydrate cache and run cleanup.
   * Listeners must be registered synchronously before any await to ensure messages
   * arriving during MV3 Service Worker cold start are not lost.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register event listeners BEFORE async work — ensures messages are captured during cold start
    this.adapter.commands.onCommand(this.handleCommand.bind(this));
    this.adapter.tabs.onRemoved(this.handleTabRemoved.bind(this));
    this.adapter.tabs.onUpdated(this.handleTabUpdated.bind(this));
    this.adapter.runtime.onMessage(this.handleMessage.bind(this));

    await this.repo.initialize();
    await this.repo.startupCleanup();
    await this.recoveryService.cleanupExpired();

    this.initialized = true;
    await this.diagnostics.record('SUCCESS', 'worker_init');
  }

  /**
   * Handle cold start — re-hydrate if cache is invalid.
   */
  async ensureReady(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ─── Command Dispatch ──────────────────────────────────────────────────

  private async handleCommand(command: string): Promise<void> {
    await this.ensureReady();

    try {
      // Parse command: save-slot-N, switch-slot-N, next-match
      if (command === 'next-match') {
        const result = await this.slotService.nextMatch();
        if (result.success && result.outcome.type === 'switched' && result.outcome.crossWindow) {
          await this.notifications.notify({ type: 'cross_window_switch', crossWindow: true });
        }
        await this.diagnostics.record(result.success ? 'SUCCESS' : 'NO_MATCH', 'next_match');
        return;
      }

      const saveMatch = command.match(/^save-slot-(\d+)$/);
      if (saveMatch) {
        const slotId = parseInt(saveMatch[1]);
        const version = this.repo.getConfigVersion();

        // Check if slot is already occupied (Problem 3: conflict confirm)
        const sync = await this.repo.getSyncState();
        const existingSlot = sync.slots.find((s) => s.id === slotId);

        if (existingSlot) {
          // Get current active tab info for the conflict dialog
          const tabs = await this.adapter.tabs.query({ active: true, currentWindow: true });
          const activeTab = tabs[0];
          if (activeTab) {
            const params = new URLSearchParams({
              slotId: String(slotId),
              oldTitle: existingSlot.titleSnapshot ?? '',
              oldUrl: existingSlot.urlMatch.type === 'exact' ? existingSlot.urlMatch.value : '',
              newTitle: activeTab.title ?? '',
              newUrl: activeTab.url ?? '',
              tabId: String(activeTab.id),
              favIconUrl: activeTab.favIconUrl ?? '',
            });
            await this.adapter.windows.create({
              url: this.adapter.runtime.getURL(`src/ui/conflict-confirm/index.html?${params.toString()}`),
              type: 'popup',
              width: 400,
              height: 420,
              focused: true,
            });
            await this.diagnostics.record('SUCCESS', 'save_slot_conflict_prompt');
            return;
          }
        }

        const result = await this.slotService.saveSlot(slotId, version);
        await this.diagnostics.record(result.success ? 'SUCCESS' : 'INTERNAL_ERROR', 'save_slot');

        // Problem 3a: Show notification on successful save
        if (result.success) {
          const tabs = await this.adapter.tabs.query({ active: true, currentWindow: true });
          const savedTitle = tabs[0]?.title ?? 'Unknown page';
          const notificationId = `tbs-save-${slotId}-${Date.now()}`;
          try {
            await this.adapter.notifications.create(notificationId, {
              type: 'basic',
              title: 'Tab Bookmark Shortcuts',
              message: `Saved to Slot ${slotId}: ${savedTitle}`,
              iconUrl: this.adapter.runtime.getURL('icons/icon-128.png'),
            });
            // Auto-clear after 5 seconds
            setTimeout(() => {
              this.adapter.notifications.clear(notificationId).catch(() => {});
            }, 5000);
          } catch {
            // Notification failure is non-critical but must not vanish silently
            await this.diagnostics.record('BROWSER_API_ERROR', 'save_slot_notification');
          }
        }
        return;
      }

      const switchMatch = command.match(/^switch-slot-(\d+)$/);
      if (switchMatch) {
        const slotId = parseInt(switchMatch[1]);
        // Same key as the SWITCH_SLOT message path so a command + a message for
        // the same slot coalesce together (A10 / item1).
        const result = await this.coalesce(`switch:${String(slotId)}`, async () => {
          const r = await this.slotService.switchSlot(slotId);
          if (r.success) {
            await this.applySwitchOutcome(r.outcome);
          }
          return r;
        });
        await this.diagnostics.record(result.success ? 'SUCCESS' : 'SLOT_NOT_FOUND', 'switch_slot');
        return;
      }

      // Unknown command
      await this.diagnostics.record('COMMAND_NOT_FOUND', 'unknown_command');
    } catch (e) {
      await this.diagnostics.record('INTERNAL_ERROR', 'command_handler');
    }
  }

  // ─── In-flight coalescing (A10) ─────────────────────────────────────────
  //
  // Concurrent triggers against the SAME key collapse into a single execution;
  // the shared promise is returned to every awaiter (errors propagate to all).
  // This is per-key, NEVER a global throttle — different keys stay concurrent.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /** Hash-insensitive base-URL key (mirrors `openOrReusePage`'s matching). */
  private baseUrlKey(url: string): string {
    const hashIdx = url.indexOf('#');
    return hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  }

  private coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const started = run().finally(() => {
      // Only clear if this very promise is still the registered one.
      if (this.inFlight.get(key) === started) this.inFlight.delete(key);
    });
    this.inFlight.set(key, started);
    return started;
  }

  // ─── applySwitchOutcome — the ONLY side-effect mapping point ────────────
  //
  // Mapping table (design §3.2) covers exactly the four frozen SwitchOutcome
  // variants. There is deliberately NO privileged-page variant branch: privileged
  // targets are handled on the open/navigate path via the existing PROTECTED_PAGE
  // domain error (BLK-B / B2).
  //
  //   needs_recovery          → create-or-focus recovery window; 1× no_target
  //   switched + crossWindow  → 1× cross_window_switch
  //   switched (same window)  → diagnostics only
  //   incognito_blocked       → diagnostics only
  //   no_match                → diagnostics only
  private async applySwitchOutcome(
    outcome: import('@shared/types').SwitchOutcome,
  ): Promise<void> {
    switch (outcome.type) {
      case 'needs_recovery': {
        await this.notifications.notify({ type: 'no_target', slotId: outcome.slotId });
        await this.openOrFocusRecoveryWindow(outcome.slotId, outcome.recoveryId);
        await this.diagnostics.record('SUCCESS', 'switch_needs_recovery');
        return;
      }
      case 'switched': {
        if (outcome.crossWindow) {
          await this.notifications.notify({ type: 'cross_window_switch', slotId: 0, crossWindow: true });
        }
        await this.diagnostics.record('SUCCESS', 'switch_switched');
        return;
      }
      case 'incognito_blocked': {
        // Design §3.2: `incognito_blocked` → notification = — (diagnostics only).
        // The user-visible toast (`Incognito access not authorized`) is raised by
        // the UI that initiated the switch, which owns the outcome; sending a
        // `background_failure` notification here was a mapping-table violation.
        await this.diagnostics.record('INCOGNITO_NOT_AUTHORIZED', 'switch_incognito_blocked');
        return;
      }
      case 'no_match': {
        await this.diagnostics.record('NO_MATCH', 'switch_no_match');
        return;
      }
    }
  }

  /**
   * Create-or-focus the recovery window for a slot (D12/A11): at most one window
   * per slot. An existing live session's `windowId` is focused instead of a new
   * window being spawned.
   */
  private async openOrFocusRecoveryWindow(slotId: number, recoveryId: string): Promise<void> {
    const local = await this.repo.getLocalState();

    // Reuse any LIVE session window for this slot (idempotency). Expired
    // sessions are skipped so this decision matches `RecoveryService.getSession`'s
    // lazy expiry filter — a stale session must never mask a fresh window.
    // The session id is NOT excluded: `createRecoverySession` now dedups per
    // slot, so the re-triggered `recoveryId` may legitimately be the id of the
    // already-open window's session (which is exactly what must be focused).
    const now = Date.now();
    const existing = local.recoverySessions.find(
      (s) =>
        s.slotId === slotId &&
        s.windowId > 0 &&
        new Date(s.expiresAt).getTime() >= now,
    );
    if (existing) {
      // FIX-3: reuse must be validated against the window's liveness. Chrome
      // rejects an update to a closed window id; blindly awaiting it threw,
      // which (on the message path) became INTERNAL_ERROR and (on the command
      // path) a diagnostics-only failure — the notification was sent but the
      // window never opened. Swallow the rejection and fall through to create.
      try {
        await this.adapter.windows.update(existing.windowId, { focused: true });
        return;
      } catch {
        // Dead window id → drop the stale placeholder and create a fresh window.
      }
    }

    const syncState = await this.repo.getSyncState();
    const recoverySlot = syncState.slots.find((s) => s.id === slotId);
    // FIX-2: the effective auto-bind value (slot override wins, else global).
    // Without this the recovery window could not render the right checkbox
    // state and always opened unchecked (design §3.5 / D14 / DT8④).
    const effectiveAutoBind = recoverySlot?.autoBindOverride ?? syncState.autoBindGlobal;
    const recoveryParams = new URLSearchParams({
      recoveryId,
      slotId: String(slotId),
      title: recoverySlot?.titleSnapshot ?? '',
      url: recoverySlot?.urlMatch.type === 'exact' ? recoverySlot.urlMatch.value : '',
      matchType: recoverySlot?.urlMatch.type ?? 'exact',
      autoBind: String(effectiveAutoBind),
    });
    const win = await this.adapter.windows.create({
      url: this.adapter.runtime.getURL(`src/ui/recovery/index.html?${recoveryParams.toString()}`),
      type: 'popup',
      width: 400,
      height: 300,
      focused: true,
    });
    // Backfill the window id so the next trigger focuses instead of creating.
    await this.repo.updateRecoverySession(recoveryId, { windowId: win.id });
  }

  // ─── Tab Removed Cleanup ───────────────────────────────────────────────

  private async handleTabRemoved(tabId: number, _removeInfo: { windowId: number; isWindowClosing: boolean }): Promise<void> {
    await this.ensureReady();
    await this.repo.cleanupForRemovedTab(tabId);
  }

  /**
   * Handle tab update events (page refresh / navigation) — the persistence mechanism.
   *
   * Mirrors the reference plugin (Tab_Renmae/background.js): on `status === 'complete'`
   * (and/or a URL change) we re-apply the full field chain to the tab so titles and
   * favicons survive refresh. This is the ROBUST delivery path that complements the
   * content-script reporting path (which is unreliable for already-open tabs).
   */
  private async handleTabUpdated(
    tabId: number,
    changeInfo: { url?: string; status?: string },
    tab: import('@adapters/contract').NormalizedTab,
  ): Promise<void> {
    await this.ensureReady();

    // Re-apply on load completion and/or URL change (mirrors reference plugin).
    const shouldReapply = changeInfo.status === 'complete' || changeInfo.url !== undefined;
    if (!shouldReapply) return;

    const url = tab.url ?? changeInfo.url;
    if (!url) return;

    await this.handleContentNavigation(tabId, url);
  }

  // ─── Message Routing ───────────────────────────────────────────────────

  private handleMessage(message: unknown, sender: { tab?: { id?: number; url?: string } }, sendResponse: (response?: unknown) => void): boolean {
    // T21: only claim the message port for actions we actually handle.
    //
    // Returning `true` unconditionally kept every message channel open forever,
    // so an unrecognised action was silently unanswered and the caller waited
    // indefinitely. Unknown actions now get an explicit reply and release the port.
    if (!isKnownAction(message)) {
      sendResponse({ success: false, errorCode: 'UNKNOWN_ACTION', message: 'Unknown action' });
      return false;
    }

    let settled = false;
    const respond = (response?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sendResponse(response);
    };

    // T21: response budget. A write that overruns is NOT cancelled (side effects
    // must not be interrupted); the caller is simply told the answer is late so
    // the UI cannot hang forever.
    const timer = setTimeout(() => {
      respond({ success: false, errorCode: 'TIMEOUT', message: 'Worker response timed out' });
    }, RESPONSE_TIMEOUT_MS);

    void this.routeMessage(message, sender).then(respond).catch(() => {
      respond({ success: false, errorCode: 'INTERNAL_ERROR', message: 'Worker error' });
    });
    return true;
  }

  private async routeMessage(message: unknown, sender: { tab?: { id?: number } }): Promise<unknown> {
    await this.ensureReady();

    if (!message || typeof message !== 'object') {
      return { success: false, errorCode: 'INVALID_REQUEST', message: 'Invalid message format' };
    }

    const request = message as AnyRequest;

    switch (request.action) {
      // ─── Slot operations ─────────────────────────────────────────────
      case 'SAVE_SLOT': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.slotService.saveSlot(
          request.payload.slotId,
          version,
          request.payload.uiMarker,
          request.payload.strategy,
        );
      }

      case 'SWITCH_SLOT': {
        // item1 fix + A10: the sidebar entry runs the SAME side-effect mapping as
        // the switch-slot-x command, and concurrent triggers for the same slot
        // coalesce into one execution (1 window / 1 notification / 1 binding).
        const slotId = request.payload.slotId;
        return this.coalesce(`switch:${String(slotId)}`, async () => {
          const switchResult = await this.slotService.switchSlot(slotId);
          if (switchResult.success) {
            await this.applySwitchOutcome(switchResult.outcome);
          }
          return switchResult;
        });
      }

      case 'POSITION_CURRENT_PREV':
        return this.slotService.positionPrev(request.payload.anchorTabId);

      case 'POSITION_CURRENT_NEXT':
        return this.slotService.positionNext(request.payload.anchorTabId);

      case 'NEXT_MATCH':
        return this.slotService.nextMatch();

      case 'NEXT_MATCH_SLOT':
        return this.slotService.nextMatchForSlot(request.payload.slotId);

      case 'PREV_MATCH_SLOT':
        return this.slotService.prevMatchForSlot(request.payload.slotId);

      case 'NEXT_MATCH_CURRENT':
        return this.slotService.nextMatchForUrl(request.payload.url);

      case 'PREV_MATCH_CURRENT':
        return this.slotService.prevMatchForUrl(request.payload.url);

      case 'UNBIND_SLOT': {
        const result = await this.slotService.unbindSlot(request.payload.slotId);
        if (!result.success) {
          return {
            success: false,
            errorCode: result.errorCode,
            message: result.message,
          };
        }
        return { success: true };
      }

      case 'UNDO_SAVE': {
        // B2: restore the pre-overwrite snapshot when one is available and
        // unexpired; otherwise degrade to deletion. Failures are propagated.
        const result = await this.slotService.restoreSlot(request.payload.slotId);
        if (!result.success) {
          return {
            success: false,
            errorCode: result.errorCode,
            message: result.message,
          };
        }
        return { success: true };
      }

      // ─── Rule operations ─────────────────────────────────────────────
      // No version check — single-user local extension, direct write.
      case 'CREATE_RULE': {
        try {
          return await this.ruleService.createRule(request.payload);
        } catch (e) {
          // B10: annotate as ResponseBase so an unknown errorCode is a COMPILE error.
          const failure: ResponseBase = { success: false, errorCode: 'INTERNAL_ERROR', message: String(e) };
          return failure;
        }
      }

      case 'UPDATE_RULE': {
        try {
          // expectedUpdatedAt is a version marker, not a rule field — extract it
          // so it never leaks into the persisted rule object.
          const payload = request.payload;
          const { ruleId, expectedUpdatedAt, ...updates } = payload;
          return await this.ruleService.updateRule(ruleId, updates, expectedUpdatedAt);
        } catch (e) {
          const failure: ResponseBase = { success: false, errorCode: 'INTERNAL_ERROR', message: String(e) };
          return failure;
        }
      }

      case 'DELETE_RULE': {
        try {
          return await this.ruleService.deleteRule(request.payload.ruleId);
        } catch (e) {
          const failure: ResponseBase = { success: false, errorCode: 'INTERNAL_ERROR', message: String(e) };
          return failure;
        }
      }

      // ─── Tab override ────────────────────────────────────────────────
      case 'SET_TAB_OVERRIDE': {
        // T37 (B9-10): reject an unsafe favicon at the WRITE layer. The compute
        // layer already filters before delivery (no XSS), but persisting a
        // `javascript:` value leaves dirty state that re-surfaces on every read.
        //
        // T12/R1: EXEMPT `type:'template'`. A recipe carries `value:''` (the
        // recipe fields are the truth, T7), so the empty-string check would
        // REJECT a valid recipe — a false positive. Security equivalence: a
        // recipe `value` never reaches `link.href`; it must first be RENDERED to
        // a PNG (T12 renderer) which then passes `isSafeFaviconProtocol`. The
        // delivery layer (apply-fields.ts inline gate) and the chain layer stay
        // guarded. Only the recipe branch is relaxed — nothing else.
        const overrideFavicon = request.payload.favicon;
        if (overrideFavicon && !isFaviconWriteSafe(overrideFavicon)) {
          return {
            success: false,
            errorCode: 'INVALID_REQUEST',
            message: 'Unsupported favicon protocol. Use http(s) or a data: image.',
          };
        }
        await this.ruleService.setTabOverride(request.payload.tabId, request.payload.title, request.payload.favicon);
        return { success: true };
      }

      case 'REMOVE_TAB_OVERRIDE':
        await this.ruleService.removeTabOverride(request.payload.tabId);
        return { success: true };

      // ─── Settings ────────────────────────────────────────────────────
      case 'SET_GLOBAL_STRATEGY': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.repo.setMatchSettings(request.payload.matchSettings, version);
      }

      case 'SET_SWITCH_DIRECTION': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.repo.setSwitchDirection(request.payload.direction, version);
      }

      case 'SET_AUTO_BIND_GLOBAL': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.repo.setAutoBindGlobal(request.payload.enabled, version);
      }

      case 'SET_SLOT_AUTO_BIND': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.repo.setSlotAutoBindOverride(request.payload.slotId, request.payload.override, version);
      }

      case 'SET_SLOT_STRATEGY': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        const sync = await this.repo.getSyncState();
        const slot = sync.slots.find((s) => s.id === request.payload.slotId);
        if (!slot) {
          // Problem 2: empty slots should also be able to set strategy override
          // Create a minimal slot configuration with the strategy
          const now = new Date().toISOString();
          const minimalSlot: import('@shared/types').SlotDefinition = {
            id: request.payload.slotId,
            urlMatch: { type: 'exact', value: '' },
            strategy: request.payload.strategy,
            uiMarker: {},
            titleSnapshot: '',
            faviconSnapshot: '',
            createdAt: now,
            updatedAt: now,
          };
          return this.repo.saveSlot(minimalSlot, version);
        }
        return this.repo.saveSlot({ ...slot, strategy: request.payload.strategy }, version);
      }

      case 'UPDATE_SLOT_UI_MARKER': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        const sync = await this.repo.getSyncState();
        const slot = sync.slots.find((s) => s.id === request.payload.slotId);
        if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', message: 'Slot not found' };

        // T37 (B9-10): same write-layer gate as SET_TAB_OVERRIDE — a slot icon
        // flows into `link.href` via the slot tier, so it must not be persisted
        // unless it clears the allowlist.
        //
        // T12/R1: exempt `type:'template'` (recipe carries `value:''`; the
        // rendered PNG is what passes the gate) — same security equivalence as
        // SET_TAB_OVERRIDE above, and only for recipes.
        const markerIcon = request.payload.uiMarker.icon;
        if (markerIcon && !isFaviconWriteSafe(markerIcon)) {
          return {
            success: false,
            errorCode: 'INVALID_REQUEST',
            message: 'Unsupported favicon protocol. Use http(s) or a data: image.',
          };
        }

        // Merge per DIMENSION, never replace the whole marker.
        //
        // The two dimensions (customTitle / icon) are independent chains and each
        // caller sends only the field it edited (`{icon}` or `{customTitle}`).
        // Whole-object replacement therefore silently wiped the OTHER dimension —
        // editing the icon reset the title and vice-versa. Semantics are:
        //   undefined -> leave as-is (dimension not part of this edit)
        //   null      -> explicit clear (DT11)
        //   value     -> write
        const incoming = request.payload.uiMarker;
        const current = slot.uiMarker;
        const mergedMarker = {
          ...current,
          ...(incoming.customTitle !== undefined ? { customTitle: incoming.customTitle } : {}),
          ...(incoming.icon !== undefined ? { icon: incoming.icon } : {}),
          ...(incoming.backgroundColor !== undefined ? { backgroundColor: incoming.backgroundColor } : {}),
        };

        const saved = await this.repo.saveSlot(
          { ...slot, uiMarker: mergedMarker, updatedAt: new Date().toISOString() },
          version,
        );
        if (!saved.success) return saved;
        // Problem: slot tier must win — re-apply the slot's fields to its bound
        // tabId immediately so the browser tab reflects the modified icon/title
        // (and current page syncs when it is the bound tab). Only the bound tabId
        // is affected; other matching tabs fall through to rule/original tiers.
        await this.reapplyFieldsToBoundTab(request.payload.slotId);
        return saved;
      }

      // ─── Slot URL update (Problem 8: double-click URL edit) ─────────
      case 'UPDATE_SLOT_URL': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        const sync = await this.repo.getSyncState();
        const slot = sync.slots.find((s) => s.id === request.payload.slotId);
        if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', message: 'Slot not found' };

        // T30 (B4-2): a regex supplied here is persisted and later compiled on
        // every navigation, so it must clear the same ReDoS gate as the rule
        // paths. Previously this endpoint was a validation bypass.
        if (request.payload.matchType === 'regex') {
          const check = validateRegex(request.payload.url);
          if (!check.valid) {
            return {
              success: false,
              errorCode: check.error === 'REGEX_TOO_LONG' ? 'RULE_REGEX_TOO_LONG' : 'REGEX_RISK',
              message: check.message ?? 'Invalid regex pattern',
            };
          }
        }

        const updatedSlot = {
          ...slot,
          urlMatch: { type: request.payload.matchType, value: request.payload.url },
          updatedAt: new Date().toISOString(),
        };
        const savedUrl = await this.repo.saveSlot(updatedSlot, version);
        if (!savedUrl.success) return savedUrl;
        // A3/spy #7: a slot URL edit must redeliver to the slot's bound tab.
        const bindingForSlot = (await this.repo.getLocalState()).bindings.find((b) => b.slotId === slot.id);
        if (bindingForSlot) await this.delivery.recomputeAndRedeliver([bindingForSlot.tabId]);
        return savedUrl;
      }

      // ─── Recovery ────────────────────────────────────────────────────
      case 'RECOVERY_OPEN_URL': {
        // A10: concurrent opens for the same session create at most one tab.
        const recoveryId = request.payload.recoveryId;
        return this.coalesce(`recovery-open:${recoveryId}`, async () =>
          this.recoveryService.openUrl(recoveryId, request.payload.autoBind),
        );
      }

      case 'RECOVERY_NEXT_MATCH':
        return this.recoveryService.nextMatch(request.payload.recoveryId, request.payload.autoBind);

      case 'RECOVERY_PREV_MATCH':
        return this.recoveryService.prevMatch(request.payload.recoveryId, request.payload.autoBind);

      case 'RECOVERY_DISMISS':
        await this.recoveryService.dismiss(request.payload.recoveryId);
        return { success: true };

      // ─── Import/Export ───────────────────────────────────────────────
      case 'EXPORT_CONFIG':
        return this.importExportService.exportConfig();

      case 'IMPORT_PREVIEW':
        return this.importExportService.generatePreview(request.payload.json);

      case 'IMPORT_COMMIT': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.importExportService.commitImport(request.payload.preview, request.payload.slotDecisions, version);
      }

      // ─── Import/Export — redesigned trio (T17 / A10 / A11) ──────────────
      case 'EXPORT_PACKAGE':
        return this.importExportService.exportPackage(request.payload.scope);

      case 'IMPORT_INSPECT':
        return this.importExportService.inspect(request.payload.file);

      case 'IMPORT_APPLY': {
        // F4: the version is REQUIRED. The legacy case above (IMPORT_COMMIT)
        // defaulted to the current version, which made the optimistic lock pass
        // unconditionally — a stale preview could overwrite newer config. A
        // missing/non-numeric version is refused rather than defaulted.
        const expectedVersion = request.configVersion;
        if (typeof expectedVersion !== 'number') {
          return { success: false, errorCode: 'INVALID_REQUEST', message: 'IMPORT_APPLY requires configVersion' };
        }
        return this.importExportService.applyImport(
          request.payload.file,
          request.payload.intent,
          expectedVersion,
          // D4: pass the platform capability so APPLY can emit manual-set-up
          // guidance for the shortcut dimension (Chrome/Edge).
          { commandsUpdateSupported: this.adapter.commands.updateSupported() },
        );
      }

      // ─── Diagnostics ─────────────────────────────────────────────────
      case 'GET_DIAGNOSTICS': {
        const entries = await this.diagnostics.getEntries();
        return { success: true, entries };
      }

      case 'CLEAR_DIAGNOSTICS':
        await this.diagnostics.clear();
        return { success: true };

      case 'EXPORT_DIAGNOSTICS': {
        const json = await this.diagnostics.export();
        return { success: true, json };
      }

      // ─── State queries ───────────────────────────────────────────────
      case 'GET_STATE': {
        const sync = await this.repo.getSyncState();
        const local = await this.repo.getLocalState();
        return { success: true, sync, local };
      }

      case 'GET_DASHBOARD': {
        return this.buildDashboard();
      }

      case 'GET_IMPACT_PREVIEW': {
        // Review item 5.2 / 6.3: exact impact of a rule pattern over the OPEN
        // tabs, so the editor can show "Matches N tabs · M masked".
        const sync = await this.repo.getSyncState();
        const local = await this.repo.getLocalState();
        const tabs = await this.adapter.tabs.query({});
        const { urlMatch, excludeRuleId, limit } = request.payload;

        const matchedTabs = tabs.filter((t) => matchesUrl(t.url, urlMatch));

        const entries: import('@shared/messages').ImpactPreviewEntry[] = [];
        let masked = 0;
        for (const tab of matchedTabs) {
          const tabId = tab.id;
          const url = tab.url;
          // "Masked" == a higher tier (explicit override or slot binding) owns
          // this tab, so the rule value is not what the user actually sees.
          const ownedByOverride = local.tabOverrides.some((o) => o.tabId === tabId);
          const ownedBySlot = local.bindings.some((b) => b.tabId === tabId);
          const isMasked = ownedByOverride || ownedBySlot;
          if (isMasked) masked += 1;
          if (entries.length < (limit ?? 3)) {
            entries.push({ tabId, label: `Tab ${String(tabId)}`, url, masked: isMasked });
          }
        }
        void sync;
        void excludeRuleId;
        return {
          success: true,
          preview: { total: matchedTabs.length, masked, entries },
        } satisfies import('@shared/messages').GetImpactPreviewResponse['result'];
      }

      case 'RESOLVE_MATCH_URL': {
        // Review item 6.1: a rule being created has no chain of its own, so the
        // create form needs "what would a tab at this URL show right now?".
        // Answered from the OPEN tabs: pick the first matching tab and resolve
        // its chain through the single shared implementation, so the offered
        // value is exactly what the sidebar would display for that tab.
        const sync = await this.repo.getSyncState();
        const local = await this.repo.getLocalState();
        const tabs = await this.adapter.tabs.query({});
        const matched = tabs.filter((t) => matchesUrl(t.url, request.payload.urlMatch));

        if (matched.length === 0) {
          return {
            success: true,
            resolved: { matchedTabs: 0, title: null, icon: null, source: null },
          } satisfies import('@shared/messages').ResolveMatchUrlResponse['result'];
        }

        const first = matched[0];
        const input = { sync, local, tabId: first.id, tabUrl: first.url };
        const titleChain = resolveFieldChain('title', input);
        const faviconChain = resolveFieldChain('favicon', input);

        // The TierKey values are exactly the four chain sources, so the winner's
        // source can be reported verbatim without a second mapping to drift.
        return {
          success: true,
          resolved: {
            matchedTabs: matched.length,
            title: titleChain.winner.value,
            icon: faviconChain.winner.value,
            source: titleChain.winner.value !== null ? titleChain.winner.source : faviconChain.winner.source,
          },
        } satisfies import('@shared/messages').ResolveMatchUrlResponse['result'];
      }

      case 'SITE_SNAPSHOT_REPORT': {
        // A7: the content script lazily captures the ORIGINAL page value before
        // its first rewrite and reports it here. The tabId comes from the sender
        // (never trusted from the payload shape alone at the routing layer).
        const tabId = sender.tab?.id ?? request.payload.tabId;
        await this.repo.setSiteSnapshot({
          tabId,
          title: request.payload.title,
          faviconHref: request.payload.faviconHref,
          capturedAt: new Date().toISOString(),
        });
        return { success: true };
      }

      case 'GET_COMMANDS': {
        const commands = await this.adapter.commands.getAll();
        return { success: true, commands };
      }

      // ─── Icon operations ─────────────────────────────────────────────
      case 'DOWNLOAD_ICON':
        return this.iconService.downloadAndCache(request.payload.url, request.payload.cacheKey);

      case 'UPLOAD_ICON':
        await this.repo.setIconCache(request.payload.cacheKey, request.payload.dataUri);
        return { success: true };

      // ─── Page opening (sidebar fallback, Problem 1) ─────────────────
      // Bug 1: reuse an already-open tab instead of always creating a new one.
      // Matching is hash-insensitive; a different hash triggers a hash-only
      // navigation (activate + update url), never a new tab.
      case 'OPEN_PAGE': {
        const msg = message as { payload?: { url?: string } };
        const url = msg.payload?.url;
        if (url) {
          // A10: coalesce concurrent opens of the same base-URL (hash-insensitive)
          // so a race cannot spawn two tabs.
          const baseKey = this.baseUrlKey(url);
          await this.coalesce(baseKey, async () => {
            await openOrReusePage({
              queryAllTabs: async () => {
                const tabs = await this.adapter.tabs.query({});
                return tabs.map((t) => ({ id: t.id, url: t.url }));
              },
              activateTab: async (tabId) => {
                await this.adapter.tabs.update(tabId, { active: true });
              },
              navigateTab: async (tabId, targetUrl) => {
                await this.adapter.tabs.update(tabId, { url: targetUrl });
              },
              createTab: async (targetUrl) => {
                await this.adapter.tabs.create({ url: targetUrl, active: true });
                // T11: diagnosis token — no URL/title content (isSanitized-safe).
                await this.diagnostics.record('SUCCESS', 'open_page:background:create');
              },
            }, url);
          });
        }
        return { success: true };
      }

      // ─── Conflict cancel (Problem 3) ────────────────────────────────
      case 'CONFLICT_CANCEL':
        // No-op: user chose not to overwrite. Just acknowledge.
        return { success: true };

      // ─── Conflict overwrite (Problem 1 fix: use captured tab data) ──
      case 'CONFLICT_OVERWRITE': {
        // B2 → T24: the undo snapshot is now captured inside
        // `slotService.saveSlotFromData` (the single shared capture point for
        // every overwrite route), so this handler no longer duplicates it.
        const version = this.repo.getConfigVersion();
        const overwriteResult = await this.slotService.saveSlotFromData(
          request.payload.slotId,
          version,
          {
            tabId: request.payload.tabId,
            url: request.payload.url,
            title: request.payload.title,
            favIconUrl: request.payload.favIconUrl,
          },
        );
        // Problem 3: Show notification on successful conflict overwrite
        if (overwriteResult.success) {
          const notificationId = `tbs-save-${request.payload.slotId}-${Date.now()}`;
          try {
            await this.adapter.notifications.create(notificationId, {
              type: 'basic',
              title: 'Tab Bookmark Shortcuts',
              message: `Saved to Slot ${request.payload.slotId}: ${request.payload.title}`,
              iconUrl: this.adapter.runtime.getURL('icons/icon-128.png'),
            });
            setTimeout(() => {
              this.adapter.notifications.clear(notificationId).catch(() => {});
            }, 5000);
          } catch {
            // Notification failure is non-critical but must not vanish silently
            await this.diagnostics.record('BROWSER_API_ERROR', 'save_slot_notification');
          }
        }
        return overwriteResult;
      }

      // ─── Sidebar opening (B11c / T18) ─────────────────────────────────
      // Sole handler for OPEN_SIDEBAR: the former listener in
      // ToolbarActionHandler has been removed, so this action cannot be
      // double-handled.
      case 'OPEN_SIDEBAR': {
        const result = await this.sidebarAdapter.openSidebar(request.payload?.windowId);
        if (!result.success) {
          const failure: ResponseBase = {
            success: false,
            errorCode: 'BROWSER_API_ERROR',
            message: result.message,
          };
          return failure;
        }
        return { success: true };
      }

      // ─── Content script messages ─────────────────────────────────────
      case 'CONTENT_NAVIGATION': {
        // A5: route through the single delivery entry (no `force` any more).
        const tabId = sender.tab?.id;
        if (tabId) {
          await this.handleContentNavigation(tabId, request.payload.url);
        }
        return { success: true };
      }

      case 'CONTENT_READY': {
        // DOM is ready — the same single entry recomputes + redelivers.
        const tabId = sender.tab?.id;
        if (tabId) {
          await this.handleContentNavigation(tabId, request.payload.url);
        }
        return { success: true };
      }

      default: {
        // T17-③a: exhaustiveness guard. `request` is `AnyRequest`, so any union
        // member missing a `case` above makes this assignment a compile error.
        // Unreachable at runtime — it does not widen the dispatch.
        const _exhaustive: never = request;
        void _exhaustive;
        return { success: false, errorCode: 'UNKNOWN_ACTION', message: 'Unknown action' };
      }
    }
  }

  // ─── Content Navigation Handler ────────────────────────────────────────

  /**
   * A5: all three navigation triggers (`tabs.onUpdated`, `CONTENT_NAVIGATION`,
   * `CONTENT_READY`) route to the SAME single delivery entry. `force` no longer
   * exists — delivery is idempotent ("write the current chain state").
   */
  private async handleContentNavigation(tabId: number, url: string): Promise<void> {
    void url;
    await this.delivery.recomputeAndRedeliver([tabId]);
  }

  // ─── Data Dashboard (A10) ──────────────────────────────────────────────

  /**
   * Build the Data Dashboard rows.
   *
   * The chain is computed ONCE, here, for every row (A10): the UI never
   * assembles a second copy, so the displayed value and the delivered value
   * cannot drift. `delivery` likewise reports only what the background can
   * actually observe (a protected URL, or an un-captured site value).
   */
  /** Test-facing accessor for the dashboard rows (see `buildDashboard`). */
  async buildDashboardForTest(): Promise<import('@shared/types').DashboardRow[]> {
    const result = await this.buildDashboard();
    return result.rows;
  }

  private async buildDashboard(): Promise<{ success: true; rows: import('@shared/types').DashboardRow[] }> {
    const sync = await this.repo.getSyncState();
    const local = await this.repo.getLocalState();

    const allTabs = await this.adapter.tabs.query({});
    const tabById = new Map(allTabs.map((t) => [t.id, t]));
    const rows: import('@shared/types').DashboardRow[] = [];

    const deliveryFor = (url: string | null, tabId: number | undefined): import('@shared/types').DashboardRow['delivery'] => {
      if (url && isProtectedUrl(url)) return 'protected';
      if (tabId !== undefined && tabById.get(tabId) === undefined) return 'unknown';
      return 'ok';
    };

    const chainFor = (tabId: number, tabUrl: string): import('@shared/types').DashboardRow['chain'] => ({
      title: resolveFieldChain('title', { sync, local, tabId, tabUrl }),
      favicon: resolveFieldChain('favicon', { sync, local, tabId, tabUrl }),
    });

    // 1. Explicit tab overrides.
    for (const o of local.tabOverrides) {
      const tab = tabById.get(o.tabId);
      const url = tab?.url ?? null;
      rows.push({
        id: `cp-${o.tabId}`,
        kind: 'override',
        label: `Tab ${o.tabId}`,
        url,
        anchor: { kind: 'override', tabId: o.tabId },
        tabId: o.tabId,
        chain: chainFor(o.tabId, url ?? ''),
        delivery: deliveryFor(url, o.tabId),
      });
    }

    // 2. Slots whose title/icon was explicitly set.
    for (const slot of sync.slots) {
      const hasData = Boolean(slot.uiMarker.customTitle?.trim() || slot.uiMarker.icon?.value);
      if (!hasData) continue;
      const binding = local.bindings.find((b) => b.slotId === slot.id);
      const tabId = binding?.tabId;
      const url = slot.urlMatch.value || null;
      rows.push({
        id: `slot-${slot.id}`,
        kind: 'slot',
        label: `Slot ${slot.id}`,
        url,
        anchor: { kind: 'slot', slotId: slot.id },
        slotId: slot.id,
        ...(tabId !== undefined ? { tabId } : {}),
        chain:
          tabId !== undefined
            ? chainFor(tabId, tabById.get(tabId)?.url ?? url ?? '')
            : { title: resolveFieldChain('title', { sync, local, tabId: -1, tabUrl: url ?? '' }), favicon: resolveFieldChain('favicon', { sync, local, tabId: -1, tabUrl: url ?? '' }) },
        delivery: tabId !== undefined ? deliveryFor(url, tabId) : 'unknown',
      });
    }

    // 3. Rule-hit tabs — the "managed tabs" view (review item 7.1).
    //
    // A tab is a rule-hit when an ENABLED rule matches its URL and the tab is
    // not already covered above (an explicit override or a slot-bound tab owns
    // that row). The winning rule is reported as the anchor so the dashboard can
    // jump to it.
    const coveredTabIds = new Set<number>([
      ...local.tabOverrides.map((o) => o.tabId),
      ...local.bindings.map((b) => b.tabId),
    ]);
    for (const tab of allTabs) {
      if (coveredTabIds.has(tab.id)) continue;
      const candidates = sync.rules
        .filter((r) => r.enabled !== false && matchesUrl(tab.url, r.urlMatch))
        .sort((a, b) => b.priority - a.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (candidates.length === 0) continue;
      const matched = candidates[0];
      rows.push({
        id: `hit-${String(tab.id)}`,
        kind: 'rule-hit',
        label: `Tab ${String(tab.id)}`,
        url: tab.url,
        anchor: { kind: 'rule', ruleId: matched.id },
        tabId: tab.id,
        ruleId: matched.id,
        chain: chainFor(tab.id, tab.url),
        delivery: deliveryFor(tab.url, tab.id),
      });
    }

    return { success: true, rows };
  }

  /**
   * Re-apply the full field chain (slot → override → rule → site) to the tab that
   * is bound to a given slot. Used when a slot's icon/title is modified so the
   * bound tabId immediately reflects the slot values (slot tier wins).
   *
   * Strictly tabId-scoped: only the bound tabId is touched; other tabs that merely
   * match the same URL are not affected (they fall through to rule/original tiers).
   */
  private async reapplyFieldsToBoundTab(slotId: number): Promise<void> {
    const local = await this.repo.getLocalState();
    const binding = local.bindings.find((b) => b.slotId === slotId);
    if (!binding) return;
    // A8: protection is decided inside the delivery entry — not here.
    try {
      const tab = await this.adapter.tabs.get(binding.tabId);
      await this.handleContentNavigation(binding.tabId, tab.url);
    } catch {
      // Tab no longer exists — nothing to re-apply.
    }
  }
}

// ─── Bootstrap (only in actual Service Worker context) ───────────────────────

export function bootstrapWorker(adapter: BrowserAdapter): WorkerOrchestrator {
  const orchestrator = new WorkerOrchestrator(adapter);
  void orchestrator.initialize();
  return orchestrator;
}
