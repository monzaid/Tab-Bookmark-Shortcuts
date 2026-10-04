/**
 * F4 (a11y) — closing a modal opened from the slot `⋯` menu must return focus
 * to the `⋯` trigger, not to `<body>`.
 *
 * `Dialog` captures `document.activeElement` in its open effect. On the REAL
 * menu path the clicked element (`role="menuitem"`) is unmounted in the same
 * commit (`setMenuOpen(false)`), so the browser has already moved focus to
 * `<body>` by the time the effect runs. `previousFocus` therefore becomes
 * `<body>` and Escape drops the user at the top of the document.
 *
 * The pre-existing a11y suite masks this by calling `trigger.focus()` manually,
 * which is not what the browser does — this test reproduces the browser
 * behaviour (the menu item receives focus from the click, then disappears).
 *
 * RED guard: pre-fix `document.activeElement` after Escape is `<body>`.
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
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true,
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

/**
 * Open the slot-1 icon modal the way a user does: click `⋯`, click
 * `Change Icon…`. The menu item is focused first (browsers focus a button on
 * click), so it holds focus when it is unmounted.
 */
async function openIconModalViaMenu(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });
  const trigger = screen.getByRole('button', { name: 'More options for slot 1' });
  fireEvent.click(trigger);

  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: 'Change Icon…' })).toBeInTheDocument();
  });
  const menuItem = screen.getByRole('menuitem', { name: 'Change Icon…' });
  // Browsers move focus to the clicked button; jsdom does not do this for us.
  menuItem.focus();
  fireEvent.click(menuItem);

  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  return trigger;
}

describe('F4 — focus returns to the real menu trigger after closing a modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve(BASE_STATE));
  });

  it('should return focus to the ⋯ trigger after Escape closes the icon modal', async () => {
    render(<SidebarApp />);
    const trigger = await openIconModalViaMenu();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(trigger);
  });

  it('should return focus to the ⋯ trigger after the delete confirm is cancelled via Escape', async () => {
    render(<SidebarApp />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
    });
    const trigger = screen.getByRole('button', { name: 'More options for slot 1' });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Clear Slot Data' })).toBeInTheDocument();
    });
    const menuItem = screen.getByRole('menuitem', { name: 'Clear Slot Data' });
    menuItem.focus();
    fireEvent.click(menuItem);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(trigger);
  });
});