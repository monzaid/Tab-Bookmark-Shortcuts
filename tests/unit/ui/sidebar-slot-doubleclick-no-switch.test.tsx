/**
 * Reported: double-clicking a slot's ICON, TITLE or URL to edit it switched to the
 * bound tab first, so the user was pulled away from the sidebar at the moment they
 * asked to change something — the intent of a double-click on those fields is to
 * EDIT, not to activate.
 *
 * ─── Root cause (and why the existing tests missed it) ───────────────────────
 *
 * The row carries `onClick={() => onSwitch(slot)}` (a single click activates the
 * slot), and each editable field carries `onDoubleClick` that calls
 * `e.stopPropagation()` and opens the editor.
 *
 * That `stopPropagation` is on the `dblclick` listener, but a real double-click
 * dispatches `click`, `click`, `dblclick` — so the first `click` has ALREADY
 * bubbled to the row and activated the slot before the editor ever opens. The
 * suppression was written against the wrong event.
 *
 * The existing suites could not catch it because `fireEvent.doubleClick` dispatches
 * ONLY `dblclick`; the two `click`s that the browser sends never happen, so the
 * row's handler is never reached. These tests therefore dispatch the REAL
 * sequence, which is the whole point: reproducing the browser's event order is
 * what makes the defect observable in jsdom at all.
 *
 * ─── What is asserted ────────────────────────────────────────────────────────
 *
 *  - a DOUBLE-click on icon / title / URL opens the editor and sends NO switch;
 *  - an ISOLATED click still activates the slot, so the fix suppresses a
 *    double-click's clicks rather than disabling the row's activation (the
 *    obvious wrong fix);
 *  - the guard is bounded in time, so activation cannot be swallowed forever.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();
const mockTabsQuery = vi.fn();

/** One slot, BOUND to tab 42 — `isBound` is what makes the fields editable. */
const BOUND_STATE = {
  result: {
    success: true,
    sync: {
      configVersion: 1,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [{
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: 'inherit',
        uiMarker: { customTitle: 'Example' },
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
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
    query: mockTabsQuery,
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

/** Every `SWITCH_SLOT` the sidebar sent — what "it jumped away" means. */
const switches = (): unknown[] =>
  mockSendMessage.mock.calls
    .filter((call) => (call[0] as { action?: string }).action === 'SWITCH_SLOT')
    .map((call) => (call[0] as { payload?: unknown }).payload);

/**
 * A REAL double-click: `click`, `click`, `dblclick`.
 *
 * Written out rather than `fireEvent.doubleClick` on purpose — the missing
 * `click`s are exactly the defect, so a helper that omitted them would test
 * nothing. `detail` is set because a real second click carries `detail: 2`.
 */
function realDoubleClick(el: Element): void {
  fireEvent.click(el, { detail: 1 });
  fireEvent.click(el, { detail: 2 });
  fireEvent.doubleClick(el);
}

async function renderBoundSlot(): Promise<HTMLElement> {
  render(<SidebarApp />);
  // The row only offers its fields once the binding has loaded.
  return await waitFor(() => {
    const row = document.querySelector<HTMLElement>('.tbs-slot-row');
    if (!row) throw new Error('slot row not rendered yet');
    return row;
  });
}

describe('a double-click on an editable slot field edits, and does not activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabsQuery.mockResolvedValue([]);
    mockSendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'GET_STATE') return Promise.resolve(BOUND_STATE);
      return Promise.resolve({ result: { success: true } });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the TITLE: opens the editor and sends no switch', async () => {
    await renderBoundSlot();
    const title = document.querySelector('.tbs-slot-row__title') as HTMLElement;
    expect(title).not.toBeNull();

    realDoubleClick(title);

    // The editor opened...
    await waitFor(() => {
      expect(screen.getByLabelText('Rename slot 1')).toBeInTheDocument();
    });
    // ...and the slot was NOT activated on the way in. One switch would mean the
    // sidebar navigated away before the user could type.
    expect(switches()).toEqual([]);
  });

  it('the ICON: opens the icon editor and sends no switch', async () => {
    await renderBoundSlot();
    const icon = document.querySelector('.tbs-slot-row__icon') as HTMLElement;
    expect(icon).not.toBeNull();

    realDoubleClick(icon);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(switches()).toEqual([]);
  });

  it('the URL: opens the URL editor and sends no switch', async () => {
    await renderBoundSlot();
    const url = document.querySelector('.tbs-slot-row__url') as HTMLElement;
    expect(url).not.toBeNull();

    realDoubleClick(url);

    await waitFor(() => {
      expect(screen.getByLabelText('Edit URL for slot 1')).toBeInTheDocument();
    });
    expect(switches()).toEqual([]);
  });

  it('an ISOLATED click still activates the slot', async () => {
    // The wrong fix would be to stop the row switching at all. A single click is
    // still the activation gesture, and it must not be collateral damage.
    await renderBoundSlot();
    const row = document.querySelector('.tbs-slot-row') as HTMLElement;

    fireEvent.click(row, { detail: 1 });

    await waitFor(() => {
      expect(switches()).toEqual([{ slotId: 1 }]);
    });
  });

  it('activation is not swallowed for the NEXT click after a double-click', async () => {
    // The guard must be BOUNDED, not sticky: after the editing gesture the row is
    // still the way to activate the slot, and a guard that never expired would
    // silently break that.
    await renderBoundSlot();
    const title = document.querySelector('.tbs-slot-row__title') as HTMLElement;
    realDoubleClick(title);
    await waitFor(() => {
      expect(screen.getByLabelText('Rename slot 1')).toBeInTheDocument();
    });
    expect(switches()).toEqual([]);

    // Leave the editor, wait past the guard's window, then click the row.
    fireEvent.blur(screen.getByLabelText('Rename slot 1'));
    const row = document.querySelector('.tbs-slot-row') as HTMLElement;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    fireEvent.click(row, { detail: 1 });

    await waitFor(() => {
      expect(switches()).toEqual([{ slotId: 1 }]);
    });
  });
});
