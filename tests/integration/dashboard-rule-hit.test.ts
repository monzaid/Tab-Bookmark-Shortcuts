/**
 * Review item 7.1 — the Data Dashboard must show "managed tabs" that are
 * controlled by a RULE (the `rule-hit` kind), which was previously never
 * produced by the background.
 *
 * The computed chain is verified too: a rule-hit row must report `rule` as the
 * winning source and carry the rule id as its jump anchor.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('Data Dashboard — managed tabs driven by a rule (rule-hit)', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tabA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabOther: NormalizedTab = { id: 11, windowId: 1, index: 1, url: 'https://other.com/', title: 'Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    adapter.setTabs([tabA, tabOther]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('should emit a rule-hit row for a tab matched by an enabled rule', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rule Title',
    }, 0);
    expect(created.success).toBe(true);

    const dashboard = await worker.buildDashboardForTest();
    const hit = dashboard.find((r) => r.kind === 'rule-hit');
    expect(hit).toBeDefined();
    expect(hit?.tabId).toBe(10);
    expect(hit?.ruleId).toBe(created.success ? created.rule.id : undefined);
    expect(hit?.anchor).toEqual({ kind: 'rule', ruleId: created.success ? created.rule.id : undefined });

    // The displayed value must come from the rule tier.
    expect(hit?.chain.title.winner.source).toBe('rule');
    expect(hit?.chain.title.winner.value).toBe('Rule Title');
  });

  it('should not emit a rule-hit row for a tab matched by a disabled rule', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rule Title',
      enabled: false,
    }, 0);
    expect(created.success).toBe(true);

    const dashboard = await worker.buildDashboardForTest();
    expect(dashboard.some((r) => r.kind === 'rule-hit')).toBe(false);
  });

  it('should not duplicate a tab that already owns an override row', async () => {
    adapter.setTabs([tabA]);
    await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rule Title',
    }, 0);
    await worker.repo.setTabOverride({ tabId: 10, title: 'Manual', createdAt: new Date().toISOString() });

    const dashboard = await worker.buildDashboardForTest();
    const forTab10 = dashboard.filter((r) => r.tabId === 10);
    // The override row wins the tab; no rule-hit duplicate.
    expect(forTab10).toHaveLength(1);
    expect(forTab10[0].kind).toBe('override');
  });

  it('should not include a tab that no rule matches', async () => {
    adapter.setTabs([tabOther]);
    await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
    }, 0);

    const dashboard = await worker.buildDashboardForTest();
    expect(dashboard.some((r) => r.tabId === 11 && r.kind === 'rule-hit')).toBe(false);
  });
});