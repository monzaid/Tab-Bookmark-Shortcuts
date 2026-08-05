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
import { matchesUrl, sortCandidates } from '@shared/url-utils';

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
  async openUrl(recoveryId: string): Promise<
    { success: true; outcome: SwitchOutcome } |
    { success: false; errorCode: string; message: string }
  > {
    const session = await this.getSession(recoveryId);
    if (!session) {
      return { success: false, errorCode: 'RECOVERY_EXPIRED', message: 'Recovery session expired or not found' };
    }

    try {
      if (session.urlMatch.type === 'regex') {
        // Cannot open a regex pattern as URL — return error
        return { success: false, errorCode: 'INVALID_REQUEST', message: 'Cannot open a regex pattern as URL' };
      }

      const newTab = await this.adapter.tabs.create({ url: session.urlMatch.value, active: true });

      // Update binding and snapshot
      await this.repo.setBinding({
        slotId: session.slotId,
        tabId: newTab.id,
        windowId: newTab.windowId,
        boundAt: new Date().toISOString(),
      });

      await this.repo.setLastSuccessSlot(session.slotId);

      // Clean up session
      await this.repo.removeRecoverySession(recoveryId);

      return {
        success: true,
        outcome: { type: 'switched', tabId: newTab.id, windowId: newTab.windowId, crossWindow: false },
      };
    } catch (e) {
      return { success: false, errorCode: 'BROWSER_API_ERROR', message: 'Failed to open URL' };
    }
  }

  /**
   * Switch to next matching tab — re-queries tabs in real time.
   */
  async nextMatch(recoveryId: string): Promise<
    { success: true; outcome: SwitchOutcome } |
    { success: false; errorCode: string; message: string }
  > {
    const session = await this.getSession(recoveryId);
    if (!session) {
      return { success: false, errorCode: 'RECOVERY_EXPIRED', message: 'Recovery session expired or not found' };
    }

    // Real-time re-query
    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const candidates = await this.findCandidates(session.urlMatch, incognitoAllowed);

    if (candidates.length === 0) {
      // No candidates — return displayable error, do NOT disable button
      return { success: false, errorCode: 'NO_MATCH', message: 'No matching tabs found at this time' };
    }

    const target = candidates[0];

    // Activate target
    const currentWindow = await this.adapter.windows.getCurrent();
    if (target.windowId !== currentWindow.id) {
      await this.adapter.windows.update(target.windowId, { focused: true });
    }
    await this.adapter.tabs.update(target.tabId, { active: true });

    // Update local binding and recovery snapshot only
    await this.repo.setBinding({
      slotId: session.slotId,
      tabId: target.tabId,
      windowId: target.windowId,
      boundAt: new Date().toISOString(),
    });

    await this.repo.setLastSuccessSlot(session.slotId);

    // Clean up session
    await this.repo.removeRecoverySession(recoveryId);

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
    const currentWindow = await this.adapter.windows.getCurrent();

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
