/**
 * F1 (regression from U5) — clicking the DELETE confirm overlay must cancel only.
 *
 * `Confirm` is rendered inside the clickable `.tbs-slot-row` (the row root has
 * `onClick={handleClick}` → `handleSwitch` → `SWITCH_SLOT`). The shared
 * `Dialog`'s overlay (`div.tbs-dialog-overlay`) only calls `onClose` and does
 * NOT stop propagation, so a click on the overlay that cancels the dialog also
 * bubbles up to the row and switches the browser to that slot in the same tick.
 *
 * Expected: overlay click closes the dialog and sends ZERO `SWITCH_SLOT`.
 *
 * RED guard: pre-fix the overlay click bubbles to the row → `SWITCH_SLOT` = 1.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

const BASE_STATE = {
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

interface SentMessage {
  action?: string;
}

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

const switchCalls = () =>
  mockSendMessage.mock.calls.filter((c) => (c[0] as SentMessage).action === 'SWITCH_SLOT');

const unbindCalls = () =>
  mockSendMessage.mock.calls.filter((c) => (c[0] as SentMessage).action === 'UNBIND_SLOT');

async function openDeleteConfirm(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'More options for slot 1' }));
  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: 'Delete Slot' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Slot' }));
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
}

describe('F1 — confirm overlay click must not switch slots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockImplementation((message: SentMessage) => {
      if (message.action === 'GET_STATE' || message.action === undefined) {
        return Promise.resolve(BASE_STATE);
      }
      return Promise.resolve({ success: true });
    });
  });

  it('should cancel without sending SWITCH_SLOT when the overlay is clicked', async () => {
    render(<SidebarApp />);
    await openDeleteConfirm();

    const overlay = document.querySelector('.tbs-dialog-overlay');
    if (overlay === null) throw new Error('dialog overlay not found');
    fireEvent.click(overlay);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // The overlay click is a pure cancel — it must NOT bubble into the row.
    expect(switchCalls()).toHaveLength(0);
    expect(unbindCalls()).toHaveLength(0);
  });

  it('should still switch when the row itself is clicked (guard: no over-blocking)', async () => {
    render(<SidebarApp />);
    await waitFor(() => {
      expect(screen.getByRole('listitem', { name: 'Slot 1: Example (Bound)' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('listitem', { name: 'Slot 1: Example (Bound)' }));

    await waitFor(() => {
      expect(switchCalls()).toHaveLength(1);
    });
  });
});