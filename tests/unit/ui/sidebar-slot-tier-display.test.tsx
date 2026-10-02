import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

/**
 * Bug 2 fix: the sidebar "current page" display must use the SAME priority chain
 * as the worker's computeFields — slot (bound to this tabId) → override → rule →
 * site. Before the fix, the sidebar omitted the slot-bound-tab tier, so a bound
 * slot's value that the real tab actually shows was NOT reflected in the sidebar.
 */

const BOUND_SLOT = {
  id: 1,
  urlMatch: { type: 'exact' as const, value: 'https://example.com/page' },
  strategy: 'inherit' as const,
  uiMarker: {},
  titleSnapshot: 'Slot Bound Title',
  faviconSnapshot: 'https://slot.com/icon.png',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const RULE = {
  id: 'r1',
  urlMatch: { type: 'exact' as const, value: 'https://example.com/page' },
  priority: 100,
  title: 'Rule Wins If No Slot',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeState() {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true,
        slots: [BOUND_SLOT],
        rules: [RULE],
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
  };
}

const mockSendMessage = vi.fn();
const mockQuery = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: mockQuery,
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

/** The current-page title element has class `tbs-sidebar__current-title`. */
function currentTitle(): HTMLElement | null {
  return document.querySelector('.tbs-sidebar__current-title');
}
/** The current-page favicon img element has class `tbs-sidebar__current-favicon`. */
function currentFavicon(): HTMLImageElement | null {
  return document.querySelector('img.tbs-sidebar__current-favicon');
}

describe('Sidebar current-page display aligns with worker slot-bound-tab tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(makeState());
    mockQuery.mockResolvedValue([
      { id: 42, url: 'https://example.com/page', title: 'Original Title', favIconUrl: '' },
    ]);
  });

  it('should show the bound slot value for the current page (slot tier wins over rule)', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(currentTitle()).toBeTruthy();
    });
    // The current-page title must be the bound slot value, NOT the (higher-priority) rule title.
    const title = currentTitle();
    expect(title?.textContent).toBe('Slot Bound Title');
  });

  it('should show the bound slot favicon for the current page', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      const img = currentFavicon();
      expect(img).toBeTruthy();
      expect(img?.src).toContain('slot.com');
    });
  });

  it('should fall back to rule value when the current tab is NOT the bound tab', async () => {
    // Current tab is a different tab (not the bound tabId 42).
    mockQuery.mockResolvedValue([
      { id: 99, url: 'https://example.com/page', title: 'Original Title', favIconUrl: '' },
    ]);
    render(<SidebarApp />);

    await waitFor(() => {
      expect(currentTitle()).toBeTruthy();
    });
    const title = currentTitle();
    expect(title?.textContent).toBe('Rule Wins If No Slot');
  });
});