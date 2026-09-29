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

import type { BrowserAdapter, NormalizedTab } from '@adapters/contract';
import type { StorageRepository, WriteResult } from './storage-repository';
import { PENDING_UNDO_TTL_MS } from './storage-repository';
import type {
  SlotDefinition,
  MatchStrategy,
  TabCandidate,
  SwitchOutcome,
} from '@shared/types';
import { matchesUrl, sortCandidates, normalizeUrl } from '@shared/url-utils';

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

export class SlotService {
  constructor(
    private adapter: BrowserAdapter,
    private repo: StorageRepository,
  ) {}

  // ─── Save Slot ─────────────────────────────────────────────────────────

  /**
   * Save current active tab to a slot.
   */
  async saveSlot(
    slotId: number,
    expectedVersion: number,
    uiMarker?: SlotDefinition['uiMarker'],
    strategy?: MatchStrategy | 'inherit',
  ): Promise<{ success: true; slot: SlotDefinition } | { success: false; errorCode: string; message: string }> {
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
    await this.captureBeforeOverwrite(slotId);

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

    return { success: true, slot };
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
   */
  private async captureBeforeOverwrite(slotId: number): Promise<void> {
    try {
      await this.captureUndoSnapshot(slotId);
    } catch {
      // Non-fatal: the save proceeds without an undo snapshot.
    }
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

    // Determine effective strategy
    const effectiveStrategy = slot.strategy === 'inherit'
      ? sync.globalStrategy
      : slot.strategy;

    // Check incognito authorization
    const incognitoAllowed = await this.adapter.incognito.isAllowed();

    // Get binding
    const binding = local.bindings.find((b) => b.slotId === slotId);

    // Strategy A: Session tab first
    if (effectiveStrategy === 'A' && binding) {
      try {
        const tab = await this.adapter.tabs.get(binding.tabId);
        if (tab.incognito && !incognitoAllowed) {
          return { success: true, outcome: { type: 'incognito_blocked', slotId } };
        }
        await this.activateTab(tab);
        await this.recordSuccess(slotId, tab);
        return {
          success: true,
          outcome: { type: 'switched', tabId: tab.id, windowId: tab.windowId, crossWindow: await this.isCrossWindow(tab.windowId) },
        };
      } catch {
        // Tab no longer exists, fall through to URL matching
      }
    }

    // Strategy B: Session tab + rule validation
    if (effectiveStrategy === 'B' && binding) {
      try {
        const tab = await this.adapter.tabs.get(binding.tabId);
        if (tab.incognito && !incognitoAllowed) {
          return { success: true, outcome: { type: 'incognito_blocked', slotId } };
        }
        // Validate URL still matches
        if (matchesUrl(tab.url, slot.urlMatch)) {
          await this.activateTab(tab);
          await this.recordSuccess(slotId, tab);

          // Initialize cycle cursor with all candidates
          const allCandidates = await this.findCandidates(slot.urlMatch, incognitoAllowed);
          const currentIdx = allCandidates.findIndex((c) => c.tabId === tab.id);
          await this.repo.setCycleCursor({
            slotId,
            currentIndex: currentIdx >= 0 ? currentIdx : 0,
            candidateTabIds: allCandidates.map((c) => c.tabId),
            updatedAt: new Date().toISOString(),
          });

          return {
            success: true,
            outcome: { type: 'switched', tabId: tab.id, windowId: tab.windowId, crossWindow: await this.isCrossWindow(tab.windowId) },
          };
        }
        // URL no longer matches — fall through to full search
      } catch {
        // Tab no longer exists — fall through
      }
    }

    // Strategy C (or fallback): Full URL/regex search
    const candidates = await this.findCandidates(slot.urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      // No candidates — needs recovery
      const recoveryId = await this.createRecoverySession(slot);
      return {
        success: true,
        outcome: { type: 'needs_recovery', recoveryId, slotId },
      };
    }

    // Activate first candidate
    const target = candidates[0];
    await this.activateTabById(target.tabId, target.windowId);
    await this.recordSuccess(slotId, { id: target.tabId, windowId: target.windowId } as NormalizedTab);

    // Initialize cycle cursor at index 0
    await this.repo.setCycleCursor({
      slotId,
      currentIndex: 0,
      candidateTabIds: candidates.map((c) => c.tabId),
      updatedAt: new Date().toISOString(),
    });

    // Update binding
    await this.repo.setBinding({
      slotId,
      tabId: target.tabId,
      windowId: target.windowId,
      boundAt: new Date().toISOString(),
    });

    return {
      success: true,
      outcome: { type: 'switched', tabId: target.tabId, windowId: target.windowId, crossWindow: target.isCurrentWindow === false },
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

    // Get or create cursor
    let cursor = local.cycleCursors.find((c) => c.slotId === lastSlotId);
    let nextIndex = 0;

    if (cursor) {
      nextIndex = (cursor.currentIndex + 1) % candidates.length;
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

    // Record success for global next-match
    await this.recordSuccess(slotId, { id: target.tabId, windowId: target.windowId } as NormalizedTab);

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

    // Record success for global next-match
    await this.recordSuccess(slotId, { id: target.tabId, windowId: target.windowId } as NormalizedTab);

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

  async unbindSlot(slotId: number): Promise<WriteResult> {
    // Remove local binding
    await this.repo.removeBinding(slotId);
    // Remove slot definition from sync storage (Problem 1: ✕ must fully reset)
    const version = this.repo.getConfigVersion();
    const result = await this.repo.removeSlot(slotId, version);
    // B3: surface the write outcome — a failed sync removal must not be reported as success.
    return result;
  }

  // ─── Undo Snapshot (B2) ────────────────────────────────────────────────

  /**
   * Capture the state of `slotId` immediately before an overwrite so UNDO_SAVE
   * can restore it (rather than deleting the slot).
   *
   * Writes to a dedicated `storage.local` key with a 5s TTL. A cleanup timer is
   * armed as a best effort; correctness relies on the lazy `expiresAt` check in
   * `repo.getPendingUndo` because a service worker may be suspended.
   */
  async captureUndoSnapshot(slotId: number): Promise<void> {
    const sync = await this.repo.getSyncState();
    const existingSlot = sync.slots.find((s) => s.id === slotId);
    if (!existingSlot) return;

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

    await this.repo.setPendingUndo({
      slotId,
      captureId,
      slotSnapshot,
      bindingSnapshot: existingBinding ? { ...existingBinding } : null,
      expiresAt: Date.now() + PENDING_UNDO_TTL_MS,
    });

    // Best-effort cleanup — the lazy expiresAt check is the real guarantee.
    // T25 (N2) + T34: pass BOTH slotId and captureId so this timer can only ever
    // clear the exact capture it armed; neither a newer slot's snapshot nor a
    // newer capture of the same slot may be clobbered.
    setTimeout(() => {
      void this.repo.clearPendingUndo(slotId, captureId);
    }, PENDING_UNDO_TTL_MS + 100);
  }

  /**
   * Undo a previous overwrite of `slotId`.
   *
   * - Snapshot present & unexpired → restore slot definition + binding.
   * - Otherwise → degrade to the delete semantics (`unbindSlot`, B3-propagated).
   *
   * The snapshot is always cleared so a given undo can only be consumed once.
   */
  async restoreSlot(slotId: number): Promise<WriteResult> {
    const pending = await this.repo.getPendingUndo(slotId);

    if (!pending) {
      // No (valid) snapshot — degrade to deletion; propagate any write failure.
      return this.unbindSlot(slotId);
    }

    const version = this.repo.getConfigVersion();
    const saved = await this.repo.saveSlot(pending.slotSnapshot, version);
    if (!saved.success) {
      return saved;
    }

    if (pending.bindingSnapshot) {
      await this.repo.setBinding(pending.bindingSnapshot);
    } else {
      await this.repo.removeBinding(slotId);
    }

    // T25 (N2) + T34: conditional clear with BOTH identities — only consume the
    // exact capture we just restored, never a newer one.
    await this.repo.clearPendingUndo(slotId, pending.captureId);
    return saved;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  /**
   * Find all matching tab candidates across all windows.
   */
  private async findCandidates(
    urlMatch: SlotDefinition['urlMatch'],
    incognitoAllowed: boolean,
  ): Promise<TabCandidate[]> {
    const allTabs = await this.adapter.tabs.query({});
    const currentWindow = await this.adapter.windows.getCurrent();

    const candidates: TabCandidate[] = allTabs
      .filter((tab) => {
        // Exclude incognito tabs if not authorized
        if (tab.incognito && !incognitoAllowed) return false;
        // Match URL
        return matchesUrl(tab.url, urlMatch);
      })
      .map((tab) => ({
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
        isCurrentWindow: tab.windowId === currentWindow.id,
        isIncognito: tab.incognito,
      }));

    return sortCandidates(candidates);
  }

  /**
   * Activate a tab and focus its window.
   */
  private async activateTab(tab: NormalizedTab): Promise<void> {
    // Focus window first if needed
    const currentWindow = await this.adapter.windows.getCurrent();
    if (tab.windowId !== currentWindow.id) {
      await this.adapter.windows.update(tab.windowId, { focused: true });
    }
    // Activate tab
    await this.adapter.tabs.update(tab.id, { active: true });
  }

  private async activateTabById(tabId: number, windowId: number): Promise<void> {
    const currentWindow = await this.adapter.windows.getCurrent();
    if (windowId !== currentWindow.id) {
      await this.adapter.windows.update(windowId, { focused: true });
    }
    await this.adapter.tabs.update(tabId, { active: true });
  }

  private async isCrossWindow(targetWindowId: number): Promise<boolean> {
    const currentWindow = await this.adapter.windows.getCurrent();
    return currentWindow.id !== targetWindowId;
  }

  private async recordSuccess(slotId: number, _tab: NormalizedTab): Promise<void> {
    await this.repo.setLastSuccessSlot(slotId);
  }

  private async createRecoverySession(slot: SlotDefinition): Promise<string> {
    const recoveryId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min TTL

    await this.repo.addRecoverySession({
      recoveryId,
      slotId: slot.id,
      urlMatch: slot.urlMatch,
      titleSnapshot: slot.titleSnapshot,
      faviconSnapshot: slot.faviconSnapshot,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return recoveryId;
  }
}
