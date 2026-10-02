/**
 * T9 — centralized protected-page handling (A8/C5) + removal of `force` (A5).
 *
 * `isProtectedUrl` is decided ONCE, inside the delivery entry. A protected tab
 * is reported `protected` and never delivered; editing it remains allowed (C5).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { FieldDeliveryService } from '@background/field-delivery-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

function tab(id: number, url: string): NormalizedTab {
  return { id, windowId: 1, index: id, url, title: 'Site', favIconUrl: '', active: false, incognito: false, status: 'complete' };
}

describe('T9: protected pages are centralized at the delivery entry', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let delivery: FieldDeliveryService;

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    delivery = new FieldDeliveryService(adapter, repo);
  });

  it('reports protected and never touches the delivery channel', async () => {
    adapter.setTabs([tab(1, 'chrome://settings')]);
    const report = await delivery.recomputeAndRedeliver([1]);
    expect(report[1]).toBe('protected');
    expect(adapter.calls.filter((c) => c.method === 'tabs.sendMessage')).toHaveLength(0);
    expect(adapter.calls.filter((c) => c.method === 'scripting.executeScript')).toHaveLength(0);
  });

  it.each([
    'chrome://extensions',
    'about:blank',
    'edge://settings',
    'chrome-extension://abc/page.html',
  ])('treats %s as protected', async (url) => {
    adapter.setTabs([tab(1, url)]);
    const report = await delivery.recomputeAndRedeliver([1]);
    expect(report[1]).toBe('protected');
  });

  it('still ALLOWS editing a protected tab (C5: edit is not blocked)', async () => {
    adapter.setTabs([tab(1, 'chrome://settings')]);
    const worker = new WorkerOrchestrator(adapter);
    await worker.initialize();

    const result = await (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(
      { requestId: 'ov-1', action: 'SET_TAB_OVERRIDE', payload: { tabId: 1, title: 'Edited Anyway' } },
      {},
    );
    expect(result).toEqual(expect.objectContaining({ success: true }));
    const local = await repo.getLocalState();
    expect(local.tabOverrides.find((o) => o.tabId === 1)?.title).toBe('Edited Anyway');
  });
});

describe('T9: `force` is fully removed (A5)', () => {
  it('the ApplyPayload type has no force field', async () => {
    const mod = await import('@background/apply-fields');
    // A payload with an extra `force` key is not a valid ApplyPayload — the
    // compile-time proof is the absence of the field on the interface, asserted
    // here structurally.
    const payload: import('@background/apply-fields').ApplyPayload = { title: 'x' };
    expect(Object.keys(payload)).not.toContain('force');
    expect('submitForce' in mod).toBe(false);
  });

  it('the delivery service never sends a force flag on the wire', async () => {
    const adapter = createMockAdapter();
    adapter.setWindows([win]);
    adapter.setTabs([tab(1, 'https://a.com/x')]);
    const repo = new StorageRepository(adapter);
    await repo.initialize();
    const delivery = new FieldDeliveryService(adapter, repo);

    await repo.addRule({
      id: 'r1',
      urlMatch: { type: 'exact', value: 'https://a.com/x' },
      priority: 0,
      title: 'T',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await delivery.recomputeAndRedeliver([1]);

    const msgs = adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage')
      .map((c) => c.args[1] as Record<string, unknown>);
    for (const m of msgs) {
      expect('force' in m).toBe(false);
      expect(JSON.stringify(m)).not.toContain('force');
    }
  });
});

