/**
 * T2/T6 — the shared undo stack model and semantics (U4/U6/U7).
 *
 * Two claims are load-bearing and get their own cases:
 *   - `consume(id)` pops the entry the USER CLICKED, not the newest one ("undo
 *     the bar I pointed at" — U1);
 *   - the stack is UNBOUNDED (U7); entries are reclaimed only by expiry (U2).
 *
 * The `replay` discriminant is exercised for BOTH branches (U6): a `background`
 * entry replays as exactly ONE `UNDO_SAVE`, a `client` entry replays one message
 * per write — the two mechanisms coexist in one stack.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoStack, createUndoReplay, nextUndoEntryId } from '@ui/shared/undo-stack';
import type { UndoEntryInput } from '@ui/shared/undo-stack';
import type { UndoSnapshot } from '@ui/shared/undo-bar';

const backgroundEntry = (overrides: Partial<Extract<UndoEntryInput, { replay: 'background' }>> = {}): UndoEntryInput => ({
  replay: 'background',
  slotId: 1,
  captureId: 10,
  message: 'Slot 1 overwritten',
  expiresAt: Date.now() + 5000,
  ...overrides,
});

const clientEntry = (snapshot: UndoSnapshot, message = 'Cleared'): UndoEntryInput => ({
  replay: 'client',
  snapshot,
  message,
  expiresAt: Date.now() + 5000,
});

describe('T2: UndoEntry discriminant narrows correctly', () => {
  it('a background entry exposes slotId/captureId; a client entry exposes snapshot', () => {
    const onReplay = vi.fn();
    const { result } = renderHook(() => useUndoStack({ onReplay }));

    act(() => {
      result.current.push(backgroundEntry({ captureId: 7 }));
      result.current.push(clientEntry({ writes: [], affectedTabIds: [] }));
    });

    const [bg, client] = result.current.entries;
    if (bg.replay !== 'background') throw new Error('expected background');
    if (client.replay !== 'client') throw new Error('expected client');
    expect(bg.captureId).toBe(7);
    expect(client.snapshot.writes).toEqual([]);
  });
});

describe('T6: push / consume / expire / clear', () => {
  it('push 3 entries → entries.length === 3', () => {
    const { result } = renderHook(() => useUndoStack({ onReplay: vi.fn() }));
    act(() => {
      result.current.push(backgroundEntry({ captureId: 1 }));
      result.current.push(backgroundEntry({ captureId: 2 }));
      result.current.push(backgroundEntry({ captureId: 3 }));
    });
    expect(result.current.entries).toHaveLength(3);
  });

  it('consume(the SECOND id) removes only that entry, leaving the other two', () => {
    const onReplay = vi.fn();
    const { result } = renderHook(() => useUndoStack({ onReplay }));
    let secondId = '';
    act(() => {
      result.current.push(backgroundEntry({ captureId: 1 }));
      secondId = result.current.push(backgroundEntry({ captureId: 2 }));
      result.current.push(backgroundEntry({ captureId: 3 }));
    });

    act(() => { result.current.consume(secondId); });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries.map((e) => e.id)).not.toContain(secondId);
    // And the replayed entry is the SECOND one, not the newest.
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onReplay.mock.calls[0][0]).toMatchObject({ captureId: 2 });
  });

  it('expire(id) removes one entry and leaves the rest untouched', () => {
    const { result } = renderHook(() => useUndoStack({ onReplay: vi.fn() }));
    let thirdId = '';
    act(() => {
      result.current.push(backgroundEntry({ captureId: 1 }));
      result.current.push(backgroundEntry({ captureId: 2 }));
      thirdId = result.current.push(backgroundEntry({ captureId: 3 }));
    });

    act(() => { result.current.expire(thirdId); });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries.map((e) => e.id)).not.toContain(thirdId);
  });

  it('clear() empties the whole stack', () => {
    const { result } = renderHook(() => useUndoStack({ onReplay: vi.fn() }));
    act(() => {
      result.current.push(backgroundEntry({ captureId: 1 }));
      result.current.push(backgroundEntry({ captureId: 2 }));
    });
    act(() => { result.current.clear(); });
    expect(result.current.entries).toHaveLength(0);
  });

  it('U7: 20 pushes are all retained (no cap, no eviction)', () => {
    const { result } = renderHook(() => useUndoStack({ onReplay: vi.fn() }));
    act(() => {
      for (let i = 1; i <= 20; i += 1) result.current.push(backgroundEntry({ captureId: i }));
    });
    expect(result.current.entries).toHaveLength(20);
  });

  it('assigns distinct ids and never reuses one', () => {
    const idA = nextUndoEntryId();
    const idB = nextUndoEntryId();
    expect(idA).not.toBe(idB);
  });
});

describe('T6/U6: the two replay mechanisms produce the right calls', () => {
  it('background consume → exactly ONE undoSave with its captureId', () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    const replay = createUndoReplay(send);
    const { result } = renderHook(() => useUndoStack({ onReplay: replay }));

    let id = '';
    act(() => { id = result.current.push(backgroundEntry({ slotId: 4, captureId: 44 })); });
    act(() => { result.current.consume(id); });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('UNDO_SAVE', { slotId: 4, captureId: 44 });
  });

  it('client consume → one message per write (N calls for N writes)', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    const replay = createUndoReplay(send);
    const { result } = renderHook(() => useUndoStack({ onReplay: replay }));

    const snapshot: UndoSnapshot = {
      writes: [
        { kind: 'tab-override', tabId: 1, title: 'T' },
        { kind: 'slot-marker', slotId: 5 },
      ],
      affectedTabIds: [1],
    };
    let id = '';
    act(() => { id = result.current.push(clientEntry(snapshot)); });
    await act(async () => { await Promise.resolve(); result.current.consume(id); });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'SET_TAB_OVERRIDE', { tabId: 1, title: 'T' });
    expect(send).toHaveBeenNthCalledWith(2, 'UPDATE_SLOT_UI_MARKER', {
      slotId: 5,
      uiMarker: {},
    });
  });

  it('client replay covers the tag writes (RESTORE_TAG / SET_RULE_TAGS)', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    const replay = createUndoReplay(send);
    const { result } = renderHook(() => useUndoStack({ onReplay: replay }));

    const snapshot: UndoSnapshot = {
      writes: [
        { kind: 'tag-delete', tag: { id: 't1', name: 'n', backgroundColor: '#000', textColor: '#fff' }, refs: [] },
        { kind: 'rule-tags', ruleId: 'r1', previousTagIds: ['t1'] },
      ],
      affectedTabIds: [],
    };
    let id = '';
    act(() => { id = result.current.push(clientEntry(snapshot)); });
    await act(async () => { await Promise.resolve(); result.current.consume(id); });

    expect(send).toHaveBeenNthCalledWith(1, 'RESTORE_TAG', expect.objectContaining({ refs: [] }));
    expect(send).toHaveBeenNthCalledWith(2, 'SET_RULE_TAGS', { ruleId: 'r1', tagIds: ['t1'] });
  });
});

/**
 * The disabled button is only the VISIBLE half of the ordering rule.
 *
 * `consume` is reachable by more than a click — a keyboard activation, a stale
 * closure, or a direct call — and the data corruption does not care how the
 * request arrived. So the RULE is enforced in the stack, not only in the UI.
 */
describe('undo ordering is enforced in the STACK, not just the button', () => {
  it('consume REFUSES an older entry that a newer related one depends on', () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    const replay = createUndoReplay(send);
    const { result } = renderHook(() => useUndoStack({ onReplay: replay }));

    let first = '';
    let second = '';
    act(() => {
      // s1↔s2 then s2↔s3 — they share slot 2.
      first = result.current.push({ replay: 'background', slotId: 1, slotIds: [1, 2], captureId: 1001, message: 'swap 1-2', expiresAt: Date.now() + 5000 });
      second = result.current.push({ replay: 'background', slotId: 2, slotIds: [2, 3], captureId: 1002, message: 'swap 2-3', expiresAt: Date.now() + 5000 });
    });

    expect([...result.current.blocked]).toEqual([first]);

    // Attempting the blocked one changes NOTHING: no message, still on the stack.
    act(() => { result.current.consume(first); });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(2);

    // The newest is still actionable, popping the dependency…
    act(() => { result.current.consume(second); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('UNDO_SAVE', { slotId: 2, captureId: 1002 });

    // …after which the older entry becomes actionable.
    expect([...result.current.blocked]).toEqual([]);
    act(() => { result.current.consume(first); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('UNDO_SAVE', { slotId: 1, captureId: 1001 });
  });

  it('does NOT block unrelated single-slot overwrites of different slots', () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    const replay = createUndoReplay(send);
    const { result } = renderHook(() => useUndoStack({ onReplay: replay }));

    let a = '';
    act(() => {
      a = result.current.push({ replay: 'background', slotId: 1, captureId: 11, message: 'slot 1', expiresAt: Date.now() + 5000 });
      result.current.push({ replay: 'background', slotId: 5, captureId: 55, message: 'slot 5', expiresAt: Date.now() + 5000 });
    });

    expect([...result.current.blocked]).toEqual([]);
    act(() => { result.current.consume(a); });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
