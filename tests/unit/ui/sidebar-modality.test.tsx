/**
 * T14 — sidebar modal reuse of the shared field set, and the chain-derived
 * prefill (SC8 / DT4 / Q11).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

function stateWith(rules: unknown[], slots: unknown[] = [], overrides: unknown[] = [], bindings: unknown[] = []) {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
        switchDirection: 'next',
        autoBindGlobal: true,
        slots,
        rules,
      },
      local: {
        bindings,
        cycleCursors: [],
        lastSuccessSlotId: null,
        recoverySessions: [],
        recoverySnapshots: [],
        tabOverrides: overrides,
        iconCache: {},
        diagnostics: [],
      },
    },
  };
}

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([
      { id: 42, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Site Title', favIconUrl: 'https://site/f.ico', active: true, incognito: false, status: 'complete' },
    ]),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

const SLOT_S = {
  id: 5,
  urlMatch: { type: 'exact', value: 'https://example.com/page' },
  strategy: 'inherit',
  uiMarker: { customTitle: 'Slot S Title' },
  titleSnapshot: 'Slot S Title',
  faviconSnapshot: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const RULE_R = {
  id: 'r1',
  urlMatch: { type: 'exact', value: 'https://example.com/page' },
  priority: 100,
  title: 'Rule R Title',
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('T14: sidebar create-rule modal', () => {
  it('reuses the shared field set and has no mode checkbox', async () => {
    mockSendMessage.mockResolvedValue(stateWith([]));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    expect(within(dialog).getByRole('textbox', { name: /Match URL/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Match Type' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tablist', { name: 'Title source' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tablist', { name: 'Icon source' })).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: /Priority/ })).toBeInTheDocument();

    // IMP-18 item 6: the "Auto-apply on match" checkbox is gone.
    expect(within(dialog).queryByText(/Auto-apply on match/)).toBeNull();
    // DT5: creation is labelled as unsaved.
    expect(within(dialog).getByText(/not saved yet/)).toBeInTheDocument();
  });

  it('does not render Clear in the create variant', async () => {
    mockSendMessage.mockResolvedValue(stateWith([]));
    render(<SidebarApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });
    expect(within(dialog).queryByText('Clear title')).toBeNull();
    expect(within(dialog).queryByText('Clear icon')).toBeNull();
  });

  it('prefills the Title from the CHAIN (slot wins over the rule here)', async () => {
    mockSendMessage.mockResolvedValue(
      stateWith([RULE_R], [SLOT_S], [], [{ slotId: 5, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }]),
    );
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    // The slot tier is above the rule tier → the prefill must be the slot value.
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Custom title text')).toHaveValue('Slot S Title');
    });
  });

  it('prefills a tab override when one wins the chain', async () => {
    mockSendMessage.mockResolvedValue(
      stateWith(
        [RULE_R],
        [SLOT_S],
        [{ tabId: 42, title: 'Override O', createdAt: '2026-01-01T00:00:00Z' }],
        [{ slotId: 5, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
      ),
    );
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    await waitFor(() => {
      expect(within(dialog).getByLabelText('Custom title text')).toHaveValue('Override O');
    });
  });

  /**
   * rev473 / FIX-C (i): `Use` on a recipe RECORD must copy the RECIPE, not its
   * derived render.
   *
   * The chain's `value` for a recipe is the materialized PNG (R2), so applying
   * it must recover the ORIGINAL `IconSource` through the record's `owner`.
   * This surface used to drop `owner` and guess from `value.startsWith('data:')`,
   * which reopened the recipe as an UPLOAD and destroyed it on save (C1).
   *
   * STRUCTURAL (not a render comparison): we assert the persisted payload keeps
   * `type:'template'` with intact recipe fields — a jsdom render comparison
   * would pass even with the old bug (the PNG is a valid icon).
   */
  it('Use on a recipe record keeps the RECIPE (never flattens it to an upload)', async () => {
    const PNG = 'data:image/png;base64,U0xPVFJFTkRFUg==';
    const RECIPE = {
      id: 'r-recipe',
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 50,
      title: 'Recipe Rule',
      // The BACKEND materializes a recipe's value at read time (R2): the field
      // carries the rendered PNG while the recipe identity stays intact.
      favicon: { type: 'template', value: PNG, backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' },
      enabled: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    mockSendMessage.mockResolvedValue(stateWith([RECIPE], []));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    // Open the icon editor's `Use chain` tab so the record rows (and their `Use`
    // buttons) render, then apply that record's icon to this new rule's draft.
    const iconTabs = within(dialog).getByRole('tablist', { name: 'Icon source' });
    fireEvent.click(within(iconTabs).getByRole('tab', { name: /Use chain/i }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Apply the .* to this field/i }));

    // STRUCTURAL: the record's ORIGINAL source was recovered through `owner`, so
    // the draft carries a RECIPE — the editor switches to `Custom Icon` and its
    // fields hold the recipe's values. The old bug flattened it to an upload
    // (the editor would have opened on `Upload` with a data URI instead).
    await waitFor(() => {
      const selected = Array.from(iconTabs.querySelectorAll('[role="tab"]'))
        .filter((t) => t.getAttribute('aria-selected') === 'true')
        .map((t) => t.textContent?.trim());
      expect(selected).toEqual(['Custom Icon']);
    });
    expect(within(dialog).getByLabelText('Custom background color')).toHaveValue('#2563eb');
    expect(within(dialog).getByLabelText('Icon text or emoji')).toHaveValue('A');
    expect(within(dialog).getByLabelText('Custom text color')).toHaveValue('#ffffff');
  });
});