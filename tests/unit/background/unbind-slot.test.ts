/**
 * TDD RED→GREEN: unbindSlot must remove BOTH the local binding AND the sync slot definition.
 * Problem 1: ✕ button appears to do nothing because only the binding is removed.
 *
 * B3 (T2): unbindSlot must return and propagate the RemoveSlot WriteResult instead of
 * silently discarding it — a failed sync removal must not be reported as success.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { SlotService } from '@background/slot-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('unbindSlot — full reset (Problem 1)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: SlotService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab: NormalizedTab = {
    id: 10, windowId: 1, index: 0,
    url: 'https://example.com/page', title: 'Example', favIconUrl: '',
    active: true, incognito: false, status: 'complete',
  };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([tab]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new SlotService(adapter, repo);
  });

  it('should remove slot definition from sync storage on unbind', async () => {
    // Save slot 3
    const saveResult = await service.saveSlot(3, 0);
    expect(saveResult.success).toBe(true);

    // Verify slot exists in sync
    let sync = await repo.getSyncState();
    expect(sync.slots.find((s) => s.id === 3)).toBeDefined();

    // Unbind
    await service.unbindSlot(3);

    // Slot definition must be gone from sync
    sync = await repo.getSyncState();
    expect(sync.slots.find((s) => s.id === 3)).toBeUndefined();
  });

  it('should remove local binding on unbind', async () => {
    await service.saveSlot(3, 0);

    let local = await repo.getLocalState();
    expect(local.bindings.find((b) => b.slotId === 3)).toBeDefined();

    await service.unbindSlot(3);

    local = await repo.getLocalState();
    expect(local.bindings.find((b) => b.slotId === 3)).toBeUndefined();
  });

  it('should be idempotent — unbinding an empty slot does not throw', async () => {
    await expect(service.unbindSlot(7)).resolves.not.toThrow();
  });

  // ─── B3 (T2): WriteResult propagation ────────────────────────────────────
  it('B3: should return a failed WriteResult when the sync removal fails', async () => {
    const saveResult = await service.saveSlot(3, 0);
    expect(saveResult.success).toBe(true);

    const originalSet = adapter.storage.set;
    try {
      // Fail ONLY the sync area — removeBinding (local) still succeeds.
      adapter.storage.set = async (area, items) => {
        if (area === 'sync') {
          throw new Error('QUOTA_BYTES exceeded');
        }
        return originalSet(area, items);
      };

      const result = await service.unbindSlot(3);
      expect(result).toMatchObject({ success: false, errorCode: 'BROWSER_API_ERROR' });
    } finally {
      adapter.storage.set = originalSet;
    }
  });

  it('B3: UNBIND_SLOT message must report success:false when the sync removal fails', async () => {
    const worker = new WorkerOrchestrator(adapter);
    await worker.initialize();

    const saveResult = await worker.slotService.saveSlot(3, 0);
    expect(saveResult.success).toBe(true);

    const originalSet = adapter.storage.set;
    let response: { success: boolean } | undefined;
    try {
      adapter.storage.set = async (area, items) => {
        if (area === 'sync') {
          throw new Error('QUOTA_BYTES exceeded');
        }
        return originalSet(area, items);
      };

      response = (await (
        worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }
      ).routeMessage({ requestId: 'unbind-fail', action: 'UNBIND_SLOT', payload: { slotId: 3 } }, {})) as {
        success: boolean;
      };
    } finally {
      adapter.storage.set = originalSet;
    }

    expect(response.success).toBe(false);
  });

  it('B3: happy path still returns success:true', async () => {
    await service.saveSlot(3, 0);
    const result = await service.unbindSlot(3);
    expect(result).toMatchObject({ success: true });
  });
});
