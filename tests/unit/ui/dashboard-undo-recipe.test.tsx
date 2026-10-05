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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

    // The undo bar appears; press Undo.
    const undoBtn = await screen.findByRole('button', { name: 'Undo' });
    fireEvent.click(undoBtn);

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
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

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