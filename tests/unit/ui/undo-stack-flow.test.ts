/**
 * T7 — stack semantics close-out: the USER-VISIBLE PROMISE across both replay
 * mechanisms (U1 + U6 + U2 + U7).
 *
 * The point of the whole stack change is one sentence: "do two undoable things,
 * get two bars, and each bar undoes ITS OWN thing". These cases assert exactly
 * that, and that a mixed stack (a background action and a client action) keeps
 * the two replay mechanisms straight.
 *
 * The wiring into a real surface is Wave 3's job (T8–T10); here the "backend" is
 * a recorder, which is all that is needed to prove the stack reports the right
 * action — that a UI surface calls `push` per action is the surface's contract.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoStack, createUndoReplay } from '@ui/shared/undo-stack';
import type { UndoEntryInput } from '@ui/shared/undo-stack';

const background = (
  slotId: number,
  captureId: number,
): UndoEntryInput => ({
  replay: 'background',
  slotId,
  captureId,
  message: `Slot ${String(slotId)} overwritten`,
  expiresAt: Date.now() + 5000,
});

describe('T7: the user-visible promise — two actions, two bars, each its own', () => {
  it('two background actions → two bars; clicking the FIRST undoes the FIRST captureId', () => {
    const backend: Array<{ captureId: number }> = [];
    const send = vi.fn((action: string, payload?: unknown) => {
      if (action === 'UNDO_SAVE') backend.push(payload as { captureId: number });
      return Promise.resolve({ success: true });
    });
    const { result } = renderHook(() => useUndoStack({ onReplay: createUndoReplay(send) }));

    // Two SAVE_SLOT overwrites produce two captures, each pushed as its own bar.
    let firstId = '';
    let secondId = '';
    act(() => {
      firstId = result.current.push(background(3, 1001));
    });
    act(() => {
      secondId = result.current.push(background(3, 1002));
    });

    // One test file, one inner callback; void the unused binding explicitly.
    void secondId;
    expect(result.current.entries).toHaveLength(2);

    // Click the FIRST bar → the backend must receive the FIRST captureId.
    act(() => { result.current.consume(firstId); });

    expect(backend).toHaveLength(1);
    expect(backend[0].captureId).toBe(1001);
    // The second bar survives the first being consumed.
    expect(result.current.entries).toHaveLength(1);
  });

  it('a tag-delete (client) and an overwrite (background) coexist and replay correctly', () => {
    const calls: string[] = [];
    const send = vi.fn((action: string) => {
      calls.push(action);
      return Promise.resolve({ success: true });
    });
    const { result } = renderHook(() => useUndoStack({ onReplay: createUndoReplay(send) }));

    let bgId = '';
    let clientId = '';
    act(() => {
      bgId = result.current.push(background(7, 7001));
      clientId = result.current.push({
        replay: 'client',
        snapshot: {
          writes: [{ kind: 'tag-delete', tag: { id: 't1', name: 'n', backgroundColor: '#000', textColor: '#fff' }, refs: [] }],
          affectedTabIds: [],
        },
        message: 'Tag deleted',
        expiresAt: Date.now() + 5000,
      });
    });

    expect(result.current.entries).toHaveLength(2);

    // Replay the BACKGROUND one → one UNDO_SAVE.
    act(() => { result.current.consume(bgId); });
    expect(calls).toEqual(['UNDO_SAVE']);

    // Replay the CLIENT one → one RESTORE_TAG.
    act(() => { result.current.consume(clientId); });
    expect(calls).toEqual(['UNDO_SAVE', 'RESTORE_TAG']);
  });

  it('U2 + U7: with several live bars, expiring ONE leaves the rest undoable', () => {
    const backend: Array<{ captureId: number }> = [];
    const send = vi.fn((action: string, payload?: unknown) => {
      if (action === 'UNDO_SAVE') backend.push(payload as { captureId: number });
      return Promise.resolve({ success: true });
    });
    const { result } = renderHook(() => useUndoStack({ onReplay: createUndoReplay(send) }));

    let expiredId = '';
    let liveId = '';
    act(() => {
      expiredId = result.current.push(background(1, 11));
      liveId = result.current.push(background(2, 22));
      result.current.push(background(3, 33));
    });

    // One bar expires — the other two remain (U2), each still undoable (U7).
    act(() => { result.current.expire(expiredId); });
    expect(result.current.entries).toHaveLength(2);

    act(() => { result.current.consume(liveId); });
    expect(backend.map((b) => b.captureId)).toEqual([22]);
    expect(result.current.entries).toHaveLength(1);
  });
});
