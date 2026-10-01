import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryWindow } from '@ui/recovery/App';

const onOpenUrl = vi.fn().mockResolvedValue(undefined);
const onNextMatch = vi.fn().mockResolvedValue(undefined);
const onPrevMatch = vi.fn().mockResolvedValue(undefined);
const onDismiss = vi.fn().mockResolvedValue(undefined);

/**
 * T12b replay — the recovery window gained Prev/Next + autoBind and keeps the
 * `Tab Not Found` title / `role="dialog"` contract (this file is the ACTUAL
 * lock point for those, not pages.smoke).
 */
const defaultProps = {
  recoveryId: 'rec-1',
  slotTitle: 'Example Page',
  slotUrl: 'https://example.com',
  matchType: 'exact' as const,
  autoBind: false,
  onOpenUrl,
  onNextMatch,
  onPrevMatch,
  onDismiss,
};

describe('T19: Recovery window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Recovery window — Happy path', () => {
    it('should still render the Tab Not Found dialog title', () => {
      render(<RecoveryWindow {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Tab Not Found')).toBeInTheDocument();
    });

    it('should render the action buttons', () => {
      render(<RecoveryWindow {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Open saved URL in new tab' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Switch to previous matching tab' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Switch to next matching tab' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Do nothing and close' })).toBeInTheDocument();
    });

    it('should show slot title and URL', () => {
      render(<RecoveryWindow {...defaultProps} />);
      expect(screen.getByText('Example Page')).toBeInTheDocument();
      expect(screen.getByText('https://example.com')).toBeInTheDocument();
    });

    it('should call onOpenUrl with the current autoBind value', () => {
      render(<RecoveryWindow {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open saved URL in new tab' }));
      expect(onOpenUrl).toHaveBeenCalledWith('rec-1', false);
    });

    it('should call onNextMatch / onPrevMatch', async () => {
      render(<RecoveryWindow {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Switch to next matching tab' }));
      await vi.waitFor(() => {
        expect(onNextMatch).toHaveBeenCalledWith('rec-1', false);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Switch to previous matching tab' }));
      await vi.waitFor(() => {
        expect(onPrevMatch).toHaveBeenCalledWith('rec-1', false);
      });
    });

    it('should call onDismiss when Do Nothing clicked', () => {
      render(<RecoveryWindow {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Do nothing and close' }));
      expect(onDismiss).toHaveBeenCalledWith('rec-1');
    });
  });

  describe('Recovery window — Error path', () => {
    it('should show error and re-enable buttons on next-match failure', async () => {
      const onNextMatch = vi.fn().mockRejectedValue(new Error('no match'));
      render(<RecoveryWindow {...defaultProps} onNextMatch={onNextMatch} />);

      fireEvent.click(screen.getByRole('button', { name: 'Switch to next matching tab' }));

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('No matching tabs found at this time');
      });

      expect(screen.getByRole('button', { name: 'Switch to next matching tab' })).toBeEnabled();
    });

    it('should render the inline protected-page message when Open URL fails with PROTECTED_PAGE', async () => {
      const onOpenUrl = vi.fn().mockRejectedValue(new Error('PROTECTED_PAGE'));
      render(<RecoveryWindow {...defaultProps} onOpenUrl={onOpenUrl} />);

      fireEvent.click(screen.getByRole('button', { name: 'Open saved URL in new tab' }));

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('This URL cannot be opened');
      });
      // The window must remain open.
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});