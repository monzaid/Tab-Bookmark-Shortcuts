import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { SlotService } from '@background/slot-service';
import type { NormalizedWindow, NormalizedTab } from '@adapters/contract';

/**
 * T8: Position (↑/↓) back-end.
 * - Ring = current window, by tab index (A14).
 * - Start = `anchorTabId` (BLK-A / A1); a stale anchor degrades to the active
 *   tab with NO error (DT7).
 * - Single-tab ring → no-op (DT4).
 * - Browsing class → binding NOT written (A4b).
 */
describe('T8: position step (↑/↓)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: SlotService;

  const win1: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const win2: NormalizedWindow = { id: 2, focused: false, incognito: false, type: 'normal' };

  const tab = (id: number, windowId: number, index: number, active = false): NormalizedTab => ({
    id,
    windowId,
    index,
    url: 'https://example.com/' + String(id),
    title: 'T' + String(id),
    favIconUrl: '',
    active,
    incognito: false,
    status: 'complete',
  });

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win1, win2]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new SlotService(adapter, repo);
  });

  it('steps to the next tab by position', async () => {
    adapter.setTabs([tab(10, 1, 0, true), tab(11, 1, 1), tab(12, 1, 2)]);

    const r = await service.positionNext(10);
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(11);
  });

  it('wraps around the ring on next', async () => {
    adapter.setTabs([tab(10, 1, 0), tab(11, 1, 1), tab(12, 1, 2, true)]);

    const r = await service.positionNext(12);
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(10);
  });

  it('steps backward with prev', async () => {
    adapter.setTabs([tab(10, 1, 0), tab(11, 1, 1, true), tab(12, 1, 2)]);

    const r = await service.positionPrev(11);
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(10);
  });

  it('T8 RED: a stale anchor degrades to the active tab WITHOUT error (DT7)', async () => {
    adapter.setTabs([tab(10, 1, 0), tab(11, 1, 1), tab(12, 1, 2, true)]);

    // 99 is closed → start from the active tab (12) and step forward → 10.
    const r = await service.positionNext(99);
    expect(r.success).toBe(true);
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(10);
  });

  it('no anchor → start from the active tab', async () => {
    adapter.setTabs([tab(10, 1, 0), tab(11, 1, 1, true), tab(12, 1, 2)]);

    const r = await service.positionNext();
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(12);
  });

  it('T8 RED: a single-tab ring is a no-op and never writes the binding (DT4 / A4b)', async () => {
    adapter.setTabs([tab(10, 1, 0, true)]);
    const spy = vi.spyOn(repo, 'setBinding');

    const r = await service.positionNext(10);
    expect(r.success).toBe(true);
    expect(r.success ? r.outcome.type : null).toBe('no_match');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('T8: only the CURRENT window participates in the ring', async () => {
    adapter.setTabs([tab(10, 1, 0, true), tab(20, 2, 0), tab(11, 1, 1)]);

    const r = await service.positionNext(10);
    // Tab 20 lives in window 2 and must be skipped.
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(11);
  });

  it('T8: position browsing never writes the slot binding (A4b)', async () => {
    adapter.setTabs([tab(10, 1, 0, true), tab(11, 1, 1)]);
    const spy = vi.spyOn(repo, 'setBinding');

    await service.positionNext(10);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});