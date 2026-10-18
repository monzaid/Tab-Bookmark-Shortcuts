/**
 * Slot Command Service — save/switch 10 slots, cross-window matching, activation, and cycle.
 *
 * Responsibilities:
 * - Save/overwrite 10 slots with strategy (default B / explicit inherit / override)
 * - tabId validation against current tab state
 * - Full accessible tab query (excludes incognito if not authorized)
 * - Candidate sorting: current window first, left-to-right, then other windows
 * - Cross-window focus/activate
 * - "Next match" cycling based on last successful slot
 * - Returns domain states: switched / no_match / needs_recovery / incognito_blocked
 */

import type { BrowserAdapter } from '@adapters/contract';
import type { StorageRepository, WriteResult, PendingUndoSnapshot } from './storage-repository';
import { PENDING_UNDO_TTL_MS } from './storage-repository';
import type {
  SlotDefinition,
  SlotBinding,
  MatchRuleSettings,
  SyncState,
  TabCandidate,
  SwitchOutcome,
} from '@shared/types';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';
import type { DomainErrorCode } from '@shared/types';
import { normalizeUrl } from '@shared/url-utils';
import { resolveSwitch } from './switch/resolve-switch';
import { findMatchCandidates, buildPositionRing } from './switch/primitives';
import { resolveUserWindow } from './user-window';

// ─── Slot Service ────────────────────────────────────────────────────────────

/**
 * T34: monotonically increasing identity for undo captures.
 *
 * Module-level (not per-instance) so identity stays unique even if more than
 * one SlotService exists, and monotonic within a service-worker lifetime —
 * which is all the TTL window requires.
 */
let captureIdCounter = 0;
function nextCaptureId(): number {
  captureIdCounter += 1;
  return captureIdCounter;
}

/** D3/A4: slot numbers are fixed 1..10 and ARE the identity. */
const SLOT_ID_MIN = 1;
const SLOT_ID_MAX = 10;
function isSlotNumber(value: number): boolean {
  return Number.isInteger(value) && value >= SLOT_ID_MIN && value <= SLOT_ID_MAX;
}

export class SlotService {
  /**
   * A2/A5: the delivery entry, injected by the worker (same shape as
   * `RuleService.setDelivery`). A forward swap changes which tab each slot owns
   * and which strategy it therefore applies, so BOTH sides must be re-delivered
   * (D7). Wired by `WorkerOrchestrator` (T13).
   */
  private deliver: (tabIds: number[]) => Promise<unknown> = () => Promise.resolve(undefined);

  constructor(
    private adapter: BrowserAdapter,
    private repo: StorageRepository,
  ) {}

  /** A2: single delivery entry, injected by the worker. */
  setDelivery(fn: (tabIds: number[]) => Promise<unknown>): void {
    this.deliver = fn;
  }

  // ─── Save Slot ─────────────────────────────────────────────────────────

  /**
   * Save current active tab to a slot.
   */
  async saveSlot(
    slotId: number,
    expectedVersion: number,
    uiMarker?: SlotDefinition['uiMarker'],
    strategy?: 'inherit' | MatchRuleSettings,
  ): Promise<
    { success: true; slot: SlotDefinition; captureId?: number; expiresAt?: number }
    | { success: false; errorCode: string; message: string }
  > {
    // Get current active tab
    const tabs = await this.adapter.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      return { success: false, errorCode: 'TAB_NOT_FOUND', message: 'No active tab found' };
    }

    const activeTab = tabs[0];
    const now = new Date().toISOString();

    const slot: SlotDefinition = {
      id: slotId,
      urlMatch: { type: 'exact', value: normalizeUrl(activeTab.url) },
      strategy: strategy ?? 'inherit',
      uiMarker: uiMarker ?? {},
      titleSnapshot: activeTab.title,
      faviconSnapshot: activeTab.favIconUrl,
      createdAt: now,
      updatedAt: now,
    };

    // T24 (N1): capture the about-to-be-overwritten state BEFORE the write, so
    // UNDO_SAVE can restore it. This is the single shared capture point for the
    // sidebar SAVE_SLOT path and the keyboard-command path; CONFLICT_OVERWRITE
    // funnels through `saveSlotFromData` below and is covered the same way.
    // A10: the returned `captureId` is forwarded to the caller so a UI surface
    // can address THIS capture; absent for an empty slot (nothing captured).
    // R1: `expiresAt` rides along so the UI's countdown shares the worker's
    // deadline instead of inventing its own (see `captureUndoSnapshot`).
    const captured = await this.captureBeforeOverwrite(slotId);

    const result = await this.repo.saveSlot(slot, expectedVersion);
    if (!result.success) {
      return { success: false, errorCode: result.errorCode, message: result.message };
    }

    // Bind tabId locally
    await this.repo.setBinding({
      slotId,
      tabId: activeTab.id,
      windowId: activeTab.windowId,
      boundAt: now,
    });

    return captured === undefined
      ? { success: true, slot }
      : { success: true, slot, captureId: captured.captureId, expiresAt: captured.expiresAt };
  }

  // ─── Save Slot From Explicit Data (conflict overwrite) ─────────────────

  /**
   * Save a slot using explicitly provided tab data (no active-tab re-query).
   * Used by CONFLICT_OVERWRITE to avoid saving the conflict popup's own tab.
   */
  async saveSlotFromData(
    slotId: number,
    expectedVersion: number,
    data: { tabId: number; url: string; title: string; favIconUrl: string },
  ): Promise<{ success: true; slot: SlotDefinition } | { success: false; errorCode: string; message: string }> {
    const now = new Date().toISOString();

    const slot: SlotDefinition = {
      id: slotId,
      urlMatch: { type: 'exact', value: normalizeUrl(data.url) },
      strategy: 'inherit',
      uiMarker: {},
      titleSnapshot: data.title,
      faviconSnapshot: data.favIconUrl,
      createdAt: now,
      updatedAt: now,
    };

    // T24 (N1): same shared capture point as `saveSlot` — an overwrite reached
    // through the conflict dialog must be undoable too.
    await this.captureBeforeOverwrite(slotId);

    const result = await this.repo.saveSlot(slot, expectedVersion);
    if (!result.success) {
      return { success: false, errorCode: result.errorCode, message: result.message };
    }

    // Bind tabId locally
    await this.repo.setBinding({
      slotId,
      tabId: data.tabId,
      windowId: 0, // Will be resolved on next switch
      boundAt: now,
    });

    return { success: true, slot };
  }

  /**
   * T24 (N1): best-effort snapshot of the slot that is about to be overwritten.
   *
   * Centralized so every overwrite route (sidebar SAVE_SLOT, keyboard command,
   * conflict overwrite) shares one capture point. A capture failure must never
   * block the save — the worst case degrades UNDO_SAVE to its delete semantics.
   * No-ops when the slot is empty (nothing to restore).
   *
   * A10: returns the capture identity (or `undefined` for an empty slot / a
   * failed capture) so `saveSlot` can hand it back WITHOUT exposing the
   * snapshot itself.
   */
  private async captureBeforeOverwrite(
    slotId: number,
  ): Promise<{ captureId: number; expiresAt: number } | undefined> {
    try {
      return await this.captureUndoSnapshot(slotId);
    } catch {
      // Non-fatal: the save proceeds without an undo snapshot.
      return undefined;
    }
  }

  // ─── Swap Slots (D1/D2/D3, D7, D14, A4/A5/A6/A7/A10) ───────────────────

  /**
   * Swap the CONTENT of two slots (D1/D2), leaving each NUMBER's config in place.
   *
   * Content that follows the move: `urlMatch` / `uiMarker` / `titleSnapshot` /
   * `faviconSnapshot` / the binding. Config that stays with the number:
   * `strategy` / `autoBindOverride` (D2 — a KNOWN, documented trade-off: a moved
   * record adopts the TARGET number's strategy; no other entry point can produce
   * that state, and it is asserted as expected in the tests so it is not "fixed"
   * later).
   *
   * An EMPTY slot (in 1..10, no record) is a LEGAL operand (D3/A4): occupied↔
   * empty degrades to a move, and empty↔empty is a no-op. Out-of-range numbers
   * (not an integer in 1..10) are `SLOT_NOT_FOUND` — the SAME code the slot path
   * already uses, NOT a new `DomainErrorCode` (A4/D17).
   *
   * Returns a thin union rather than `WriteResult`, which cannot express
   * "success with zero writes" (A1).
   */
  async swapSlots(
    sourceSlotId: number,
    targetSlotId: number,
    expectedVersion: number,
  ): Promise<
    | { success: true; configVersion: number; changed: boolean; captureId?: number; expiresAt?: number }
    | { success: false; errorCode: string; message: string }
  > {
    // A4: source === target is a caller bug; silent success would hide it.
    if (sourceSlotId === targetSlotId) {
      return { success: false, errorCode: 'INVALID_REQUEST', message: 'Cannot swap a slot with itself' };
    }
    // A4: out-of-range is SLOT_NOT_FOUND. In-range-but-missing is an empty slot.
    if (!isSlotNumber(sourceSlotId) || !isSlotNumber(targetSlotId)) {
      return { success: false, errorCode: 'SLOT_NOT_FOUND', message: 'Slot number out of range (1..10)' };
    }

    const sync = await this.repo.getSyncState();
    const sourceSlot = sync.slots.find((s) => s.id === sourceSlotId);
    const targetSlot = sync.slots.find((s) => s.id === targetSlotId);

    // A7/D17: both empty → success with ZERO writes. `writeSync` bumps the
    // version unconditionally, so it must be BYPASSED to honour "no version move".
    if (!sourceSlot && !targetSlot) {
      return { success: true, configVersion: this.repo.getConfigVersion(), changed: false };
    }

    // Step ① (D14): snapshot both slots' record + binding BEFORE touching either
    // area. Doubles as the undo snapshot (Z1) and the step-④ compensation source.
    const localBefore = await this.repo.getLocalState();
    const sourceBindingBefore = localBefore.bindings.find((b) => b.slotId === sourceSlotId) ?? null;
    const targetBindingBefore = localBefore.bindings.find((b) => b.slotId === targetSlotId) ?? null;

    // Config is per-NUMBER: take it from whatever record currently occupies that
    // number, else the defaults (an empty number carries no strategy).
    const configAt = (existing: SlotDefinition | undefined): Pick<SlotDefinition, 'strategy' | 'autoBindOverride'> => ({
      strategy: existing ? existing.strategy : 'inherit',
      ...(existing?.autoBindOverride === undefined ? {} : { autoBindOverride: existing.autoBindOverride }),
    });
    // Content is the record MINUS its number-identity and its config (D2).
    const contentOf = (existing: SlotDefinition | undefined): SlotDefinition | null =>
      existing === undefined
        ? null
        : {
            id: existing.id, // overwritten below; carried for typing only
            urlMatch: { ...existing.urlMatch },
            uiMarker: { ...existing.uiMarker },
            titleSnapshot: existing.titleSnapshot,
            faviconSnapshot: existing.faviconSnapshot,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
            strategy: existing.strategy,
          };

    const sourceContent = contentOf(targetSlot); // target content lands on source number
    const targetContent = contentOf(sourceSlot); // source content lands on target number

    const nextSource: SlotDefinition | null = sourceContent
      ? { ...sourceContent, id: sourceSlotId, ...configAt(sourceSlot) }
      : null;
    const nextTarget: SlotDefinition | null = targetContent
      ? { ...targetContent, id: targetSlotId, ...configAt(targetSlot) }
      : null;

    const applySlot = (slots: SlotDefinition[], id: number, next: SlotDefinition | null): void => {
      const idx = slots.findIndex((s) => s.id === id);
      if (next === null) {
        if (idx >= 0) slots.splice(idx, 1);
        return;
      }
      if (idx >= 0) slots[idx] = next;
      else slots.push(next);
    };

    // Step ② (D14): write sync with the optimistic version. A failure aborts with
    // local untouched — nothing to compensate.
    const syncWrite = await this.repo.writeSync(expectedVersion, (state) => {
      const slots = [...state.slots];
      applySlot(slots, sourceSlotId, nextSource);
      applySlot(slots, targetSlotId, nextTarget);
      return { ...state, slots };
    });
    if (!syncWrite.success) {
      return { success: false, errorCode: syncWrite.errorCode, message: syncWrite.message };
    }

    // Step ③ (A6/D14): ONE `writeLocal` performs every local change:
    //   - swap the two bindings,
    //   - purge the derived state tied to either number (D5),
    //   - neutralise `lastSuccessSlotId` when it points at one of them.
    // Three separate repo calls would open three write windows and violate D14.
    const swapBinding = (bindings: SlotBinding[]): SlotBinding[] => {
      const without = bindings.filter((b) => b.slotId !== sourceSlotId && b.slotId !== targetSlotId);
      const moved: SlotBinding[] = [];
      if (targetBindingBefore) moved.push({ ...targetBindingBefore, slotId: sourceSlotId });
      if (sourceBindingBefore) moved.push({ ...sourceBindingBefore, slotId: targetSlotId });
      return [...without, ...moved];
    };

    try {
      await this.repo.writeLocal((state) => ({
        ...state,
        bindings: swapBinding(state.bindings),
        cycleCursors: state.cycleCursors.filter((c) => c.slotId !== sourceSlotId && c.slotId !== targetSlotId),
        recoverySessions: state.recoverySessions.filter((s) => s.slotId !== sourceSlotId && s.slotId !== targetSlotId),
        recoverySnapshots: state.recoverySnapshots.filter((s) => s.slotId !== sourceSlotId && s.slotId !== targetSlotId),
        lastSuccessSlotId:
          state.lastSuccessSlotId === sourceSlotId || state.lastSuccessSlotId === targetSlotId
            ? null
            : state.lastSuccessSlotId,
      }));
    } catch {
      // Step ④ (D14): the local write failed — put sync back. If this
      // compensation ALSO fails the state is left inconsistent, the same
      // boundary `clearAndWriteWithCompensation` documents (not over-claimed).
      await this.repo.writeSync(this.repo.getConfigVersion(), (state) => {
        const slots = [...state.slots];
        applySlot(slots, sourceSlotId, sourceSlot ?? null);
        applySlot(slots, targetSlotId, targetSlot ?? null);
        return { ...state, slots };
      });
      try {
        await this.repo.writeLocal((state) => ({ ...state, bindings: localBefore.bindings }));
      } catch {
        // Boundary (D14): both the write and its compensation failed.
      }
      return { success: false, errorCode: 'INTERNAL_ERROR', message: 'Swap failed and was rolled back' };
    }

    // Capture the swap for undo (Z1, reusing this shared stack + the A10 channel).
    const captureId = nextCaptureId();
    // R1: same single source of truth as `captureUndoSnapshot` — the UI must not
    // invent its own deadline or it can outlive the worker's entry.
    const swapExpiresAt = Date.now() + PENDING_UNDO_TTL_MS;
    await this.repo.setPendingUndo({
      kind: 'swap',
      id: `swap-${String(captureId)}`,
      captureId,
      sourceSlotId,
      targetSlotId,
      sourceSnapshot: sourceSlot ? { ...sourceSlot, urlMatch: { ...sourceSlot.urlMatch }, uiMarker: { ...sourceSlot.uiMarker } } : null,
      sourceBinding: sourceBindingBefore ? { ...sourceBindingBefore } : null,
      targetSnapshot: targetSlot ? { ...targetSlot, urlMatch: { ...targetSlot.urlMatch }, uiMarker: { ...targetSlot.uiMarker } } : null,
      targetBinding: targetBindingBefore ? { ...targetBindingBefore } : null,
      expiresAt: Date.now() + PENDING_UNDO_TTL_MS,
    });
    setTimeout(() => {
      void this.repo.clearPendingUndo(sourceSlotId, captureId);
    }, PENDING_UNDO_TTL_MS + 100);

    // D7/A5: re-READ both slots' bindings AFTER the write (the swap may have
    // moved them), drop the empty side's `undefined`, and redeliver. Precedent:
    // UPDATE_SLOT_URL redelivers to the slot's bound tab the same way.
    //
    // The re-read is AWAITED (it is local storage, and it decides who to notify),
    // but the DELIVERY ITSELF IS NOT — it is a side effect of an already-committed
    // write, not part of the answer.
    //
    // Reported defect: awaiting it here meant a bound tab that could not answer
    // `FIELD_APPLY` (navigating, frozen, no content script yet) held the RESPONSE
    // open until the worker's 10s budget expired. The swap had long since been
    // written, so the user was told "taking longer than expected — check whether it
    // applied" for a swap that had applied. Delivery is retried on its own ladder
    // and reported as degraded per tab, so nothing is lost by not waiting: the
    // caller cannot act on a per-tab delivery outcome, and the sidebar re-reads
    // state after its toast anyway.
    const localAfter = await this.repo.getLocalState();
    const affectedTabIds = [sourceSlotId, targetSlotId]
      .map((id) => localAfter.bindings.find((b) => b.slotId === id)?.tabId)
      .filter((tabId): tabId is number => typeof tabId === 'number');
    if (affectedTabIds.length > 0) {
      // Fire-and-forget, with a catch so a delivery failure cannot become an
      // unhandled rejection in the worker.
      void this.deliver(affectedTabIds).catch(() => undefined);
    }

    return { success: true, configVersion: this.repo.getConfigVersion(), changed: true, captureId, expiresAt: swapExpiresAt };
  }

  // ─── Switch Slot ───────────────────────────────────────────────────────

  /**
   * Switch to a slot's target tab.
   * Applies matching strategy (A/B/C) and returns outcome.
   */
  async switchSlot(slotId: number): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    const sync = await this.repo.getSyncState();
    const local = await this.repo.getLocalState();

    const slot = sync.slots.find((s) => s.id === slotId);
    if (!slot) {
      return { success: false, errorCode: 'SLOT_EMPTY', message: `Slot ${slotId} is not configured` };
    }

    // Effective settings (slot override or global). Read-side defensive default
    // (NIT-4): UI mocks / hand-built payloads can omit these fields at runtime
    // even though the type marks them required, so the widening below is
    // deliberate. This is NOT a compatibility layer — it never reads the removed
    // legacy strategy field.
    const syncRuntime = sync as Partial<SyncState>;
    const effectiveSettings = slot.strategy === 'inherit'
      ? (syncRuntime.matchSettings ?? DEFAULT_MATCH_SETTINGS)
      : slot.strategy;

    // Check incognito authorization
    const incognitoAllowed = await this.adapter.incognito.isAllowed();

    // Get binding
    const binding = local.bindings.find((b) => b.slotId === slotId);

    // Resolve the live binding tab (null when it is closed).
    const bindingTab = binding ? await this.getLiveCandidate(binding.tabId) : null;
    if (bindingTab && bindingTab.isIncognito && !incognitoAllowed) {
      return { success: true, outcome: { type: 'incognito_blocked', slotId } };
    }

    // Gather resolver inputs (no caching — A14).
    const candidates = await this.findCandidates(slot.urlMatch, incognitoAllowed);
    const activeTabId = await this.getActiveTabId();
    const positionalRing = await this.buildCurrentWindowRing();

    const resolution = resolveSwitch({
      settings: effectiveSettings,
      urlMatch: slot.urlMatch,
      bindingTabId: binding?.tabId ?? null,
      bindingTab,
      candidates,
      positionalRing,
      activeTabId,
      direction: syncRuntime.switchDirection ?? 'next',
    });

    if (resolution.kind === 'noop') {
      return { success: true, outcome: { type: 'no_match', slotId } };
    }

    if (resolution.kind === 'recovery') {
      const recoveryId = await this.createRecoverySession(slot);
      return { success: true, outcome: { type: 'needs_recovery', recoveryId, slotId } };
    }

    // resolution.kind === 'switch' — perform activation + commit-class bookkeeping.
    const targetTab = await this.getLiveCandidate(resolution.targetTabId);
    await this.activateTabById(resolution.targetTabId, targetTab?.windowId ?? -1);
    await this.recordSuccess(slotId);

    if (candidates.length > 0) {
      const currentIdx = candidates.findIndex((c) => c.tabId === resolution.targetTabId);
      await this.repo.setCycleCursor({
        slotId,
        currentIndex: currentIdx >= 0 ? currentIdx : 0,
        candidateTabIds: candidates.map((c) => c.tabId),
        updatedAt: new Date().toISOString(),
      });
    }

    // Commit class (design §3.4) → update binding.
    await this.repo.setBinding({
      slotId,
      tabId: resolution.targetTabId,
      windowId: targetTab?.windowId ?? -1,
      boundAt: new Date().toISOString(),
    });

    // `crossWindow` must be derived from the PRE-activation snapshot: activating a
// tab in another window focuses that window, after which `getCurrent()` would
// report the target window as current and the flag would always be false.
    return {
      success: true,
      outcome: {
        type: 'switched',
        tabId: resolution.targetTabId,
        windowId: targetTab?.windowId ?? -1,
        crossWindow: targetTab ? targetTab.isCurrentWindow === false : false,
      },
    };
  }

  // ─── Next Match ────────────────────────────────────────────────────────

  /**
   * Switch to next matching tab based on last successful slot's cycle cursor.
   */
  async nextMatch(): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    const local = await this.repo.getLocalState();
    const sync = await this.repo.getSyncState();

    const lastSlotId = local.lastSuccessSlotId;
    if (lastSlotId === null) {
      return { success: false, errorCode: 'NO_MATCH', message: 'No previous successful switch to cycle from' };
    }

    const slot = sync.slots.find((s) => s.id === lastSlotId);
    if (!slot) {
      return { success: false, errorCode: 'SLOT_EMPTY', message: `Slot ${lastSlotId} no longer configured` };
    }

    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const candidates = await this.findCandidates(slot.urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      return { success: true, outcome: { type: 'no_match', slotId: lastSlotId } };
    }

    // Direction-aware (D6): the single-command entry honours the global direction.
    const syncRuntime = sync as Partial<SyncState>;
    const direction = syncRuntime.switchDirection ?? 'next';

    // Get or create cursor
    const cursor = local.cycleCursors.find((c) => c.slotId === lastSlotId);
    let nextIndex = 0;

    if (cursor) {
      const step = direction === 'next' ? 1 : -1;
      nextIndex = (cursor.currentIndex + step + candidates.length) % candidates.length;
    } else if (direction === 'previous') {
      nextIndex = candidates.length - 1;
    }

    const target = candidates[nextIndex];
    await this.activateTabById(target.tabId, target.windowId);

    // Update cursor
    await this.repo.setCycleCursor({
      slotId: lastSlotId,
      currentIndex: nextIndex,
      candidateTabIds: candidates.map((c) => c.tabId),
      updatedAt: new Date().toISOString(),
    });

    // Update binding
    await this.repo.setBinding({
      slotId: lastSlotId,
      tabId: target.tabId,
      windowId: target.windowId,
      boundAt: new Date().toISOString(),
    });

    return {
      success: true,
      outcome: { type: 'switched', tabId: target.tabId, windowId: target.windowId, crossWindow: target.isCurrentWindow === false },
    };
  }

  // ─── Position (↑/↓) — Current Page (T8 / D7 / BLK-A / A1) ─────────────

  /**
   * Step to the previous/next tab BY POSITION within the current window.
   *
   * - Ring = live tabs of the current window, ordered by tab index (A14).
   * - Start point = `anchorTabId` (the sidebar passes `lockedTabId ?? currentTabId`).
   *   A stale/closed anchor degrades to the current active tab WITHOUT error (DT7).
   * - A single-tab ring is a no-op (DT4).
   * - Browsing class: the slot binding is NOT touched (A4b).
   */
  async positionPrev(anchorTabId?: number): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    return this.positionStep('previous', anchorTabId);
  }

  async positionNext(anchorTabId?: number): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    return this.positionStep('next', anchorTabId);
  }

  private async positionStep(
    direction: 'previous' | 'next',
    anchorTabId?: number,
  ): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    const ring = await this.buildCurrentWindowRing();
    if (ring.length === 0) {
      return { success: false, errorCode: 'NO_CANDIDATES', message: 'No tabs in the current window' };
    }
    if (ring.length === 1) {
      // Single-tab ring → no-op, not an error (DT4).
      return { success: true, outcome: { type: 'no_match', slotId: 0 } };
    }

    const activeTabId = await this.getActiveTabId();
    // Start point: a live anchor wins; a stale anchor degrades to the active
    // tab without error (DT7).
    const anchorTab = anchorTabId === undefined ? undefined : ring.find((t) => t.tabId === anchorTabId);
    const startTabId: number | null = anchorTab !== undefined ? anchorTab.tabId : activeTabId;

    const startIdx = startTabId === null ? -1 : ring.findIndex((t) => t.tabId === startTabId);
    const baseIdx = startIdx >= 0 ? startIdx : 0;
    const delta = direction === 'next' ? 1 : -1;
    const targetIdx = (baseIdx + delta + ring.length) % ring.length;
    const target = ring[targetIdx];

    // ACC#7: the ring is the user's window, so compare against it (not the
    // focused popup) to avoid a spurious focus jump.
    const currentWindow = await resolveUserWindow(this.adapter);
    if (target.windowId !== currentWindow.id) {
      await this.adapter.windows.update(target.windowId, { focused: true });
    }
    await this.adapter.tabs.update(target.tabId, { active: true });

    // Browsing class → binding intentionally NOT updated (A4b).
    await this.recordSuccess(0);

    return {
      success: true,
      outcome: { type: 'switched', tabId: target.tabId, windowId: target.windowId, crossWindow: false },
    };
  }

  // ─── Next Match for Specific Slot (Problem 1) ─────────────────────────

  /**
   * Switch to next matching tab for a specific slot (cycle cursor per slot).
   * Used by the sidebar "Next" button. If only one match, equivalent to switching to it.
   */
  async nextMatchForSlot(slotId: number): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    const sync = await this.repo.getSyncState();
    const local = await this.repo.getLocalState();

    const slot = sync.slots.find((s) => s.id === slotId);
    if (!slot) {
      return { success: false, errorCode: 'SLOT_EMPTY', message: `Slot ${slotId} is not configured` };
    }

    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const candidates = await this.findCandidates(slot.urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      return { success: true, outcome: { type: 'no_match', slotId } };
    }

    // Get or create cursor for this slot
    let cursor = local.cycleCursors.find((c) => c.slotId === slotId);
    let nextIndex = 0;

    if (cursor && candidates.length > 1) {
      nextIndex = (cursor.currentIndex + 1) % candidates.length;
    }

    const target = candidates[nextIndex];
    await this.activateTabById(target.tabId, target.windowId);

    // Update cursor
    await this.repo.setCycleCursor({
      slotId,
      currentIndex: nextIndex,
      candidateTabIds: candidates.map((c) => c.tabId),
      updatedAt: new Date().toISOString(),
    });

    // NOTE: intentionally NOT updating the slot binding here — next-match
    // cycling must keep the binding pointing at the pre-switch tab.
    //
    // EMERGENT, INTENTIONAL (design §3.4): after cycling through Matches with
    // this button, pressing "Switch to slot x" (combination 4) FOCUSES BACK to
    // the binding — deliberately NOT the page you cycled to. This is the
    // documented consequence of the commit/browse split ("browsing must not
    // update the binding"). Do NOT "fix" it as if it were an oversight.

    // Record success for global next-match
    await this.recordSuccess(slotId);

    return {
      success: true,
      outcome: { type: 'switched', tabId: target.tabId, windowId: target.windowId, crossWindow: target.isCurrentWindow === false },
    };
  }

  // ─── Previous Match for Specific Slot (Bug 3) ─────────────────────────

  /**
   * Switch to the previous matching tab for a specific slot (reverse cycle).
   * Mirror of nextMatchForSlot: index = (currentIndex - 1 + n) % n.
   * Candidates are re-queried fresh every call, so a cursor referencing stale
   * tabIds simply wraps modulo the current candidate count.
   * Does NOT update the slot binding (same contract as nextMatchForSlot).
   */
  async prevMatchForSlot(slotId: number): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    const sync = await this.repo.getSyncState();
    const local = await this.repo.getLocalState();

    const slot = sync.slots.find((s) => s.id === slotId);
    if (!slot) {
      return { success: false, errorCode: 'SLOT_EMPTY', message: `Slot ${slotId} is not configured` };
    }

    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const candidates = await this.findCandidates(slot.urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      return { success: true, outcome: { type: 'no_match', slotId } };
    }

    // Get cursor for this slot; without one, start at the first candidate
    // (same start rule as nextMatchForSlot).
    const cursor = local.cycleCursors.find((c) => c.slotId === slotId);
    let prevIndex = 0;

    if (cursor && candidates.length > 1) {
      prevIndex = (cursor.currentIndex - 1 + candidates.length) % candidates.length;
    }

    const target = candidates[prevIndex];
    await this.activateTabById(target.tabId, target.windowId);

    // Update cursor
    await this.repo.setCycleCursor({
      slotId,
      currentIndex: prevIndex,
      candidateTabIds: candidates.map((c) => c.tabId),
      updatedAt: new Date().toISOString(),
    });

    // NOTE: intentionally NOT updating the slot binding here — prev-match
    // cycling must keep the binding pointing at the pre-switch tab.
    //
    // EMERGENT, INTENTIONAL (design §3.4): see the twin note in
    // `nextMatchForSlot` — after cycling with this button, "Switch to slot x"
    // (combination 4) focuses back to the binding on purpose. Not a defect.

    // Record success for global next-match
    await this.recordSuccess(slotId);

    return {
      success: true,
      outcome: { type: 'switched', tabId: target.tabId, windowId: target.windowId, crossWindow: target.isCurrentWindow === false },
    };
  }

  // ─── Current-page Next/Prev Match ─────────────────────────────────────

  /**
   * Switch to the next tab matching the current page's URL (exact match).
   * Mirrors nextMatchForSlot but keyed on a raw URL instead of a slot definition.
   * The current page's effective URL is used verbatim as an exact UrlMatch.
   */
  async nextMatchForUrl(url: string): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    const urlMatch: SlotDefinition['urlMatch'] = { type: 'exact', value: url };
    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const candidates = await this.findCandidates(urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      return { success: true, outcome: { type: 'no_match', slotId: 0 } };
    }

    // Cycle relative to the currently active tab (or start at 0).
    const activeTabs = await this.adapter.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    let nextIndex = 0;
    if (activeTab && activeTab.id != null && candidates.length > 1) {
      const activeIdx = candidates.findIndex((c) => c.tabId === activeTab.id);
      nextIndex = activeIdx >= 0 ? (activeIdx + 1) % candidates.length : 0;
    }

    const target = candidates[nextIndex];
    await this.activateTabById(target.tabId, target.windowId);

    return {
      success: true,
      outcome: { type: 'switched', tabId: target.tabId, windowId: target.windowId, crossWindow: target.isCurrentWindow === false },
    };
  }

  /**
   * Switch to the previous tab matching the current page's URL (exact match).
   * Index = (activeIndex - 1 + n) % n.
   */
  async prevMatchForUrl(url: string): Promise<{ success: true; outcome: SwitchOutcome } | { success: false; errorCode: string; message: string }> {
    const urlMatch: SlotDefinition['urlMatch'] = { type: 'exact', value: url };
    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const candidates = await this.findCandidates(urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      return { success: true, outcome: { type: 'no_match', slotId: 0 } };
    }

    const activeTabs = await this.adapter.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    let prevIndex = 0;
    if (activeTab && activeTab.id != null && candidates.length > 1) {
      const activeIdx = candidates.findIndex((c) => c.tabId === activeTab.id);
      prevIndex = activeIdx >= 0 ? (activeIdx - 1 + candidates.length) % candidates.length : 0;
    }

    const target = candidates[prevIndex];
    await this.activateTabById(target.tabId, target.windowId);

    return {
      success: true,
      outcome: { type: 'switched', tabId: target.tabId, windowId: target.windowId, crossWindow: target.isCurrentWindow === false },
    };
  }

  // ─── Unbind Slot ───────────────────────────────────────────────────────

  async unbindSlot(slotId: number): Promise<
    | { success: true; configVersion: number; captureId?: number; expiresAt?: number }
    | { success: false; errorCode: DomainErrorCode; message: string }
  > {
    // DR3 RECONSIDERED (this iteration): the delete is now undoable.
    //
    // The original ruling was that a delete could not be undone because no snapshot
    // was captured and no "restore a slot" entry point existed. Neither is true any
    // more: `captureUndoSnapshot` and `restoreSlot`'s `single` branch were built for
    // the overwrite path and are already GENERAL slot restores (slot definition +
    // binding), so this only has to capture before it deletes.
    //
    // Captured BEFORE the write: after it, the slot is gone and there is nothing to
    // record. An empty slot yields no snapshot (nothing to restore), which is why
    // the result's `captureId` stays optional.
    const capture = await this.captureBeforeOverwrite(slotId);
    const result = await this.removeSlotAndBinding(slotId);
    if (!result.success) return result;
    return capture ? { ...result, ...capture } : result;
  }

  /**
   * Remove a slot's binding and definition, WITHOUT capturing a snapshot.
   *
   * Split out of `unbindSlot` so the two callers can differ on the one thing that
   * matters: a user-initiated delete captures (so it can be undone), while
   * `restoreSlot`'s "no snapshot for this capture" fallback must not — capturing
   * there would arm a fresh undo entry from inside an undo, and the delete it
   * performs is a degradation, not an action the user took.
   */
  private async removeSlotAndBinding(slotId: number): Promise<WriteResult> {
    // Remove local binding
    await this.repo.removeBinding(slotId);
    // Remove slot definition from sync storage (Problem 1: ✕ must fully reset)
    const version = this.repo.getConfigVersion();
    // B3: surface the write outcome — a failed sync removal must not be reported as success.
    return this.repo.removeSlot(slotId, version);
  }

  // ─── Undo Snapshot (B2) ────────────────────────────────────────────────

  /**
   * Capture the state of `slotId` immediately before an overwrite so UNDO_SAVE
   * can restore it (rather than deleting the slot).
   *
   * Writes to a dedicated `storage.local` key with a 5s TTL. A cleanup timer is
   * armed as a best effort; correctness relies on the lazy `expiresAt` check in
   * `repo.getPendingUndo` because a service worker may be suspended.
   *
   * A10: returns the `captureId` of the entry it appended, or `undefined` when
   * the slot was empty (early return — nothing captured, so nothing to undo).
   */
  async captureUndoSnapshot(
    slotId: number,
  ): Promise<{ captureId: number; expiresAt: number } | undefined> {
    const sync = await this.repo.getSyncState();
    const existingSlot = sync.slots.find((s) => s.id === slotId);
    if (!existingSlot) return undefined;

    const local = await this.repo.getLocalState();
    const existingBinding = local.bindings.find((b) => b.slotId === slotId) ?? null;

    // Deep enough copy to be immune to later in-place mutation of the live state.
    const slotSnapshot: SlotDefinition = {
      ...existingSlot,
      urlMatch: { ...existingSlot.urlMatch },
      uiMarker: { ...existingSlot.uiMarker },
    };

    // T34: stamp this capture with a unique identity so ownership can be proven
    // later. `slotId` alone cannot distinguish two rapid overwrites of the SAME
    // slot, which is how the first capture's timer used to destroy the second,
    // still-valid undo snapshot (and UNDO_SAVE then silently deleted the slot).
    const captureId = nextCaptureId();

    // R1 (F4 review): the expiry is computed HERE, at capture time, and handed
    // back to the caller. The UI previously derived its own `Date.now() + 5s`
    // from the RESPONSE, which lands one round-trip later — leaving a window
    // where the worker's entry is already expired but the bar is still shown.
    // Clicking it there made `restoreSlot` take its "no snapshot → unbindSlot"
    // path and SILENTLY DELETE the slot. One source of truth closes that window.
    const expiresAt = Date.now() + PENDING_UNDO_TTL_MS;

    // U5/Z1: append to the shared stack rather than replacing it — one entry per
    // undoable action. `id` is the stack-local identity (distinct from
    // `captureId`, which proves ownership); derived from the globally unique
    // capture identity so it is stable and collision-free.
    await this.repo.setPendingUndo({
      kind: 'single',
      id: `single-${String(captureId)}`,
      slotId,
      captureId,
      slotSnapshot,
      bindingSnapshot: existingBinding ? { ...existingBinding } : null,
      expiresAt,
    });

    // Best-effort cleanup — the lazy expiresAt check is the real guarantee.
    // T25 (N2) + T34: pass BOTH slotId and captureId so this timer can only ever
    // clear the exact capture it armed; neither a newer slot's snapshot nor a
    // newer capture of the same slot may be clobbered.
    setTimeout(() => {
      void this.repo.clearPendingUndo(slotId, captureId);
    }, PENDING_UNDO_TTL_MS + 100);

    // A10/R1: expose the generated identity AND the authoritative expiry so the
    // caller can both address this capture and stop the bar at the instant the
    // worker stops honouring it.
    return { captureId, expiresAt };
  }

  /**
   * Undo the action identified by `captureId` (U1/U5/Z1).
   *
   * Taking the CAPTURE identity (not "the newest snapshot") is what makes each
   * stacked undo bar act on ITS OWN action — clicking the second bar must undo
   * the second action, never the latest one (U1).
   *
   * Dispatch is by the stored entry's `kind` (Z1):
   * - `single` → the pre-existing overwrite semantics (restore, or degrade to
   *   deletion when there is no snapshot — `unbindSlot`, B3-propagated).
   * - `swap`   → restore BOTH slots (content + binding) in one write, mirroring
   *   the same ordered-write + compensation sequence the forward swap uses.
   *
   * The entry is always cleared so a given undo can only be consumed once.
   */
  async restoreSlot(slotId: number, captureId: number): Promise<WriteResult> {
    const pending = await this.repo.getPendingUndo(captureId);

    if (!pending) {
      // No (valid) entry for this capture — degrade to deletion; propagate any
      // write failure. Goes through the NON-capturing removal: an undo must not
      // arm a new undo entry for a delete the user did not ask for.
      return this.removeSlotAndBinding(slotId);
    }

    if (pending.kind === 'swap') {
      return this.restoreSwapSnapshot(pending);
    }

    const version = this.repo.getConfigVersion();
    const saved = await this.repo.saveSlot(pending.slotSnapshot as SlotDefinition, version);
    if (!saved.success) {
      return saved;
    }

    if (pending.bindingSnapshot) {
      await this.repo.setBinding(pending.bindingSnapshot);
    } else {
      await this.repo.removeBinding(pending.slotId);
    }

    // T25 (N2) + T34: conditional clear with BOTH identities — only consume the
    // exact capture we just restored, never a newer one.
    await this.repo.clearPendingUndo(pending.slotId, pending.captureId);
    return saved;
  }

  /**
   * Restore both slots carried by a `swap` undo entry (Z1).
   *
   * One undo = one write (D4): both slot definitions go into a SINGLE `writeSync`
   * and both bindings into a SINGLE `writeLocal`. Sync is written first, so a
   * version conflict aborts before local is touched (nothing to compensate). A
   * local failure is compensated by writing the pre-restore sync state back —
   * the same ordered-write + compensation shape as the forward swap (D14).
   */
  private async restoreSwapSnapshot(
    entry: Extract<PendingUndoSnapshot, { kind: 'swap' }>,
  ): Promise<WriteResult> {
    const version = this.repo.getConfigVersion();
    const before = await this.repo.getSyncState();
    const beforeSlots = new Map(before.slots.map((s) => [s.id, s] as const));
    const beforeBindings = (await this.repo.getLocalState()).bindings;

    const upsert = (slots: SlotDefinition[], id: number, next: SlotDefinition | null): void => {
      const idx = slots.findIndex((s) => s.id === id);
      if (next === null) {
        if (idx >= 0) slots.splice(idx, 1);
        return;
      }
      if (idx >= 0) slots[idx] = next;
      else slots.push(next);
    };

    const restored = await this.repo.writeSync(version, (state) => {
      const slots = [...state.slots];
      upsert(slots, entry.sourceSlotId, entry.sourceSnapshot);
      upsert(slots, entry.targetSlotId, entry.targetSnapshot);
      return { ...state, slots };
    });
    if (!restored.success) {
      return restored;
    }

    const applyBinding = (
      bindings: SlotBinding[],
      id: number,
      next: SlotBinding | null,
    ): SlotBinding[] => {
      const without = bindings.filter((b) => b.slotId !== id);
      return next ? [...without, next] : without;
    };

    try {
      await this.repo.writeLocal((state) => ({
        ...state,
        bindings: applyBinding(
          applyBinding(state.bindings, entry.sourceSlotId, entry.sourceBinding),
          entry.targetSlotId,
          entry.targetBinding,
        ),
      }));
    } catch (e) {
      // Step ④ (D14): a failed local write is compensated by putting sync back.
      // If this compensation ALSO fails the state is inconsistent — the same
      // boundary the existing `clearAndWriteWithCompensation` documents.
      await this.repo.writeSync(this.repo.getConfigVersion(), (state) => ({
        ...state,
        slots: state.slots
          .filter((s) => s.id !== entry.sourceSlotId && s.id !== entry.targetSlotId)
          .concat(
            [beforeSlots.get(entry.sourceSlotId), beforeSlots.get(entry.targetSlotId)].filter(
              (s): s is SlotDefinition => s !== undefined,
            ),
          ),
      }));
      await this.repo.writeLocal((state) => ({ ...state, bindings: beforeBindings }));
      throw e;
    }

    await this.repo.clearPendingUndo(entry.sourceSlotId, entry.captureId);
    return restored;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  /**
   * Fetch a live tab as a resolver-shaped candidate, or `null` when the tab no
   * longer exists (closed). Used for the slot binding and for the resolver's
   * chosen target.
   */
  private async getLiveCandidate(tabId: number): Promise<TabCandidate | null> {
    try {
      const tab = await this.adapter.tabs.get(tabId);
      const currentWindow = await resolveUserWindow(this.adapter);
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
        isCurrentWindow: tab.windowId === currentWindow.id,
        isIncognito: tab.incognito,
      };
    } catch {
      return null;
    }
  }

  /** The active tab id of the user's window, or null (ACC#7: not the focused popup). */
  private async getActiveTabId(): Promise<number | null> {
    const userWindow = await resolveUserWindow(this.adapter);
    const tabs = await this.adapter.tabs.query({ active: true, windowId: userWindow.id });
    return tabs.length > 0 ? tabs[0].id : null;
  }

  /** Position ring = live tabs of the user's window, ordered by tab index (ACC#7). */
  private async buildCurrentWindowRing(): Promise<TabCandidate[]> {
    const currentWindow = await resolveUserWindow(this.adapter);
    const allTabs = await this.adapter.tabs.query({ windowId: currentWindow.id });
    const candidates: TabCandidate[] = allTabs.map((tab) => ({
      tabId: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      isCurrentWindow: tab.windowId === currentWindow.id,
      isIncognito: tab.incognito,
    }));
    return buildPositionRing(candidates, currentWindow.id);
  }

  /**
   * Find all matching tab candidates across all windows.
   */
  private async findCandidates(
    urlMatch: SlotDefinition['urlMatch'],
    incognitoAllowed: boolean,
  ): Promise<TabCandidate[]> {
    const allTabs = await this.adapter.tabs.query({});
    // ACC#7: order candidates against the USER'S window, not the focused popup.
    const currentWindow = await resolveUserWindow(this.adapter);

    const candidates: TabCandidate[] = allTabs.map((tab) => ({
      tabId: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      isCurrentWindow: tab.windowId === currentWindow.id,
      isIncognito: tab.incognito,
    }));

    // Single source of truth for filtering + ordering (A7): reuse the shared primitive.
    return findMatchCandidates(candidates, urlMatch, incognitoAllowed);
  }

  private async activateTabById(tabId: number, windowId: number): Promise<void> {
    // ACC#7/#1a: compare against the USER'S window. `getCurrent()` returns the
    // focused recovery popup while the user acts from it, which would wrongly
    // trigger a window-focus jump for a target that is already in the user's
    // window (and steal focus from the popup).
    const currentWindow = await resolveUserWindow(this.adapter);
    if (windowId !== currentWindow.id) {
      await this.adapter.windows.update(windowId, { focused: true });
    }
    await this.adapter.tabs.update(tabId, { active: true });
  }

  

  private async recordSuccess(slotId: number): Promise<void> {
    await this.repo.setLastSuccessSlot(slotId);
  }

  /**
   * Create (or reuse) the recovery session for a slot.
   *
   * FIX-3: invariant "at most ONE active session per slot" (design §3.5). A slot
   * owns a single singleton window, so letting a second live session accumulate
   * would leak windows. Repeated `needs_recovery` for the same slot therefore
   * REUSES the active session (its `windowId` is preserved, so the worker
   * focuses the window instead of spawning a duplicate).
   *
   * The expiry filter mirrors `RecoveryService.getSession`'s lazy check: an
   * EXPIRED same-slot session is pruned and never treated as reusable — that
   * keeps the reuse decision consistent with what every consumer of a session
   * would observe.
   */
  private async createRecoverySession(slot: SlotDefinition): Promise<string> {
    const now = new Date();
    const nowMs = now.getTime();

    const local = await this.repo.getLocalState();
    const sameSlot = local.recoverySessions.filter((s) => s.slotId === slot.id);
    const active = sameSlot.find((s) => new Date(s.expiresAt).getTime() >= nowMs);

    // Drop every same-slot session that is expired (or superseded by `active`).
    for (const stale of sameSlot) {
      if (stale !== active) {
        await this.repo.removeRecoverySession(stale.recoveryId);
      }
    }
    if (active) {
      return active.recoveryId;
    }

    const recoveryId = `rec-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date(nowMs + 5 * 60 * 1000); // 5 min TTL

    await this.repo.addRecoverySession({
      recoveryId,
      slotId: slot.id,
      urlMatch: slot.urlMatch,
      titleSnapshot: slot.titleSnapshot,
      faviconSnapshot: slot.faviconSnapshot,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      // Backfilled by the worker when the recovery window is created/focused.
      windowId: -1,
      candidateCursor: null,
    });

    return recoveryId;
  }
}
