/**
 * UI Message Client — typed client for all UI pages to communicate with Worker.
 *
 * - All UI pages use this client (never direct storage/browser API)
 * - configVersion write with optimistic conflict detection
 * - Conflict → refresh/retry banner
 * - storage.onChanged external change banner
 * - Sidebar draft isolation
 * - Domain error → accessible message mapping
 *
 * Does NOT: read/write storage directly in React, silently overwrite on conflict
 */

import type { DomainErrorCode, SyncState, LocalState, SwitchOutcome, DiagnosticEntry, ExportScope, ImportIntent, ImportInspection, ImportApplyResult, MatchRuleSettings, SwitchDirection } from '@shared/types';

// ─── Error Message Mapping ───────────────────────────────────────────────────

const ERROR_MESSAGES: Record<DomainErrorCode, string> = {
  INVALID_REQUEST: 'The request was invalid. Please try again.',
  UNKNOWN_ACTION: 'An unknown operation was attempted.',
  CONFIG_CONFLICT: 'Configuration was changed elsewhere. Please refresh and retry.',
  STALE_VERSION: 'Your changes are based on outdated data. Please refresh.',
  SLOT_NOT_FOUND: 'The specified slot does not exist.',
  SLOT_EMPTY: 'This slot has not been configured yet.',
  SLOT_ALREADY_BOUND: 'This slot is already bound to a tab.',
  NO_MATCH: 'No matching tabs were found.',
  NO_CANDIDATES: 'No candidate tabs available.',
  RECOVERY_EXPIRED: 'The recovery session has expired.',
  RECOVERY_NOT_FOUND: 'Recovery session not found.',
  RULE_CONFLICT_BLOCK: 'A conflicting rule already exists. Cannot save.',
  RULE_CONFLICT_WARN: 'These rules may overlap. Please confirm.',
  DUPLICATE_RULE: 'A rule with the same match pattern already exists.',
  VERSION_CONFLICT: 'This rule was modified elsewhere. Please refresh and retry.',
  RULE_INVALID_REGEX: 'The regex pattern is invalid.',
  RULE_REGEX_TOO_LONG: 'The regex pattern exceeds 500 characters.',
  RULE_PROTECTED_URL: 'Rules cannot be created for protected browser pages.',
  RULE_NOT_FOUND: 'The specified rule was not found.',
  ICON_TOO_LARGE: 'The icon file is too large (max 2MB, 512px).',
  ICON_INVALID_FORMAT: 'Invalid icon format. Use PNG, JPEG, or WebP.',
  ICON_DOWNLOAD_FAILED: 'Icon download failed. You can retry manually.',
  IMPORT_INVALID: 'The import file is invalid or corrupted.',
  IMPORT_VERSION_MISMATCH: 'The import file version is not supported.',
  IMPORT_CANCELLED: 'Import was cancelled.',
  INCOGNITO_NOT_AUTHORIZED: 'Incognito access is not enabled for this extension.',
  PROTECTED_PAGE: 'This operation cannot be performed on protected pages.',
  BROWSER_API_ERROR: 'A browser error occurred. Please try again.',
  TAB_NOT_FOUND: 'The specified tab was not found.',
  WINDOW_NOT_FOUND: 'The specified window was not found.',
  COMMAND_NOT_FOUND: 'The specified command was not found.',
  INTERNAL_ERROR: 'An internal error occurred. Please try again.',
  TIMEOUT: 'The operation timed out. Please try again.',
};

export function getErrorMessage(code: DomainErrorCode): string {
  return ERROR_MESSAGES[code] ?? 'An unexpected error occurred.';
}

// ─── Client Types ────────────────────────────────────────────────────────────

export interface ClientState {
  sync: SyncState;
  local: LocalState;
  configVersion: number;
  externalChangeDetected: boolean;
}

export type ClientResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; errorCode: DomainErrorCode; message: string };

// ─── Message Client ──────────────────────────────────────────────────────────

export class MessageClient {
  private configVersion = 0;
  private externalChangeListeners: Array<(newVersion: number) => void> = [];

  constructor() {
    // B11: guard the subscription. The client is now constructed by every page
    // entry point, some of which run in environments without chrome.storage
    // (tests, restricted contexts). Messaging still works without it — only the
    // external-change signal is unavailable.
    //
    // The view is re-typed as optional so this check stays meaningful rather
    // than being reported as an always-truthy comparison on a non-optional global.
    const storageApi = (
      globalThis as {
        chrome?: { storage?: { onChanged?: typeof chrome.storage.onChanged } };
      }
    ).chrome?.storage?.onChanged;
    if (!storageApi) return;

    // Listen for external storage changes
    storageApi.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes['syncState']) {
        const newValue = changes['syncState'].newValue as SyncState | undefined;
        if (newValue && newValue.configVersion !== this.configVersion) {
          this.configVersion = newValue.configVersion;
          this.externalChangeListeners.forEach((l) => { l(newValue.configVersion); });
        }
      }
    });
  }

  /**
   * Register a listener for external config changes.
   */
  onExternalChange(listener: (newVersion: number) => void): () => void {
    this.externalChangeListeners.push(listener);
    return () => {
      this.externalChangeListeners = this.externalChangeListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Get current config version for optimistic writes.
   */
  getConfigVersion(): number {
    return this.configVersion;
  }

  // ─── Core Send ─────────────────────────────────────────────────────────

  /**
   * B11: raw pass-through used by the page entry points.
   *
   * `send()` normalizes everything into a `ClientResult`, which would change
   * the response shape each page currently destructures (`response?.result ??
   * response`). This method keeps the wire semantics identical to a direct
   * `chrome.runtime.sendMessage` call while centralizing that API access here,
   * so page code no longer touches `chrome.*` for cross-context messaging.
   */
  async sendRaw(action: string, payload?: unknown, configVersion?: number): Promise<unknown> {
    const message: Record<string, unknown> = {
      requestId: `ui-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
      action,
    };
    if (payload !== undefined) message.payload = payload;
    if (configVersion !== undefined) message.configVersion = configVersion;

    const raw: unknown = await chrome.runtime.sendMessage(message);
    const response = raw as { configVersion?: unknown } | null;
    const version = response === null ? undefined : response.configVersion;
    if (typeof version === 'number') {
      this.configVersion = version;
    }
    return raw;
  }

  private async send<T>(
    action: string,
    payload?: unknown,
    includeVersion: boolean | number = false,
  ): Promise<ClientResult<T>> {
    try {
      const message: Record<string, unknown> = {
        requestId: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action,
      };
      if (payload !== undefined) message.payload = payload;
      // `false` = none, `true` = the client's tracked version, a number = that
      // exact version (T18: APPLY must carry the INSPECT-read version, which is
      // not necessarily the latest the client has seen — F4/C3).
      if (includeVersion !== false) {
        message.configVersion = includeVersion === true ? this.configVersion : includeVersion;
      }

      const response = await chrome.runtime.sendMessage(message);

      if (!response) {
        return { success: false, errorCode: 'INTERNAL_ERROR', message: getErrorMessage('INTERNAL_ERROR') };
      }

      // Update version if returned
      if (response.configVersion !== undefined) {
        this.configVersion = response.configVersion;
      }

      if (response.success === false) {
        const code = (response.errorCode ?? 'INTERNAL_ERROR');
        return { success: false, errorCode: code, message: getErrorMessage(code) };
      }

      return { success: true, data: response as unknown as T };
    } catch {
      return { success: false, errorCode: 'BROWSER_API_ERROR', message: getErrorMessage('BROWSER_API_ERROR') };
    }
  }

  // ─── State ─────────────────────────────────────────────────────────────

  async getState(): Promise<ClientResult<{ sync: SyncState; local: LocalState }>> {
    const result = await this.send<{ result: { success: boolean; sync: SyncState; local: LocalState } }>('GET_STATE');
    if (!result.success) return result;
    const data = result.data as unknown as { result: { sync: SyncState; local: LocalState } };
    if (data.result?.sync) {
      this.configVersion = data.result.sync.configVersion;
    }
    return { success: true, data: { sync: data.result.sync, local: data.result.local } };
  }

  async getCommands(): Promise<ClientResult<Array<{ name: string; shortcut: string | null; description: string }>>> {
    const result = await this.send<{ result: { success: boolean; commands: Array<{ name: string; shortcut: string | null; description: string }> } }>('GET_COMMANDS');
    if (!result.success) return result;
    return { success: true, data: (result.data as unknown as { result: { commands: Array<{ name: string; shortcut: string | null; description: string }> } }).result.commands };
  }

  // ─── Slot Operations ───────────────────────────────────────────────────

  async saveSlot(slotId: number, urlMatch: { type: string; value: string }, titleSnapshot: string, faviconSnapshot: string): Promise<ClientResult> {
    return this.send('SAVE_SLOT', { slotId, urlMatch, titleSnapshot, faviconSnapshot }, true);
  }

  async switchSlot(slotId: number): Promise<ClientResult<{ outcome: SwitchOutcome }>> {
    return this.send('SWITCH_SLOT', { slotId });
  }

  async nextMatch(): Promise<ClientResult<{ outcome: SwitchOutcome }>> {
    return this.send('NEXT_MATCH');
  }

  async unbindSlot(slotId: number): Promise<ClientResult> {
    return this.send('UNBIND_SLOT', { slotId });
  }

  async undoSave(slotId: number): Promise<ClientResult> {
    return this.send('UNDO_SAVE', { slotId });
  }

  // ─── Rule Operations ───────────────────────────────────────────────────

  async createRule(payload: { urlMatch: { type: string; value: string }; priority: number; title?: string }): Promise<ClientResult> {
    return this.send('CREATE_RULE', payload);
  }

  async updateRule(ruleId: string, updates: Record<string, unknown>): Promise<ClientResult> {
    return this.send('UPDATE_RULE', { ruleId, ...updates });
  }

  async deleteRule(ruleId: string): Promise<ClientResult> {
    return this.send('DELETE_RULE', { ruleId });
  }

  // ─── Settings ──────────────────────────────────────────────────────────

  async setMatchSettings(matchSettings: MatchRuleSettings): Promise<ClientResult> {
    return this.send('SET_GLOBAL_STRATEGY', { matchSettings }, true);
  }

  async setSlotStrategy(slotId: number, strategy: 'inherit' | MatchRuleSettings): Promise<ClientResult> {
    return this.send('SET_SLOT_STRATEGY', { slotId, strategy }, true);
  }

  async setSwitchDirection(direction: SwitchDirection): Promise<ClientResult> {
    return this.send('SET_SWITCH_DIRECTION', { direction }, true);
  }

  async setAutoBindGlobal(enabled: boolean): Promise<ClientResult> {
    return this.send('SET_AUTO_BIND_GLOBAL', { enabled }, true);
  }

  async setSlotAutoBind(slotId: number, override: boolean | null): Promise<ClientResult> {
    return this.send('SET_SLOT_AUTO_BIND', { slotId, override }, true);
  }

  async positionCurrentPrev(anchorTabId?: number): Promise<ClientResult> {
    return this.send('POSITION_CURRENT_PREV', anchorTabId === undefined ? {} : { anchorTabId });
  }

  async positionCurrentNext(anchorTabId?: number): Promise<ClientResult> {
    return this.send('POSITION_CURRENT_NEXT', anchorTabId === undefined ? {} : { anchorTabId });
  }

  // ─── Recovery ──────────────────────────────────────────────────────────

  async recoveryOpenUrl(recoveryId: string, autoBind: boolean): Promise<ClientResult> {
    return this.send('RECOVERY_OPEN_URL', { recoveryId, autoBind });
  }

  async recoveryNextMatch(recoveryId: string, autoBind: boolean): Promise<ClientResult> {
    return this.send('RECOVERY_NEXT_MATCH', { recoveryId, autoBind });
  }

  async recoveryPrevMatch(recoveryId: string, autoBind: boolean): Promise<ClientResult> {
    return this.send('RECOVERY_PREV_MATCH', { recoveryId, autoBind });
  }

  async recoveryDismiss(recoveryId: string): Promise<ClientResult> {
    return this.send('RECOVERY_DISMISS', { recoveryId });
  }

  // ─── Import/Export (A10/A11) ───────────────────────────────────────────

  async exportPackage(scope: ExportScope): Promise<ClientResult<{ package: string }>> {
    return this.send('EXPORT_PACKAGE', { scope });
  }

  async importInspect(file: string): Promise<ClientResult<{ inspection: ImportInspection }>> {
    return this.send('IMPORT_INSPECT', { file });
  }

  /**
   * A11/C3: `expectedVersion` is the `configVersion` read at INSPECT time — the
   * optimistic lock APPLY binds to. Passing it explicitly (rather than letting
   * the client default to its own tracked version) is the F4 fix: the lock must
   * catch a write that happened between INSPECT and APPLY.
   */
  async importApply(
    file: string,
    intent: ImportIntent,
    expectedVersion: number,
  ): Promise<ClientResult<{ applied: ImportApplyResult }>> {
    return this.send('IMPORT_APPLY', { file, intent }, expectedVersion);
  }

  // ─── Diagnostics ───────────────────────────────────────────────────────

  async getDiagnostics(): Promise<ClientResult<{ entries: DiagnosticEntry[] }>> {
    return this.send('GET_DIAGNOSTICS');
  }

  async clearDiagnostics(): Promise<ClientResult> {
    return this.send('CLEAR_DIAGNOSTICS');
  }

  async exportDiagnostics(): Promise<ClientResult<{ json: string }>> {
    return this.send('EXPORT_DIAGNOSTICS');
  }

  // ─── Tab Override ──────────────────────────────────────────────────────

  async setTabOverride(tabId: number, title?: string): Promise<ClientResult> {
    return this.send('SET_TAB_OVERRIDE', { tabId, title });
  }

  async removeTabOverride(tabId: number): Promise<ClientResult> {
    return this.send('REMOVE_TAB_OVERRIDE', { tabId });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let clientInstance: MessageClient | null = null;

export function getMessageClient(): MessageClient {
  if (!clientInstance) {
    clientInstance = new MessageClient();
  }
  return clientInstance;
}
