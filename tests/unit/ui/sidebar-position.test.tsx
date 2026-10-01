import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

/**
 * T12a: Sidebar Position buttons (↑/↓).
 * - The Current Page row gains two position buttons.
 * - Clicking sends POSITION_CURRENT_PREV/NEXT with the anchor
 *   (`lockedTabId ?? currentTabId`) (BLK-A / A1).
 * - Slot rows do NOT gain position buttons.
 */
const runtimeSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    id: 'test-id',
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: runtimeSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    // The sidebar derives `currentTabId` from the active tab query.
    query: vi.fn().mockResolvedValue([
      { id: 42, windowId: 1, url: 'https://example.com', title: 'Example', favIconUrl: '' },
    ]),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

const STATE_WITH_TAB = {
  result: {
    success: true,
    sync: {
      configVersion: 1,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [],
      rules: [],
    },
    local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
    currentTab: { id: 42, windowId: 1, url: 'https://example.com', title: 'Example', favIconUrl: '' },
  },
};

describe('T12a: sidebar position buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSendMessage.mockImplementation((msg: { action: string }) =>
      Promise.resolve(msg.action === 'GET_STATE' ? STATE_WITH_TAB : { success: true }),
    );
  });

  async function renderSidebar() {
    render(<SidebarApp />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
    });
  }

  it('T12a RED: renders the position buttons in the current-page row', async () => {
    await renderSidebar();
    expect(screen.getByRole('button', { name: 'Switch to previous position tab' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to next position tab' })).toBeInTheDocument();
  });

  it('T12a RED: clicking ↓ sends POSITION_CURRENT_NEXT with the anchor', async () => {
    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to next position tab' }));

    await waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'POSITION_CURRENT_NEXT',
          payload: { anchorTabId: 42 },
        }),
      );
    });
  });

  it('T12a: clicking ↑ sends POSITION_CURRENT_PREV', async () => {
    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to previous position tab' }));

    await waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'POSITION_CURRENT_PREV' }),
      );
    });
  });

  it('T12a: the aria-labels do not collide with the match buttons', async () => {
    await renderSidebar();
    // Match buttons keep their own labels.
    expect(screen.getByRole('button', { name: 'Switch to previous matching tab for current page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to next matching tab for current page' })).toBeInTheDocument();
  });
});