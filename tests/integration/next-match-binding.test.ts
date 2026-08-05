/**
 * Bug 2: Next-match switching for a specific slot must NOT rebind the slot's
 * binding.tabId to the switched-to tab. The binding created by saveSlot (the
 * pre-switch tabId) must remain unchanged.
 *
 * The normal switch path (switchSlot / saveSlot) still updates bindings —
 * that behavior is asserted here as a regression guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { SlotService } from '@background/slot-service';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('Bug 2: nextMatchForSlot must not update slot binding tabId', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: SlotService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const otherWindow: NormalizedWindow = { id: 2, focused: false, incognito: false, type: 'normal' };

  const tabCurrentA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example A', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabCurrentB: NormalizedTab = { id: 11, windowId: 1, index: 2, url: 'https://example.com/page', title: 'Example B', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabOther: NormalizedTab = { id: 20, windowId: 2, index: 0, url: 'https://example.com/page', title: 'Example Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow, otherWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new SlotService(adapter, repo);
  });

  it('should keep the original binding.tabId after nextMatchForSlot switches to another tab', async () => {
    adapter.setTabs([tabCurrentA, tabCurrentB, tabOther]);
    await service.saveSlot(1, 0);

    // Pre-switch binding points at tab 10 (the saved tab)
    let local = await repo.getLocalState();
    const originalBinding = local.bindings.find((b) => b.slotId === 1);
    expect(originalBinding).toBeDefined();
    expect(originalBinding!.tabId).toBe(10);

    // Normal switch (strategy B) initializes the cycle cursor at index 0 (tab 10).
    // The next call to nextMatchForSlot will advance to a DIFFERENT candidate.
    const switchResult = await service.switchSlot(1);
    expect(switchResult.success).toBe(true);

    // Spy on setBinding — nextMatchForSlot must NOT call it
    const setBindingSpy = vi.spyOn(repo, 'setBinding');
    setBindingSpy.mockClear();

    // Next-match switches to a different candidate (tab 11, index 2)
    const result = await service.nextMatchForSlot(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.outcome.type).toBe('switched');
      if (result.outcome.type === 'switched') {
        expect(result.outcome.tabId).not.toBe(10); // actually switched away
      }
    }

    // setBinding must NOT have been called during nextMatchForSlot
    expect(setBindingSpy).not.toHaveBeenCalled();

    // Binding must remain on the ORIGINAL tabId (10), not the switch target
    local = await repo.getLocalState();
    const binding = local.bindings.find((b) => b.slotId === 1);
    expect(binding).toBeDefined();
    expect(binding!.tabId).toBe(10);
    expect(binding!.tabId).toBe(originalBinding!.tabId);

    setBindingSpy.mockRestore();
  });

  it('should still update cycle cursor on nextMatchForSlot', async () => {
    adapter.setTabs([tabCurrentA, tabCurrentB, tabOther]);
    await service.saveSlot(1, 0);

    const result = await service.nextMatchForSlot(1);
    expect(result.success).toBe(true);

    const local = await repo.getLocalState();
    const cursor = local.cycleCursors.find((c) => c.slotId === 1);
    expect(cursor).toBeDefined();
    expect(cursor!.candidateTabIds).toEqual(expect.arrayContaining([11]));
  });

  it('should record lastSuccessSlotId on nextMatchForSlot (no binding side effects)', async () => {
    adapter.setTabs([tabCurrentA, tabCurrentB, tabOther]);
    await service.saveSlot(1, 0);

    await service.nextMatchForSlot(1);

    const local = await repo.getLocalState();
    expect(local.lastSuccessSlotId).toBe(1);
  });

  // Regression guard: the normal switch path MUST keep updating bindings.
  it('regression: switchSlot full-search path still updates binding', async () => {
    adapter.setTabs([tabCurrentA]);
    await service.saveSlot(1, 0);

    // Remove the bound tab so strategy B falls through to full search
    adapter.setTabs([tabOther]);

    const result = await service.switchSlot(1);
    expect(result.success).toBe(true);
    if (result.success && result.outcome.type === 'switched') {
      expect(result.outcome.tabId).toBe(20);
    }

    const local = await repo.getLocalState();
    const binding = local.bindings.find((b) => b.slotId === 1);
    expect(binding).toBeDefined();
    expect(binding!.tabId).toBe(20); // normal switch still rebinds
  });
});
