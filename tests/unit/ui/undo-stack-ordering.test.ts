/**
 * Undo ORDER — the reported duplication defect.
 *
 * The user's scenario, with initial `s1=X, s2=Y, s3=Z`:
 *   1. swap s1↔s2   → s1=Y, s2=X, s3=Z
 *   2. swap s2↔s3   → s1=Y, s2=Z, s3=X
 *   3. undo (1)     → s1=X, s2=Y, s3=X
 *   4. undo (2)     → s1=X, s2=X, s3=Z   ← s2 now holds s1's original data
 *
 * Step 4 is the bug: snapshot (2) was captured from the state step (1) left
 * behind, so applying (1) first makes (2) write stale content back. Undo is only
 * sound in LIFO order, and the stack must therefore refuse to let a RELATED entry
 * be undone before the newer one.
 *
 * This file tests the RULE (which entries are blocked), not the pixels.
 */
import { describe, it, expect } from 'vitest';
import { computeBlockedIds } from '@ui/shared/undo-stack';
import type { UndoEntry } from '@ui/shared/undo-stack';

const swap = (id: string, a: number, b: number): UndoEntry => ({
  id,
  replay: 'background',
  slotId: a,
  slotIds: [a, b],
  captureId: Number(id),
  message: `Slots ${String(a)} and ${String(b)} swapped`,
  expiresAt: Date.now() + 5000,
});

const overwrite = (id: string, slotId: number): UndoEntry => ({
  id,
  replay: 'background',
  slotId,
  captureId: Number(id),
  message: `Slot ${String(slotId)} overwritten`,
  expiresAt: Date.now() + 5000,
});

/** A `client` entry: no slot footprint, so it can never go stale against one. */
const tagEntry = (id: string): UndoEntry => ({
  id,
  replay: 'client',
  snapshot: { writes: [], affectedTabIds: [] },
  message: 'Tag deleted',
  expiresAt: Date.now() + 5000,
});

describe('undo ordering — the reported scenario', () => {
  it('THE REPORTED BUG: blocks the older of two swaps that share a slot', () => {
    // s1↔s2 then s2↔s3 — they share slot 2.
    const entries = [swap('1', 1, 2), swap('2', 2, 3)];
    const blocked = computeBlockedIds(entries);

    // Only the OLDER one is blocked; the newest stays actionable.
    expect(blocked.has('1')).toBe(true);
    expect(blocked.has('2')).toBe(false);
  });

  it('leaves UNRELATED swaps untouched — order does not matter between them', () => {
    // s1↔s2 then s3↔s4: disjoint, so both are safe to undo in any order.
    const entries = [swap('1', 1, 2), swap('2', 3, 4)];
    const blocked = computeBlockedIds(entries);
    expect([...blocked]).toEqual([]);
  });

  it('is TRANSITIVE across a chain (A·B·C on s1..s4)', () => {
    // A(s1,s2) · B(s2,s3) · C(s3,s4): A and B must BOTH be blocked.
    // Blocking only the directly-overlapping one would still let B run before C,
    // duplicating s3's content — the same defect one step along.
    const entries = [swap('A', 1, 2), swap('B', 2, 3), swap('C', 3, 4)];
    const blocked = computeBlockedIds(entries);
    expect(blocked.has('A')).toBe(true);
    expect(blocked.has('B')).toBe(true);
    expect(blocked.has('C')).toBe(false);
  });

  it('does NOT block a single-slot overwrite — even of a slot a swap later moved', () => {
    // Narrowing found by dogfooding: two successive overwrites of the same slot
    // are self-contained whole-slot replacements, so undoing the older one first
    // restores a coherent earlier state. Blocking them (the first version of this
    // rule) broke the stack's own "undo the older of two writes" interaction.
    const entries = [overwrite('old', 2), swap('new', 2, 3)];
    const blocked = computeBlockedIds(entries);
    expect(blocked.has('old')).toBe(false);
    expect(blocked.has('new')).toBe(false);
  });

  it('does NOT block two successive overwrites of the SAME slot', () => {
    const entries = [overwrite('first', 1), overwrite('second', 1)];
    expect([...computeBlockedIds(entries)]).toEqual([]);
  });

  it('blocks an older swap whose SECOND slot a newer one reuses', () => {
    // s1↔s2 then s2↔s3 share slot 2 — the case a `slotId`-only rule would MISS,
    // because entry 2's `slotId` is 2 and entry 1's is 1.
    const entries = [swap('1', 1, 2), swap('2', 2, 3)];
    expect(computeBlockedIds(entries).has('1')).toBe(true);
  });

  it('never blocks tag/rule entries — they carry no slot footprint', () => {
    // A tag mutation cannot go stale against a slot write, and vice versa.
    const entries = [tagEntry('tag'), swap('sw', 1, 2)];
    const blocked = computeBlockedIds(entries);
    expect(blocked.has('tag')).toBe(false);
    expect(blocked.has('sw')).toBe(false);
  });

  it('blocks EXACTLY the older swap in the reported pair', () => {
    const entries = [swap('A', 1, 2), swap('B', 2, 3)];
    expect([...computeBlockedIds(entries)]).toEqual(['A']);
  });

  it('unblocks the older entry once the newer one is gone', () => {
    // Undoing (or expiring) the newer entry removes the dependency, so the older
    // one becomes actionable again — the rule is not a permanent lock.
    const entries = [swap('1', 1, 2), swap('2', 2, 3)];
    expect(computeBlockedIds(entries).has('1')).toBe(true);
    expect(computeBlockedIds([entries[0]]).has('1')).toBe(false);
  });

  it('handles an empty stack', () => {
    expect([...computeBlockedIds([])]).toEqual([]);
  });
});
