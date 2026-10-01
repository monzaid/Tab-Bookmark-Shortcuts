import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * FIX-2: the recovery window must receive the EFFECTIVE auto-bind value so its
 * checkbox opens in the right state (design §3.5 / D14 / A12 / DT8④):
 *
 *   effective = slot.autoBindOverride ?? syncState.autoBindGlobal
 *
 * Pre-fix the worker omitted `autoBind` entirely, so the window always fell back
 * to "unchecked" regardless of the settings.
 */
describe('FIX-2: recovery window autoBind param = effective value', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win1: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab = (id: number, url: string, active = false): NormalizedTab => ({
    id,
    windowId: 1,
    index: id,
    url,
    title: 'T' + String(id),
    favIconUrl: '',
    active,
    incognito: false,
    status: 'complete',
  });

  const route = (msg: unknown) =>
    (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win1]);
    adapter.setTabs([tab(10, 'https://example.com/page', true)]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  async function saveSlot(slotId: number, url: string): Promise<void> {
    await route({
      requestId: 'save-' + String(slotId),
      action: 'SAVE_SLOT',
      configVersion: worker.repo.getConfigVersion(),
      payload: { slotId, urlMatch: { type: 'exact', value: url }, titleSnapshot: 'T', faviconSnapshot: '' },
    });
  }

  /** Trigger `needs_recovery` and return the parsed `autoBind` query param. */
  async function triggerAndReadAutoBind(): Promise<string | null> {
    adapter.setTabs([]); // no candidates → needs_recovery
    adapter.calls.length = 0;
    const res = (await route({ requestId: 'sw', action: 'SWITCH_SLOT', payload: { slotId: 1 } })) as {
      outcome?: { type: string };
    };
    expect(res.outcome?.type).toBe('needs_recovery');

    const createCalls = adapter.calls.filter((c) => c.method === 'windows.create');
    expect(createCalls).toHaveLength(1);
    const createArgs = createCalls[0].args[0] as { url: string };
    const url = new URL(createArgs.url.replace('chrome-extension://mock-id/', 'http://localhost/'));
    return url.searchParams.get('autoBind');
  }

  it('FIX-2 RED ①: global on + no override → autoBind="true" (checkbox checked)', async () => {
    await saveSlot(1, 'https://example.com/page');
    // Default autoBindGlobal is true; no slot override.
    expect(await triggerAndReadAutoBind()).toBe('true');
  });

  it('FIX-2 RED ②: global on + slot override false → autoBind="false" (checkbox unchecked)', async () => {
    await saveSlot(1, 'https://example.com/page');
    await route({
      requestId: 'ov-1',
      action: 'SET_SLOT_AUTO_BIND',
      configVersion: worker.repo.getConfigVersion(),
      payload: { slotId: 1, override: false },
    });

    expect(await triggerAndReadAutoBind()).toBe('false');
  });

  it('FIX-2 RED ③: global off + slot override true → autoBind="true" (checkbox checked)', async () => {
    await saveSlot(1, 'https://example.com/page');
    await route({
      requestId: 'g-1',
      action: 'SET_AUTO_BIND_GLOBAL',
      configVersion: worker.repo.getConfigVersion(),
      payload: { enabled: false },
    });
    await route({
      requestId: 'ov-2',
      action: 'SET_SLOT_AUTO_BIND',
      configVersion: worker.repo.getConfigVersion(),
      payload: { slotId: 1, override: true },
    });

    expect(await triggerAndReadAutoBind()).toBe('true');
  });
});