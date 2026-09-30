import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  // ── U8 (P9) — appended only (GE3); the two cases above are untouched ──────
  it('should word the auto-conversion hint in English, with no CJK mixed in', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add to global rules' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));

    const urlInput = await screen.findByLabelText('Match URL');
    fireEvent.change(urlInput, { target: { value: '*.example.com/*' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Regex' }));

    const hint = await screen.findByRole('status');
    expect(hint.textContent).toContain('Auto-converted to regex');
    expect(/[\u4e00-\u9fff]/.test(hint.textContent)).toBe(false);
  });

  // ── U8 (P12) — appended only (GE3) ────────────────────────────────────────
  it('should keep a toast visible for 5s (the shared default), not 3s', async () => {
    vi.useFakeTimers();
    try {
      const { act } = await import('@testing-library/react');
      mockSendMessage.mockResolvedValue(makeState('https://example\\.com/.*', 'Regex Rule Title'));
      mockSendMessage.mockImplementation((message: { action?: string }) =>
        Promise.resolve(
          message.action === 'SAVE_SLOT'
            ? { result: { success: true } }
            : makeState('https://example\\.com/.*', 'Regex Rule Title'),
        ),
      );

      render(<SidebarApp />);

      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      fireEvent.click(screen.getAllByRole('button', { name: 'Save to slot 1' })[0]);

      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      expect(screen.getAllByRole('alert').some((a) => a.textContent.includes('Saved to slot 1'))).toBe(true);

      // Still there at 3s — the pre-fix `duration={3000}` would have dismissed it.
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.getAllByRole('alert').some((a) => a.textContent.includes('Saved to slot 1'))).toBe(true);

      // Gone after the shared 5000ms default.
      act(() => { vi.advanceTimersByTime(2500); });
      expect(screen.queryAllByRole('alert').some((a) => a.textContent.includes('Saved to slot 1'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});