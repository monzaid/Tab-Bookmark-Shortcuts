import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryWindow } from '@ui/recovery/App';

describe('T19: Recovery window', () => {
  describe('Recovery window — Happy path', () => {
    const defaultProps = {
      recoveryId: 'rec-1',
      slotTitle: 'Example Page',
      slotUrl: 'https://example.com',
      onOpenUrl: vi.fn().mockResolvedValue(undefined),
      onNextMatch: vi.fn().mockResolvedValue(undefined),
      onDismiss: vi.fn().mockResolvedValue(undefined),
    };

    it('should render three action buttons', () => {
      render(<RecoveryWindow {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Open saved URL in new tab' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Switch to next matching tab' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Do nothing and close' })).toBeInTheDocument();
    });

    it('should show slot title and URL', () => {
      render(<RecoveryWindow {...defaultProps} />);
      expect(screen.getByText('Example Page')).toBeInTheDocument();
      expect(screen.getByText('https://example.com')).toBeInTheDocument();
    });

    it('should call onOpenUrl when Open URL clicked', () => {
      render(<RecoveryWindow {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open saved URL in new tab' }));
      expect(defaultProps.onOpenUrl).toHaveBeenCalledWith('rec-1');
    });

    it('should call onNextMatch when Next Match clicked', () => {
      render(<RecoveryWindow {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Switch to next matching tab' }));
      expect(defaultProps.onNextMatch).toHaveBeenCalledWith('rec-1');
    });

    it('should call onDismiss when Do Nothing clicked', () => {
      render(<RecoveryWindow {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Do nothing and close' }));
      expect(defaultProps.onDismiss).toHaveBeenCalledWith('rec-1');
    });
  });

  describe('Recovery window — Error path', () => {
    it('should show error and re-enable buttons on next-match failure', async () => {
      const onNextMatch = vi.fn().mockRejectedValue(new Error('no match'));
      render(
        <RecoveryWindow
          recoveryId="rec-2"
          slotTitle="Test"
          slotUrl="https://test.com"
          onOpenUrl={vi.fn()}
          onNextMatch={onNextMatch}
          onDismiss={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Switch to next matching tab' }));

      // Wait for async rejection
      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('No matching tabs found');
      });

      // Buttons should be re-enabled
      expect(screen.getByRole('button', { name: 'Switch to next matching tab' })).toBeEnabled();
    });
  });

  });
