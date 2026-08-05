import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryWindow } from '@ui/recovery/App';
import { CandidateSelectorApp } from '@ui/candidate-selector/App';
import type { TabCandidate } from '@shared/types';

describe('T19: Recovery window and cross-window candidate selector', () => {
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

  describe('Candidate selector — Happy path', () => {
    const candidates: TabCandidate[] = [
      { tabId: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'Tab A', favIconUrl: '', isCurrentWindow: true, isIncognito: false },
      { tabId: 2, windowId: 1, index: 1, url: 'https://b.com', title: 'Tab B', favIconUrl: '', isCurrentWindow: true, isIncognito: false },
      { tabId: 3, windowId: 2, index: 0, url: 'https://c.com', title: 'Tab C', favIconUrl: '', isCurrentWindow: false, isIncognito: false },
    ];

    it('should group candidates by window with current window first', () => {
      render(
        <CandidateSelectorApp
          candidates={candidates}
          mode="slot"
          onSwitch={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('Current Window')).toBeInTheDocument();
      expect(screen.getByText('Window 2')).toBeInTheDocument();

      // Current window group should appear first
      const groups = screen.getAllByRole('listitem');
      expect(groups).toHaveLength(3);
    });

    it('should switch immediately on click in slot mode', () => {
      const onSwitch = vi.fn();
      render(
        <CandidateSelectorApp
          candidates={candidates}
          mode="slot"
          onSwitch={onSwitch}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Tab A'));
      expect(onSwitch).toHaveBeenCalledWith(candidates[0]);
    });

    it('should switch on Enter key in slot mode', () => {
      const onSwitch = vi.fn();
      render(
        <CandidateSelectorApp
          candidates={candidates}
          mode="slot"
          onSwitch={onSwitch}
          onClose={vi.fn()}
        />
      );

      const item = screen.getByText('Tab B').closest('[role="listitem"]')!;
      fireEvent.keyDown(item, { key: 'Enter' });
      expect(onSwitch).toHaveBeenCalledWith(candidates[1]);
    });

    it('should require Apply confirmation in manual-rule mode', () => {
      const onApply = vi.fn();
      render(
        <CandidateSelectorApp
          candidates={candidates}
          mode="manual-rule"
          onSwitch={vi.fn()}
          onApply={onApply}
          onClose={vi.fn()}
        />
      );

      // Click selects but does NOT apply
      fireEvent.click(screen.getByText('Tab A'));
      expect(onApply).not.toHaveBeenCalled();

      // Apply button should now be enabled
      const applyBtn = screen.getByRole('button', { name: 'Apply rule to selected tab' });
      expect(applyBtn).toBeEnabled();

      fireEvent.click(applyBtn);
      expect(onApply).toHaveBeenCalledWith(candidates[0]);
    });

    it('should close on Escape key', () => {
      const onClose = vi.fn();
      render(
        <CandidateSelectorApp
          candidates={candidates}
          mode="slot"
          onSwitch={vi.fn()}
          onClose={onClose}
        />
      );

      const item = screen.getByText('Tab A').closest('[role="listitem"]')!;
      fireEvent.keyDown(item, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Candidate selector — Error path', () => {
    it('should show empty message when no candidates', () => {
      render(
        <CandidateSelectorApp
          candidates={[]}
          mode="slot"
          onSwitch={vi.fn()}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('No matching tabs found.')).toBeInTheDocument();
    });

    it('should disable Apply button when nothing selected in manual mode', () => {
      const candidates: TabCandidate[] = [
        { tabId: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'Tab A', favIconUrl: '', isCurrentWindow: true, isIncognito: false },
      ];
      render(
        <CandidateSelectorApp
          candidates={candidates}
          mode="manual-rule"
          onSwitch={vi.fn()}
          onApply={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Apply rule to selected tab' })).toBeDisabled();
    });
  });
});
