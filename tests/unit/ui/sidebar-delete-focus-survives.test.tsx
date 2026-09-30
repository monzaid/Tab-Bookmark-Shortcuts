/**
 * N7 (P2/P3) — focus must survive the DESTRUCTIVE confirm path.
 *
 * F4 made `Dialog` restore focus to the `⋯` trigger. But on the real delete
 * path the trigger does not survive: `onConfirm` closes the dialog and calls
 * `onUnbind` → `loadState()` → the slot becomes unbound → `isEmpty` short-
 * circuits the actions section, so `⋯` is removed from the DOM. Focusing a
 * detached node is a no-op and the browser leaves focus on `<body>`, i.e. the
 * user is silently dropped out of the list right after deleting a slot.
 *
 * Expected: after confirming the delete, focus lands on a documented, stable
 * target — the slot row itself — never `<body>`.
 *
 * RED guard: pre-fix `document.activeElement` is `<body>`.
 *
 * RED baseline tree: U1–U9 + N5 + N6 applied working tree.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

const BOUND_STATE = {
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

/** After the unbind the background reports slot 1 as gone. */
const EMPTY_SLOT_STATE = {
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
};

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
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

describe('N7 — focus is not lost on the destructive delete path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let unbound = false;
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'UNBIND_SLOT') {
        unbound = true;
        return Promise.resolve({ success: true });
      }
      if (message.action === 'GET_STATE') {
        return Promise.resolve(unbound ? EMPTY_SLOT_STATE : BOUND_STATE);
      }
      return Promise.resolve({ result: { success: true, commands: [] } });
    });
  });

  it('should land focus on the slot row after confirming the delete', async () => {
    const user = userEvent.setup();
    render(<SidebarApp />);

    const moreButton = await screen.findByRole('button', { name: 'More options for slot 1' });
    await user.click(moreButton);

    const menuItem = await screen.findByRole('menuitem', { name: 'Delete Slot' });
    await user.click(menuItem);

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    await user.click(deleteButton);

    // The slot is now unbound: `⋯` (and the whole actions section) is gone.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'More options for slot 1' })).toBeNull();
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    // Focus must be user-visible somewhere stable — never dropped to <body>.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(
      screen.getByRole('listitem', { name: 'Slot 1: Slot 1 (Empty)' }),
    );
  });
});