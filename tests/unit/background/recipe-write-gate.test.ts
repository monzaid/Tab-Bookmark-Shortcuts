/**
 * T12 (R1 / gap 1) — the write gates must ADMIT a `type:'template'` recipe
 * (whose `value` is `''`), while still rejecting unsafe non-recipe icons.
 *
 * Root cause: `isSafeFaviconProtocol('')` returns false, so a valid recipe was
 * falsely rejected, making recipe persistence impossible end-to-end.
 *
 * Security equivalence: a recipe value never reaches `link.href` — it is
 * rendered to a PNG that then passes the gate. Only the `type:'template'`
 * branch is relaxed; every other type keeps the exact prior check.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { IconService } from '@background/icon-service';
import { RuleService } from '@background/rule-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { IconSource } from '@shared/types';
import type { RecipeRenderer } from '@background/recipe-renderer';

const RECIPE: IconSource = { type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' };

describe('T12: write gates admit recipes (gap 1)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
  });

  const route = (worker: WorkerOrchestrator, m: unknown) =>
    (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<{ success: boolean }> })
      .routeMessage(m, {});

  it('SET_TAB_OVERRIDE persists a recipe while still rejecting a javascript: url', async () => {
    const worker = new WorkerOrchestrator(adapter);
    await worker.initialize();

    const ok = await route(worker, { requestId: 'r1', action: 'SET_TAB_OVERRIDE', payload: { tabId: 10, favicon: RECIPE } });
    expect(ok.success, 'a recipe must persist (was falsely rejected)').toBe(true);
    const stored = (await repo.getLocalState()).tabOverrides.find((o) => o.tabId === 10)?.favicon;
    expect(stored).toEqual(RECIPE);

    const bad = await route(worker, {
      requestId: 'r2', action: 'SET_TAB_OVERRIDE',
      payload: { tabId: 11, favicon: { type: 'url', value: 'javascript:alert(1)' } },
    });
    expect(bad.success, 'a non-recipe unsafe url must STILL be rejected').toBe(false);
  });

  it('UPDATE_SLOT_UI_MARKER persists a slot recipe', async () => {
    const worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
    // saveSlot reads the active tab, so seed one (like the existing worker test).
    adapter.setTabs([
      { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' },
    ]);
    expect((await worker.slotService.saveSlot(1, repo.getConfigVersion())).success).toBe(true);

    const ok = await route(worker, {
      requestId: 'm1', action: 'UPDATE_SLOT_UI_MARKER',
      payload: { slotId: 1, uiMarker: { icon: RECIPE } },
    });
    expect(ok.success).toBe(true);
    const slot = (await repo.getSyncState()).slots.find((s) => s.id === 1);
    expect(slot?.uiMarker.icon).toEqual(RECIPE);
  });

  it('saveRule (createRule) persists a recipe favicon', async () => {
    const ruleService = new RuleService(adapter, repo);
    const result = await ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://recipe.example/page' },
      priority: 0,
      favicon: RECIPE,
    });
    expect(result.success, 'createRule must accept a recipe favicon').toBe(true);
    if (result.success) {
      expect(result.rule.favicon).toEqual(RECIPE);
    }
  });

  it('createRule still rejects a non-recipe unsafe favicon (gate not bypassed)', async () => {
    const ruleService = new RuleService(adapter, repo);
    const result = await ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://bad.example/page' },
      priority: 0,
      favicon: { type: 'url', value: 'javascript:alert(1)' },
    });
    expect(result.success).toBe(false);
  });

  it('a rendered recipe passes isSafeFaviconProtocol (the equivalence premise)', async () => {
    const { isSafeFaviconProtocol } = await import('@shared/url-utils');
    // Use the IconService only to show the renderer contract exists; the
    // decisive premise is the gate itself.
    const svc = new IconService(repo, {
      renderToPng: () => Promise.resolve('data:image/png;base64,AAAA'),
    } as unknown as RecipeRenderer);
    void svc;
    expect(isSafeFaviconProtocol('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeFaviconProtocol('')).toBe(false); // why the recipe was falsely rejected
  });
});