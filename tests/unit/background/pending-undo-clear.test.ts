/**
 * T4 — `clearPendingUndo` filters instead of deleting the whole key (U5).
 *
 * This is the hardest existing assumption in the whole change: the key used to be
 * removed unconditionally, so with a stack ANY one entry's cleanup timer (or any
 * one undo) would destroy every other entry's still-valid undo. The tests pin
 * that a clear removes exactly the matching entry and never touches the rest —
 * including the T34 case (two captures of the SAME slot, different captureId).
 *
 * A `swap` entry has no `slotId`, so ownership falls back to the globally unique
 * `captureId`; that is the `clearPendingUndo(undefined, captureId)` path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import type { PendingUndoSnapshot } from '@background/storage-repository';
import type { SlotDefinition } from '@shared/types';

const slot = (id: number): SlotDefinition => ({
  id,
  urlMatch: { type: 'exact', value: `https://s${String(id)}.example` },
  strategy: 'inherit',
  uiMarker: {},
  titleSnapshot: `Title ${String(id)}`,
  faviconSnapshot: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const single = (
  override: Partial<Extract<PendingUndoSnapshot, { kind: 'single' }>>,
): PendingUndoSnapshot => ({
  kind: 'single',
  id: 'x',
  slotId: 1,
  captureId: 1,
  slotSnapshot: slot(1),
  bindingSnapshot: null,
  expiresAt: Date.now() + 5000,
  ...override,
});

describe('T4: clearPendingUndo removes ONE entry, never the whole stack', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(() => {
    adapter.reset();
    repo = new StorageRepository(adapter);
  });

  it('two entries on DIFFERENT slots: clearing one leaves the other intact', async () => {
    await repo.setPendingUndo(single({ id: 'a', slotId: 1, captureId: 11 }));
    await repo.setPendingUndo(single({ id: 'b', slotId: 2, captureId: 22, slotSnapshot: slot(2) }));

    await repo.clearPendingUndo(1, 11);

    const stack = await repo.getPendingUndo();
    expect(stack).toHaveLength(1);
    expect(stack[0].captureId).toBe(22);
  });

  it('T34: two captures of the SAME slot: clearing the old capture keeps the newer', async () => {
    await repo.setPendingUndo(single({ id: 'old', slotId: 1, captureId: 100 }));
    await repo.setPendingUndo(single({ id: 'new', slotId: 1, captureId: 200 }));

    await repo.clearPendingUndo(1, 100);

    const stack = await repo.getPendingUndo();
    expect(stack).toHaveLength(1);
    expect(stack[0].captureId).toBe(200);
  });

  it('the LAST entry being cleared removes the KEY (no empty-array residue)', async () => {
    await repo.setPendingUndo(single({ id: 'only', slotId: 1, captureId: 5 }));
    await repo.clearPendingUndo(1, 5);

    expect(await repo.getPendingUndo()).toEqual([]);
    // The key itself is gone — an empty array must not linger.
    expect('pendingUndo' in adapter.state.localStorage).toBe(false);
  });

  it('a clear that matches nothing leaves the stack untouched', async () => {
    await repo.setPendingUndo(single({ id: 'a', slotId: 1, captureId: 11 }));
    await repo.clearPendingUndo(9, 999);
    expect(await repo.getPendingUndo()).toHaveLength(1);
  });

  it('a swap entry (no slotId) is cleared by its global captureId', async () => {
    await repo.setPendingUndo(single({ id: 'a', slotId: 1, captureId: 11 }));
    await repo.setPendingUndo({
      kind: 'swap',
      id: 'w',
      captureId: 42,
      sourceSlotId: 3,
      targetSlotId: 7,
      sourceSnapshot: slot(3),
      sourceBinding: null,
      targetSnapshot: slot(7),
      targetBinding: null,
      expiresAt: Date.now() + 5000,
    });

    await repo.clearPendingUndo(3, 42);

    const stack = await repo.getPendingUndo();
    expect(stack).toHaveLength(1);
    expect(stack[0].captureId).toBe(11);
  });

  it('an EXPIRED entry is dropped on read while its neighbours survive', async () => {
    await repo.setPendingUndo(single({ id: 'expired', slotId: 1, captureId: 1, expiresAt: Date.now() - 1 }));
    await repo.setPendingUndo(single({ id: 'live', slotId: 2, captureId: 2, slotSnapshot: slot(2) }));

    const stack = await repo.getPendingUndo();
    expect(stack).toHaveLength(1);
    expect(stack[0].captureId).toBe(2);
  });
});
