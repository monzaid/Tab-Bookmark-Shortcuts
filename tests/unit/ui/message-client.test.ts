import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageClient, getErrorMessage } from '@ui/shared/message-client';
import type { DomainErrorCode } from '@shared/types';

// Mock chrome APIs
const mockSendMessage = vi.fn();
const mockStorageListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
  },
  storage: {
    onChanged: {
      addListener: vi.fn((listener: typeof mockStorageListeners[number]) => {
        mockStorageListeners.push(listener);
      }),
    },
  },
});

describe('T22: UI message client, optimistic conflict, external change', () => {
  let client: MessageClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageListeners.length = 0;
    client = new MessageClient();
  });

  describe('Happy path — typed requests and version tracking', () => {
    it('should send GET_STATE and track configVersion', async () => {
      mockSendMessage.mockResolvedValue({
        result: {
          success: true,
          sync: { configVersion: 5, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
          local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
        },
      });

      const result = await client.getState();
      expect(result.success).toBe(true);
      expect(client.getConfigVersion()).toBe(5);
    });

    it('should include configVersion in write requests', async () => {
      mockSendMessage.mockResolvedValue({ success: true, configVersion: 2 });

      // First set version
      mockSendMessage.mockResolvedValueOnce({
        result: { success: true, sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] }, local: {} },
      });
      await client.getState();

      mockSendMessage.mockResolvedValueOnce({ success: true, configVersion: 2 });
      await client.setMatchSettings({ tabIdMode: 'no-exists', ruleCheckMode: 'match', priority: 'tabId' });

      expect(mockSendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: 'SET_GLOBAL_STRATEGY',
          configVersion: 1,
          payload: { matchSettings: { tabIdMode: 'no-exists', ruleCheckMode: 'match', priority: 'tabId' } },
        })
      );
    });

    it('should map domain errors to accessible messages', () => {
      expect(getErrorMessage('CONFIG_CONFLICT')).toContain('refresh');
      expect(getErrorMessage('RULE_PROTECTED_URL')).toContain('protected');
      expect(getErrorMessage('ICON_TOO_LARGE')).toContain('2MB');
      expect(getErrorMessage('INCOGNITO_NOT_AUTHORIZED')).toContain('Incognito');
    });

    it('should return safe error message for unknown codes', () => {
      const msg = getErrorMessage('TOTALLY_UNKNOWN' as never);
      expect(msg).toContain('unexpected');
    });
  });

  describe('Error path — stale version and external change', () => {
    it('should return CONFIG_CONFLICT error with safe message', async () => {
      mockSendMessage.mockResolvedValue({
        success: false,
        errorCode: 'CONFIG_CONFLICT',
        message: 'Version conflict: expected 1, current is 5',
      });

      const result = await client.setMatchSettings({ tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'none' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('CONFIG_CONFLICT');
        // Should NOT expose raw internal message
        expect(result.message).toContain('refresh');
        expect(result.message).not.toContain('expected 1');
      }
    });

    it('should detect external change via storage.onChanged', () => {
      const listener = vi.fn();
      client.onExternalChange(listener);

      // Simulate external change
      mockStorageListeners.forEach((l) => l(
        { syncState: { newValue: { configVersion: 10 } } },
        'sync'
      ));

      expect(listener).toHaveBeenCalledWith(10);
      expect(client.getConfigVersion()).toBe(10);
    });

    it('should unsubscribe external change listener', () => {
      const listener = vi.fn();
      const unsub = client.onExternalChange(listener);
      unsub();

      mockStorageListeners.forEach((l) => l(
        { syncState: { newValue: { configVersion: 20 } } },
        'sync'
      ));

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle browser API failure gracefully', async () => {
      mockSendMessage.mockRejectedValue(new Error('Extension context invalidated'));

      const result = await client.getState();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('BROWSER_API_ERROR');
        expect(result.message).not.toContain('Extension context');
      }
    });

    it('T22: every DomainErrorCode has a non-empty English user-facing message', () => {
      // Exhaustive at runtime, not just by the Record<> type: catches a code
      // added to the union with an empty/placeholder string.
      const codes: DomainErrorCode[] = [
        'INVALID_REQUEST', 'UNKNOWN_ACTION',
        'CONFIG_CONFLICT', 'STALE_VERSION',
        'SLOT_NOT_FOUND', 'SLOT_EMPTY', 'SLOT_ALREADY_BOUND',
        'NO_MATCH', 'NO_CANDIDATES',
        'RECOVERY_EXPIRED', 'RECOVERY_NOT_FOUND',
        'RULE_CONFLICT_BLOCK', 'RULE_CONFLICT_WARN', 'DUPLICATE_RULE',
        'VERSION_CONFLICT', 'RULE_INVALID_REGEX', 'RULE_REGEX_TOO_LONG',
        'RULE_PROTECTED_URL', 'RULE_NOT_FOUND',
        'ICON_TOO_LARGE', 'ICON_INVALID_FORMAT', 'ICON_DOWNLOAD_FAILED',
        'IMPORT_INVALID', 'IMPORT_VERSION_MISMATCH', 'IMPORT_CANCELLED',
        'INCOGNITO_NOT_AUTHORIZED', 'PROTECTED_PAGE',
        'BROWSER_API_ERROR', 'TAB_NOT_FOUND', 'WINDOW_NOT_FOUND', 'COMMAND_NOT_FOUND',
        'INTERNAL_ERROR', 'TIMEOUT',
      ];

      for (const code of codes) {
        const message = getErrorMessage(code);
        expect(message, `missing message for ${code}`).toBeTruthy();
        expect(message.length, `too short for ${code}`).toBeGreaterThan(10);
        // T22: language policy is English (matches message-client's mapping).
        // A CJK character here means an un-translated string leaked in.
        expect(/[\u4e00-\u9fff]/.test(message), `non-English message for ${code}`).toBe(false);
      }
    });

    it('T22: has a safe fallback for an unknown code', () => {
      const message = getErrorMessage('NOT_A_REAL_CODE' as never);
      expect(message).toBeTruthy();
      expect(message).toContain('unexpected');
    });

    it('B11: sendRaw passes the action/payload through and tracks configVersion', async () => {
      mockSendMessage.mockResolvedValue({ result: { success: true }, configVersion: 7 });

      const response = await client.sendRaw('OPEN_PAGE', { url: 'chrome-extension://x/p.html' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OPEN_PAGE',
          payload: { url: 'chrome-extension://x/p.html' },
        })
      );
      // Response shape must be the RAW wire object (pages destructure `response.result ?? response`)
      expect(response).toEqual({ result: { success: true }, configVersion: 7 });
      expect(client.getConfigVersion()).toBe(7);
    });

    it('B11: sendRaw forwards configVersion only when provided', async () => {
      mockSendMessage.mockResolvedValue({ success: true });

      await client.sendRaw('SAVE_SLOT', { slotId: 1 });
      expect(mockSendMessage.mock.lastCall?.[0]).not.toHaveProperty('configVersion');

      await client.sendRaw('SET_GLOBAL_STRATEGY', { matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' } }, 3);
      expect(mockSendMessage.mock.lastCall?.[0]).toHaveProperty('configVersion', 3);
    });

    it('B11: constructing the client without chrome.storage does not throw', () => {
      const original = globalThis.chrome;
      try {
        // Simulate a context where only runtime is available
        (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage: vi.fn() } };
        expect(() => new MessageClient()).not.toThrow();
      } finally {
        (globalThis as unknown as { chrome: unknown }).chrome = original;
      }
    });

    it('should not silently overwrite on conflict', async () => {
      // Simulate: client thinks version is 1, but server is at 5
      mockSendMessage.mockResolvedValueOnce({
        result: { success: true, sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] }, local: {} },
      });
      await client.getState();

      // Write attempt returns conflict
      mockSendMessage.mockResolvedValueOnce({
        success: false,
        errorCode: 'CONFIG_CONFLICT',
        message: 'conflict',
      });

      const result = await client.saveSlot(1, { type: 'exact', value: 'https://x.com' }, 'X', '');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('CONFIG_CONFLICT');
      }
      // Client should NOT have updated its version (no silent overwrite)
      expect(client.getConfigVersion()).toBe(1);
    });
  });
});
