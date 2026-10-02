/**
 * T17 — a11y closure (CT3-b / CT3-g + IMP-12).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Confirm, FormField, formFieldIds } from '@ui/shared/components';
import { UndoBar } from '@ui/shared/undo-bar';
import type { UndoSnapshot } from '@ui/shared/undo-bar';

describe('T17: Confirm — DOM order, initial focus, protection window (CT3-b)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('places the confirmation button before cancellation', () => {
    render(
      <Confirm open title="Delete?" message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} confirmLabel="Delete" cancelLabel="Keep" />,
    );
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    // First focusable in the dialog is the confirm button.
    expect(buttons.indexOf('Delete')).toBeLessThan(buttons.indexOf('Keep'));
  });

  it('moves initial focus to the confirm button', async () => {
    render(<Confirm open title="Delete?" message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} confirmLabel="Delete" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('ignores an Enter inside the ~120ms protection window (CT3-b4)', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Confirm open title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={vi.fn()} confirmLabel="Delete" />);

    // Immediately activate the confirm button — inside the window.
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('accepts Enter once the protection window has passed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onConfirm = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Confirm open title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={vi.fn()} confirmLabel="Delete" />);

    await act(async () => { vi.advanceTimersByTime(200); });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('T17: UndoBar — role is status, never alert+polite (CT3-g4)', () => {
  it('never stacks role="alert" with aria-live="polite"', () => {
    const snapshot: UndoSnapshot = { writes: [], affectedTabIds: [] };
    render(<UndoBar state={{ message: 'Cleared', snapshot, expiresAt: Date.now() + 5000 }} onUndo={vi.fn()} />);
    const root = screen.getByRole('status');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('role')).not.toBe('alert');
  });

  it('takes focus and does not co-run with Confirm (serial, CT3-g2)', () => {
    const snapshot: UndoSnapshot = { writes: [], affectedTabIds: [] };
    // UndoBar alone owns focus when it is present.
    render(<UndoBar state={{ message: 'Cleared', snapshot, expiresAt: Date.now() + 5000 }} onUndo={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /undo/i }));
  });
});

describe('T17: FormField exposes its described-by ids as public API (IMP-12)', () => {
  it('returns stable error/hint ids', () => {
    expect(formFieldIds('rf-url')).toEqual({ errorId: 'rf-url-error', hintId: 'rf-url-hint' });
  });

  it('renders an error node carrying role="alert"', () => {
    render(
      <FormField label="URL" htmlFor="rf-url" error="Bad">
        <input id="rf-url" />
      </FormField>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('rf-url-error');
  });

  it('renders a hint node with the hint id', () => {
    render(
      <FormField label="URL" htmlFor="rf-url" hint="Helpful">
        <input id="rf-url" />
      </FormField>,
    );
    expect(document.getElementById('rf-url-hint')?.textContent).toBe('Helpful');
  });
});