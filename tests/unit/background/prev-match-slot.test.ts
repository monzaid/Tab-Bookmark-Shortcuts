/**
 * Bug 3 (backend): prevMatchForSlot — reverse cycling for a slot.
 *
 * Mirrors nextMatchForSlot:
 * - index = (currentIndex - 1 + candidates.length) % candidates.length
 * - wrap-around from first to last candidate
 * - no binding update (binding keeps pointing at the pre-switch tab)
 * - empty candidates → no_match; unconfigured slot → SLOT_EMPTY
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { SlotService } from '@background/slot-service';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('Bug 3: prevMatchForSlot — reverse cycle for a specific slot', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: SlotService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const otherWindow: NormalizedWindow = { id: 2, focused: false, incognito: false, type: 'normal' };

  // Sort order after sortCandidates: current window by index, then other windows.
  // Expected candidate order: [tab 10 (win1 idx0), tab 11 (win1 idx2), tab 20 (win2)]
  const tabCurrentA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabCurrentB: NormalizedTab = { id: 11, windowId: 1, index: 2, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabOther: NormalizedTab = { id: 20, windowId: 2, index: 0, url: 'https://example.com/page', title: 'Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow, otherWindow]);
    adapter.setTabs([tabCurrentA, tabCurrentB, tabOther]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new SlotService(adapter, repo);
  });

  it('should wrap around to the LAST candidate when prev is called at cursor index 0', async () => {
    await service.saveSlot(1, 0);
    // Strategy-B switch initializes the cycle cursor at index 0 (tab 10)
    const sw = await service.switchSlot(1);
    expect(sw.success).toBe(true);

    const result = await service.prevMatchForSlot(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.outcome.type).toBe('switched');
      if (result.outcome.type === 'switched') {
        // (0 - 1 + 3) % 3 = 2 → tab 20 (last candidate)
        expect(result.outcome.tabId).toBe(20);
        expect(result.outcome.crossWindow).toBe(true);
      }
    }
  });

  it('should step backwards through candidates on repeated prev calls (same window = stable order)', async () => {
    // Same-window tabs only: candidate order [10, 11] stays stable across calls
    // (sort order depends on the current window — same semantics as nextMatchForSlot)
    adapter.setTabs([tabCurrentA, tabCurrentB]);
    await service.saveSlot(1, 0);
    await service.switchSlot(1); // cursor = 0

    const first = await service.prevMatchForSlot(1); // (0 - 1 + 2) % 2 = 1 → tab 11
    expect(first.success).toBe(true);
    if (first.success && first.outcome.type === 'switched') {
      expect(first.outcome.tabId).toBe(11);
    }

    const second = await service.prevMatchForSlot(1); // (1 - 1 + 2) % 2 = 0 → tab 10, full circle
    expect(second.success).toBe(true);
    if (second.success && second.outcome.type === 'switched') {
      expect(second.outcome.tabId).toBe(10);
    }
  });

  it('should update the cycle cursor backwards', async () => {
    await service.saveSlot(1, 0);
    await service.switchSlot(1);

    await service.prevMatchForSlot(1);

    const local = await repo.getLocalState();
    const cursor = local.cycleCursors.find((c) => c.slotId === 1);
    expect(cursor).toBeDefined();
    expect(cursor!.currentIndex).toBe(2);
  });

  it('should NOT update the slot binding (same contract as nextMatchForSlot)', async () => {
    await service.saveSlot(1, 0);

    const setBindingSpy = vi.spyOn(repo, 'setBinding');
    setBindingSpy.mockClear();

    const result = await service.prevMatchForSlot(1);
    expect(result.success).toBe(true);

    expect(setBindingSpy).not.toHaveBeenCalled();

    // Binding still points at the originally saved tab
    const local = await repo.getLocalState();
    const binding = local.bindings.find((b) => b.slotId === 1);
    expect(binding).toBeDefined();
    expect(binding!.tabId).toBe(10);

    setBindingSpy.mockRestore();
  });

  it('should record lastSuccessSlotId (same as nextMatchForSlot)', async () => {
    await service.saveSlot(1, 0);

    await service.prevMatchForSlot(1);

    const local = await repo.getLocalState();
    expect(local.lastSuccessSlotId).toBe(1);
  });

  it('should return no_match when there are no matching candidates', async () => {
    await service.saveSlot(1, 0);
    adapter.setTabs([]);

    const result = await service.prevMatchForSlot(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.outcome.type).toBe('no_match');
    }
  });

  it('should return SLOT_EMPTY for an unconfigured slot', async () => {
    const result = await service.prevMatchForSlot(9);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('SLOT_EMPTY');
    }
  });

  it('regression: nextMatchForSlot behavior is unchanged (forward cycle still works)', async () => {
    await service.saveSlot(1, 0);
    await service.switchSlot(1); // cursor = 0

    const result = await service.nextMatchForSlot(1);
    expect(result.success).toBe(true);
    if (result.success && result.outcome.type === 'switched') {
      expect(result.outcome.tabId).toBe(11); // (0 + 1) % 3 = 1
    }
  });
});
