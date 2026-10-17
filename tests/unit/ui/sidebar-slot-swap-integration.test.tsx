/**
 * T21 — the DRAG path end to end, all FOUR operand combinations (D3/D13/D17).
 *
 * What jsdom CAN and CANNOT prove (D19 honesty requirement):
 * jsdom has no drag-and-drop engine, so `fireEvent.dragStart/dragOver/drop` are
 * driven by hand with a hand-written `DataTransfer` stub — the SAME device the tag
 * chip input already uses (`tag-chip-input.test.tsx:1056-1074`). That proves the
 * MECHANISM: which payload `dragstart` writes, which drops are accepted, that
 * exactly one `SWAP_SLOTS` leaves the UI, and which undo entry follows. It does
 * NOT prove that a real browser paints a drag image. The `Alt` gesture and its
 * menu-suppression measurement (the V1 human check) are NOT part of this batch and
 * are asserted nowhere in this repo.
 *
 * The stub deliberately omits `setDragImage`: jsdom's `DataTransfer` has no such
 * method, so the production call must be OPTIONAL-CHAINED or this file throws.
 *
 * The four cases and what each one means (D3: an empty slot is a LEGAL operand):
 * - occupied ↔ occupied : the two contents EXCHANGE
 * - occupied ↔ empty    : the content MOVES, the source becomes empty
 * - empty    ↔ occupied  : the mirror of the above
 * - empty    ↔ empty     : NOTHING is sent — the UI refuses it before the wire
 *                          (D17), because two empty slots have nothing to swap.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();
const mockTabsQuery = vi.fn();

/**
 * A MUTABLE slice of the slot table, so `SWAP_SLOTS` can actually move a record
 * and the following `GET_STATE` refresh shows the new arrangement — the "list
 * updates" half of the round trip. Slots 1 and 3 start occupied.
 */
type FakeSlot = {
  id: number;
  urlMatch: { type: string; value: string };
  strategy: string;
  uiMarker: { customTitle: string };
  titleSnapshot: string;
  faviconSnapshot: string;
  createdAt: string;
  updatedAt: string;
};

function freshSlots(): FakeSlot[] {
  return [
    {
      id: 1,
      urlMatch: { type: 'exact', value: 'https://one.example' },
      strategy: 'inherit',
      uiMarker: { customTitle: 'One' },
      titleSnapshot: 'One',
      faviconSnapshot: '',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 3,
      urlMatch: { type: 'exact', value: 'https://three.example' },
      strategy: 'inherit',
      uiMarker: { customTitle: 'Three' },
      titleSnapshot: 'Three',
      faviconSnapshot: '',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];
}

function stateWith(slots: FakeSlot[]): unknown {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
        switchDirection: 'next',
        autoBindGlobal: true,
        slots,
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
}

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

/** Every `UNDO_SAVE` payload. */
const undos = (): unknown[] =>
  mockSendMessage.mock.calls
    .filter((call) => (call[0] as { action?: string }).action === 'UNDO_SAVE')
    .map((call) => (call[0] as { payload?: unknown }).payload);

/** A `DataTransfer` with exactly the surface jsdom has; no `setDragImage`. */
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

/** The title shown on row `index` (0-based). */
function rowTitle(index: number): string {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.tbs-slot-row'));
  return rows[index].querySelector('.tbs-slot-row__title')?.textContent ?? '';
}

let slots: FakeSlot[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  slots = freshSlots();
  mockTabsQuery.mockResolvedValue([]);
  mockSendMessage.mockImplementation((message: { action?: string; payload?: { sourceSlotId?: number; targetSlotId?: number } }) => {
    if (message.action === 'GET_STATE') return Promise.resolve(stateWith(slots));
    if (message.action === 'SWAP_SLOTS') {
      // Mirror the worker: exchange the two records' CONTENTS, keeping each
      // number's identity (D2). Empty↔empty never reaches here (the UI refuses).
      const source = slots.find((s) => s.id === message.payload?.sourceSlotId);
      const target = slots.find((s) => s.id === message.payload?.targetSlotId);
      slots = slots.filter(
        (s) => s.id !== message.payload?.sourceSlotId && s.id !== message.payload?.targetSlotId,
      );
      if (target) slots.push({ ...target, id: message.payload?.sourceSlotId as number });
      if (source) slots.push({ ...source, id: message.payload?.targetSlotId as number });
      // A10/Z1: the swap carries the undo `captureId`, so the UI can name it.
      return Promise.resolve({ success: true, configVersion: 2, changed: true, captureId: 9 });
    }
    if (message.action === 'UNDO_SAVE') return Promise.resolve({ success: true });
    return Promise.resolve({ result: { success: true } });
  });
});

/** Drag `fromIndex` onto `toIndex` through the real handlers. */
function drag(fromIndex: number, toIndex: number): { transfer: ReturnType<typeof makeTransfer> } {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.tbs-slot-row'));
  const transfer = makeTransfer();
  fireEvent.dragStart(rows[fromIndex], { dataTransfer: transfer });
  fireEvent.dragOver(rows[toIndex], { dataTransfer: transfer });
  fireEvent.drop(rows[toIndex], { dataTransfer: transfer });
  return { transfer };
}

describe('T21 — the drag round trip for all four operand combinations', () => {
  it('occupied ↔ occupied: the two contents exchange, one bar appears, and Undo names the swap', async () => {
    // Rows 1 and 3 hold "One" and "Three".
    await renderApp();
    expect(rowTitle(0)).toContain('One');
    expect(rowTitle(2)).toContain('Three');

    drag(0, 2);

    await waitFor(() => { expect(swaps()).toEqual([{ sourceSlotId: 1, targetSlotId: 3 }]); });

    // The list itself updates (that is why D25-④ sends NO success toast).
    await waitFor(() => {
      expect(rowTitle(0)).toContain('Three');
      expect(rowTitle(2)).toContain('One');
    });

    // Exactly ONE undoable action, naming both numbers (D25-③ wording).
    const bar = await screen.findByRole('status');
    expect(bar.textContent).toContain('Slots 1 and 3 swapped');

    // Undo replays THAT capture through the shared background channel (U1/A10).
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => { expect(undos()).toEqual([{ slotId: 1, captureId: 9 }]); });
  });

  it('occupied ↔ empty: the content MOVES to the empty slot and the source becomes empty', async () => {
    await renderApp();
    expect(rowTitle(0)).toContain('One');

    // Row 1 (occupied) onto row 7 (empty).
    drag(0, 6);

    await waitFor(() => { expect(swaps()).toEqual([{ sourceSlotId: 1, targetSlotId: 7 }]); });
    await waitFor(() => {
      expect(rowTitle(0)).toContain('Slot 1'); // the fallback title ⇒ now empty
      expect(rowTitle(6)).toContain('One');
    });
  });

  it('empty ↔ occupied: the mirror — the empty source receives the content', async () => {
    await renderApp();
    expect(rowTitle(2)).toContain('Three');

    // Row 7 (empty) onto row 3 (occupied).
    drag(6, 2);

    await waitFor(() => { expect(swaps()).toEqual([{ sourceSlotId: 7, targetSlotId: 3 }]); });
    await waitFor(() => {
      expect(rowTitle(6)).toContain('Three');
      expect(rowTitle(2)).toContain('Slot 3');
    });
  });

  it('empty ↔ empty: the UI refuses it — nothing is sent, because there is nothing to swap', async () => {
    // D17: two empty slots (rows 2 and 4) have no contents to exchange, so the
    // list does not initiate at all. The worker's own `changed:false` remains the
    // boundary; this is the local half of that layered check.
    await renderApp();

    drag(1, 3);

    await act(async () => { await Promise.resolve(); });
    expect(swaps()).toEqual([]);
    // No message ⇒ no bar (there is nothing to undo).
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('T21 — the swap is undoable exactly once, per entry (U1/U6/Z1)', () => {
  it('a successful swap stacks a bar; consuming it sends its own captureId', async () => {
    await renderApp();

    drag(0, 2);
    await waitFor(() => { expect(swaps()).toEqual([{ sourceSlotId: 1, targetSlotId: 3 }]); });

    const undoButtons = await screen.findAllByRole('button', { name: 'Undo' });
    expect(undoButtons).toHaveLength(1);

    fireEvent.click(undoButtons[0]);
    await waitFor(() => { expect(undos()).toEqual([{ slotId: 1, captureId: 9 }]); });

    // The bar was consumed — a second click cannot replay the same capture.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });
    expect(undos()).toHaveLength(1);
  });

  /**
   * D25-② (R2) — a version conflict gets its OWN copy.
   *
   * The design reuses the sentence the rule editor already shows
   * (`Slot data changed elsewhere. Refresh and try again.`) so a user who has seen
   * that one does not have to learn a second way of saying it. Before R2 every
   * failure collapsed into the generic `Failed to swap slots X and Y`, which told
   * a user whose data had merely gone stale nothing actionable.
   */
  /**
   * Reported defect 2: "Failed to swap slots x and y" appeared although the data
   * HAD swapped. The cause was a `TIMEOUT` response — the worker's budget elapsed
   * while its write completed (its own comment: "a write that overruns is NOT
   * cancelled"). Asserting failure there is a claim the UI cannot support, so it
   * must say the outcome is unknown and re-read the list instead.
   */
  it('a TIMEOUT is reported as "unknown", not as a failure', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') return Promise.resolve(stateWith(slots));
      if (message.action === 'SWAP_SLOTS') {
        return Promise.resolve({ success: false, errorCode: 'TIMEOUT', message: 'Worker response timed out' });
      }
      return Promise.resolve({ success: true });
    });

    render(<SidebarApp />);
    const title = await screen.findByText('One');
    const row = title.closest('.tbs-slot-row') as HTMLElement;
    const number = row.querySelector('.tbs-slot-row__number') as HTMLElement;

    const transfer = makeTransfer();
    fireEvent.dragStart(number, { dataTransfer: transfer });
    const targetRow = (await screen.findByText('Three')).closest('.tbs-slot-row') as HTMLElement;
    fireEvent.dragOver(targetRow, { dataTransfer: transfer });
    fireEvent.drop(targetRow, { dataTransfer: transfer });

    await waitFor(() => { expect(swaps()).toHaveLength(1); });
    expect(await screen.findByText(/taking longer than expected/i)).toBeInTheDocument();
    // The false claim must be gone.
    expect(screen.queryByText(/^Failed to swap slots/)).toBeNull();
  });

  it('shows the conflict-specific copy for CONFIG_CONFLICT, not the generic line', async () => {
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') return Promise.resolve(stateWith(slots));
      if (message.action === 'SWAP_SLOTS') {
        return Promise.resolve({ success: false, errorCode: 'CONFIG_CONFLICT', message: 'version mismatch' });
      }
      return Promise.resolve({ success: true });
    });

    render(<SidebarApp />);
    const title = await screen.findByText('One');
    const row = title.closest('.tbs-slot-row') as HTMLElement;
    const number = row.querySelector('.tbs-slot-row__number') as HTMLElement;

    const transfer = makeTransfer();
    fireEvent.dragStart(number, { dataTransfer: transfer });
    const targetRow = (await screen.findByText('Three')).closest('.tbs-slot-row') as HTMLElement;
    fireEvent.dragOver(targetRow, { dataTransfer: transfer });
    fireEvent.drop(targetRow, { dataTransfer: transfer });

    await waitFor(() => { expect(swaps()).toHaveLength(1); });
    // The dedicated sentence, and NOT the generic one.
    expect(await screen.findByText('Slot data changed elsewhere. Refresh and try again.')).toBeInTheDocument();
    expect(screen.queryByText(/^Failed to swap slots/)).toBeNull();
  });
});
