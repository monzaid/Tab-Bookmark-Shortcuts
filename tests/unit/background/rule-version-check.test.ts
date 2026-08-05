import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedWindow } from '@adapters/contract';

/**
 * Module 2 (background) — lightweight version check for rule edits.
 * updatedAt timestamp comparison: expectedUpdatedAt must match stored value,
 * otherwise VERSION_CONFLICT is returned and no write happens.
 */
describe('Module 2: updateRule version check (updatedAt)', () => {
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

  it('should update successfully when expectedUpdatedAt matches', async () => {
    const created = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/v' },
      mode: 'auto',
      priority: 0,
      title: 'Original',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await service.updateRule(
      created.rule.id,
      { title: 'Changed' },
      created.rule.updatedAt,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rule.title).toBe('Changed');
      // updatedAt must advance
      expect(result.rule.updatedAt).not.toBe(created.rule.updatedAt);
    }
  });

  it('should return VERSION_CONFLICT when expectedUpdatedAt is stale', async () => {
    const created = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/v2' },
      mode: 'auto',
      priority: 0,
      title: 'Original',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const staleUpdatedAt = '2020-01-01T00:00:00.000Z';
    const result = await service.updateRule(
      created.rule.id,
      { title: 'Should Fail' },
      staleUpdatedAt,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('VERSION_CONFLICT');
    }

    // Rule unchanged
    const sync = await repo.getSyncState();
    expect(sync.rules[0].title).toBe('Original');
  });

  it('should still allow update without expectedUpdatedAt (backwards compatible)', async () => {
    const created = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/v3' },
      mode: 'auto',
      priority: 0,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await service.updateRule(created.rule.id, { title: 'NoVersion' });
    expect(result.success).toBe(true);
  });

  it('should route expectedUpdatedAt through worker UPDATE_RULE without leaking into updates', async () => {
    const orchestrator = new WorkerOrchestrator(adapter);
    await orchestrator.initialize();

    const createRes = await (orchestrator as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<{ success: boolean; rule?: { id: string; updatedAt: string } }> }).routeMessage({
      requestId: 'v1',
      action: 'CREATE_RULE',
      payload: {
        urlMatch: { type: 'exact', value: 'https://example.com/worker-version' },
        mode: 'auto',
        priority: 0,
      },
    }, {});
    expect(createRes.success).toBe(true);
    expect(createRes.rule).toBeDefined();
    if (!createRes.rule) throw new Error('expected created rule');
    const ruleId = createRes.rule.id;
    const updatedAt = createRes.rule.updatedAt;

    // Stale version → VERSION_CONFLICT
    const staleRes = await (orchestrator as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<{ success: boolean; errorCode?: string }> }).routeMessage({
      requestId: 'v2',
      action: 'UPDATE_RULE',
      payload: { ruleId, title: 'X', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
    }, {});
    expect(staleRes.success).toBe(false);
    expect(staleRes.errorCode).toBe('VERSION_CONFLICT');

    // Correct version → success
    const okRes = await (orchestrator as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<{ success: boolean; rule?: { title?: string; expectedUpdatedAt?: unknown } }> }).routeMessage({
      requestId: 'v3',
      action: 'UPDATE_RULE',
      payload: { ruleId, title: 'Y', expectedUpdatedAt: updatedAt },
    }, {});
    expect(okRes.success).toBe(true);
    expect(okRes.rule?.title).toBe('Y');
    // expectedUpdatedAt must NOT be persisted as a rule field
    expect((okRes.rule as unknown as Record<string, unknown>).expectedUpdatedAt).toBeUndefined();
  });
});
