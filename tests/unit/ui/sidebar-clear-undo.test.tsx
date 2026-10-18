/**
 * Clear / reset operations are undoable.
 *
 * A7/A8 stay as decided (diagnostics, import), but every RESET-shaped write in the
 * sidebar now offers an undo: clearing or overwriting a title/icon at the tab or
 * slot tier is the class of mistake a user cannot otherwise reverse, and the chain
 * makes it silent — the value falls through to a lower tier and looks like "nothing
 * happened".
 *
 * These tests drive the REAL UI path (double-click the value, then its `⊘`) and then
 * REPLAY the undo, asserting the message the restore actually sends. Asserting the
 * message is the point: an undo entry that replays the wrong action, or the wrong
 * TIER, is worse than no undo at all.
 *
 * Follows `sidebar-title-commit.test.tsx`'s accessors — the same shapes, because
 * the message payload is read from `call[0].payload` and the editor is opened by
 * double-clicking the displayed value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const ACTIVE_TAB = { id: 7, url: 'https://example.com', title: 'Tab Title', favIconUrl: 'https://example.com/favicon.ico' };

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([ACTIVE_TAB]),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

/** Every payload sent for an action, in order. */
const payloadsOf = (action: string): Array<Record<string, unknown> | undefined> =>
  mockSendMessage.mock.calls
    .filter((call) => (call[0] as { action?: string }).action === action)
    .map((call) => (call[0] as { payload?: Record<string, unknown> }).payload);

/** Open the Current Page title editor. */
async function openTitleEditor(): Promise<HTMLInputElement> {
  render(<SidebarApp />);
  const displayed = await waitFor(() => {
    const el = document.querySelector('.tbs-sidebar__current-title');
    if (!el) throw new Error('current title not rendered yet');
    return el;
  });
  fireEvent.doubleClick(displayed);
  return await screen.findByLabelText('Rename current tab');
}

describe('clearing a value offers an undo that restores it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'GET_STATE') {
        return Promise.resolve({
          result: {
            success: true,
            sync: {
              configVersion: 1,
              matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
              switchDirection: 'next',
              autoBindGlobal: true,
              slots: [
                {
                  id: 1,
                  urlMatch: { type: 'exact', value: 'https://example.com' },
                  strategy: 'inherit',
                  uiMarker: { customTitle: 'Slot One' },
                  titleSnapshot: 'Slot One',
                  faviconSnapshot: '',
                  createdAt: '2026-01-01T00:00:00Z',
                  updatedAt: '2026-01-01T00:00:00Z',
                },
              ],
              rules: [],
              tags: [],
            },
            local: {
              bindings: [{ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
              cycleCursors: [],
              lastSuccessSlotId: null,
              recoverySessions: [],
              recoverySnapshots: [],
              // The tab being edited HAS an override, so clearing it has something
              // to restore and the entry must be pushed.
              tabOverrides: [{ tabId: 7, title: 'Tab Title' }],
              iconCache: {},
              diagnostics: [],
            },
          },
        });
      }
      return Promise.resolve({ result: { success: true } });
    });
  });

  it('the current page title clear offers an undo that writes the OLD value back', async () => {
    const input = await openTitleEditor();
    // `⊘` writes the override clear; the bar must then offer the value it removed.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Clear the page title override' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear the page title override' }));

    await waitFor(() => {
      expect(payloadsOf('SET_TAB_OVERRIDE')).toContainEqual({ tabId: 7, title: '' });
    });
    // The editor closed with the clear, so the bar is what is left on screen.
    expect(input).toBeDefined();

    fireEvent.click(await screen.findByRole('button', { name: /^Undo/ }));

    await waitFor(() => {
      expect(payloadsOf('SET_TAB_OVERRIDE')).toContainEqual({ tabId: 7, title: 'Tab Title' });
    });
  });

  it('the SLOT title clear replays a slot marker, never a tab override', async () => {
    render(<SidebarApp />);
    const displayed = await waitFor(() => {
      const el = document.querySelector('.tbs-slot-row__title');
      if (!el) throw new Error('slot title not rendered yet');
      return el;
    });
    fireEvent.doubleClick(displayed);
    await screen.findByLabelText('Rename slot 1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear the slot title for slot 1' }));

    await waitFor(() => {
      expect(payloadsOf('UPDATE_SLOT_UI_MARKER')).toContainEqual({ slotId: 1, uiMarker: { customTitle: '' } });
    });

    fireEvent.click(await screen.findByRole('button', { name: /^Undo/ }));

    await waitFor(() => {
      expect(payloadsOf('UPDATE_SLOT_UI_MARKER')).toContainEqual({ slotId: 1, uiMarker: { customTitle: 'Slot One' } });
    });
    // The tier must not be confused: replaying a tab override here would write to
    // the sidebar's current tab instead of the slot.
    expect(payloadsOf('SET_TAB_OVERRIDE')).not.toContainEqual(
      expect.objectContaining({ title: 'Slot One' }),
    );
  });
});
