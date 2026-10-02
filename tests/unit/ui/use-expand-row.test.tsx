import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useExpandRow } from '@ui/shared/use-expand-row';

type RowId = 'a' | 'b';

function Harness() {
  const { isExpanded, toggle, getRowHandlers, setToggleRef } = useExpandRow<RowId>();

  const renderRow = (id: RowId, label: string) => (
    <div data-testid={`row-${id}`} {...getRowHandlers(id)}>
      <button
        ref={(el) => { setToggleRef(id, el); }}
        onClick={(e) => { toggle(id, e.currentTarget.closest<HTMLElement>('[data-testid]')); }}
      >
        {label} toggle
      </button>
      {isExpanded(id) && <input aria-label={`${label} field`} />}
    </div>
  );

  return (
    <div>
      {renderRow('a', 'A')}
      {renderRow('b', 'B')}
    </div>
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('T6: useExpandRow', () => {
  it('expands a row and moves focus into the first field', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'A toggle' }));
    await flush();

    expect(screen.getByLabelText('A field')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('A field'));
  });

  it('collapses the current row on Escape and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'A toggle' }));
    await flush();
    expect(screen.getByLabelText('A field')).toBeTruthy();

    // Focus is inside the row, so Escape reaches the row's handler.
    await user.keyboard('{Escape}');
    await flush();

    expect(screen.queryByLabelText('A field')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'A toggle' }));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('supports multiple rows open at once', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'A toggle' }));
    await flush();
    await user.click(screen.getByRole('button', { name: 'B toggle' }));
    await flush();

    expect(screen.getByLabelText('A field')).toBeTruthy();
    expect(screen.getByLabelText('B field')).toBeTruthy();
  });

  it('Escape on one row does not collapse the other', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'A toggle' }));
    await flush();
    await user.click(screen.getByRole('button', { name: 'B toggle' }));
    await flush();

    screen.getByLabelText('A field').focus();
    await user.keyboard('{Escape}');
    await flush();

    expect(screen.queryByLabelText('A field')).toBeNull();
    expect(screen.getByLabelText('B field')).toBeTruthy();
  });
});