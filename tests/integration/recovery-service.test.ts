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
      windowId: -1,
      candidateCursor: null,
      ...overrides,
    };
  }

  describe('Happy path — recovery with real-time results', () => {
    it('should rebind on next-match with live tabs and NOT consume the session (DT1/DT5)', async () => {
      const session = createSession();
      await repo.addRecoverySession(session);

      // Set up tabs that match AFTER recovery was created (real-time)
      adapter.setTabs([
        { id: 50, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Live Match', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      const result = await service.nextMatch('rec-test-1', false);
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.tabId).toBe(50);
      }

      // Browsing must NOT close the window / consume the session (DT1).
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(1);
      expect(local.recoverySessions[0].candidateCursor).toBe(50);
    });

    it('should open URL in new tab and rebind', async () => {
      const session = createSession();
      await repo.addRecoverySession(session);

      const result = await service.openUrl('rec-test-1', false);
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.tabId).toBeGreaterThan(0);
      }

      // Open URL is a terminal action → session consumed, window closed (DT3).
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);
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

      const result = await service.nextMatch('rec-expired', false);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RECOVERY_EXPIRED');
      }

      // Session should be cleaned up
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);
    });

    it('should return RECOVERY_EXPIRED for non-existent session', async () => {
      const result = await service.openUrl('rec-nonexistent', false);
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

      const result = await service.nextMatch('rec-test-1', false);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('NO_MATCH');
      }

      // Session remains until dismissed/expired (button stays enabled).
    });

    it('should not modify slot URL/regex definition on recovery', async () => {
      // Set up a slot with regex
      await repo.addRule({
        id: 'rule-1',
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
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

      await service.nextMatch('rec-test-1', false);

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

  // ─── T6: Prev/Next browsing never closes the window (DT1/DT2/DT5) ──────────
  describe('T6: Prev/Next cursor browsing', () => {
    const threeCandidates = () => [
      { id: 50, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: false, incognito: false, status: 'complete' as const },
      { id: 51, windowId: 1, index: 1, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' as const },
      { id: 52, windowId: 1, index: 2, url: 'https://example.com/page', title: 'C', favIconUrl: '', active: false, incognito: false, status: 'complete' as const },
    ];

    it('T6 RED: repeated next/prev advances the cursor and keeps the session', async () => {
      await repo.addRecoverySession(createSession());
      adapter.setTabs(threeCandidates());

      const first = await service.nextMatch('rec-test-1', false);
      expect(first.success).toBe(true);

      const afterFirst = await repo.getLocalState();
      expect(afterFirst.recoverySessions).toHaveLength(1);
      const cursor1 = afterFirst.recoverySessions[0].candidateCursor;
      expect(cursor1).not.toBeNull();

      // Second click must advance again (not re-resolve to the same tab).
      const second = await service.nextMatch('rec-test-1', false);
      expect(second.success).toBe(true);
      const afterSecond = await repo.getLocalState();
      expect(afterSecond.recoverySessions).toHaveLength(1);
      const cursor2 = afterSecond.recoverySessions[0].candidateCursor;
      expect(cursor2).not.toBe(cursor1);

      // Prev returns toward the previous candidate.
      const back = await service.prevMatch('rec-test-1', false);
      expect(back.success).toBe(true);
      const afterBack = await repo.getLocalState();
      expect(afterBack.recoverySessions).toHaveLength(1);
      expect(afterBack.recoverySessions[0].candidateCursor).toBe(cursor1);
    });

    it('T6: browsing does NOT update the slot binding (A4b, autoBind=false)', async () => {
      await repo.addRecoverySession(createSession());
      adapter.setTabs(threeCandidates());

      await service.nextMatch('rec-test-1', false);

      const local = await repo.getLocalState();
      expect(local.bindings).toHaveLength(0);
    });

    it('T6: browsing WITH autoBind=true writes the slot binding', async () => {
      await repo.addRecoverySession(createSession());
      adapter.setTabs(threeCandidates());

      await service.nextMatch('rec-test-1', true);

      const local = await repo.getLocalState();
      expect(local.bindings).toHaveLength(1);
    });

    it('T6 RED: no candidates → displayable NO_MATCH without closing the session', async () => {
      await repo.addRecoverySession(createSession());
      adapter.setTabs([]);

      const result = await service.nextMatch('rec-test-1', false);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('NO_MATCH');
        expect(result.message).toContain('No matching tabs found at this time');
      }
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(1);
    });
  });

  // ─── T6: Open URL intercepts privileged pages (BLK-B / B2) ────────────────
  describe('T6: Open URL protected-page interception', () => {
    it('T6 RED: file:// target is intercepted with the existing PROTECTED_PAGE domain error', async () => {
      await repo.addRecoverySession(createSession({
        urlMatch: { type: 'exact', value: 'file:///etc/passwd' },
      }));
      adapter.setTabs([]);

      const result = await service.openUrl('rec-test-1', false);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('PROTECTED_PAGE');
        expect(result.message).toBe('This URL cannot be opened');
      }

      // The tab must NOT have been created.
      const createCalls = adapter.calls.filter((c) => c.method === 'tabs.create');
      expect(createCalls).toHaveLength(0);
    });

    it('T6: chrome:// target is intercepted too', async () => {
      await repo.addRecoverySession(createSession({
        urlMatch: { type: 'exact', value: 'chrome://settings' },
      }));

      const result = await service.openUrl('rec-test-1', false);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('PROTECTED_PAGE');
      }
    });

    it('T6: an ordinary https target still opens and consumes the session', async () => {
      await repo.addRecoverySession(createSession());
      adapter.setTabs([]);

      const result = await service.openUrl('rec-test-1', false);
      expect(result.success).toBe(true);

      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);
    });

    it('ACC#3 RED: Open URL succeeds for a normal target even when incognito is NOT authorized', async () => {
      // C3 original intent: authorization is only required to ACTIVATE/FOCUS an
      // incognito tab or to CREATE a tab in an incognito context — NOT for every
      // ordinary `tabs.create`. Gating `openUrl` on `incognito.isAllowed()` was
      // an over-implementation: under the shipped `incognito: not_allowed`
      // manifest it is ALWAYS false, so "Open URL" failed unconditionally
      // (users saw "Failed to open URL").
      adapter.state.incognitoAllowed = false;
      await repo.addRecoverySession(createSession());
      adapter.setTabs([]);
      adapter.calls.length = 0;

      const result = await service.openUrl('rec-test-1', false);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.outcome.type).toBe('switched');
      }
      // The ordinary (non-incognito) tab IS created.
      const createCalls = adapter.calls.filter((c) => c.method === 'tabs.create');
      expect(createCalls).toHaveLength(1);
      // Terminal action → session consumed.
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(0);
    });
  });

  // ─── ACC#1a: browsing from the focused recovery popup ────────────────────
  describe('ACC#1a: Prev/Next from the focused recovery popup', () => {
    const popupWindow: NormalizedWindow = { id: 3, focused: true, incognito: false, type: 'popup' };

    const candidatesInUserWindow = () => [
      { id: 50, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' as const },
      { id: 51, windowId: 1, index: 1, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' as const },
    ];

    it('ACC#1a RED: same-window browse does NOT move window focus (popup stays focused/usable)', async () => {
      // The user clicks Prev/Next INSIDE the recovery popup, so the focused
      // window is the popup. Candidates live in the user's normal window (1).
      adapter.setWindows([{ ...currentWindow, focused: false }, otherWindow, popupWindow]);
      adapter.setTabs(candidatesInUserWindow());
      await repo.addRecoverySession(createSession());
      adapter.calls.length = 0;

      const result = await service.nextMatch('rec-test-1', false);

      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        // First browse anchors on the active tab (50) and steps to its
        // neighbour (51) — design §3.5.
        expect(result.outcome.tabId).toBe(51);
        // NOT a cross-window jump: the "current window" is the user's window,
        // not the focused popup.
        expect(result.outcome.crossWindow).toBe(false);
      }
      // The popup keeps focus — no `windows.update(..., { focused: true })`.
      const focusCalls = adapter.calls.filter((c) => c.method === 'windows.update');
      expect(focusCalls).toHaveLength(0);
      // Browsing keeps the session (window stays open, clickable again).
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(1);
    });

    it('ACC#1a RED: Prev/Next are repeatable from the focused popup', async () => {
      adapter.setWindows([{ ...currentWindow, focused: false }, otherWindow, popupWindow]);
      adapter.setTabs(candidatesInUserWindow());
      await repo.addRecoverySession(createSession());

      const first = await service.nextMatch('rec-test-1', false);
      expect(first.success).toBe(true);
      const second = await service.nextMatch('rec-test-1', false);
      expect(second.success).toBe(true);
      const back = await service.prevMatch('rec-test-1', false);
      expect(back.success).toBe(true);

      // Session survives every browse and nothing was removed/closed.
      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(1);
      expect(adapter.calls.filter((c) => c.method === 'windows.update')).toHaveLength(0);
    });
  });
});
