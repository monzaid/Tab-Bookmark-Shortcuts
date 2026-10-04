/**
 * Manual review, round 2 — issues 2 and 3 at the DELIVERY seam.
 *
 * Issue 2: a rule saved with BOTH a title and an icon must push BOTH to every
 * matching tab. The report is "the tab got the title but not the icon".
 *
 * Issue 3: editing a Dashboard `rule-hit` row writes the RULE, and the tabs it
 * manages must pick up the new title/icon (the report is that nothing changes
 * and the title even falls back to the site value).
 *
 * The assertions read the actual `FIELD_APPLY` directives, so they fail on
 * exactly the reported symptom rather than on an internal detail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { FieldDirective } from '@shared/messages';

describe('review round 2 — rule writes reach the tabs', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tabA: NormalizedTab = {
    id: 10, windowId: 1, index: 0, url: 'https://example.com/page',
    title: 'Site Title', favIconUrl: 'https://example.com/site.png',
    active: true, incognito: false, status: 'complete',
  };

  /** The LAST directives delivered to a tab (the newest state wins). */
  function lastApplyFor(tabId: number): { title?: FieldDirective; favicon?: FieldDirective } | undefined {
    const calls = adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage' && c.args[0] === tabId)
      .map((c) => c.args[1] as { type?: string; title?: FieldDirective; favicon?: FieldDirective })
      .filter((m) => m?.type === 'FIELD_APPLY');
    return calls[calls.length - 1];
  }

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    adapter.setTabs([tabA]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('issue 2: creating a rule with title AND icon delivers BOTH to the matching tab', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rule Title',
      favicon: { type: 'url', value: 'https://cdn.example.com/rule.png' },
    }, 0);
    expect(created.success).toBe(true);

    const apply = lastApplyFor(10);
    expect(apply, 'the matching tab must receive a FIELD_APPLY').toBeDefined();

    // BOTH dimensions must be `set` with the rule's values.
    expect(apply?.title).toEqual({ kind: 'set', value: 'Rule Title' });
    expect(apply?.favicon).toEqual({ kind: 'set', value: 'https://cdn.example.com/rule.png' });
  });

  it('issue 2: the delivered favicon is reachable from the dashboard row that reported it', async () => {
    await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rule Title',
      favicon: { type: 'url', value: 'https://cdn.example.com/rule.png' },
    }, 0);

    const rows = await worker.buildDashboardForTest();
    const hit = rows.find((r) => r.kind === 'rule-hit');
    // The row the user sees claims a favicon...
    expect(hit?.chain.favicon.winner.value).toBe('https://cdn.example.com/rule.png');
    // ...so the tab must have been told the same value.
    expect(lastApplyFor(10)?.favicon).toEqual({
      kind: 'set',
      value: 'https://cdn.example.com/rule.png',
    });
  });

  it('issue 3: editing a rule updates the tab it manages (title AND icon)', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Before',
      favicon: { type: 'url', value: 'https://cdn.example.com/before.png' },
    }, 0);
    if (!created.success) throw new Error('setup failed');
    const ruleId = created.rule.id;

    // The Dashboard's rule-hit `Save` writes the RULE.
    const updated = await worker.ruleService.updateRule(ruleId, {
      title: 'After',
      favicon: { type: 'url', value: 'https://cdn.example.com/after.png' },
    });
    expect(updated.success).toBe(true);

    const apply = lastApplyFor(10);
    expect(apply?.title).toEqual({ kind: 'set', value: 'After' });
    expect(apply?.favicon).toEqual({ kind: 'set', value: 'https://cdn.example.com/after.png' });
  });

  it('issue 3: an edit that only changes the title must NOT clear the rule icon', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Before',
      favicon: { type: 'url', value: 'https://cdn.example.com/keep.png' },
    }, 0);
    if (!created.success) throw new Error('setup failed');

    // A title-only update: the icon must survive (this is how the Dashboard
    // sends a draft whose icon dimension was untouched).
    const updated = await worker.ruleService.updateRule(created.rule.id, { title: 'After' });
    expect(updated.success).toBe(true);
    expect(updated.success && updated.rule.favicon?.value).toBe('https://cdn.example.com/keep.png');

    const apply = lastApplyFor(10);
    expect(apply?.title).toEqual({ kind: 'set', value: 'After' });
    expect(apply?.favicon).toEqual({ kind: 'set', value: 'https://cdn.example.com/keep.png' });
  });
});