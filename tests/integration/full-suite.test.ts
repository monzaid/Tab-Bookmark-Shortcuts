import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * T24: Full integration suite — cross-module compatibility regression.
 *
 * Combines adapter, store, Worker, content, UI client mock browser harness.
 * Covers: command→match/recovery, rule→navigation rewrite, import→version,
 * tab removed→cleanup, incognito/protected/notification boundaries.
 */
describe('T24: Integration suite — cross-module compatibility', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win1: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const win2: NormalizedWindow = { id: 2, focused: false, incognito: false, type: 'normal' };

  const tabA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://github.com/user/repo', title: 'GitHub Repo', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabB: NormalizedTab = { id: 11, windowId: 1, index: 1, url: 'https://github.com/user/other', title: 'GitHub Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabC: NormalizedTab = { id: 20, windowId: 2, index: 0, url: 'https://github.com/org/project', title: 'GitHub Org', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabIncognito: NormalizedTab = { id: 40, windowId: 3, index: 0, url: 'https://github.com/private', title: 'Private', favIconUrl: '', active: false, incognito: true, status: 'complete' };

  async function route(action: string, payload?: unknown, configVersion?: number) {
    const msg: Record<string, unknown> = { requestId: `int-${Date.now()}`, action };
    if (payload) msg.payload = payload;
    if (configVersion !== undefined) msg.configVersion = configVersion;
    return (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {}) as Promise<Record<string, unknown>>;
  }

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win1, win2]);
    adapter.setTabs([tabA, tabB, tabC]);
    adapter.setCommands(Array.from({ length: 21 }, (_, i) => ({
      name: i < 20 ? `${i % 2 === 0 ? 'save' : 'switch'}-slot-${Math.floor(i / 2) + 1}` : 'next-match',
      description: `Command ${i + 1}`,
      shortcut: null,
    })));
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  describe('Full chain: command → match → switch → cycle', () => {
    it('should save, switch, and cycle through candidates end-to-end', async () => {
      // Save slot 1
      const saveResult = await route('SAVE_SLOT', { slotId: 1, urlMatch: { type: 'exact', value: 'https://github.com/user/repo' }, titleSnapshot: 'GitHub Repo', faviconSnapshot: '' }, 0);
      expect(saveResult.success).toBe(true);

      // Switch slot 1 — should find current window tab first
      const switchResult = await route('SWITCH_SLOT', { slotId: 1 }) as Record<string, unknown>;
      expect(switchResult.success).toBe(true);

      // Next match — should cycle
      const nextResult = await route('NEXT_MATCH') as Record<string, unknown>;
      expect(nextResult.success).toBe(true);
    });

    it('should trigger recovery when no candidates exist', async () => {
      // Save slot (binds to active tabA with url github.com/user/repo)
      await route('SAVE_SLOT', { slotId: 2, urlMatch: { type: 'exact', value: 'https://github.com/user/repo' }, titleSnapshot: 'Repo', faviconSnapshot: '' }, 0);

      // Remove all matching tabs
      adapter.setTabs([]);

      // Switch — no matching tabs exist anymore
      const result = await route('SWITCH_SLOT', { slotId: 2 }) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const outcome = result.outcome as { type: string; recoveryId?: string };
      expect(outcome.type).toBe('needs_recovery');
      expect(outcome.recoveryId).toContain('rec-');
    });
  });

  describe('Full chain: rule → navigation → rewrite', () => {
    it('should create rule and apply on content navigation', async () => {
      // Create auto rule
      const createResult = await route('CREATE_RULE', {
        urlMatch: { type: 'regex', value: 'https://github\\.com/.*' },
        mode: 'auto',
        priority: 10,
        title: 'Custom GitHub',
      }, 0) as Record<string, unknown>;
      expect(createResult.success).toBe(true);

      // Simulate content navigation
      const navResult = await (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'nav-1', action: 'CONTENT_NAVIGATION', payload: { tabId: 10, url: 'https://github.com/user/repo', navigationType: 'initial' } },
        { tab: { id: 10 } }
      ) as Record<string, unknown>;
      expect(navResult.success).toBe(true);

      // Verify rewrite was delivered via scripting.executeScript
      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      expect(execCalls.length).toBeGreaterThan(0);
    });

    it('should reject rule for protected URL', async () => {
      const result = await route('CREATE_RULE', {
        urlMatch: { type: 'exact', value: 'chrome://settings' },
        mode: 'auto',
        priority: 0,
      }, 0) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('RULE_PROTECTED_URL');
    });
  });

  describe('Full chain: import → version → single commit', () => {
    it('should import config with single version increment', async () => {
      // Save a slot first (version → 1)
      await route('SAVE_SLOT', { slotId: 1, urlMatch: { type: 'exact', value: 'https://existing.com' }, titleSnapshot: 'Existing', faviconSnapshot: '' }, 0);

      // Generate import preview
      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [
          { id: 1, urlMatch: { type: 'exact', value: 'https://imported.com' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: 'Imported', faviconSnapshot: '', createdAt: '', updatedAt: '' },
          { id: 5, urlMatch: { type: 'exact', value: 'https://new.com' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: 'New', faviconSnapshot: '', createdAt: '', updatedAt: '' },
        ],
        rules: [],
        matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'no-match', priority: 'tabId' },
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 99,
      });

      const previewResult = await route('IMPORT_PREVIEW', { json: importJson }) as Record<string, unknown>;
      expect(previewResult.success).toBe(true);

      // Commit with decisions
      const preview = previewResult.preview as { slotConflicts: Array<{ slotId: number; decision: string }> };
      const decisions = preview.slotConflicts.map((c) => ({ ...c, decision: 'import' }));

      const commitResult = await route('IMPORT_COMMIT', { preview: previewResult.preview, slotDecisions: decisions }, 1) as Record<string, unknown>;
      expect(commitResult.success).toBe(true);
      expect(commitResult.configVersion).toBe(2); // Single increment from 1→2
    });
  });

  describe('Full chain: tab removed → cleanup', () => {
    it('should clean bindings and overrides on tab removed', async () => {
      // Save slot (creates binding to tab 10)
      await route('SAVE_SLOT', { slotId: 1, urlMatch: { type: 'exact', value: 'https://github.com/user/repo' }, titleSnapshot: 'Repo', faviconSnapshot: '' }, 0);

      // Set tab override
      await route('SET_TAB_OVERRIDE', { tabId: 10, title: 'Custom' });

      // Verify binding exists
      let state = await route('GET_STATE') as Record<string, unknown>;
      let local = state.local as { bindings: unknown[]; tabOverrides: unknown[] };
      expect(local.bindings.length).toBeGreaterThan(0);

      // Simulate tab removed
      adapter.emitTabRemoved(10, 1);
      await new Promise((r) => setTimeout(r, 50));

      // Verify cleanup
      state = await route('GET_STATE') as Record<string, unknown>;
      const localAfter = state.local as { bindings: Array<{ tabId: number }>; tabOverrides: Array<{ tabId: number }> };
      expect(localAfter.bindings.filter((b) => b.tabId === 10)).toHaveLength(0);
      expect(localAfter.tabOverrides.filter((o) => o.tabId === 10)).toHaveLength(0);
    });
  });

  describe('Boundary: incognito, protected pages, notifications', () => {
    it('should exclude incognito tabs when not authorized', async () => {
      adapter.state.incognitoAllowed = false;
      // Save slot while normal tab is active
      await route('SAVE_SLOT', { slotId: 1, urlMatch: { type: 'exact', value: 'https://github.com/private' }, titleSnapshot: 'Private', faviconSnapshot: '' }, 0);

      // Now only incognito tab matches
      adapter.setTabs([tabIncognito]);

      // Switch should trigger recovery (no accessible candidates)
      const result = await route('SWITCH_SLOT', { slotId: 1 }) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const outcome = result.outcome as { type: string };
      expect(outcome.type).toBe('needs_recovery');
    });

    it('should not send notification for same-window switch', async () => {
      adapter.setTabs([tabA, tabB]); // Both in current window

      await route('SAVE_SLOT', { slotId: 1, urlMatch: { type: 'exact', value: 'https://github.com/user/repo' }, titleSnapshot: 'Repo', faviconSnapshot: '' }, 0);
      await route('SWITCH_SLOT', { slotId: 1 });

      // No notification for same-window
      const notifCalls = adapter.calls.filter((c) => c.method === 'notifications.create');
      expect(notifCalls).toHaveLength(0);
    });

    it('should handle unknown action without crash', async () => {
      const result = await route('COMPLETELY_UNKNOWN_ACTION') as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN_ACTION');
    });

    it('should handle stale cache with reload', async () => {
      // Simulate external version bump
      adapter.state.syncStorage['syncState'] = {
        configVersion: 99,
        matchSettings: { tabIdMode: 'no-exists', ruleCheckMode: 'match', priority: 'tabId' },
        switchDirection: 'next',
        autoBindGlobal: true,
        slots: [],
        rules: [],
      };

      // Worker should detect and handle
      const checkResult = await worker.repo.checkExternalChange();
      expect(checkResult.changed).toBe(true);
      expect(checkResult.newVersion).toBe(99);
    });
  });
});
