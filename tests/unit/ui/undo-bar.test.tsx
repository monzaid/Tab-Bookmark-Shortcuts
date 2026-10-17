/**
 * T11 — generalized UndoBar (IMP-6 / DT9): atomic restore, role semantics,
 * focus acquisition/return.
 *
 * T5 (U1/U2): the bar is now a STACK — several bars render at once, each with
 * its own Undo button and its own countdown. These cases extend (and adapt) the
 * T11 ones to that shape.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UndoBar } from '@ui/shared/undo-bar';
import type { UndoBarEntry } from '@ui/shared/undo-bar';

/** Controlled harness — mirrors how the real stack drives the bar. */
function Harness({ initial, blocked }: { initial: UndoBarEntry[]; blocked?: string[] }) {
  const [entries, setEntries] = useState(initial);
  const onExpire = vi.fn((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  });
  window.__lastExpire = onExpire;
  return (
    <UndoBar
      entries={entries}
      blockedIds={new Set(blocked ?? [])}
      onUndo={(id) => { setEntries((prev) => prev.filter((e) => e.id !== id)); }}
      onExpire={onExpire}
    />
  );
}

declare global {
  interface Window { __lastExpire?: ReturnType<typeof vi.fn>; }
}

describe('T11/T5: UndoBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.__lastExpire;
  });

  const entry = (id: string, expiresAt: number): UndoBarEntry => ({
    id,
    message: `Cleared ${id}`,
    expiresAt,
  });

  it('uses role="status" (never alert + polite, CT3-g4)', () => {
    render(<UndoBar entries={[entry('a', Date.now() + 5000)]} onUndo={vi.fn()} onExpire={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes focus on open so a keyboard user can undo immediately (CT3-g)', () => {
    render(<UndoBar entries={[entry('a', Date.now() + 5000)]} onUndo={vi.fn()} onExpire={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /undo/i }));
  });

  it('U1: renders ONE Undo button per entry and calls onUndo with THAT entry id', async () => {
    vi.useRealTimers();
    const onUndo = vi.fn();
    const user = userEvent.setup();
    render(
      <UndoBar
        entries={[entry('first', Date.now() + 5000), entry('second', Date.now() + 5000)]}
        onUndo={onUndo}
        onExpire={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: /undo/i });
    expect(buttons).toHaveLength(2);

    // Click the FIRST bar — it must report its own id, not "the newest".
    await user.click(buttons[0]);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith('first');
  });

  it('U2: each entry expires on its OWN deadline, leaving the others intact', async () => {
    const now = Date.now();
    render(<Harness initial={[entry('soon', now + 1000), entry('late', now + 2000)]} />);
    expect(screen.getAllByRole('button', { name: /undo/i })).toHaveLength(2);

    await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(1000); });
    // The first entry's own timer fired and removed only itself.
    const remainingMessages = screen.getAllByRole('status').map((n) => n.textContent);
    expect(remainingMessages.some((t) => t.includes('late'))).toBe(true);
    expect(remainingMessages.some((t) => t.includes('soon'))).toBe(false);
    expect(screen.getAllByRole('button', { name: /undo/i })).toHaveLength(1);
  });

  it('returns focus to the trigger when the last bar disappears (CT3-g1)', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const returnFocusRef = { current: trigger };

    function FocusHarness() {
      const [entries, setEntries] = useState([entry('a', Date.now() + 5000)]);
      return (
        <UndoBar
          entries={entries}
          onUndo={(id) => { setEntries((prev) => prev.filter((e) => e.id !== id)); }}
          onExpire={(id) => { setEntries((prev) => prev.filter((e) => e.id !== id)); }}
          returnFocusRef={returnFocusRef}
        />
      );
    }

    render(<FocusHarness />);
    // The bar took focus on open...
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /undo/i }));

    // ...and hands it back to the trigger once the bar expires away.
    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

/**
 * Ordering: a blocked Undo is DISABLED, and says why.
 *
 * A greyed-out control with no explanation is indistinguishable from a bug, so the
 * bar pairs the disabled button with a reason. (The rule itself lives in the stack
 * and is tested in `undo-stack-ordering.test.ts` / `undo-stack.test.ts`.)
 */
describe('UndoBar — blocked entries', () => {
  it('disables a blocked Undo and explains it, leaving the newest usable', () => {
    render(
      <Harness
        blocked={['old']}
        initial={[
          { id: 'old', message: 'Slots 1 and 2 swapped', expiresAt: Date.now() + 5000 },
          { id: 'new', message: 'Slots 2 and 3 swapped', expiresAt: Date.now() + 5000 },
        ]}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: /undo/i });
    expect(buttons).toHaveLength(2);
    // Oldest first (U1), so buttons[0] is the blocked one.
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
    // The reason is present, not just the grey.
    expect(screen.getByText(/undo a later swap first/i)).toBeInTheDocument();
  });

  it('does not focus a DISABLED button (a disabled element cannot take focus)', async () => {
    render(
      <Harness
        blocked={['old']}
        initial={[
          { id: 'old', message: 'Slots 1 and 2 swapped', expiresAt: Date.now() + 5000 },
          { id: 'new', message: 'Slots 2 and 3 swapped', expiresAt: Date.now() + 5000 },
        ]}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    const buttons = screen.getAllByRole('button', { name: /undo/i });
    expect(buttons[0]).toBeDisabled();
    // Focus must land on the newest ACTIONABLE bar, not silently stay on <body>.
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('renders no hint when nothing is blocked', () => {
    render(<Harness initial={[{ id: 'only', message: 'Slots 1 and 2 swapped', expiresAt: Date.now() + 5000 }]} />);
    expect(screen.queryByText(/undo a later swap first/i)).toBeNull();
    expect(screen.getByRole('button', { name: /undo/i })).toBeEnabled();
  });
});
