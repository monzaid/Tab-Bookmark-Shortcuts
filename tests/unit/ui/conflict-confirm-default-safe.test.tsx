/**
 * U3 (P7) — the conflict window countdown must be NON-DESTRUCTIVE on timeout.
 *
 * Old behaviour: 5s of no action auto-executed the overwrite (data loss).
 * Required behaviour: timeout equals Cancel — the destructive result must be
 * an explicit click.
 *
 * RED guard: on the pre-fix code the countdown calls `onOverwrite`, so
 * assertions ① (`onOverwrite` never called) and ③ (countdown wording) fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConflictConfirm } from '@ui/conflict-confirm/App';

const conflict = {
  slotId: 1,
  oldTitle: 'Old',
  oldUrl: 'https://old.example',
  newTitle: 'New',
  newUrl: 'https://new.example',
};

describe('U3 (P7) — conflict countdown defaults to safe (cancel)', () => {
  let closeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // The terminal state calls window.close(); jsdom logs a "not implemented" error.
    closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    closeSpy.mockRestore();
  });

  it('should not overwrite when the countdown expires', () => {
    const onOverwrite = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);

    render(<ConflictConfirm conflict={conflict} onOverwrite={onOverwrite} onCancel={onCancel} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onOverwrite).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should word the countdown as non-destructive (Cancelling, not Auto-overwrite)', () => {
    render(<ConflictConfirm conflict={conflict} onOverwrite={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/Cancelling in \d+s/)).toBeInTheDocument();
    expect(screen.queryByText(/Auto-overwrite/)).not.toBeInTheDocument();
  });

  it('should label the progressbar countdown as non-destructive', () => {
    render(<ConflictConfirm conflict={conflict} onOverwrite={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Cancelling countdown');
  });

  it('should still overwrite on an explicit click (destructive stays explicit)', () => {
    const onOverwrite = vi.fn().mockResolvedValue(undefined);

    render(<ConflictConfirm conflict={conflict} onOverwrite={onOverwrite} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Force overwrite slot' }));

    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });
});