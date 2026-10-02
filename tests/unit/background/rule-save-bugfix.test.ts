import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import { FieldDeliveryService } from '@background/field-delivery-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedWindow } from '@adapters/contract';

/**
 * Rule save tests — simple, direct, no version check.
 *
 * Design: single-user local extension. Rule save = validate → construct → write → done.
 * No optimistic locking, no configVersion, no conflict detection on writes.
 */
describe('Rule save — simple direct writes', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;
  let delivery: FieldDeliveryService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
    // Mirror the production wiring (A2): the delivery coordinator is injected.
    delivery = new FieldDeliveryService(adapter, repo);
    service.setDelivery((tabIds) => delivery.recomputeAndRedeliver(tabIds));
  });

  describe('createRule', () => {
    it('should create a rule and persist it', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        priority: 0,
        title: 'Test Rule',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rule.urlMatch.value).toBe('https://example.com/page');
        expect(result.rule.title).toBe('Test Rule');
        expect(result.rule.id).toMatch(/^rule-/);
      }

      // Verify persisted
      const sync = await repo.getSyncState();
      expect(sync.rules).toHaveLength(1);
      expect(sync.rules[0].urlMatch.value).toBe('https://example.com/page');
    });

    it('should create multiple rules sequentially without version conflicts', async () => {
      const r1 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/first' },
        priority: 0,
      });
      expect(r1.success).toBe(true);

      const r2 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/second' },
        priority: 5,
      });
      expect(r2.success).toBe(true);

      const r3 = await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        priority: 10,
      });
      expect(r3.success).toBe(true);

      const sync = await repo.getSyncState();
      expect(sync.rules).toHaveLength(3);
    });

    it('should reject protected URLs', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'chrome://extensions' },
        priority: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_PROTECTED_URL');
      }
    });

    it('should reject invalid regex', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'regex', value: '[invalid' },
        priority: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_INVALID_REGEX');
      }
    });

    it('should clamp priority to [-100, 100]', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/clamp' },
        priority: 999,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rule.priority).toBe(100);
      }
    });

    it('should reject an exact duplicate rule (atomic duplicate detection)', async () => {
      const first = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/dup' },
        priority: 0,
      });
      expect(first.success).toBe(true);

      const second = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/dup' },
        priority: 0,
      });
      expect(second.success).toBe(false);
      if (!second.success) {
        expect(second.errorCode).toBe('DUPLICATE_RULE');
      }

      const sync = await repo.getSyncState();
      expect(sync.rules).toHaveLength(1);
    });

    it('should only append one rule when two identical CREATE_RULE calls race', async () => {
      const ruleA = {
        urlMatch: { type: 'exact' as const, value: 'https://example.com/race' },
        priority: 0,
      };
      // Fire two concurrent identical creates. The atomic duplicate check inside
      // the serialized write queue must ensure only one is appended.
      const [r1, r2] = await Promise.all([
        service.createRule(ruleA),
        service.createRule(ruleA),
      ]);

      const successes = [r1, r2].filter((r) => r.success).length;
      expect(successes).toBe(1);

      const sync = await repo.getSyncState();
      expect(sync.rules.filter((r) => r.urlMatch.value === 'https://example.com/race')).toHaveLength(1);
    });
  });

  describe('updateRule', () => {
    it('should update an existing rule', async () => {
      const created = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/edit' },
        priority: 0,
        title: 'Original',
      });
      expect(created.success).toBe(true);
      if (!created.success) return;

      const updated = await service.updateRule(created.rule.id, {
        title: 'Updated',
        priority: 10,
      });
      expect(updated.success).toBe(true);
      if (updated.success) {
        expect(updated.rule.title).toBe('Updated');
        expect(updated.rule.priority).toBe(10);
        expect(updated.rule.urlMatch.value).toBe('https://example.com/edit');
      }
    });

    it('should return RULE_NOT_FOUND for non-existent rule', async () => {
      const result = await service.updateRule('non-existent-id', { title: 'X' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_NOT_FOUND');
      }
    });
  });

  describe('deleteRule', () => {
    it('should delete an existing rule', async () => {
      const created = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/delete-me' },
        priority: 0,
      });
      expect(created.success).toBe(true);
      if (!created.success) return;

      const result = await service.deleteRule(created.rule.id);
      expect(result.success).toBe(true);

      const sync = await repo.getSyncState();
      expect(sync.rules).toHaveLength(0);
    });

    it('should re-apply fields to matching tabs after deletion', async () => {
      adapter.setTabs([
        { id: 1, url: 'https://example.com/reapply', index: 0, windowId: 1, active: false, title: 'A', favIconUrl: '', incognito: false, status: 'complete' },
        { id: 2, url: 'https://example.com/reapply', index: 1, windowId: 1, active: false, title: 'B', favIconUrl: '', incognito: false, status: 'complete' },
      ]);
      const created = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/reapply' },
        priority: 0,
        title: 'Rule Title',
      });
      expect(created.success).toBe(true);
      if (!created.success) return;

      adapter.calls.length = 0;

      const result = await service.deleteRule(created.rule.id);
      expect(result.success).toBe(true);

      // After deletion the rule no longer applies, so the re-apply must push
      // the fallback (original) fields to every previously-matching tab.
      const reapplyCalls = adapter.calls.filter((c) =>
        c.method === 'tabs.sendMessage' || c.method === 'scripting.executeScript'
      );
      const touchedTabIds = new Set<number>();
      for (const c of reapplyCalls) {
        if (c.method === 'tabs.sendMessage') touchedTabIds.add(c.args[0] as number);
        if (c.method === 'scripting.executeScript') {
          const target = (c.args[0] as { target?: { tabId?: number } })?.target;
          if (target?.tabId != null) touchedTabIds.add(target.tabId);
        }
      }
      expect(touchedTabIds.has(1)).toBe(true);
      expect(touchedTabIds.has(2)).toBe(true);
    });

    it('should return RULE_NOT_FOUND for non-existent rule', async () => {
      const result = await service.deleteRule('non-existent-id');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_NOT_FOUND');
      }
    });
  });

  describe('Worker routing — no configVersion needed', () => {
    it('should create rule via worker without configVersion', async () => {
      const orchestrator = new WorkerOrchestrator(adapter);
      await orchestrator.initialize();

      const res = await (orchestrator as any).routeMessage({
        requestId: 'test-1',
        action: 'CREATE_RULE',
        payload: {
          urlMatch: { type: 'exact', value: 'https://example.com/via-worker' },
          priority: 0,
        },
      }, {});

      expect((res as any).success).toBe(true);
      expect((res as any).rule.urlMatch.value).toBe('https://example.com/via-worker');
    });

    it('should create multiple rules via worker without version issues', async () => {
      const orchestrator = new WorkerOrchestrator(adapter);
      await orchestrator.initialize();

      const res1 = await (orchestrator as any).routeMessage({
        requestId: 'test-1',
        action: 'CREATE_RULE',
        payload: {
          urlMatch: { type: 'exact', value: 'https://example.com/a' },
          priority: 0,
        },
      }, {});
      expect((res1 as any).success).toBe(true);

      // Second create — no version to get stale
      const res2 = await (orchestrator as any).routeMessage({
        requestId: 'test-2',
        action: 'CREATE_RULE',
        payload: {
          urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
          priority: 5,
        },
      }, {});
      expect((res2 as any).success).toBe(true);
    });

    it('should update rule via worker', async () => {
      const orchestrator = new WorkerOrchestrator(adapter);
      await orchestrator.initialize();

      const createRes = await (orchestrator as any).routeMessage({
        requestId: 'test-1',
        action: 'CREATE_RULE',
        payload: {
          urlMatch: { type: 'exact', value: 'https://example.com/update-me' },
          priority: 0,
          title: 'Before',
        },
      }, {});
      expect((createRes as any).success).toBe(true);
      const ruleId = (createRes as any).rule.id;

      const updateRes = await (orchestrator as any).routeMessage({
        requestId: 'test-2',
        action: 'UPDATE_RULE',
        payload: { ruleId, title: 'After', priority: 10 },
      }, {});
      expect((updateRes as any).success).toBe(true);
      expect((updateRes as any).rule.title).toBe('After');
    });

    it('should delete rule via worker', async () => {
      const orchestrator = new WorkerOrchestrator(adapter);
      await orchestrator.initialize();

      const createRes = await (orchestrator as any).routeMessage({
        requestId: 'test-1',
        action: 'CREATE_RULE',
        payload: {
          urlMatch: { type: 'exact', value: 'https://example.com/del' },
          priority: 0,
        },
      }, {});
      const ruleId = (createRes as any).rule.id;

      const delRes = await (orchestrator as any).routeMessage({
        requestId: 'test-2',
        action: 'DELETE_RULE',
        payload: { ruleId },
      }, {});
      expect((delRes as any).success).toBe(true);
    });
  });

  describe('Queue resilience', () => {
    it('should recover queue after a storage write failure', async () => {
      // First write succeeds
      const result1 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/first' },
        priority: 0,
      });
      expect(result1.success).toBe(true);

      // Simulate storage failure on next write
      const originalSet = adapter.storage.set;
      let shouldFail = true;
      adapter.storage.set = async (area, items) => {
        if (area === 'sync' && shouldFail) {
          throw new Error('Quota exceeded');
        }
        return originalSet(area, items);
      };

      // Second write fails
      await expect(service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/second' },
        priority: 0,
      })).rejects.toThrow();

      // Fix the issue
      shouldFail = false;

      // Third write MUST succeed — queue must not be permanently broken
      const result3 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/third' },
        priority: 0,
      });
      expect(result3.success).toBe(true);
      if (result3.success) {
        expect(result3.rule.urlMatch.value).toBe('https://example.com/third');
      }

      adapter.storage.set = originalSet;
    });
  });

  describe('Worker initialization registers listeners before async work', () => {
    it('should register onMessage listener synchronously during initialize', async () => {
      const freshAdapter = createMockAdapter();
      freshAdapter.setWindows([currentWindow]);
      const orchestrator = new WorkerOrchestrator(freshAdapter);

      const callOrder: string[] = [];
      const originalOnMessage = freshAdapter.runtime.onMessage;
      freshAdapter.runtime.onMessage = (listener: any) => {
        callOrder.push('onMessage_registered');
        originalOnMessage(listener);
      };
      const originalStorageGet = freshAdapter.storage.get;
      freshAdapter.storage.get = async (...args: any[]) => {
        callOrder.push('storage_get');
        return originalStorageGet(...(args as [any, any]));
      };

      await orchestrator.initialize();

      const onMessageIdx = callOrder.indexOf('onMessage_registered');
      const storageGetIdx = callOrder.indexOf('storage_get');
      expect(onMessageIdx).toBeGreaterThanOrEqual(0);
      expect(onMessageIdx).toBeLessThanOrEqual(storageGetIdx);
    });
  });
});
