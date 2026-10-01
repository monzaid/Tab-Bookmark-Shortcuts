/**
 * Bug 3 (sidebar): "Switch to previous matching tab" button for bound slots.
 *
 * - Rendered ABOVE the existing next (↻) button in a vertical stack
 * - Same variant/size as the next button; aria-label/tooltip follow the same pattern
 * - Click sends PREV_MATCH_SLOT with the slot id; no_match outcome → info toast
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
});

function stateResponse(overrides?: Record<string, unknown>) {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true,
        slots: [
          {
            id: 1,
            urlMatch: { type: 'exact', value: 'https://example.com' },
            strategy: 'inherit',
            uiMarker: { customTitle: 'Example' },
            titleSnapshot: 'Example',
            faviconSnapshot: '',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        rules: [],
      },
      local: {
        bindings: [{ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
        cycleCursors: [],
        lastSuccessSlotId: 1,
        recoverySessions: [],
        recoverySnapshots: [],
        tabOverrides: [],
        iconCache: {},
        diagnostics: [],
      },
      ...overrides,
    },
  };
}

describe('Bug 3 (sidebar): previous matching tab button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(stateResponse());
  });

  it('should render a previous-match button for the bound slot with correct aria-label', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'Switch to previous matching tab for slot 1' }),
    ).toBeInTheDocument();
  });

  it('should stack prev above next: prev appears earlier in the DOM than next', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    const allButtons = screen.getAllByRole('button');
    const prevIndex = allButtons.findIndex(
      (b) => b.getAttribute('aria-label') === 'Switch to previous matching tab for slot 1',
    );
    const nextIndex = allButtons.findIndex(
      (b) => b.getAttribute('aria-label') === 'Switch to next matching tab for slot 1',
    );
    expect(prevIndex).toBeGreaterThanOrEqual(0);
    expect(nextIndex).toBeGreaterThanOrEqual(0);
    // Prev must come first in document order (above the next button)
    expect(prevIndex).toBeLessThan(nextIndex);
  });

  it('should send PREV_MATCH_SLOT message on click', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to previous matching tab for slot 1' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PREV_MATCH_SLOT', payload: { slotId: 1 } }),
      );
    });
  });

  it('should show an info toast when the outcome is no_match', async () => {
    mockSendMessage.mockImplementation(async (msg: { action: string }) => {
      if (msg.action === 'PREV_MATCH_SLOT') {
        return { result: { success: true, outcome: { type: 'no_match', slotId: 1 } } };
      }
      return stateResponse();
    });

    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to previous matching tab for slot 1' }));

    await waitFor(() => {
      expect(screen.getByText(/no matching tabs found/)).toBeInTheDocument();
    });
  });

  it('should not render prev/next buttons for empty slots (only Save)', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Switch to previous matching tab for slot 2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to next matching tab for slot 2' })).not.toBeInTheDocument();
  });
});
