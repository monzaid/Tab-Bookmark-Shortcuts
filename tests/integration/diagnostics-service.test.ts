import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { DiagnosticsService, NotificationService, IncognitoService } from '@background/diagnostics-service';

describe('T14: Sanitized diagnostics, notification policy, incognito authorization', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let diagnostics: DiagnosticsService;
  let notifications: NotificationService;
  let incognito: IncognitoService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    diagnostics = new DiagnosticsService(adapter, repo);
    notifications = new NotificationService(adapter);
    incognito = new IncognitoService(adapter);
  });

  describe('Happy path — diagnostics and notifications', () => {
    it('should record sanitized diagnostic entries', async () => {
      await diagnostics.record('SUCCESS', 'switch_slot');
      await diagnostics.record('NO_MATCH', 'next_match');

      const entries = await diagnostics.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].errorCode).toBe('SUCCESS');
      expect(entries[0].operationType).toBe('switch_slot');
      expect(entries[0].browserType).toBe('chrome');
      expect(entries[1].errorCode).toBe('NO_MATCH');
    });

    it('should export diagnostics without URL/title', async () => {
      await diagnostics.record('SUCCESS', 'save_slot');
      await diagnostics.record('CONFIG_CONFLICT', 'write_sync');

      const exported = await diagnostics.export();
      const parsed = JSON.parse(exported);
      expect(parsed.entryCount).toBe(2);
      expect(parsed.browserType).toBe('chrome');
      // Must NOT contain sensitive data
      expect(exported).not.toContain('http://');
      expect(exported).not.toContain('https://');
      expect(exported).not.toContain('title');
    });

    it('should clear diagnostics', async () => {
      await diagnostics.record('SUCCESS', 'test');
      await diagnostics.clear();

      const entries = await diagnostics.getEntries();
      expect(entries).toHaveLength(0);
    });

    it('should send notification for cross-window switch', async () => {
      await notifications.notify({ type: 'cross_window_switch', slotId: 3, crossWindow: true });

      const notifCalls = adapter.calls.filter((c) => c.method === 'notifications.create');
      expect(notifCalls).toHaveLength(1);
      expect(notifCalls[0].args[1]).toEqual(
        expect.objectContaining({
          title: 'Tab Switched',
          message: expect.stringContaining('slot 3'),
        })
      );
    });

    it('should send notification for recovery rebind', async () => {
      await notifications.notify({ type: 'recovery_rebind', slotId: 5 });

      const notifCalls = adapter.calls.filter((c) => c.method === 'notifications.create');
      expect(notifCalls).toHaveLength(1);
    });

    it('should validate diagnostic entries are sanitized', () => {
      const entry = {
        timestamp: '2026-01-01T00:00:00Z',
        errorCode: 'SUCCESS' as const,
        browserType: 'chrome' as const,
        operationType: 'switch_slot',
      };
      expect(DiagnosticsService.isSanitized(entry)).toBe(true);

      const badEntry = {
        timestamp: '2026-01-01T00:00:00Z',
        errorCode: 'SUCCESS' as const,
        browserType: 'chrome' as const,
        operationType: 'https://example.com/page',
      };
      expect(DiagnosticsService.isSanitized(badEntry)).toBe(false);
    });
  });

  describe('Error path — same-window no notification, incognito exclusion', () => {
    it('should NOT notify for same-window normal switch', async () => {
      await notifications.notify({ type: 'cross_window_switch', slotId: 1, crossWindow: false });

      const notifCalls = adapter.calls.filter((c) => c.method === 'notifications.create');
      expect(notifCalls).toHaveLength(0);
    });

    it('should NOT notify for same-window cycle', async () => {
      expect(notifications.shouldNotify(false, false)).toBe(false);
    });

    it('should notify for cross-window switch', () => {
      expect(notifications.shouldNotify(true, false)).toBe(true);
    });

    it('should notify for recovery rebind', () => {
      expect(notifications.shouldNotify(false, true)).toBe(true);
    });

    it('should exclude incognito tabs when not authorized', async () => {
      adapter.state.incognitoAllowed = false;

      const tabs = [
        { id: 1, incognito: false },
        { id: 2, incognito: true },
        { id: 3, incognito: false },
      ];

      const filtered = await incognito.filterTabs(tabs);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((t) => !t.incognito)).toBe(true);
    });

    it('should include incognito tabs when authorized', async () => {
      adapter.state.incognitoAllowed = true;

      const tabs = [
        { id: 1, incognito: false },
        { id: 2, incognito: true },
      ];

      const filtered = await incognito.filterTabs(tabs);
      expect(filtered).toHaveLength(2);
    });

    it('should report incognito tab as not accessible when unauthorized', async () => {
      adapter.state.incognitoAllowed = false;

      expect(await incognito.isTabAccessible({ incognito: true })).toBe(false);
      expect(await incognito.isTabAccessible({ incognito: false })).toBe(true);
    });

    it('should record error code only in diagnostics (no URL leak)', async () => {
      await diagnostics.record('INCOGNITO_NOT_AUTHORIZED', 'switch_slot');

      const entries = await diagnostics.getEntries();
      expect(entries[0].errorCode).toBe('INCOGNITO_NOT_AUTHORIZED');
      expect(entries[0].operationType).toBe('switch_slot');
      // No URL or tab info leaked
      const json = JSON.stringify(entries[0]);
      expect(json).not.toContain('http');
      expect(json).not.toContain('tabId');
    });
  });
});
