/**
 * T11 — generalized UndoBar (IMP-6 / DT9): atomic restore, role semantics,
 * focus acquisition/return.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UndoBar } from '@ui/shared/undo-bar';
import type { UndoSnapshot } from '@ui/shared/undo-bar';

describe('T11: UndoBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const snapshot: UndoSnapshot = {
    writes: [
      { kind: 'tab-override', tabId: 1, title: 'T' },
      { kind: 'slot-marker', slotId: 5 },
      { kind: 'rule', ruleId: 'r1' },
    ],
    affectedTabIds: [1, 2],
  };

  it('uses role="status" (never alert + polite, CT3-g4)', () => {
    render(<UndoBar state={{ message: 'Cleared', snapshot, expiresAt: Date.now() + 5000 }} onUndo={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hands the WHOLE batch to onUndo in a single call (atomic, DT9)', async () => {
    vi.useRealTimers();
    const onUndo = vi.fn();
    const user = userEvent.setup();
    render(<UndoBar state={{ message: 'Cleared', snapshot, expiresAt: Date.now() + 5000 }} onUndo={onUndo} />);

    await user.click(screen.getByRole('button', { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith(snapshot);
    expect(onUndo.mock.calls[0][0].writes).toHaveLength(3);
  });

  it('takes focus on open so a keyboard user can undo immediately (CT3-g)', () => {
    render(<UndoBar state={{ message: 'Cleared', snapshot, expiresAt: Date.now() + 5000 }} onUndo={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /undo/i }));
  });

  it('expires and returns focus to the trigger (CT3-g1)', async () => {
    const onExpire = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const returnFocusRef = { current: trigger };

    render(
      <UndoBar
        state={{ message: 'Cleared', snapshot, expiresAt: Date.now() + 5000 }}
        onUndo={vi.fn()}
        onExpire={onExpire}
        returnFocusRef={returnFocusRef}
      />,
    );

    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(onExpire).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});