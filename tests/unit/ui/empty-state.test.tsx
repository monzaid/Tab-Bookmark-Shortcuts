import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '@ui/shared/empty-state';

describe('T6: EmptyState renders four variants without deciding anything', () => {
  it('renders the no-match copy', () => {
    render(<EmptyState variant="no-match" />);
    expect(screen.getByText(/No rules match your search/i)).toBeTruthy();
  });

  it('renders a Clear search action when given one', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState variant="no-match" action={{ label: 'Clear search', onClick }} />);

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('announces the first-load error assertively', () => {
    render(<EmptyState variant="error-first" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('reports the stale variant as a status, not an alert', () => {
    render(<EmptyState variant="error-stale" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('allows a caller to override the message', () => {
    render(<EmptyState variant="empty" message="Nothing customized yet" />);
    expect(screen.getByText('Nothing customized yet')).toBeTruthy();
  });
});