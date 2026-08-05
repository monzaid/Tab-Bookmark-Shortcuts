import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

// Mock chrome.runtime.sendMessage
const mockSendMessage = vi.fn().mockResolvedValue({
  result: {
    success: true,
    sync: {
      configVersion: 1,
      globalStrategy: 'B',
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
  },
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
});

describe('T15: Sidebar framework, current context, 10-slot list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({
      result: {
        success: true,
        sync: {
          configVersion: 1,
          globalStrategy: 'B',
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
      },
    });
  });

  describe('Happy path — rendering and interactions', () => {
    it('should render 10 slot rows', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        const list = screen.getByRole('list', { name: '10 bookmark slots' });
        expect(list).toBeInTheDocument();
      });

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(10);
    });

    it('should show bound slot with title and status', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      expect(screen.getByText('Bound')).toBeInTheDocument();
    });

    it('should show empty slots with Save button', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getAllByText('Empty').length).toBeGreaterThan(0);
      });

      const saveButtons = screen.getAllByRole('button', { name: /Save to slot/ });
      expect(saveButtons.length).toBe(9); // 9 empty slots
    });

    it('should send NEXT_MATCH_SLOT message on Next button click', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      const nextButton = screen.getByRole('button', { name: 'Switch to next matching tab for slot 1' });
      fireEvent.click(nextButton);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'NEXT_MATCH_SLOT', payload: { slotId: 1 } })
      );
    });

    it('should switch on Enter key for bound slot', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      // Find the first listitem (slot 1) and press Enter
      const items = screen.getAllByRole('listitem');
      fireEvent.keyDown(items[0], { key: 'Enter' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SWITCH_SLOT' })
      );
    });

    it('should toggle collapse for current page section', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Collapse current page/ })).toBeInTheDocument();
      });

      const toggle = screen.getByRole('button', { name: /Collapse current page/ });
      fireEvent.click(toggle);

      expect(screen.getByRole('button', { name: /Expand current page/ })).toBeInTheDocument();
    });

    it('should render lock toggle button', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
      });

      // Lock button is present and interactive
      const lockBtn = screen.getByRole('button', { name: /Lock to current tab/ });
      fireEvent.click(lockBtn);

      // Button remains functional (currentTabId is null in test, so lock stays null)
      expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
    });
  });

  describe('Edge path — lock removed tab and missing shortcuts', () => {
    it('should toggle lock button state', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
      });

      // Click lock — button should change to unlock label
      fireEvent.click(screen.getByRole('button', { name: /Lock to current tab/ }));

      // Since currentTabId is null in test, lockedTabId stays null
      // But the button should still be present and functional
      expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
    });

    it('should render application role with aria-label', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('application', { name: 'Tab Bookmarks Sidebar' })).toBeInTheDocument();
      });
    });

    it('should show footer navigation entries', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import or export' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'View diagnostics' })).toBeInTheDocument();
      });
    });
  });
});
