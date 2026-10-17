/**
 * T1 — the pendingUndo STACK (U5 / Z1).
 *
 * The key's value lives in its own `storage.local` key (NOT inside `LocalState`),
 * and its SHAPE changed from one snapshot to an array of them (U5). The tests
 * below pin three properties the rest of the feature depends on:
 *   1. appending really appends (two captures → two entries, not one);
 *   2. a legacy single-object archive is tolerated as a one-element stack;
 *   3. Z1 — a `swap` entry carries BOTH slots' snapshots intact, which is the
 *      whole point of making the snapshot a discriminated union.
 *
 * A `LocalState` key-set assertion guards the isolation invariant: the stack must
 * stay OUT of `LocalState` (its `writeLocal` strip invariant would otherwise be
 * violated — revision §1.6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import type { PendingUndoSnapshot } from '@background/storage-repository';
import type { SlotDefinition, SlotBinding } from '@shared/types';

const slot = (id: number, url: string): SlotDefinition => ({
  id,
  urlMatch: { type: 'exact', value: url },
  strategy: 'inherit',
  uiMarker: {},
  titleSnapshot: `Title ${String(id)}`,
  faviconSnapshot: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const binding = (slotId: number, tabId: number): SlotBinding => ({
  slotId,
  tabId,
  windowId: 1,
  boundAt: '2026-01-01T00:00:00Z',
});

const single = (override: Partial<Extract<PendingUndoSnapshot, { kind: 'single' }>> = {}): PendingUndoSnapshot => ({
  kind: 'single',
  id: 's1',
  slotId: 1,
  captureId: 101,
  slotSnapshot: slot(1, 'https://one.example'),
  bindingSnapshot: null,
  expiresAt: Date.now() + 5000,
  ...override,
});

describe('T1: pendingUndo is a single-key STACK (U5)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(() => {
    adapter.reset();
    repo = new StorageRepository(adapter);
  });

  it('two setPendingUndo calls yield TWO readable entries (not one)', async () => {
    await repo.setPendingUndo(single({ id: 's1', slotId: 1, captureId: 101 }));
    await repo.setPendingUndo(single({ id: 's2', slotId: 2, captureId: 102, slotSnapshot: slot(2, 'https://two.example') }));

    const stack = await repo.getPendingUndo();
    expect(stack).toHaveLength(2);
    expect(stack.map((e) => e.captureId).sort()).toEqual([101, 102]);
  });

  it('getPendingUndo(captureId) returns exactly that entry', async () => {
    await repo.setPendingUndo(single({ id: 's1', captureId: 101 }));
    await repo.setPendingUndo(single({ id: 's2', slotId: 2, captureId: 102 }));

    const found = await repo.getPendingUndo(102);
    expect(found).not.toBeNull();
    expect(found?.captureId).toBe(102);
    expect(await repo.getPendingUndo(999)).toBeNull();
  });

  it('tolerates a LEGACY single-object archive (no kind/id) as a one-element stack', async () => {
    // Written straight into the mock's local area (bypasses our writers) so the
    // read path sees the pre-U5 shape: a bare object, no `kind`, no `id`.
    adapter.state.localStorage['pendingUndo'] = {
      slotId: 3,
      captureId: 7,
      slotSnapshot: slot(3, 'https://legacy.example'),
      bindingSnapshot: null,
      expiresAt: Date.now() + 5000,
    };

    const stack = await repo.getPendingUndo();
    expect(stack).toHaveLength(1);
    expect(stack[0].kind).toBe('single');
    expect(await repo.getPendingUndo(7)).toMatchObject({ kind: 'single', slotId: 3 });
  });

  it('Z1: a swap entry carries BOTH slots\' snapshots and bindings intact', async () => {
    const swap: PendingUndoSnapshot = {
      kind: 'swap',
      id: 'w1',
      captureId: 500,
      sourceSlotId: 3,
      targetSlotId: 7,
      sourceSnapshot: slot(3, 'https://three.example'),
      sourceBinding: binding(3, 30),
      targetSnapshot: slot(7, 'https://seven.example'),
      targetBinding: binding(7, 70),
      expiresAt: Date.now() + 5000,
    };
    await repo.setPendingUndo(swap);

    const read = await repo.getPendingUndo(500);
    expect(read?.kind).toBe('swap');
    if (read?.kind !== 'swap') throw new Error('expected a swap entry');
    expect(read.sourceSnapshot?.urlMatch.value).toBe('https://three.example');
    expect(read.targetSnapshot?.urlMatch.value).toBe('https://seven.example');
    expect(read.sourceBinding?.tabId).toBe(30);
    expect(read.targetBinding?.tabId).toBe(70);
  });

  it('keeps the snapshot OUT of LocalState (own key, not inside the state)', async () => {
    await repo.initialize();
    await repo.setPendingUndo(single());

    // The stack lives under its own key — never inside `LocalState`, whose
    // `writeLocal` strip invariant would otherwise be violated (revision §1.6).
    expect('pendingUndo' in adapter.state.localStorage).toBe(true);
    const localState = adapter.state.localStorage['localState'] as Record<string, unknown> | undefined;
    if (localState !== undefined) {
      expect('pendingUndo' in localState).toBe(false);
      expect('slotSnapshot' in localState).toBe(false);
    }
  });
});

/**
 * F4 finding — the array shape introduced a read-modify-write race.
 *
 * `setPendingUndo` reads the stack, pushes, and writes it back. With a SINGLE
 * snapshot stored, two overlapping captures could not lose anything (both wrote
 * the same key with their own object). With an ARRAY, whichever write lands last
 * wins and the other entry vanishes — a silently lost undo bar.
 *
 * The mock adapter resolves synchronously, so the race cannot appear by luck. It
 * must be FORCED, and the interleaving has to be the LOSING one: both reads must
 * complete before either write. Delaying a `get` does NOT achieve that (the
 * second read would simply observe the first write, and nothing is lost — this
 * was verified by removing the queue and watching the test still pass). Holding
 * the first `set` open does: read(a)=[] , read(b)=[] , write(b)=[b] , write(a)=[a]
 * — b is gone. With the serial queue, the second capture's read happens after the
 * first write, so it appends instead of overwriting.
 */
describe('F4: concurrent captures must not discard each other', () => {
  it('two overlapping setPendingUndo calls both survive', async () => {
    const adapter = createMockAdapter();
    const repo = new StorageRepository(adapter);
    await repo.initialize();

    const realSet = adapter.storage.set.bind(adapter.storage);
    let held = 0;
    // Hold the FIRST write, so the second capture reads before the first write
    // lands — the interleaving that loses an entry.
    adapter.storage.set = async (area, items) => {
      if (held === 0) {
        held++;
        await new Promise((resolve) => { setTimeout(resolve, 10); });
      }
      return realSet(area, items);
    };

    const first = repo.setPendingUndo(single({ captureId: 501, id: 'a' }));
    const second = repo.setPendingUndo(single({ captureId: 502, id: 'b' }));
    await Promise.all([first, second]);

    const stack = await repo.getPendingUndo();
    expect(stack.map((e) => e.captureId).sort((a, b) => a - b)).toEqual([501, 502]);
  });

  it('a cleanup cannot interleave with a capture and drop the fresh entry', async () => {
    const adapter = createMockAdapter();
    const repo = new StorageRepository(adapter);
    await repo.initialize();

    await repo.setPendingUndo(single({ captureId: 601, id: 'old' }));

    const realSet = adapter.storage.set.bind(adapter.storage);
    let held = 0;
    adapter.storage.set = async (area, items) => {
      if (held === 0) {
        held++;
        await new Promise((resolve) => { setTimeout(resolve, 10); });
      }
      return realSet(area, items);
    };

    // The clear must not clobber the capture that is being appended alongside it.
    const clear = repo.clearPendingUndo(1, 601);
    const add = repo.setPendingUndo(single({ captureId: 602, id: 'new' }));
    await Promise.all([clear, add]);

    const stack = await repo.getPendingUndo();
    expect(stack.map((e) => e.captureId)).toEqual([602]);
  });
});
