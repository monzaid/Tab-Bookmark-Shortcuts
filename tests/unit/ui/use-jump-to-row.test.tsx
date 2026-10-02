/**
 * T13 — useJumpToRow (F1 / F1b / F2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useJumpToRow, JUMP_HIGHLIGHT_CLASS } from '@ui/shared/use-jump-to-row';
import type { TierOwner } from '@shared/field-chain';

function Harness({ rows, hasRows }: { rows: Record<string, string>; hasRows: boolean }) {
  const searchRef = { current: null as HTMLElement | null };
  const { jumpTo, announcement } = useJumpToRow({
    resolveRow: (anchor: TierOwner) => {
      if (anchor.kind !== 'rule') return null;
      return document.querySelector<HTMLElement>(`[data-rule-id="${anchor.ruleId}"]`);
    },
    firstRow: () => document.querySelector<HTMLElement>('tr[data-rule-id]'),
    searchRef,
  });

  return (
    <div>
      <input ref={(el) => { searchRef.current = el; }} aria-label="Search rules" />
      <table>
        <tbody>
          {hasRows &&
            Object.entries(rows).map(([id, label]) => (
              <tr key={id} data-rule-id={id}>
                <td>{label}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <button onClick={() => { jumpTo({ kind: 'rule', ruleId: 'r2' }); }}>Jump r2</button>
      {announcement && <div role="status">{announcement.message}</div>}
    </div>
  );
}

describe('T13: useJumpToRow', () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scrolls to a visible target row and highlights it temporarily (F1/F2)', async () => {
    vi.useFakeTimers();
    render(<Harness rows={{ r1: 'One', r2: 'Two', r3: 'Three' }} hasRows />);

    await act(async () => { screen.getByText('Jump r2').click(); });

    const row2 = document.querySelector('[data-rule-id="r2"]')!;
    expect(row2.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(row2.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(false);
  });

  it('does NOT auto-expand the row and does not touch filters (F1)', async () => {
    render(<Harness rows={{ r1: 'One', r2: 'Two' }} hasRows />);
    const row2 = document.querySelector('[data-rule-id="r2"]')!;
    const before = row2.outerHTML;

    await act(async () => { screen.getByText('Jump r2').click(); });

    // Only the class changed — no subtree expansion.
    expect(row2.querySelectorAll('input').length).toBe(0);
    expect(row2.textContent).toBe('Two');
    expect(before).toContain('Two');
  });

  it('falls back to the first row WITHOUT highlighting it, and explains why (F1b/F1b-a)', async () => {
    render(<Harness rows={{ r1: 'One', r3: 'Three' }} hasRows />);

    await act(async () => { screen.getByText('Jump r2').click(); });

    const row1 = document.querySelector('[data-rule-id="r1"]')!;
    expect(row1.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(false);
    expect(document.querySelectorAll(`.${JUMP_HIGHLIGHT_CLASS}`).length).toBe(0);
    expect(screen.getByRole('status').textContent).toContain('hidden by the current search');
  });

  it('focuses the search box and announces when there are no rows at all (F1b)', async () => {
    render(<Harness rows={{}} hasRows={false} />);

    await act(async () => { screen.getByText('Jump r2').click(); });

    expect(document.activeElement).toBe(screen.getByLabelText('Search rules'));
    expect(screen.getByRole('status').textContent).toContain('No rules to show');
  });

  it('does NOT steal focus on a successful jump (F2-c)', async () => {
    render(<Harness rows={{ r1: 'One', r2: 'Two' }} hasRows />);
    const search = screen.getByLabelText('Search rules');
    search.focus();

    await act(async () => { screen.getByText('Jump r2').click(); });

    expect(document.activeElement).toBe(search);
    expect(screen.getByRole('status').textContent).toContain('Jumped to the rule');
  });

  it('a repeated jump resets the highlight timer (F2-d)', async () => {
    vi.useFakeTimers();
    render(<Harness rows={{ r1: 'One', r2: 'Two' }} hasRows />);
    const row2 = document.querySelector('[data-rule-id="r2"]')!;

    await act(async () => { screen.getByText('Jump r2').click(); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    // Second jump resets the timer.
    await act(async () => { screen.getByText('Jump r2').click(); });
    await act(async () => { vi.advanceTimersByTime(1500); });

    // 1500ms after the second jump the highlight must still be present.
    expect(row2.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(true);

    await act(async () => { vi.advanceTimersByTime(600); });
    expect(row2.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(false);
  });

  it('keeps the highlight under reduced motion (F2-b: only the transition is dropped)', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    try {
      render(<Harness rows={{ r1: 'One', r2: 'Two' }} hasRows />);
      await act(async () => { screen.getByText('Jump r2').click(); });
      const row2 = document.querySelector<HTMLElement>('[data-rule-id="r2"]')!;
      expect(row2.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(true);
      expect(row2.dataset.jumpReducedMotion).toBe('true');
    } finally {
      window.matchMedia = original;
    }
  });
});