import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import { DiagnosticsService } from '@background/diagnostics-service';
import type { NormalizedWindow } from '@adapters/contract';

/**
 * T11: page-opening diagnostics must distinguish the two hypotheses for item 2:
 *  - "two creators racing": create records with DIFFERENT `source` values.
 *  - "same handler called twice": two create records with the SAME `source`.
 *
 * Hard constraint (isSanitized): diagnostics must NOT carry URL / title / regex
 * text — the `operationType` token encodes the facts instead.
 */
describe('T11: open-page path diagnostics', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const BASE = 'chrome-extension://mock-id/src/ui/settings/index.html';

  const route = (msg: unknown) =>
    (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    adapter.setTabs([]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
    adapter.calls.length = 0;
  });

  it('T11 RED: an OPEN_PAGE create writes a sanitized diagnostic token', async () => {
    await route({ requestId: 'd1', action: 'OPEN_PAGE', payload: { url: BASE } });

    const local = await worker.repo.getLocalState();
    const openEntries = local.diagnostics.filter((e) => e.operationType.startsWith('open_page'));
    expect(openEntries.length).toBeGreaterThan(0);
    expect(openEntries.some((e) => e.operationType === 'open_page:background:create')).toBe(true);
  });

  it('T11: every open-page diagnostic entry is sanitized (no URL / title leak)', async () => {
    await route({ requestId: 'd2', action: 'OPEN_PAGE', payload: { url: BASE } });

    const local = await worker.repo.getLocalState();
    const openEntries = local.diagnostics.filter((e) => e.operationType.startsWith('open_page'));
    expect(openEntries.length).toBeGreaterThan(0);
    for (const entry of openEntries) {
      expect(DiagnosticsService.isSanitized(entry)).toBe(true);
    }
  });

  it('T11: the operationType token carries the source dimension', async () => {
    await route({ requestId: 'd3', action: 'OPEN_PAGE', payload: { url: BASE } });

    const local = await worker.repo.getLocalState();
    const token = local.diagnostics.find((e) => e.operationType.startsWith('open_page'))?.operationType ?? '';
    // Format: open_page:<source>:<result>
    const parts = token.split(':');
    expect(parts[0]).toBe('open_page');
    expect(['background', 'sidebar-fallback']).toContain(parts[1]);
    expect(parts[2]).toBe('create');
  });
});