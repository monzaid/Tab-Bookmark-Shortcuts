/**
 * T15/T16 — swapping two slots' contents from the sidebar: the DRAG path (D8/D9)
 * and the `⋯` menu path (D10/D23/D24).
 *
 * What jsdom CAN and CANNOT prove here (D19 honesty requirement):
 * jsdom has no drag-and-drop engine, so `fireEvent.dragStart/dragOver/drop` are
 * driven by hand with a hand-written `DataTransfer` stub (the SAME device the tag
 * chip input already uses, `tag-chip-input.test.tsx:1056-1074`). That proves the
 * MEchanism — which payload is written at `dragstart`, which drop is accepted, and
 * that exactly one `SWAP_SLOTS` leaves the UI. It does NOT prove that the real
 * browser paints a drag image, nor that `Alt` suppresses a menu (the latter is the
 * V1 human check and is deliberately NOT asserted anywhere in this repo).
 *
 * The stub deliberately omits `setDragImage`: jsdom's `DataTransfer` has no such
 * method, so the production call must be OPTIONAL-CHAINED or this file throws.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();
const mockTabsQuery = vi.fn();

/** Slots 1 and 3 are OCCUPIED; 2 and 4..10 are empty (the swap operands). */
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
        {
          id: 3,
          urlMatch: { type: 'exact', value: 'https://news.example' },
          strategy: 'inherit',
          uiMarker: { customTitle: 'News' },
          titleSnapshot: 'News',
          faviconSnapshot: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      rules: [],
    },
    local: {
      bindings: [
        { slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' },
        { slotId: 3, tabId: 43, windowId: 1, boundAt: '2026-01-01T00:00:00Z' },
      ],
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

/** Every `SWITCH_SLOT` payload — what "the row was activated" means. */
const switches = (): unknown[] =>
  mockSendMessage.mock.calls
    .filter((call) => (call[0] as { action?: string }).action === 'SWITCH_SLOT')
    .map((call) => (call[0] as { payload?: unknown }).payload);

/**
 * A `DataTransfer` with EXACTLY the surface jsdom has: `setData`, `getData`,
 * `effectAllowed`, `dropEffect`. `setDragImage` is absent on purpose (see header).
 */
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

async function renderApp(): Promise<HTMLElement[]> {
  render(<SidebarApp />);
  await waitFor(() => {
    if (document.querySelectorAll('.tbs-slot-row').length !== 10) {
      throw new Error('ten slot rows not rendered yet');
    }
  });
  return Array.from(document.querySelectorAll<HTMLElement>('.tbs-slot-row'));
}

describe('T15 — dragging one slot onto another (D8/D9/D13/D22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabsQuery.mockResolvedValue([]);
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') return Promise.resolve(BOUND_STATE);
      // The worker's real reply is flat (it returns `swapSlots`'s result directly).
      if (message.action === 'SWAP_SLOTS') {
        return Promise.resolve({ success: true, configVersion: 2, changed: true, captureId: 9 });
      }
      return Promise.resolve({ result: { success: true } });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dragging row 1 onto row 7 sends exactly ONE SWAP_SLOTS with that payload', async () => {
    const rows = await renderApp();
    const transfer = makeTransfer();

    fireEvent.dragStart(rows[0], { dataTransfer: transfer });
    fireEvent.dragOver(rows[6], { dataTransfer: transfer });
    fireEvent.drop(rows[6], { dataTransfer: transfer });

    await waitFor(() => {
      expect(swaps()).toEqual([{ sourceSlotId: 1, targetSlotId: 7 }]);
    });
  });

  it('dropping a slot back onto itself sends nothing', async () => {
    const rows = await renderApp();
    const transfer = makeTransfer();

    fireEvent.dragStart(rows[0], { dataTransfer: transfer });
    fireEvent.dragOver(rows[0], { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('none'); // D13: the forbidden cursor is shown.
    fireEvent.drop(rows[0], { dataTransfer: transfer });

    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toEqual([]);
  });

  /**
   * SUPERSEDED CONTRACT — the guard used to REFUSE a swap involving a row that was
   * mid-edit, because the row's editor committed by slot NUMBER and a swap would make
   * its draft land in a record that had moved.
   *
   * The editor no longer works that way: its state is owned by the list and addressed
   * by the RECORD it describes, so a swap can hand the open editor to the slot the
   * data moved to — which is what the user expects ("the edit follows the data").
   * The refusal is therefore gone for the INLINE editors, and this test now asserts
   * the migration instead. (The icon MODAL still refuses; it captured a bare slotId.)
   */
  it('dropping onto a row that is being edited SWAPS and moves the editor (was: refused)', async () => {
    const rows = await renderApp();

    // Put row 1 (slot 1) into TITLE edit mode and type something.
    fireEvent.doubleClick(document.querySelector('.tbs-slot-row__title') as HTMLElement);
    const titleInput = await waitFor(() => screen.getByLabelText('Rename slot 1'));
    fireEvent.change(titleInput, { target: { value: 'Renamed one' } });
    expect((titleInput as HTMLInputElement).value).toBe('Renamed one');

    // Drag slot 3 onto slot 1.
    const transfer = makeTransfer();
    fireEvent.dragStart(rows[2], { dataTransfer: transfer });
    fireEvent.dragOver(rows[0], { dataTransfer: transfer });
    fireEvent.drop(rows[0], { dataTransfer: transfer });

    await waitFor(() => {
      expect(swaps()).toEqual([{ sourceSlotId: 3, targetSlotId: 1 }]);
    });

    // The swap HAPPENED, and the draft travelled with its record: slot 3's data is
    // now at slot 1, so the editor that described it is edited under slot 3.
    await waitFor(() => {
      expect(screen.getByLabelText('Rename slot 3')).toBeInTheDocument();
    });
    expect((screen.getByLabelText('Rename slot 3') as HTMLInputElement).value).toBe('Renamed one');
    expect(screen.queryByLabelText('Rename slot 1')).toBeNull();
  });

  it('dragstart cancels the row activation timer that a preceding click armed', async () => {
    const rows = await renderApp();
    vi.useFakeTimers();

    // A lone click arms the deferred activation (the double-click fix)...
    fireEvent.click(rows[0], { detail: 1 });
    // ...and starting a drag must defuse it: the user is dragging, not activating.
    const transfer = makeTransfer();
    fireEvent.dragStart(rows[0], { dataTransfer: transfer });

    act(() => { vi.advanceTimersByTime(2000); });

    expect(switches()).toEqual([]);
  });

  it('the TITLE text element cancels its own dragstart, keeping text selection (D9/A8)', async () => {
    await renderApp();
    const title = document.querySelector('.tbs-slot-row__title') as HTMLElement;
    expect(title).not.toBeNull();

    // A real `dragstart` always carries a `dataTransfer`, so one is supplied here
    // too. The event then BUBBLES to the row's own handler (React invokes every
    // handler on the propagation path, and `preventDefault` does not stop that) —
    // which is precisely the D9/A8 arrangement: the text cancels the drag at its
    // own element, and the row's handler runs harmlessly on an already-cancelled
    // drag. `fireEvent` returns false because the default WAS prevented.
    expect(fireEvent.dragStart(title, { dataTransfer: makeTransfer() })).toBe(false);
  });

  it('the URL text element cancels its own dragstart too', async () => {
    await renderApp();
    const url = document.querySelector('.tbs-slot-row__url') as HTMLElement;
    expect(url).not.toBeNull();
    expect(fireEvent.dragStart(url, { dataTransfer: makeTransfer() })).toBe(false);
  });
});

describe('T16 — the ⋯ menu swap control (D10/D23/D24)', () => {
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

  /**
   * Open slot 3's `⋯` menu and FOCUS the swap field.
   *
   * The control is visible as soon as the menu opens, but it does not take focus by
   * itself — `⋯` offers seven actions and the user has not chosen one yet. Focus is
   * what raises the candidate list, so the helper does deliberately what the user
   * does: click the field.
   */
  async function openSwapPicker(): Promise<HTMLInputElement> {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'More options for slot 3' }));
    const input = await waitFor(() => {
      const field = screen.getByLabelText('Search target slot for slot 3');
      return field as HTMLInputElement;
    });
    fireEvent.focus(input);
    return input;
  }

  /** The candidate slot numbers currently offered, in order. */
  const offeredNumbers = (): string[] =>
    Array.from(document.querySelectorAll('.tbs-slot-swap__number')).map((n) => n.textContent ?? '');

  /**
   * The reported defect: the dialog said "Slot data changed elsewhere. Refresh and
   * try again." even though the swap HAD already applied.
   *
   * A repeated `Enter` (a held key emits repeated `keydown`) or Enter immediately
   * followed by a `Swap` click submitted the SAME swap twice. `closeSwapDialog()`
   * cannot prevent that — it only schedules a state change, so both calls have
   * already run by the time it takes effect. The two requests then raced: the
   * FIRST applied (the data really moved) while the SECOND failed its optimistic
   * version check and produced the conflict toast — a successful swap reported as
   * a conflict. ONE dialog submit must produce ONE message.
   */
  it('a repeated Enter keydown sends exactly ONE SWAP_SLOTS', async () => {
    const input = await openSwapPicker();
    // Narrow to slot 7 so the top candidate is the target.
    fireEvent.change(input, { target: { value: '7' } });
    // The events MUST be dispatched inside one batch. `fireEvent` flushes React
    // synchronously, so dispatching them separately would unmount the field after
    // the first Enter and the later events would hit a detached node — that is a
    // FALSE GREEN (verified: it passes even with the guard removed). Batching is
    // what reproduces the real double-action, and was confirmed to yield 2 sends
    // without the guard and 1 with it.
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter', repeat: true });
      fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    });

    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toHaveLength(1);
  });

  it('Enter followed by a rapid Swap click still sends only ONE', async () => {
    const input = await openSwapPicker();
    fireEvent.change(input, { target: { value: '7' } });
    const swapButton = screen.getByRole('button', { name: 'Swap' });

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.click(swapButton); // the second half of a fast double action
    });

    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toHaveLength(1);
  });

  it('two rapid candidate presses send only ONE', async () => {
    const input = await openSwapPicker();
    fireEvent.change(input, { target: { value: '7' } });
    const option = screen.getAllByRole('option')[0];

    act(() => {
      // `mouseDown`, not `click`: the handler is on mousedown on purpose (a click
      // would blur the field and close the list before landing — see the component).
      fireEvent.mouseDown(option);
      fireEvent.mouseDown(option);
    });

    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toHaveLength(1);
  });

  it('re-opening the menu allows a genuine second swap (the guard is not sticky)', async () => {
    // `openSwapPicker()` renders the app itself, so it may be used only ONCE per
    // test — the second open is done by hand on the same render.
    const input = await openSwapPicker();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toHaveLength(1);

    // A pick CLOSES the menu, so the second visit starts at the `⋯` button again.
    fireEvent.click(screen.getByRole('button', { name: 'More options for slot 3' }));
    const input2 = await screen.findByLabelText('Search target slot for slot 3');
    fireEvent.focus(input2);
    fireEvent.change(input2, { target: { value: '2' } });
    fireEvent.keyDown(input2, { key: 'Enter' });
    await waitFor(() => { expect(swaps()).toHaveLength(2); });
  });

  it('shows the swap control on open, in ONE row, WITHOUT stealing focus', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'More options for slot 3' }));

    // No "Swap with slot…" item to click first: the field is already here.
    expect(screen.queryByRole('menuitem', { name: 'Swap with slot…' })).toBeNull();
    const input = await screen.findByLabelText('Search target slot for slot 3');
    expect(screen.getByRole('button', { name: 'Swap' })).toBeInTheDocument();

    // `⋯` offers SEVEN actions and the user has not picked one. A caret blinking in
    // the swap field answers a question they have not asked, so focus stays put and
    // no candidates are raised until they click the field or Tab to it.
    expect(document.activeElement).not.toBe(input);
    expect(screen.queryByRole('listbox', { name: 'Target slots' })).toBeNull();

    // The description, the field and the button share ONE flex row — and the row
    // holds nothing else, because the list is its SIBLING (see the next test).
    const row = input.closest('.tbs-slot-swap');
    expect(row).not.toBeNull();
    const children = Array.from((row as HTMLElement).children).map((c) => c.className);
    expect(children.some((c) => c.includes('tbs-slot-swap__title'))).toBe(true);
    expect(children.some((c) => c.includes('tbs-slot-swap__search'))).toBe(true);
    expect(children.some((c) => c.includes('tbs-slot-swap__list'))).toBe(false);

    // And the menu's own entries are still there, undisturbed, below it.
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent);
    expect(items).toContain('Edit URL…');
    expect(items).toContain('Clear Slot Data');
  });

  it('renders the candidate list as a SIBLING of the row, so it cannot displace it', async () => {
    await openSwapPicker();

    // The list is NOT inside the one-row control. That matters for more than
    // tidiness: as a child of the row it would sit in the row's stacking context
    // and hang over the menu's entries; as a sibling it floats from the menu.
    // (The `position: absolute` that does the lifting is asserted in
    // `shared-component-styles.test.ts` — jsdom does not apply external CSS.)
    const list = document.querySelector('.tbs-slot-swap__list');
    const row = document.querySelector('.tbs-slot-swap');
    expect(list).not.toBeNull();
    expect(row).not.toBeNull();
    expect((row as Element).contains(list as Element)).toBe(false);
    // Both are children of the same menu, which is what makes the menu the anchor.
    expect(list?.parentElement).toBe(row?.parentElement);
    expect(list?.getAttribute('role')).toBe('listbox');
  });

  it('shows the candidates only while the field has focus', async () => {
    const input = await openSwapPicker();
    // Focused on open (the effect), so the list is up.
    expect(screen.queryByRole('listbox', { name: 'Target slots' })).not.toBeNull();

    // Losing focus takes the list with it, leaving the menu's own entries visible —
    // which is the whole point of gating on focus rather than showing it always.
    fireEvent.blur(input);
    expect(screen.queryByRole('listbox', { name: 'Target slots' })).toBeNull();

    fireEvent.focus(input);
    expect(screen.queryByRole('listbox', { name: 'Target slots' })).not.toBeNull();
  });

  it('searching 7 and pressing Enter sends SWAP_SLOTS {sourceSlotId: 3, targetSlotId: 7}', async () => {
    const input = await openSwapPicker();

    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(swaps()).toEqual([{ sourceSlotId: 3, targetSlotId: 7 }]);
    });
  });

  /**
   * The picker constrains the target BY CONSTRUCTION — it offers every slot in
   * 1..10 except the source — so the old "reject 0 / 11 / abc / self" table has no
   * counterpart to test: those values are not reachable. What IS worth asserting is
   * that construction itself, because it is what replaced the validation.
   */
  it('never offers the source slot, and offers every other slot', async () => {
    await openSwapPicker();

    // Slot 3 is the source, so it must not appear; 1..10 minus 3 leaves nine rows,
    // paged five at a time.
    expect(offeredNumbers()).toEqual(['1', '2', '4', '5', '6']);
    expect(offeredNumbers()).not.toContain('3');
  });

  it('pages the candidates five at a time with = and -', async () => {
    const input = await openSwapPicker();

    // First page (default) — five entries.
    expect(offeredNumbers()).toEqual(['1', '2', '4', '5', '6']);
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();

    fireEvent.keyDown(input, { key: '=' });
    expect(offeredNumbers()).toEqual(['7', '8', '9', '10']);

    fireEvent.keyDown(input, { key: '-' });
    expect(offeredNumbers()).toEqual(['1', '2', '4', '5', '6']);
  });

  it('names each candidate slot, and calls an empty one Empty (D24)', async () => {
    await openSwapPicker();

    const labels = Array.from(document.querySelectorAll('.tbs-slot-swap__label')).map((n) => n.textContent ?? '');
    // Page one is slots 1, 2, 4, 5, 6 (3 is the source and is excluded). Occupied
    // numbers carry their title; empty ones say so, because "is the target empty"
    // changes what the swap DOES (D3/D24).
    expect(offeredNumbers()).toEqual(['1', '2', '4', '5', '6']);
    expect(labels[0]).toBe('Example');
    expect(labels[1]).toBe('Empty');
    expect(labels[2]).toBe('Empty');
  });

  it('searching by label narrows the candidates, not just by number', async () => {
    const input = await openSwapPicker();

    // Slot 1 is 'Example'; slot 3 is the source, so its title is not searchable here.
    fireEvent.change(input, { target: { value: 'example' } });
    expect(offeredNumbers()).toEqual(['1']);
  });

  it('the Swap button acts on the highlighted candidate', async () => {
    const input = await openSwapPicker();

    // Arrow down highlights the FIRST candidate, so the button must send slot 1.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // `mouseDown` for the same reason as the candidate rows.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Swap' }));

    await waitFor(() => {
      expect(swaps()).toEqual([{ sourceSlotId: 3, targetSlotId: 1 }]);
    });
  });

  /**
   * REPORTED DEFECT (acceptance): clicking the swap field switched to the slot's
   * bound tab a moment later, throwing the user out of the sidebar mid-keystroke.
   *
   * The row activates on a DELAYED click (the delay is what lets a double-click be
   * an edit instead), and the menu's plain elements — the field, its button, the
   * floating candidates — do not stop propagation, so their clicks reached the
   * row's handler. The menu items that do stop it are the exception, not the rule.
   */
  it('clicking the swap field does NOT activate the row', async () => {
    const input = await openSwapPicker();
    vi.useFakeTimers();
    try {
      fireEvent.click(input);
      // Past the row's activation delay: a switch would have fired by now.
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(switches()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape clears the buffer first, without closing the menu', async () => {
    const input = await openSwapPicker();
    fireEvent.change(input, { target: { value: '7' } });

    // One press clears what was typed; the control (and the menu) stay put, so the
    // user can retype rather than being thrown back to the row.
    fireEvent.keyDown(input, { key: 'Escape' });

    expect((screen.getByLabelText('Search target slot for slot 3') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Swap' })).toBeInTheDocument();
  });
});

/**
 * R6 — a drop can carry FOREIGN data.
 *
 * `dataTransfer` on `drop` is not guaranteed to be ours: a drag can originate in
 * another page or another application entirely. Reading it as our own JSON and
 * taking `.slotId` blindly meant a cross-application drop could throw inside the
 * handler (and, before the guard, could even be shaped into a bogus number).
 *
 * The contract now is: anything that is not well-formed internal JSON with an
 * INTEGER `slotId` is treated as "not an internal drag" — the handler does not
 * throw, and the guards decide. Note this is the UI's OWN hardening, not a
 * replacement for the service layer's `isSlotNumber` boundary (UI is not the
 * boundary); it exists so the UI never emits a malformed message.
 */
describe('R6: foreign drop payloads are refused without an internal error', () => {
  const foreignPayloads: Array<[string, string]> = [
    ['not json at all', 'hello from another app'],
    ['valid JSON, wrong shape', '{"url":"https://example.com"}'],
    ['slotId is a string', '{"slotId":"7"}'],
    ['slotId is not an integer', '{"slotId":7.5}'],
    ['slotId is an object', '{"slotId":{"nested":1}}'],
    ['slotId is null', '{"slotId":null}'],
    ['empty JSON object', '{}'],
  ];

  for (const [name, payload] of foreignPayloads) {
    it(`rejects it quietly — ${name}`, async () => {
      // The signal that matters: React REPORTS a handler throw via console.error
      // and does NOT rethrow it out of `fireEvent` (verified by a throwaway probe
      // against a deliberately-throwing handler). So `expect(...).not.toThrow()`
      // would pass even with the unguarded read — it is a false green. Watching
      // `console.error` is what actually distinguishes the two implementations.
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const rows = await renderApp();
        const transfer = makeTransfer();
        transfer.setData('text/plain', payload);

        fireEvent.dragOver(rows[6], { dataTransfer: transfer });
        fireEvent.drop(rows[6], { dataTransfer: transfer });
        await act(async () => { await Promise.resolve(); });

        // Nothing was sent (already true pre-R6, since the throw precedes the send)…
        expect(swaps()).toEqual([]);
        // …and, the part R6 actually fixes, nothing threw inside the handler either.
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  }

  it('still accepts our OWN well-formed payload (the guard is not over-broad)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const rows = await renderApp();
      const transfer = makeTransfer();
      transfer.setData('text/plain', JSON.stringify({ slotId: 3 }));

      fireEvent.dragOver(rows[6], { dataTransfer: transfer });
      fireEvent.drop(rows[6], { dataTransfer: transfer });

      await waitFor(() => { expect(swaps()).toEqual([{ sourceSlotId: 3, targetSlotId: 7 }]); });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
