import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RecoveryService } from '@background/recovery-service';
import type { NormalizedWindow } from '@adapters/contract';
import type { RecoverySession } from '@shared/types';

describe('T9: Recovery sessions with real-time re-query', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RecoveryService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const otherWindow: NormalizedWindow = { id: 2, focused: false, incognito: false, type: 'normal' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow, otherWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RecoveryService(adapter, repo);
  });

  function createSession(overrides?: Partial<RecoverySession>): RecoverySession {
    const now = new Date();
    return {
      recoveryId: 'rec-test-1',
      slotId: 1,
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      titleSnapshot: 'Example',
      faviconSnapshot: '',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      ...overrides,
    };
  }

  describe('Happy path — recovery with real-time results', () => {
    it('should create recovery and rebind on next-match with live tabs', async () => {
      const session = createSession();
      await repo.addRecoverySession(session);

      // Set up tabs that match AFTER recovery was created (real-time)
      adapter.setTabs([
        { id: 50, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Live Match', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      const result = await service.nextMatch('rec-test-1');
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.tabId).toBe(50);
      }

      // Session should be cleaned up
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);

      // Binding should be updated
      expect(local.bindings).toHaveLength(1);
      expect(local.bindings[0].tabId).toBe(50);
    });

    it('should open URL in new tab and rebind', async () => {
      const session = createSession();
      await repo.addRecoverySession(session);

      const result = await service.openUrl('rec-test-1');
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.tabId).toBeGreaterThan(0);
      }

      // Session cleaned up
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);
      expect(local.bindings).toHaveLength(1);
    });

    it('should support multiple parallel recovery sessions', async () => {
      await repo.addRecoverySession(createSession({ recoveryId: 'rec-a', slotId: 1 }));
      await repo.addRecoverySession(createSession({ recoveryId: 'rec-b', slotId: 2 }));

      const sessionA = await service.getSession('rec-a');
      const sessionB = await service.getSession('rec-b');
      expect(sessionA).not.toBeNull();
      expect(sessionB).not.toBeNull();
      expect(sessionA!.slotId).toBe(1);
      expect(sessionB!.slotId).toBe(2);
    });

    it('should dismiss session without modifying config', async () => {
      const session = createSession();
      await repo.addRecoverySession(session);

      await service.dismiss('rec-test-1');

      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);
      // No binding changes
      expect(local.bindings).toHaveLength(0);
    });
  });

  describe('Error path — expired, no candidates, no config modification', () => {
    it('should return RECOVERY_EXPIRED for expired session', async () => {
      const expired = createSession({
        recoveryId: 'rec-expired',
        createdAt: '2020-01-01T00:00:00Z',
        expiresAt: '2020-01-01T00:05:00Z',
      });
      await repo.addRecoverySession(expired);

      const result = await service.nextMatch('rec-expired');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RECOVERY_EXPIRED');
      }

      // Session should be cleaned up
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);
    });

    it('should return RECOVERY_EXPIRED for non-existent session', async () => {
      const result = await service.openUrl('rec-nonexistent');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RECOVERY_EXPIRED');
      }
    });

    it('should return NO_MATCH when no candidates available', async () => {
      const session = createSession();
      await repo.addRecoverySession(session);

      // No matching tabs
      adapter.setTabs([]);

      const result = await service.nextMatch('rec-test-1');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('NO_MATCH');
      }

      // Session should NOT be removed on NO_MATCH (user can retry)
      // Actually per design: button stays enabled, returns displayable error
      // Session remains until dismissed/expired
    });

    it('should not modify slot URL/regex definition on recovery', async () => {
      // Set up a slot with regex
      await repo.addRule({
        id: 'rule-1',
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        mode: 'auto',
        priority: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const session = createSession({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
      });
      await repo.addRecoverySession(session);

      adapter.setTabs([
        { id: 60, windowId: 1, index: 0, url: 'https://example.com/new-page', title: 'New', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      await service.nextMatch('rec-test-1');

      // Verify rules unchanged
      const updatedSync = await repo.getSyncState();
      expect(updatedSync.rules).toHaveLength(1);
      expect(updatedSync.rules[0].urlMatch.value).toBe('https://example\\.com/.*');
    });

    it('should cleanup all expired sessions', async () => {
      await repo.addRecoverySession(createSession({
        recoveryId: 'rec-old-1',
        expiresAt: '2020-01-01T00:05:00Z',
      }));
      await repo.addRecoverySession(createSession({
        recoveryId: 'rec-old-2',
        expiresAt: '2020-01-01T00:05:00Z',
      }));
      await repo.addRecoverySession(createSession({
        recoveryId: 'rec-valid',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }));

      const cleaned = await service.cleanupExpired();
      expect(cleaned).toBe(2);

      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(1);
      expect(local.recoverySessions[0].recoveryId).toBe('rec-valid');
    });
  });
});
