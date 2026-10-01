/**
 * Recovery Service — recoveryId sessions with real-time re-query on action.
 *
 * - Creates parallel, local, 5-min TTL recovery sessions
 * - Recovery page receives only the ID
 * - "Open URL" or "Next match" re-queries tabs in real time
 * - Success updates local tabId binding and recovery snapshot only
 * - Complete/cancel/close/timeout all delete the session
 * - Does NOT modify slot's original URL/regex definition
 */

import type { BrowserAdapter } from '@adapters/contract';
import type { StorageRepository } from './storage-repository';
import type {
  RecoverySession,
  SwitchOutcome,
  TabCandidate,
  UrlMatchDefinition,
} from '@shared/types';
import { matchesUrl, sortCandidates, isProtectedUrl } from '@shared/url-utils';
import { resolveUserWindow } from './user-window';

export class RecoveryService {
  constructor(
    private adapter: BrowserAdapter,
    private repo: StorageRepository,
  ) {}

  /**
   * Get a recovery session by ID. Returns null if not found or expired.
   */
  async getSession(recoveryId: string): Promise<RecoverySession | null> {
    const local = await this.repo.getLocalState();
    const session = local.recoverySessions.find((s) => s.recoveryId === recoveryId);
    if (!session) return null;

    // Check expiry
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.repo.removeRecoverySession(recoveryId);
      return null;
    }

    return session;
  }

  /**
   * Open the saved URL in a new tab.
   * Re-queries nothing — just opens the URL from the session.
   */
  async openUrl(
    recoveryId: string,
    autoBind: boolean,
  ): Promise<
    { success: true; outcome: SwitchOutcome } |
    { success: false; errorCode: string; message: string }
  > {
    const session = await this.getSession(recoveryId);
    if (!session) {
      return { success: false, errorCode: 'RECOVERY_EXPIRED', message: 'Recovery session expired or not found' };
    }

    if (session.urlMatch.type === 'regex') {
      // Cannot open a regex pattern as URL — return error.
      return { success: false, errorCode: 'INVALID_REQUEST', message: 'Cannot open a regex pattern as URL' };
    }

    // NOTE (ACC#3): there is deliberately NO `incognito.isAllowed()` gate here.
    // C3's intent is that authorization is required to ACTIVATE/FOCUS an
    // incognito tab or to CREATE one in an incognito context — NOT for every
    // ordinary `tabs.create`. Gating this path made "Open URL" fail
    // unconditionally under the shipped `incognito: not_allowed` manifest, since
    // `isAllowed()` is then always false (users saw "Failed to open URL").
    // A new tab here inherits its window's context; the ordinary target is
    // non-incognito, so no authorization is needed.

    // C2 fix (BLK-B / B2): privileged pages (including file://) are intercepted
    // on the OPEN/NAVIGATE path and reported through the EXISTING domain error —
    // no new SwitchOutcome variant, and applySwitchOutcome is not involved.
    if (isProtectedUrl(session.urlMatch.value)) {
      return { success: false, errorCode: 'PROTECTED_PAGE', message: 'This URL cannot be opened' };
    }

    try {
      const newTab = await this.adapter.tabs.create({ url: session.urlMatch.value, active: true });

      // A12: autoBind comes from the action payload; only bind when ticked.
      if (autoBind) {
        await this.repo.setBinding({
          slotId: session.slotId,
          tabId: newTab.id,
          windowId: newTab.windowId,
          boundAt: new Date().toISOString(),
        });
      }

      await this.repo.setLastSuccessSlot(session.slotId);

      // Open URL is a terminal action → consume the session (DT3).
      await this.repo.removeRecoverySession(recoveryId);

      return {
        success: true,
        outcome: { type: 'switched', tabId: newTab.id, windowId: newTab.windowId, crossWindow: false },
      };
    } catch {
      return { success: false, errorCode: 'BROWSER_API_ERROR', message: 'Failed to open URL' };
    }
  }

  /**
   * Switch to next matching tab — re-queries tabs in real time.
   */
  async nextMatch(
    recoveryId: string,
    autoBind: boolean,
  ): Promise<
    { success: true; outcome: SwitchOutcome } |
    { success: false; errorCode: string; message: string }
  > {
    return this.browse(recoveryId, autoBind, 'next');
  }

  /**
   * Switch to the previous matching tab — mirrors `nextMatch` in reverse.
   * Browsing never consumes the session and never closes the window (DT1/DT5).
   */
  async prevMatch(
    recoveryId: string,
    autoBind: boolean,
  ): Promise<
    { success: true; outcome: SwitchOutcome } |
    { success: false; errorCode: string; message: string }
  > {
    return this.browse(recoveryId, autoBind, 'previous');
  }

  /**
   * Shared Prev/Next browsing (DT1/DT2/DT5).
   *
   * - Real-time re-query; wraps around the candidate ring.
   * - Start point: the session's `candidateCursor` (tabId). If unset, anchor on
   *   the active tab's neighbour, else the first/last candidate.
   * - Updates `candidateCursor` and keeps the session alive.
   * - `binding` is updated ONLY when `autoBind` is ticked (A4b / A12).
   */
  private async browse(
    recoveryId: string,
    autoBind: boolean,
    direction: 'previous' | 'next',
  ): Promise<
    { success: true; outcome: SwitchOutcome } |
    { success: false; errorCode: string; message: string }
  > {
    const session = await this.getSession(recoveryId);
    if (!session) {
      return { success: false, errorCode: 'RECOVERY_EXPIRED', message: 'Recovery session expired or not found' };
    }

    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const candidates = await this.findCandidates(session.urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      // Displayable error; the session stays alive so the user can retry.
      return { success: false, errorCode: 'NO_MATCH', message: 'No matching tabs found at this time' };
    }

    const target = await this.pickCursorTarget(session, candidates, direction);

    // Activate target (focus its window first when needed).
    //
    // ACC#1a: the "current window" must be the USER'S browsing window, not the
    // focused recovery popup. `getCurrent()` returns the popup while the user is
    // clicking Prev/Next inside it, which made every target look like a
    // cross-window jump → `windows.update(..., { focused: true })` stole focus
    // from the popup on every click (the window appeared to close and could not
    // be clicked again). Resolve the user window first.
    const currentWindow = await resolveUserWindow(this.adapter);
    if (target.windowId !== currentWindow.id) {
      await this.adapter.windows.update(target.windowId, { focused: true });
    }
    await this.adapter.tabs.update(target.tabId, { active: true });

    // Keep the session; only advance the cursor.
    await this.repo.updateRecoverySession(recoveryId, { candidateCursor: target.tabId });

    if (autoBind) {
      await this.repo.setBinding({
        slotId: session.slotId,
        tabId: target.tabId,
        windowId: target.windowId,
        boundAt: new Date().toISOString(),
      });
    }

    await this.repo.setLastSuccessSlot(session.slotId);

    return {
      success: true,
      outcome: {
        type: 'switched',
        tabId: target.tabId,
        windowId: target.windowId,
        crossWindow: target.windowId !== currentWindow.id,
      },
    };
  }

  /**
   * Resolve the browse target from the cursor:
   * - cursor present in the ring → step in `direction` (wrap)
   * - cursor absent / null       → anchor on the active tab (if it is in the
   *   ring, use its neighbour; otherwise the first/last candidate)
   */
  private async pickCursorTarget(
    session: RecoverySession,
    candidates: TabCandidate[],
    direction: 'previous' | 'next',
  ): Promise<TabCandidate> {
    const delta = direction === 'next' ? 1 : -1;

    if (session.candidateCursor !== null) {
      const cursorIdx = candidates.findIndex((c) => c.tabId === session.candidateCursor);
      if (cursorIdx >= 0) {
        return candidates[(cursorIdx + delta + candidates.length) % candidates.length];
      }
      // Cursor tab is gone → restart from the ring edge.
      return direction === 'next' ? candidates[0] : candidates[candidates.length - 1];
    }

    // First browse: anchor on the active tab when it is a candidate
    // (design §3.5: "活动页在候选内则其后一个，否则 [0]/[last]").
    //
    // ACC#1a: `currentWindow: true` resolves to the FOCUSED window — the popup
    // while the user is browsing from it — so query the user's window explicitly.
    const userWindow = await resolveUserWindow(this.adapter);
    const activeTabs = await this.adapter.tabs.query({ active: true, windowId: userWindow.id });
    const activeId = activeTabs.length > 0 ? activeTabs[0].id : null;
    const activeIdx = activeId === null ? -1 : candidates.findIndex((c) => c.tabId === activeId);
    if (activeIdx >= 0) {
      return candidates[(activeIdx + delta + candidates.length) % candidates.length];
    }
    return direction === 'next' ? candidates[0] : candidates[candidates.length - 1];
  }

  /**
   * Dismiss recovery session (cancel/close/timeout — all treated as no-op).
   */
  async dismiss(recoveryId: string): Promise<void> {
    await this.repo.removeRecoverySession(recoveryId);
  }

  /**
   * Clean up all expired sessions.
   */
  async cleanupExpired(): Promise<number> {
    const local = await this.repo.getLocalState();
    const now = Date.now();
    let cleaned = 0;

    for (const session of local.recoverySessions) {
      if (new Date(session.expiresAt).getTime() < now) {
        await this.repo.removeRecoverySession(session.recoveryId);
        cleaned++;
      }
    }

    return cleaned;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async findCandidates(
    urlMatch: UrlMatchDefinition,
    incognitoAllowed: boolean,
  ): Promise<TabCandidate[]> {
    const allTabs = await this.adapter.tabs.query({});
    // ACC#1a: order candidates against the USER'S window, not the focused popup.
    const currentWindow = await resolveUserWindow(this.adapter);

    const candidates: TabCandidate[] = allTabs
      .filter((tab) => {
        if (tab.incognito && !incognitoAllowed) return false;
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
}
