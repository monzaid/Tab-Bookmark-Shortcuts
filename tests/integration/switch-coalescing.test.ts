import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * T10: in-flight coalescing for SWITCH_SLOT and RECOVERY_OPEN_URL (A10).
 * Concurrent triggers against the SAME key collapse into one effect set
 * (1 window / 1 notification / 1 binding write).
 */
describe('T10: switch / recovery in-flight coalescing', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab = (id: number, url: string, active = false): NormalizedTab => ({
    id, windowId: 1, index: id, url, title: 'T' + String(id), favIconUrl: '',
    active, incognito: false, status: 'complete',
  });

  const route = (msg: unknown) =>
    (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

  const windowsCreated = () => adapter.calls.filter((c) => c.method === 'windows.create').length;
  const tabsCreated = () => adapter.calls.filter((c) => c.method === 'tabs.create').length;

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    adapter.setTabs([tab(10, 'https://example.com/page', true)]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  async function saveSlot(slotId: number, url: string) {
    await route({
      requestId: 'save-' + String(slotId),
      action: 'SAVE_SLOT',
      configVersion: worker.repo.getConfigVersion(),
      payload: { slotId, urlMatch: { type: 'exact', value: url }, titleSnapshot: 'T', faviconSnapshot: '' },
    });
  }

  it('T10 RED: two concurrent SWITCH_SLOT for the same slot open only one recovery window', async () => {
    await saveSlot(1, 'https://example.com/page');
    adapter.setTabs([]); // no candidates → needs_recovery
    adapter.calls.length = 0;

    await Promise.all([
      route({ requestId: 'sw-c1', action: 'SWITCH_SLOT', payload: { slotId: 1 } }),
      route({ requestId: 'sw-c2', action: 'SWITCH_SLOT', payload: { slotId: 1 } }),
    ]);

    expect(windowsCreated()).toBe(1);
  });

  it('T10 RED: two concurrent RECOVERY_OPEN_URL for the same session create one tab', async () => {
    await saveSlot(1, 'https://example.com/page');
    adapter.setTabs([]);
    adapter.calls.length = 0;

    // Trigger recovery so a session exists.
    const res = (await route({ requestId: 'r-open-1', action: 'SWITCH_SLOT', payload: { slotId: 1 } })) as {
      outcome?: { type: string; recoveryId?: string };
    };
    expect(res.outcome?.type).toBe('needs_recovery');
    const recoveryId = res.outcome?.recoveryId ?? '';
    expect(recoveryId).not.toBe('');

    adapter.calls.length = 0;
    await Promise.all([
      route({ requestId: 'ro-1', action: 'RECOVERY_OPEN_URL', payload: { recoveryId, autoBind: false } }),
      route({ requestId: 'ro-2', action: 'RECOVERY_OPEN_URL', payload: { recoveryId, autoBind: false } }),
    ]);

    expect(tabsCreated()).toBe(1);
  });
});