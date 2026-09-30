/**
 * N5 (P2) — a load failure delivered as `{ success: false }` must reach the
 * error state, not be silently swallowed.
 *
 * The background answers TIMEOUT / INTERNAL_ERROR by *resolving* with
 * `{ success: false, ... }` (`worker-orchestrator.ts`), and
 * `message-client.sendRaw` passes that through unchanged. `loadState` therefore
 * takes its `else` branch, which used to write `{ loading: false, error: null }`
 * — the `catch` never ran, so the P3 defect (a real failure rendered as ten
 * "Empty" slots) reproduced on the *more common* resolved-failure path.
 *
 * RED guard: pre-fix no alert / no Retry appears and 10 "Empty" rows render.
 *
 * RED baseline tree: U1–U9 applied working tree (HEAD a455ad8 predates P3).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

describe('N5 (P2) — a resolved { success: false } load surfaces the error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
  });

  it('should render the alert + Retry instead of 10 empty slots when GET_STATE resolves success:false', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') {
        return Promise.resolve({ success: false, errorCode: 'TIMEOUT', message: 'no response' });
      }
      return Promise.resolve({ result: { success: true, commands: [] } });
    });

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

  it('should recover the slot list when Retry then succeeds', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') {
        return Promise.resolve({ success: false, errorCode: 'INTERNAL_ERROR' });
      }
      return Promise.resolve({ result: { success: true, commands: [] } });
    });

    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') {
        return Promise.resolve({
          result: {
            success: true,
            sync: { configVersion: 1, globalStrategy: 'B', slots: [], rules: [] },
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
        });
      }
      return Promise.resolve({ result: { success: true, commands: [] } });
    });

    fireEventClickRetry();

    await waitFor(() => {
      expect(screen.getByRole('list', { name: '10 bookmark slots' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

function fireEventClickRetry(): void {
  screen.getByRole('button', { name: 'Retry' }).click();
}