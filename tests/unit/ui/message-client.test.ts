import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageClient, getErrorMessage } from '@ui/shared/message-client';

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
          sync: { configVersion: 5, globalStrategy: 'B', slots: [], rules: [] },
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
        result: { success: true, sync: { configVersion: 1, globalStrategy: 'B', slots: [], rules: [] }, local: {} },
      });
      await client.getState();

      mockSendMessage.mockResolvedValueOnce({ success: true, configVersion: 2 });
      await client.setGlobalStrategy('C');

      expect(mockSendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: 'SET_GLOBAL_STRATEGY',
          configVersion: 1,
          payload: { strategy: 'C' },
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

      const result = await client.setGlobalStrategy('A');
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

    it('should not silently overwrite on conflict', async () => {
      // Simulate: client thinks version is 1, but server is at 5
      mockSendMessage.mockResolvedValueOnce({
        result: { success: true, sync: { configVersion: 1, globalStrategy: 'B', slots: [], rules: [] }, local: {} },
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
