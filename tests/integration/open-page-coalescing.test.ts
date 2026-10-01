import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedWindow } from '@adapters/contract';

/**
 * T10: in-flight coalescing for OPEN_PAGE.
 * Two CONCURRENT opens of the same base-URL must create exactly ONE tab.
 * Serial opens of DIFFERENT urls must NOT be coalesced (no global throttling).
 */
describe('T10: OPEN_PAGE in-flight coalescing', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const BASE = 'chrome-extension://mock-id/src/ui/settings/index.html';

  const route = (msg: unknown) =>
    (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

  const createCalls = () => adapter.calls.filter((c) => c.method === 'tabs.create');

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    adapter.setTabs([]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
    adapter.calls.length = 0;
  });

  it('T10 RED: two concurrent OPEN_PAGE of the same URL create exactly one tab', async () => {
    await Promise.all([
      route({ requestId: 'c1', action: 'OPEN_PAGE', payload: { url: BASE } }),
      route({ requestId: 'c2', action: 'OPEN_PAGE', payload: { url: BASE } }),
    ]);

    expect(createCalls()).toHaveLength(1);
  });

  it('T10: coalescing is hash-insensitive (base-url key)', async () => {
    await Promise.all([
      route({ requestId: 'h1', action: 'OPEN_PAGE', payload: { url: BASE } }),
      route({ requestId: 'h2', action: 'OPEN_PAGE', payload: { url: BASE + '#diagnostics' } }),
    ]);

    expect(createCalls()).toHaveLength(1);
  });

  it('T10: serial opens of DIFFERENT urls are both created (no global throttle)', async () => {
    await route({ requestId: 's1', action: 'OPEN_PAGE', payload: { url: BASE } });
    await route({ requestId: 's2', action: 'OPEN_PAGE', payload: { url: BASE + '/other.html' } });

    expect(createCalls()).toHaveLength(2);
  });

  it('T10: a later serial open of the same URL reuses instead of creating', async () => {
    await route({ requestId: 'r1', action: 'OPEN_PAGE', payload: { url: BASE } });
    const afterFirst = createCalls().length;

    await route({ requestId: 'r2', action: 'OPEN_PAGE', payload: { url: BASE } });
    expect(createCalls().length).toBe(afterFirst);
  });
});