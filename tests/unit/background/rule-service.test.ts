import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import type { NormalizedWindow } from '@adapters/contract';

describe('T10: Page rules, field override computation, manual apply', () => {
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

  describe('Happy path — rule creation and field computation', () => {
    it('should create auto rule and apply to matching tabs', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 10,
        title: 'Custom Title',
      }, 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rule.id).toContain('rule-');
        expect(result.rule.priority).toBe(10);
      }

      // Verify rewrite was delivered via scripting.executeScript
      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      expect(execCalls.length).toBeGreaterThan(0);
    });

    it('should compute fields with override → rule → site chain', async () => {
      // Create a rule
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Rule Title',
      }, 0);

      // Set tab override
      await service.setTabOverride(1, 'Override Title');

      // Compute: override wins for title
      const computed = await service.computeFields(1, 'https://example.com/page', 'Site Title', 'site-favicon.ico');
      expect(computed.title).toBe('Override Title');
      expect(computed.titleSource).toBe('override');
    });

    it('should select highest priority rule when multiple match', async () => {
      await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        mode: 'auto',
        priority: 5,
        title: 'Low Priority',
      }, 0);

      await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/page' },
        mode: 'auto',
        priority: 10,
        title: 'High Priority',
      }, 1);

      const computed = await service.computeFields(1, 'https://example.com/page', 'Site', '');
      expect(computed.title).toBe('High Priority');
      expect(computed.titleSource).toBe('rule');
    });

    it('should return manual candidates across windows', async () => {
      adapter.setWindows([
        { id: 1, focused: true, incognito: false, type: 'normal' },
        { id: 2, focused: false, incognito: false, type: 'normal' },
      ]);
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://example.com/a', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 2, windowId: 2, index: 0, url: 'https://example.com/b', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      const createResult = await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        mode: 'manual',
        priority: 0,
        title: 'Manual Rule',
      }, 0);

      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const candidates = await service.getManualCandidates(createResult.rule.id);
      expect(candidates.success).toBe(true);
      if (candidates.success) {
        expect(candidates.candidates).toHaveLength(2);
        // Current window first
        expect(candidates.candidates[0].isCurrentWindow).toBe(true);
      }
    });
  });

  describe('Error path — protected URL, conflicts, manual restrictions', () => {
    it('should reject rule for protected URL', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'chrome://settings' },
        mode: 'auto',
        priority: 0,
      }, 0);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_PROTECTED_URL');
      }
    });

    it('should block identical exact URL rules', async () => {
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 0,
      }, 0);

      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'manual',
        priority: 5,
      }, 1);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Identical URL pattern → duplicate detection takes precedence
        expect(result.errorCode).toBe('DUPLICATE_RULE');
      }
    });

    it('should reject invalid regex', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'regex', value: '(' },
        mode: 'auto',
        priority: 0,
      }, 0);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_INVALID_REGEX');
      }
    });

    it('should reject regex exceeding 500 chars', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'regex', value: 'a'.repeat(501) },
        mode: 'auto',
        priority: 0,
      }, 0);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_REGEX_TOO_LONG');
      }
    });

    it('should not auto-apply manual rules', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'manual',
        priority: 0,
        title: 'Manual Only',
      }, 0);

      // No delivery should have been triggered for manual rules
      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      const sendCalls = adapter.calls.filter((c) => c.method === 'tabs.sendMessage');
      expect(execCalls).toHaveLength(0);
      expect(sendCalls).toHaveLength(0);
    });

    it('should reject apply to protected page tab', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'chrome://extensions', title: 'Extensions', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      const createResult = await service.createRule({
        urlMatch: { type: 'regex', value: '.*' },
        mode: 'manual',
        priority: 0,
        title: 'Test',
      }, 0);

      if (!createResult.success) return;

      const result = await service.applyToTab(createResult.rule.id, 1);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('PROTECTED_PAGE');
      }
    });

    it('should clamp priority to -100..100', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/clamp' },
        mode: 'auto',
        priority: 999,
      }, 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rule.priority).toBe(100);
      }
    });
  });
});
