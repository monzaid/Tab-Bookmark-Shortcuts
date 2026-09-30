/**
 * N6 (P2) — a transient REFRESH failure must not swallow an already-loaded list.
 *
 * `storage.onChanged` triggers `loadState` on every background write. Now that
 * a resolved `{ success: false }` correctly sets `state.error` (N5), gating the
 * list on `state.error` alone would replace the user's ten well-populated rows
 * with a blocking error panel after one flaky refresh — strictly worse than
 * before. The error panel belongs to a COLD failure (nothing loaded yet).
 *
 * Expected: cold failure → blocking alert + Retry (guardrail, unchanged).
 *           warm refresh failure → list stays, no blocking panel.
 *
 * RED guard: pre-fix the refresh failure swaps the list for the error panel.
 *
 * RED baseline tree: U1–U9 + N5 applied working tree.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();
const mockQuery = vi.fn();

type StorageListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

let storageListener: StorageListener | null = null;

const SLOT_STATE = {
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
};

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
  storage: {
    onChanged: {
      addListener: vi.fn((listener: StorageListener) => {
        storageListener = listener;
      }),
      removeListener: vi.fn(),
    },
  },
});

function getStorageListener(): StorageListener {
  if (storageListener === null) throw new Error('storage listener was not registered');
  return storageListener;
}

describe('N6 (P2) — a warm refresh failure keeps the loaded list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageListener = null;
    mockQuery.mockResolvedValue([]);
  });

  it('should keep the loaded list (and show no blocking panel) when a refresh fails', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) =>
      Promise.resolve(message.action === 'GET_STATE' ? SLOT_STATE : { result: { success: true, commands: [] } }),
    );

    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByRole('list', { name: '10 bookmark slots' })).toBeInTheDocument();
    });

    // The next refresh fails transiently (background TIMEOUT).
    mockSendMessage.mockImplementation((message: { action?: string }) =>
      Promise.resolve(
        message.action === 'GET_STATE'
          ? { success: false, errorCode: 'TIMEOUT' }
          : { result: { success: true, commands: [] } },
      ),
    );

    act(() => {
      getStorageListener()({ localState: { newValue: {} } }, 'local');
    });

    // The already-loaded list must survive a transient refresh failure.
    await waitFor(() => {
      expect(screen.getByRole('list', { name: '10 bookmark slots' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });

  it('guardrail: a COLD failure still renders the blocking alert + Retry', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) =>
      Promise.resolve(
        message.action === 'GET_STATE'
          ? { success: false, errorCode: 'TIMEOUT' }
          : { result: { success: true, commands: [] } },
      ),
    );

    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(alerts.some((t) => t.includes('Failed to load state'))).toBe(true);
    expect(screen.queryByRole('list', { name: '10 bookmark slots' })).toBeNull();
  });
});