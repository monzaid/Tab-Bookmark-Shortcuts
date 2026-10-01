/**
 * U6 (P3) — a failed state load must surface an explicit error + Retry instead
 * of masquerading as ten empty slots.
 *
 * Before: `loadState`'s catch wrote `error: 'Failed to load state'`, but nothing
 * ever read `state.error`, and `const slots = state.sync?.slots ?? []` then
 * rendered 10 rows whose label reads "Empty". A background failure was therefore
 * indistinguishable from a fresh, empty configuration.
 *
 * RED guard: assertions ①② fail pre-fix (no alert, no Retry, and 10 "Empty"
 * badges are rendered).
 *
 * Chrome stub is deliberately minimal (runtime.sendMessage + tabs.query) —
 * mirroring sidebar-regex-display.test.tsx — so the `hasTabsApi()` branch does
 * not introduce side effects into this suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

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

/** `slots: []` is a fully valid, genuinely empty configuration. */
function emptyState() {
  return {
    result: {
      success: true,
      sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
      local: {
        bindings: [],
        cycleCursors: [],
        lastSuccessSlotId: null,
        recoverySessions: [],
        recoverySnapshots: [],
        tabOverrides: [],
        iconCache: {},
        diagnostics: [],
      },
    },
  };
}

describe('U6 (P3) — sidebar surfaces a load failure with Retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
  });

  it('should render an explicit error state and a Retry control, not 10 empty slots', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) =>
      message.action === 'GET_STATE'
        ? Promise.reject(new Error('background unavailable'))
        : Promise.resolve({ result: { success: true, commands: [] } }),
    );

    render(<SidebarApp />);

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((t) => t.includes('Failed to load state'))).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // The core P3 defect: the failure must NOT be disguised as empty slots.
    expect(screen.queryAllByText('Empty')).toHaveLength(0);
    expect(screen.queryByRole('list', { name: '10 bookmark slots' })).toBeNull();
  });

  it('should recover the slot list when Retry succeeds', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) =>
      message.action === 'GET_STATE'
        ? Promise.reject(new Error('background unavailable'))
        : Promise.resolve({ result: { success: true, commands: [] } }),
    );

    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    // Background comes back before the user retries.
    mockSendMessage.mockImplementation((message: { action?: string }) =>
      Promise.resolve(message.action === 'GET_STATE' ? emptyState() : { result: { success: true, commands: [] } }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByRole('list', { name: '10 bookmark slots' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('should NOT show the error state for a genuinely empty configuration', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) =>
      Promise.resolve(message.action === 'GET_STATE' ? emptyState() : { result: { success: true, commands: [] } }),
    );

    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByRole('list', { name: '10 bookmark slots' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryAllByText('Empty')).toHaveLength(10);
  });
});