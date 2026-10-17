/**
 * T17 — the `Alt + ↑/↓` swap gesture (D11/D12/D17/A9).
 *
 * NOTE on what these tests can and cannot prove: jsdom has no browser menu bar,
 * so it cannot reproduce the "Alt opens the menu" that the suppression exists
 * for. What it CAN assert is the gesture's MECHANISM — that `keydown` cancels the
 * browser default for an armed `Alt`, that `keyup` is what commits, and that a
 * commit happens exactly once — which IS observable because the handler is what a
 * stray `keyup` would hit. It does NOT claim that the menu stayed shut, that focus
 * was never moved, or that "because the default was cancelled the keyup arrived";
 * those are the V1 human check (Windows Chrome) and are asserted NOWHERE in this
 * repo. Wording pattern quoted from `tests/unit/ui/sidebar-title-commit.test.tsx:17-22`:
 *
 *   "NOTE on what these tests can and cannot prove: jsdom does not move focus on
 *    `mousedown` (real browsers do), so it cannot reproduce the blur race itself.
 *    What it CAN assert is the fix's mechanism ... which IS observable because the
 *    guard is what a stray commit hits."
 *
 * The armed precondition (A9) is that `document.activeElement` is the row root, the
 * row is not mid-edit, and no `⋯` menu is open — so every case here focuses a row
 * first, because a gesture that is not armed must do nothing at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';
import { SWAP_GESTURE_TIMEOUT_MS } from '@ui/shared/use-swap-pending';

const mockSendMessage = vi.fn();
const mockTabsQuery = vi.fn();

/** Slot 1 is OCCUPIED (the gesture's source); 2..10 are empty. */
const BOUND_STATE = {
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

/** Every `SWAP_SLOTS` payload the sidebar sent. */
const swaps = (): unknown[] =>
  mockSendMessage.mock.calls
    .filter((call) => (call[0] as { action?: string }).action === 'SWAP_SLOTS')
    .map((call) => (call[0] as { payload?: unknown }).payload);

async function renderRows(): Promise<HTMLElement[]> {
  render(<SidebarApp />);
  await waitFor(() => {
    if (document.querySelectorAll('.tbs-slot-row').length !== 10) {
      throw new Error('ten slot rows not rendered yet');
    }
  });
  return Array.from(document.querySelectorAll<HTMLElement>('.tbs-slot-row'));
}

/** The wrapping boundary hint, if one is on screen (D25-⑤b / D17). */
const hint = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.tbs-slot-row__swap-hint');

beforeEach(() => {
  vi.clearAllMocks();
  mockTabsQuery.mockResolvedValue([]);
  mockSendMessage.mockImplementation((message: { action?: string }) => {
    if (message.action === 'GET_STATE') return Promise.resolve(BOUND_STATE);
    if (message.action === 'SWAP_SLOTS') {
      return Promise.resolve({ success: true, configVersion: 2, changed: true, captureId: 9 });
    }
    return Promise.resolve({ result: { success: true } });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T17 — arming and committing the Alt gesture (D11/A9)', () => {
  it('Alt+↓ twice moves the cursor two slots, and releasing Alt sends ONE SWAP_SLOTS (D11)', async () => {
    const rows = await renderRows();
    rows[0].focus(); // A9: the armed precondition is that a row root has focus.

    // Arming cancels the browser default for `Alt` — the mechanism the V1 check
    // measures in a real browser; here it only proves the call was made.
    expect(fireEvent.keyDown(document, { key: 'Alt', altKey: true })).toBe(false);

    // 1 → 2 → 3, two steps as D11's "move the cursor" model requires (an
    // immediate-swap model could only reach adjacent slots).
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });

    // The cursor is a TARGET, not a commit: nothing has gone out yet.
    expect(swaps()).toEqual([]);

    // Releasing `Alt` is what commits, once.
    fireEvent.keyUp(document, { key: 'Alt', altKey: false });

    await waitFor(() => {
      expect(swaps()).toEqual([{ sourceSlotId: 1, targetSlotId: 3 }]);
    });
    // Exactly one entry: the release is not re-entrant.
    expect(swaps()).toHaveLength(1);
  });

  it('arming and releasing Alt in place sends nothing and shows no hint (D17/C2)', async () => {
    const rows = await renderRows();
    rows[0].focus();

    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyUp(document, { key: 'Alt', altKey: false });

    await act(async () => { await Promise.resolve(); });

    // "In place, unmoved" is a no-op, so it must not be reported as "you hit the
    // end" (C2): neither a message nor the Top/Bottom hint.
    expect(swaps()).toEqual([]);
    expect(hint()).toBeNull();
  });

  it('the gesture only arms when a ROW ROOT has focus (A9)', async () => {
    const rows = await renderRows();
    // Focus a non-row control instead of the row root.
    screen.getByRole('button', { name: 'Open settings' }).focus();

    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });
    fireEvent.keyUp(document, { key: 'Alt', altKey: false });

    await act(async () => { await Promise.resolve(); });
    expect(rows).toHaveLength(10);
    expect(swaps()).toEqual([]);
  });
});

describe('T17 — a started drag ends the armed gesture (D13)', () => {
  it('dragstart cancels an armed Alt cursor, so the later keyup does not commit', async () => {
    const rows = await renderRows();
    rows[0].focus();

    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });

    // The user starts a drag instead. D13: the two inputs share ONE transient
    // state, so a drag must end the armed gesture (a later `↑`/`↓` would move an
    // operation the user believes they put down).
    fireEvent.dragStart(rows[0], { dataTransfer: makeTransfer() });

    fireEvent.keyUp(document, { key: 'Alt', altKey: false });
    await act(async () => { await Promise.resolve(); });

    expect(swaps()).toEqual([]);
  });
});

function makeTransfer(): {
  setData: (k: string, v: string) => void;
  getData: (k: string) => string;
  effectAllowed: string;
  dropEffect: string;
} {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => { data.set(k, v); },
    getData: (k: string) => data.get(k) ?? '',
    effectAllowed: '',
    dropEffect: '',
  };
}

describe('T17 — the boundary wraps and says so (D11/D17/D25-⑤b)', () => {
  it('slot 10 + Alt+↓ wraps the cursor to slot 1 and shows the ↓ Bottom hint, without committing', async () => {
    const rows = await renderRows();
    rows[9].focus(); // slot 10

    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });

    // D11 wrap: 10 → 1. The target is the wrapped slot, not "nowhere".
    await waitFor(() => {
      expect(rows[0].className).toContain('tbs-slot-row--swap-target');
    });

    // D17: hitting the end is announced with the SAME symbol as the key that
    // caused it, plus the Top/Bottom word (D25-⑤b).
    const hintEl = await waitFor(() => {
      const el = hint();
      if (!el) throw new Error('no boundary hint yet');
      return el;
    });
    expect(hintEl.textContent).toContain('↓');
    expect(hintEl.textContent).toContain('Bottom');

    // Still only held, not committed: the cursor moved, Alt was not released.
    expect(swaps()).toEqual([]);
  });
});

describe('T17 — the three cancellations all end it without committing (D12)', () => {
  it('Escape cancels an armed gesture', async () => {
    const rows = await renderRows();
    rows[0].focus();

    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(document, { key: 'Escape', altKey: true });
    fireEvent.keyUp(document, { key: 'Alt', altKey: false });

    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toEqual([]);
    expect(hint()).toBeNull();
  });

  /**
   * REPORTED DEFECT 2, and the reason `focusout` is no longer the cancel trigger.
   *
   * The user arms with Alt, presses an arrow once, and then simply HOLDS Alt while
   * deciding where to drop. Under the old code the gesture died ~3s later from
   * mere silence: the highlight vanished and the cursor appeared to snap back to
   * the original slot, with Alt still down. An arrow press then only moved one
   * step before it happened again.
   *
   * Silence is not evidence. This test holds for many seconds with no further
   * events and requires the gesture to be STILL ARMED — releasing must commit.
   */
  it('holds indefinitely while Alt is down (reported defect 2)', async () => {
    const rows = await renderRows();
    vi.useFakeTimers();

    rows[0].focus();
    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });

    // The REAL reported case: the user held Alt for a few seconds and the old 3s
    // timer killed the gesture. 20 seconds is far beyond that and still within any
    // sane safety net — the assertion is about the model, not a particular value.
    act(() => { vi.advanceTimersByTime(20_000); });

    // Still armed and still holding the moved target: releasing commits.
    fireEvent.keyUp(document, { key: 'Alt', altKey: false });
    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toHaveLength(1);
  });

  it('a window blur cancels an armed gesture (the release can no longer be seen)', async () => {
    const rows = await renderRows();
    rows[0].focus();

    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });

    // Alt+Tab: the page stops receiving the keyboard.
    fireEvent.blur(window);
    fireEvent.keyUp(document, { key: 'Alt', altKey: false });

    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toEqual([]);
  });

  it('the last-resort timeout still cleans up a keyup that never arrives', async () => {
    const rows = await renderRows();
    vi.useFakeTimers();

    rows[0].focus();
    fireEvent.keyDown(document, { key: 'Alt', altKey: true });
    fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });

    // No `keyup`, no blur, no other key — nothing can prove the release.
    act(() => { vi.advanceTimersByTime(SWAP_GESTURE_TIMEOUT_MS + 100); });

    fireEvent.keyUp(document, { key: 'Alt', altKey: false });
    expect(swaps()).toEqual([]);
    expect(hint()).toBeNull();
  });

  /**
   * Report 3: the gesture used to die under a user who was still working.
   *
   * The timeout was armed ONCE, on the arming `Alt` keydown, and never refreshed.
   * A user who armed, then spent a few seconds stepping through slots, had the
   * pending target cancelled underneath them — the highlight vanished and the
   * cursor appeared to snap back to the original slot, with Alt still held.
   *
   * Activity is positive evidence the gesture is alive, so each arrow press must
   * restart the idle countdown. This test alternates presses with 2s of silence
   * (each gap below the 3s backstop) and asserts the pending target SURVIVES and
   * advances; the pre-fix code would have cancelled at the first 3s mark.
   */
  it('stepping through slots does not let the backstop fire (report 3)', async () => {
    const rows = await renderRows();
    vi.useFakeTimers();

    rows[0].focus();
    fireEvent.keyDown(document, { key: 'Alt', altKey: true });

    // 2s of thinking, then a press; repeat. Total elapsed 8s — well past the 3s
    // backstop, but never 3s of IDLE time.
    for (let i = 0; i < 4; i += 1) {
      act(() => { vi.advanceTimersByTime(2000); });
      fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true });
    }

    // Still armed and still stepping: releasing now must COMMIT, not be a no-op.
    fireEvent.keyUp(document, { key: 'Alt', altKey: false });
    await act(async () => { await Promise.resolve(); });

    expect(swaps()).toHaveLength(1);
  });
});
