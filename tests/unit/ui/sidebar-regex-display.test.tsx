import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

/**
 * Bug 3 fix: sidebar display must use the SAME matching logic as the worker
 * (shared `matchesUrl` from @shared/url-utils), so a stored regex rule resolves
 * the current page's title consistently with what tabs actually show.
 */
function makeState(ruleValue: string, ruleTitle: string) {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        globalStrategy: 'B',
        slots: [],
        rules: [
          {
            id: 'r1',
            urlMatch: { type: 'regex', value: ruleValue },
            mode: 'auto',
            priority: 5,
            title: ruleTitle,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
      local: {
        bindings: [],
        cycleCursors: [],
        lastSuccessSlotId: 0,
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

describe('Sidebar regex display uses shared matchesUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(makeState('https://example\\.com/.*', 'Regex Rule Title'));
    mockQuery.mockResolvedValue([
      { id: 42, url: 'https://example.com/docs/page', title: 'Original', favIconUrl: '' },
    ]);
  });

  it('should resolve the regex rule title for the current page URL', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByText('Regex Rule Title')).toBeInTheDocument();
    });
  });

  it('should NOT resolve the regex rule for a non-matching URL', async () => {
    mockQuery.mockResolvedValue([
      { id: 42, url: 'https://other.com/page', title: 'Original', favIconUrl: '' },
    ]);
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByText('Original')).toBeInTheDocument();
    });
    expect(screen.queryByText('Regex Rule Title')).not.toBeInTheDocument();
  });
});