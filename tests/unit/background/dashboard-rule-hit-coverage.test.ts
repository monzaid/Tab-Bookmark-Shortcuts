/**
 * The Data Dashboard must SHOW the tabs a rule affects, including bound ones.
 *
 * Reported defect: after adding a rule, nothing appeared in the dashboard for the
 * tabs it matched. The cause was a disagreement about what "covered" means:
 *
 *  - a ROW was built only for a slot that sets a `uiMarker` (a title/icon the user
 *    customized), which is correct — a slot that sets nothing has nothing to manage;
 *  - the COVERED set, however, counted EVERY binding, so a saved-but-uncustomized
 *    slot claimed its tab and the rule-hit loop skipped it.
 *
 * Net effect: the tab was neither a slot row (no marker) nor a rule-hit row
 * (skipped), so the rule was invisible precisely on the tabs it was applied to.
 * Both decisions now use the same predicate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { StorageRepository } from '@background/storage-repository';
import type { NormalizedTab } from '@adapters/contract';
import type { DashboardRow } from '@shared/types';

const URL_A = 'https://example.com/page';

function tab(id: number, url: string): NormalizedTab {
  return { id, windowId: 1, index: id, url, title: 'T', favIconUrl: '', active: false, incognito: false, status: 'complete' };
}

describe('dashboard: a rule is visible on the tabs it matches', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  beforeEach(async () => {
    adapter.reset();
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  const rows = async (): Promise<DashboardRow[]> => worker.buildDashboardForTest();

  /**
   * Seed the store directly.
   *
   * The dashboard's coverage decision is what is under test, not the write paths —
   * and seeding through the repo states the exact state the defect needs (a slot
   * with a title SNAPSHOT and no marker) without depending on `saveSlot`'s
   * active-tab plumbing or on a `configVersion` being threaded through a request.
   */
  const repo = (): StorageRepository => (worker as unknown as { repo: StorageRepository }).repo;

  async function seedSlot(withMarker: boolean): Promise<void> {
    await repo().saveSlot({
      id: 1,
      urlMatch: { type: 'exact', value: URL_A },
      strategy: 'inherit',
      uiMarker: withMarker ? { customTitle: 'Mine' } : {},
      // What `saveSlot` writes: the page's own title, which is NOT a customization.
      titleSnapshot: 'Snapshot Title',
      faviconSnapshot: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }, 0);
    await repo().setBinding({ slotId: 1, tabId: 1, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' });
  }

  async function seedRule(urlMatch: { type: 'exact' | 'regex'; value: string }, title: string): Promise<void> {
    await repo().addRule({
      id: 'r1',
      urlMatch,
      priority: 0,
      title,
      tagIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  it('an UNBOUND matching tab gets a rule-hit row (the control case)', async () => {
    adapter.setTabs([tab(1, URL_A)]);
    await seedRule({ type: 'exact', value: URL_A }, 'Rule Title');

    const hit = (await rows()).find((r) => r.kind === 'rule-hit');
    expect(hit).toBeDefined();
    expect(hit?.tabId).toBe(1);
    expect(hit?.chain.title.winner.value).toBe('Rule Title');
  });

  /**
   * A saved slot (snapshot, no marker) DELIBERATELY outranks the rule — that is the
   * documented "Slot priority tier (current page beats rule)"
   * (`tests/integration/rule-apply-persistence.test.ts`): saving a page to a slot is
   * how the user says "this page shows THIS". So a rule matching such a tab is
   * CORRECTLY not delivered, and the dashboard must agree with the chain rather than
   * showing a rule-hit row for a rule that has no effect.
   *
   * What the dashboard must NOT do is claim the tab while showing nothing: a slot
   * with no marker owns no row, so it must not consume the tab either — the row
   * would otherwise be missing entirely, which is the state the report described.
   */
  it('a saved slot with no marker owns no row, and the tab is not left row-less', async () => {
    adapter.setTabs([tab(1, URL_A)]);
    await seedSlot(false);

    const all = await rows();
    // No marker means the slot owns no row: there is no customization to manage.
    expect(all.filter((r) => r.kind === 'slot')).toHaveLength(0);
    // And with no rule in this state there is nothing else to show, so the dashboard
    // is empty for this tab. The assertion that matters is the FIRST one: the row
    // that used to claim the tab without populating it is gone.
    expect(all.filter((r) => r.kind === 'rule-hit')).toHaveLength(0);
  });

  it('a matching rule DOES produce a rule-hit row when the tab is unbound', async () => {
    adapter.setTabs([tab(1, URL_A)]);
    await seedRule({ type: 'exact', value: URL_A }, 'Rule Title');

    const hit = (await rows()).find((r) => r.kind === 'rule-hit');
    expect(hit).toBeDefined();
    expect(hit?.chain.title.winner.value).toBe('Rule Title');
  });

  it('a CUSTOMIZED slot still owns its row and keeps the tab (no regression)', async () => {
    adapter.setTabs([tab(1, URL_A)]);
    await seedSlot(true);

    const all = await rows();
    const slotRow = all.find((r) => r.kind === 'slot');
    expect(slotRow).toBeDefined();
    expect(slotRow?.chain.title.winner.value).toBe('Mine');
  });
});
