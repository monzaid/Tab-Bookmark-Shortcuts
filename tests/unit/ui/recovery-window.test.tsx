import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryWindow } from '@ui/recovery/App';

/**
 * T12b: recovery window redesign behaviour.
 * - "Open URL" is shown ONLY for exact match targets (design §3.5).
 * - Prev/Next never close the window and can be clicked repeatedly (DT3).
 * - The autoBind checkbox persists on toggle and rides along in the action payload.
 */
describe('T12b: recovery window redesign', () => {
  const baseProps = {
    recoveryId: 'rec-1',
    slotTitle: 'Example',
    slotUrl: 'https://example.com',
    onOpenUrl: vi.fn().mockResolvedValue(undefined),
    onNextMatch: vi.fn().mockResolvedValue(undefined),
    onPrevMatch: vi.fn().mockResolvedValue(undefined),
    onDismiss: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T12b RED: shows Open URL for exact match targets', () => {
    render(<RecoveryWindow {...baseProps} matchType="exact" />);
    expect(screen.getByRole('button', { name: 'Open saved URL in new tab' })).toBeInTheDocument();
  });

  it('T12b RED: hides Open URL for regex match targets', () => {
    render(<RecoveryWindow {...baseProps} matchType="regex" />);
    expect(screen.queryByRole('button', { name: 'Open saved URL in new tab' })).toBeNull();
  });

  it('T12b: Prev/Next stay in the window and can be clicked repeatedly', async () => {
    const onNextMatch = vi.fn().mockResolvedValue(undefined);
    render(<RecoveryWindow {...baseProps} matchType="exact" onNextMatch={onNextMatch} />);

    const next = screen.getByRole('button', { name: 'Switch to next matching tab' });
    fireEvent.click(next);
    await vi.waitFor(() => {
      expect(onNextMatch).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(next);
    await vi.waitFor(() => {
      expect(onNextMatch).toHaveBeenCalledTimes(2);
    });

    // Window remains rendered (browsing never closes it).
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('T12b RED: autoBind checkbox persists on toggle and rides in the payload', () => {
    const onAutoBindChange = vi.fn();
    const onOpenUrl = vi.fn().mockResolvedValue(undefined);
    render(
      <RecoveryWindow
        {...baseProps}
        matchType="exact"
        autoBind={false}
        onAutoBindChange={onAutoBindChange}
        onOpenUrl={onOpenUrl}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /Auto-bind to this slot/ });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onAutoBindChange).toHaveBeenCalledWith(true);

    // The action payload reflects the new value (A12: background trusts the payload).
    fireEvent.click(screen.getByRole('button', { name: 'Open saved URL in new tab' }));
    expect(onOpenUrl).toHaveBeenCalledWith('rec-1', true);
  });

  it('T12b: no candidates on Open URL shows the inline failure but keeps the window', async () => {
    const onOpenUrl = vi.fn().mockRejectedValue(new Error('Failed to open URL'));
    render(<RecoveryWindow {...baseProps} matchType="exact" onOpenUrl={onOpenUrl} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open saved URL in new tab' }));

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to open URL');
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});