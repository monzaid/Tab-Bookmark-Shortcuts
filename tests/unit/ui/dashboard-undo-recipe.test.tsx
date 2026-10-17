/**
 * FIX-A — the settings Undo must replay the ORIGINAL `IconSource`.
 *
 * The snapshot used to hold the chain's winner VALUE (a string). For a recipe
 * that value is a derived render (R2/FIX-B), and the replay wrapped it in
 * `{type:'upload', value}` — so clearing a recipe icon and pressing Undo
 * PERMANENTLY flattened the recipe to a bitmap (C1/A6: the recipe is the only
 * durable truth; a render is a cache and must never become it).
 *
 * The assertions are STRUCTURAL, not "the render happens to match": we assert
 * the persisted payload keeps `type:'template'` with intact recipe fields. A
 * jsdom render-result comparison would pass even with the old bug (the PNG is
 * a valid icon), which is exactly the false-green class we must avoid.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';
import { resolveFieldChain } from '@shared/field-chain';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';
import type { ChainResult } from '@shared/field-chain';
import type { DashboardRow, IconSource, TabOverride, SyncState, LocalState } from '@shared/types';

const RECIPE: IconSource = {
  type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF',
};
const PNG = 'data:image/png;base64,OVERRIDEPNG';

/** A chain whose favicon tier is the materialized override (as the backend sends). */
function overrideChainWithRender(): ChainResult {
  const sync: SyncState = createDefaultSyncState();
  const local: LocalState = {
    ...createDefaultLocalState(),
    tabOverrides: [{ tabId: 7, favicon: { ...RECIPE, value: PNG }, createdAt: '2026-01-01T00:00:00Z' } as TabOverride],
  };
  return resolveFieldChain('favicon', { sync, local, tabId: 7, tabUrl: 'https://a.com/' });
}

/**
 * The state GET_STATE returns in PRODUCTION: FIX-B materializes the override
 * recipe at the read boundary, so its `value` is the rendered PNG while the
 * recipe fields remain intact. A mock that returned the persisted `value:''`
 * would bypass that materialization and test nothing.
 */
const materializedLocal: LocalState = {
  ...createDefaultLocalState(),
  tabOverrides: [{ tabId: 7, favicon: { ...RECIPE, value: PNG }, createdAt: '2026-01-01T00:00:00Z' } as TabOverride],
};

let rows: DashboardRow[] = [];

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string }) => {
  if (msg.action === 'GET_DASHBOARD') return { result: { success: true, rows } };
  if (msg.action === 'GET_STATE') return { result: { success: true, sync: rawSync, local: materializedLocal } };
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() }, getURL: (p: string) => p },
  tabs: { query: vi.fn().mockResolvedValue([]), get: vi.fn(), update: vi.fn(), create: vi.fn(), onActivated: { addListener: vi.fn(), removeListener: vi.fn() }, onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

const rawSync: SyncState = createDefaultSyncState();

function row(): DashboardRow {
  return {
    id: 'cp-7',
    kind: 'override',
    label: 'Tab 7',
    url: 'https://a.com/',
    anchor: { kind: 'override', tabId: 7 },
    tabId: 7,
    chain: { title: resolveFieldChain('title', { sync: rawSync, local: materializedLocal, tabId: 7, tabUrl: 'https://a.com/' }), favicon: overrideChainWithRender() },
    delivery: 'ok',
  };
}

/**
 * Every undo bar on screen, in stack order (U1 makes bars stackable).
 *
 * A bare `getByRole('button', {name:'Undo'})` both throws on a second bar and, in
 * `getAll` form, would let "exactly one action" pass while several are stacked —
 * so call sites use this helper with an explicit expected count.
 */
const undoBars = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.tbs-undo-bar'));

async function openDashboard() {
  render(<SettingsApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Data Dashboard' }));
  await waitFor(() => {
    expect(screen.getByRole('table', { name: 'Set icons and titles' })).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
});

describe('FIX-A: settings Undo replays the original IconSource', () => {
  it('a recipe icon survives Clear → Undo as a RECIPE (not an upload)', async () => {
    rows = [row()];
    await openDashboard();

    // Expand the row so the per-field editors (and their Clear buttons) render.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    const clearIcon = await screen.findByRole('button', { name: 'Clear icon' });
    fireEvent.click(clearIcon);

    // The undo bar appears; press Undo. Scoped to the bar and count-checked: one
    // Clear is one undoable action, and a singular `getByRole` would throw once the
    // bars can stack (U1) — or, worse, silently accept the wrong bar.
    await waitFor(() => { expect(undoBars()).toHaveLength(1); });
    fireEvent.click(within(undoBars()[0]).getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      const undoWrite = mockSendMessage.mock.calls
        .map((c) => c[0] as { action: string; payload?: { favicon?: IconSource | null } })
        .find((m) => m.action === 'SET_TAB_OVERRIDE' && m.payload?.favicon != null);
      expect(undoWrite).toBeTruthy();
    });

    const payload = mockSendMessage.mock.calls
      .map((c) => c[0] as { action: string; payload?: { favicon?: IconSource | null } })
      .find((m) => m.action === 'SET_TAB_OVERRIDE' && m.payload?.favicon != null)!.payload!;

    // STRUCTURAL: the recipe identity is preserved, field by field.
    expect(payload.favicon).toEqual(RECIPE);
    expect(payload.favicon!.type).toBe('template');
    expect(payload.favicon!.backgroundColor).toBe('#2563EB');
    expect(payload.favicon!.text).toBe('A');
    expect(payload.favicon!.textColor).toBe('#FFFFFF');
    // And NOT the flattened form.
    expect(payload.favicon!.value).not.toContain('data:image');
  });

  it('the raw recipe value stays EMPTY in the replayed payload (never the render)', async () => {
    rows = [row()];
    await openDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear icon' }));
    // One Clear ⇒ one bar; scoped click (see the comment on the first case).
    await waitFor(() => { expect(undoBars()).toHaveLength(1); });
    fireEvent.click(within(undoBars()[0]).getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      const wrote = mockSendMessage.mock.calls
        .map((c) => c[0] as { action: string; payload?: { favicon?: IconSource | null } })
        .some((m) => m.action === 'SET_TAB_OVERRIDE' && m.payload?.favicon != null);
      expect(wrote).toBe(true);
    });

    const payload = mockSendMessage.mock.calls
      .map((c) => c[0] as { action: string; payload?: { favicon?: IconSource | null } })
      .find((m) => m.action === 'SET_TAB_OVERRIDE' && m.payload?.favicon != null)!.payload!;
    expect(payload.favicon!.value).toBe('');
  });
});

describe('T10 (U1/U4): every Dashboard Clear shares ONE undo stack', () => {
  /** A second override row (tab 8), so two independent Clears are possible. */
  function secondRow(): DashboardRow {
    const local: LocalState = {
      ...createDefaultLocalState(),
      tabOverrides: [{ tabId: 8, title: 'Eight', createdAt: '2026-01-01T00:00:00Z' }],
    };
    return {
      id: 'cp-8',
      kind: 'override',
      label: 'Tab 8',
      url: 'https://b.com/',
      anchor: { kind: 'override', tabId: 8 },
      tabId: 8,
      chain: {
        title: resolveFieldChain('title', { sync: rawSync, local, tabId: 8, tabUrl: 'https://b.com/' }),
        favicon: resolveFieldChain('favicon', { sync: rawSync, local, tabId: 8, tabUrl: 'https://b.com/' }),
      },
      delivery: 'ok',
    };
  }

  it('two rows cleared give TWO bars; the first restores only its own row', async () => {
    rows = [row(), secondRow()];
    await openDashboard();

    // Clear the title on row 7, then on row 8 — two independent actions.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear title' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 8' }));
    // Two identical "Clear title" buttons now exist (both rows expanded); the
    // second one belongs to row 8's editor, which is the LAST to mount.
    const clearTitleButtons = await screen.findAllByRole('button', { name: 'Clear title' });
    fireEvent.click(clearTitleButtons[clearTitleButtons.length - 1]);

    // TWO bars — the second Clear must not replace the first (A7 removed).
    // `waitFor` (not `findAllByRole`, which resolves at >=1) so this cannot
    // pass while only the first bar is on screen.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2);
    });
    const undoButtons = screen.getAllByRole('button', { name: 'Undo' });

    // Click the FIRST bar (row 7's clear) → the replayed SET_TAB_OVERRIDE must
    // name tab 7 ONLY, never tab 8 (the whole point of per-entry identity).
    // Counted as an INCREMENT because the forward Clear also writes this action;
    // only the clicked entry's replay may add one, for its own tabId only.
    const overridesOf = (tabId: number): number =>
      mockSendMessage.mock.calls
        .map((c) => c[0] as { action: string; payload: { tabId?: number; title?: string } })
        .filter((m) => m.action === 'SET_TAB_OVERRIDE' && m.payload.tabId === tabId && m.payload.title !== undefined)
        .length;

    const before7 = overridesOf(7);
    const before8 = overridesOf(8);
    fireEvent.click(undoButtons[0]);

    await waitFor(() => { expect(overridesOf(7)).toBe(before7 + 1); });
    // Row 8's clear was NOT replayed by row 7's Undo.
    expect(overridesOf(8)).toBe(before8);
    // The second bar survives the first being consumed.
    expect(await screen.findAllByRole('button', { name: 'Undo' })).toHaveLength(1);
  });

  it('clearShown adds NO new undo bar (scope fence: it was never undoable)', async () => {
    // The guardrail: the shared stack must not silently acquire an entry for an
    // action that has no undo today (clearShown/clearSelected/resetEntry).
    rows = [row()];
    await openDashboard();

    const clearShown = await screen.findByRole('button', { name: /Clear shown/i });
    fireEvent.click(clearShown);
    // If the confirm dialog appears, dismiss it — either way, no bar may appear.
    const dialog = screen.queryByRole('dialog');
    if (dialog) {
      await new Promise((r) => setTimeout(r, 160));
      const cancel = within(dialog).queryByRole('button', { name: /Cancel/i });
      if (cancel) fireEvent.click(cancel);
    }

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});