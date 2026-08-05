/**
 * Diagnostics, Notification Policy, and Incognito Authorization Service.
 *
 * Diagnostics:
 * - Records only: timestamp, domain error code, browser type, operation type
 * - Does NOT contain URL, title, rule text, or page content
 * - Supports read/clear/manual export from local storage
 *
 * Notifications:
 * - Cross-window switch, recovery rebind, no target, background failure
 * - Does NOT notify for same-window normal switch/cycle
 *
 * Incognito:
 * - Query authorization status
 * - Exclude incognito tabs from save/match/switch/rewrite when not authorized
 */

import type { BrowserAdapter } from '@adapters/contract';
import type { StorageRepository } from './storage-repository';
import type { DiagnosticEntry, DomainErrorCode, NotificationType } from '@shared/types';

// ─── Diagnostics Service ─────────────────────────────────────────────────────

export class DiagnosticsService {
  constructor(
    private adapter: BrowserAdapter,
    private repo: StorageRepository,
  ) {}

  /**
   * Record a diagnostic entry (sanitized — no URL/title/rule text).
   */
  async record(errorCode: DomainErrorCode | 'SUCCESS', operationType: string): Promise<void> {
    const entry: DiagnosticEntry = {
      timestamp: new Date().toISOString(),
      errorCode,
      browserType: this.adapter.getBrowserType(),
      operationType,
    };
    await this.repo.addDiagnostic(entry);
  }

  /**
   * Get all diagnostic entries.
   */
  async getEntries(): Promise<DiagnosticEntry[]> {
    const local = await this.repo.getLocalState();
    return local.diagnostics;
  }

  /**
   * Clear all diagnostic entries.
   */
  async clear(): Promise<void> {
    await this.repo.clearDiagnostics();
  }

  /**
   * Export diagnostics as JSON (sanitized — safe to share).
   */
  async export(): Promise<string> {
    const entries = await this.getEntries();
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      browserType: this.adapter.getBrowserType(),
      entryCount: entries.length,
      entries,
    }, null, 2);
  }

  /**
   * Validate that a diagnostic entry does NOT contain sensitive data.
   * Used for testing/assertion.
   */
  static isSanitized(entry: DiagnosticEntry): boolean {
    const json = JSON.stringify(entry);
    // Must not contain http:// or https:// URLs
    if (json.includes('http://') || json.includes('https://')) return false;
    // Must not contain common title patterns
    if (json.includes('title')) return false;
    // Must not contain rule text patterns
    if (json.includes('regex') || json.includes('pattern')) return false;
    return true;
  }
}

// ─── Notification Service ────────────────────────────────────────────────────

export interface NotificationOptions {
  type: NotificationType;
  slotId?: number;
  crossWindow?: boolean;
}

export class NotificationService {
  constructor(
    private adapter: BrowserAdapter,
  ) {}

  /**
   * Send a notification based on policy.
   * Policy:
   * - cross_window_switch: notify
   * - recovery_rebind: notify
   * - no_target: notify
   * - background_failure: notify
   * - same-window normal switch/cycle: DO NOT notify
   */
  async notify(options: NotificationOptions): Promise<void> {
    const { type, slotId, crossWindow } = options;

    // Same-window switches do NOT get notifications
    if (type === 'cross_window_switch' && !crossWindow) {
      return;
    }

    const messages: Record<NotificationType, { title: string; message: string }> = {
      cross_window_switch: {
        title: 'Tab Switched',
        message: `Switched to slot ${slotId ?? '?'} in another window`,
      },
      recovery_rebind: {
        title: 'Tab Recovered',
        message: `Slot ${slotId ?? '?'} rebound to a matching tab`,
      },
      no_target: {
        title: 'No Matching Tab',
        message: `No matching tab found for slot ${slotId ?? '?'}`,
      },
      background_failure: {
        title: 'Background Error',
        message: 'A background operation failed. Check diagnostics for details.',
      },
    };

    const content = messages[type];
    const notificationId = `tbs-${type}-${Date.now()}`;

    try {
      await this.adapter.notifications.create(notificationId, {
        type: 'basic',
        title: content.title,
        message: content.message,
      });
    } catch {
      // Notification failure is non-critical
    }
  }

  /**
   * Determine if a switch event should trigger a notification.
   */
  shouldNotify(crossWindow: boolean, isRecovery: boolean): boolean {
    // Same-window normal switch: no notification
    if (!crossWindow && !isRecovery) return false;
    return true;
  }
}

// ─── Incognito Service ───────────────────────────────────────────────────────

export class IncognitoService {
  constructor(private adapter: BrowserAdapter) {}

  /**
   * Check if incognito access is authorized.
   */
  async isAuthorized(): Promise<boolean> {
    return this.adapter.incognito.isAllowed();
  }

  /**
   * Filter tabs to exclude incognito when not authorized.
   */
  async filterTabs<T extends { incognito: boolean }>(tabs: T[]): Promise<T[]> {
    const authorized = await this.isAuthorized();
    if (authorized) return tabs;
    return tabs.filter((t) => !t.incognito);
  }

  /**
   * Check if a specific tab is accessible (not blocked by incognito policy).
   */
  async isTabAccessible(tab: { incognito: boolean }): Promise<boolean> {
    if (!tab.incognito) return true;
    return this.isAuthorized();
  }
}
