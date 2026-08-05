import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedWindow, NormalizedTab } from '@adapters/contract';

/**
 * Module 1 — Rule save chain: validate → configVersion → conflict/duplicate → write → apply.
 * Module 3 — Rule application to matching tabs with computeFields + force.
 */
describe('Module 1+3: Rule save chain & application', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
  });

  // ─── Module 1: Duplicate detection ───────────────────────────────────────

  describe('Duplicate rule detection (DUPLICATE_RULE)', () => {
    it('should reject a duplicate exact URL rule with DUPLICATE_RULE', async () => {
      const first = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 0,
        title: 'First',
      });
      expect(first.success).toBe(true);

      const dup = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'manual',
        priority: 5,
        title: 'Second',
      });
      expect(dup.success).toBe(false);
      if (!dup.success) {
        expect(dup.errorCode).toBe('DUPLICATE_RULE');
      }

      // Only one rule persisted
      const sync = await repo.getSyncState();
      expect(sync.rules).toHaveLength(1);
    });

    it('should reject a duplicate regex rule with DUPLICATE_RULE', async () => {
      await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        mode: 'auto',
        priority: 0,
      });

      const dup = await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        mode: 'auto',
        priority: 10,
      });
      expect(dup.success).toBe(false);
      if (!dup.success) {
        expect(dup.errorCode).toBe('DUPLICATE_RULE');
      }
    });

    it('should detect duplicates via normalized exact URLs (hash/port ignored)', async () => {
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page#section' },
        mode: 'auto',
        priority: 0,
      });

      // Same URL without hash — should be considered duplicate after normalization
      const dup = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 0,
      });
      expect(dup.success).toBe(false);
      if (!dup.success) {
        expect(dup.errorCode).toBe('DUPLICATE_RULE');
      }
    });

    it('should allow different exact URLs', async () => {
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/a' },
        mode: 'auto',
        priority: 0,
      });
      const second = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/b' },
        mode: 'auto',
        priority: 0,
      });
      expect(second.success).toBe(true);
    });
  });

  describe('Update rule duplicate detection (exclude self)', () => {
    it('should reject updateRule that changes urlMatch to another rule\'s pattern with DUPLICATE_RULE', async () => {
      const r1 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/one' },
        mode: 'auto',
        priority: 0,
      });
      const r2 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/two' },
        mode: 'auto',
        priority: 0,
      });
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      if (!r1.success || !r2.success) return;

      // Try to move r2 onto r1's pattern → duplicate
      const upd = await service.updateRule(r2.rule.id, {
        urlMatch: { type: 'exact', value: 'https://example.com/one' },
      });
      expect(upd.success).toBe(false);
      if (!upd.success) {
        expect(upd.errorCode).toBe('DUPLICATE_RULE');
      }

      // Nothing changed in storage
      const sync = await repo.getSyncState();
      const still = sync.rules.find((r) => r.id === r2.rule.id);
      expect(still?.urlMatch.value).toBe('https://example.com/two');
    });

    it('should reject duplicate regex pattern on update (exclude self)', async () => {
      const r1 = await service.createRule({
        urlMatch: { type: 'regex', value: 'https://a\\.com/.*' },
        mode: 'auto',
        priority: 0,
      });
      const r2 = await service.createRule({
        urlMatch: { type: 'regex', value: 'https://b\\.com/.*' },
        mode: 'auto',
        priority: 0,
      });
      if (!r1.success || !r2.success) return;

      const upd = await service.updateRule(r2.rule.id, {
        urlMatch: { type: 'regex', value: 'https://a\\.com/.*' },
      });
      expect(upd.success).toBe(false);
      if (!upd.success) {
        expect(upd.errorCode).toBe('DUPLICATE_RULE');
      }
    });

    it('should allow updateRule that keeps its own urlMatch unchanged', async () => {
      const r1 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/keep' },
        mode: 'auto',
        priority: 0,
        title: 'Old',
      });
      if (!r1.success) return;

      // Update only title, passing the same urlMatch — must NOT be flagged as self-duplicate
      const upd = await service.updateRule(r1.rule.id, {
        urlMatch: { type: 'exact', value: 'https://example.com/keep' },
        title: 'New',
      });
      expect(upd.success).toBe(true);
      if (upd.success) {
        expect(upd.rule.title).toBe('New');
      }
    });

    it('should allow updateRule that moves to a fresh unique pattern', async () => {
      const r1 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/src' },
        mode: 'auto',
        priority: 0,
      });
      if (!r1.success) return;

      const upd = await service.updateRule(r1.rule.id, {
        urlMatch: { type: 'exact', value: 'https://example.com/dest' },
      });
      expect(upd.success).toBe(true);
    });
  });

  describe('Cross-channel duplicate blocking (settings + sidebar → same createRule)', () => {
    it('should block duplicate created through worker from a second channel', async () => {
      const orchestrator = new WorkerOrchestrator(adapter);
      await orchestrator.initialize();

      // Channel 1 (settings) creates a rule
      const res1 = await (orchestrator as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<{ success: boolean; errorCode?: string }> }).routeMessage({
        requestId: 'c1',
        action: 'CREATE_RULE',
        payload: {
          urlMatch: { type: 'exact', value: 'https://cross-channel.com/page' },
          mode: 'auto',
          priority: 0,
        },
      }, {});
      expect(res1.success).toBe(true);

      // Channel 2 (sidebar) tries the same pattern → must be blocked
      const res2 = await (orchestrator as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<{ success: boolean; errorCode?: string }> }).routeMessage({
        requestId: 'c2',
        action: 'CREATE_RULE',
        payload: {
          urlMatch: { type: 'exact', value: 'https://cross-channel.com/page' },
          mode: 'auto',
          priority: 0,
        },
      }, {});
      expect(res2.success).toBe(false);
      expect(res2.errorCode).toBe('DUPLICATE_RULE');
    });
  });

  // ─── Module 3: Rule application ──────────────────────────────────────────

  describe('Auto rule application to matching tabs', () => {
    const matchingTab: NormalizedTab = {
      id: 10, windowId: 1, index: 0, url: 'https://example.com/page',
      title: 'Original', favIconUrl: '', active: true, incognito: false, status: 'complete',
    };
    const otherTab: NormalizedTab = {
      id: 11, windowId: 1, index: 1, url: 'https://other.com/',
      title: 'Other', favIconUrl: '', active: false, incognito: false, status: 'complete',
    };
    const protectedTab: NormalizedTab = {
      id: 12, windowId: 1, index: 2, url: 'chrome://extensions',
      title: 'Ext', favIconUrl: '', active: false, incognito: false, status: 'complete',
    };

    it('should send APPLY_REWRITE with force:true to matching tabs on auto rule create', async () => {
      adapter.setTabs([matchingTab, otherTab, protectedTab]);

      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 0,
        title: 'Rewritten Title',
        favicon: { type: 'url', value: 'https://example.com/icon.png' },
      });

      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      // Only the matching tab (not other, not protected)
      const matchingExecs = execCalls.filter((c) => (c.args[0] as { target: { tabId: number } }).target.tabId === matchingTab.id);
      expect(matchingExecs.length).toBeGreaterThan(0);

      const payload = (matchingExecs[0].args[0] as { args: unknown[] }).args[0] as { title?: string; favicon?: string; force?: boolean };
      expect(payload.title).toBe('Rewritten Title');
      expect(payload.favicon).toBe('https://example.com/icon.png');

      // No exec to protected tab
      const protectedExecs = execCalls.filter((c) => (c.args[0] as { target: { tabId: number } }).target.tabId === protectedTab.id);
      expect(protectedExecs).toHaveLength(0);
    });

    it('should not send messages for manual rules', async () => {
      adapter.setTabs([matchingTab]);
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'manual',
        priority: 0,
        title: 'Manual',
      });
      const sendCalls = adapter.calls.filter((c) => c.method === 'tabs.sendMessage');
      expect(sendCalls).toHaveLength(0);
    });

    it('should re-apply computed fields to matching tabs after updateRule', async () => {
      adapter.setTabs([matchingTab]);

      const created = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 0,
        title: 'Before',
      });
      expect(created.success).toBe(true);
      if (!created.success) return;

      adapter.calls.length = 0;

      const updated = await service.updateRule(created.rule.id, { title: 'After' });
      expect(updated.success).toBe(true);

      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      expect(execCalls.length).toBeGreaterThan(0);
      const payload = (execCalls[0].args[0] as { args: unknown[] }).args[0] as { title?: string; force?: boolean };
      expect(payload.title).toBe('After');
      expect(payload.force).toBe(true);
    });
  });
});
