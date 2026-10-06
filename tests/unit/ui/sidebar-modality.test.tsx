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

/**
 * Readiness for the SLOT-ROW entry: the row (and its menu) renders only once
 * `state.sync.slots` has loaded — the same data that entry reads.
 */
async function awaitSlotRowSynced() {
  await screen.findByRole('button', { name: 'More options for slot 5' });
}

/**
 * Readiness for the CURRENT-PAGE (`＋`) entry: the chain's WINNER title must be
 * on screen. `displayCurrentTitle` alone is not enough — before sync loads it
 * falls back to `state.currentTabTitle` (the raw tab title), and `chrome.tabs.query`
 * answers immediately in these tests, so "something non-empty is shown" would let
 * the click through early. 'Rule R Title' can only come from the rule tier.
 */
async function awaitEntryBSynced() {
  await waitFor(() => { expect(screen.getByText('Rule R Title')).toBeInTheDocument(); });
  expect(screen.queryByText('Site Title')).toBeNull();
}

const PNG = 'data:image/png;base64,U0xPVFJFTkRFUg==';
/** A rule whose icon is a RECIPE (its value is the materialized PNG, R2). */
const RULE_RECIPE = {
  ...RULE_R,
  favicon: { type: 'template', value: PNG, backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' },
};

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
   * RED-1 / rev473: the SLOT-ROW entry must prefill the modal with the slot's
   * ORIGINAL icon source, so a recipe opens as a recipe.
   *
   * This entry is used (rather than the current-page `+` button) because the
   * current-page chain depends on an ASYNC tab query whose result oscillates
   * between effect passes; the slot row reads `slot.uiMarker.icon` directly.
   *
   * STRUCTURAL (not a render comparison): a jsdom render comparison would pass
   * even with the old bug (the materialized PNG is a valid icon).
   */
  it('RED-1 prefills from a SLOT row recipe source (opens on Custom, recipe fields intact)', async () => {
    const PNG = 'data:image/png;base64,U0xPVFJFTkRFUg==';
    const SLOT_RECIPE = {
      ...SLOT_S,
      uiMarker: {
        customTitle: 'Slot S Title',
        // The BACKEND materializes a recipe's value at read time (R2): the value
        // is the rendered PNG while the recipe identity stays intact.
        icon: { type: 'template', value: PNG, backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' },
      },
    };
    mockSendMessage.mockResolvedValue(stateWith([], [SLOT_RECIPE]));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'More options for slot 5' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to Global Rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    const selectedTabs = () => {
      const list = within(dialog).getByRole('tablist', { name: 'Icon source' });
      return Array.from(list.querySelectorAll('[role="tab"]'))
        .filter((t) => t.getAttribute('aria-selected') === 'true')
        .map((t) => t.textContent.trim());
    };
    await waitFor(() => { expect(selectedTabs()).toEqual(['Custom Icon']); });
    expect(within(dialog).getByLabelText('Custom background color')).toHaveValue('#2563eb');
    expect(within(dialog).getByLabelText('Icon text or emoji')).toHaveValue('A');
    expect(within(dialog).getByLabelText('Custom text color')).toHaveValue('#ffffff');
  });

  /**
   * RED-2 / rev473: `Reset` must restore the CONFIG too, not just the mode — the
   * same recipe as the prefill. Before the fix it restored `{kind:'set'}` with no
   * config, so the recipe fields went blank and a save would flatten the recipe.
   */
  it('RED-2 Reset restores the recipe CONFIG, not just the mode', async () => {
    const PNG = 'data:image/png;base64,U0xPVFJFTkRFUg==';
    const SLOT_RECIPE = {
      ...SLOT_S,
      uiMarker: {
        customTitle: 'Slot S Title',
        icon: { type: 'template', value: PNG, backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' },
      },
    };
    mockSendMessage.mockResolvedValue(stateWith([], [SLOT_RECIPE]));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'More options for slot 5' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to Global Rules' }));

    // Re-queried each time: React replaces the dialog subtree on re-render, so a
    // captured node would go stale (the "Unable to find" trap).
    const dlg = () => screen.getByRole('dialog', { name: /New Global Page Rule/ });
    await waitFor(() => { expect(within(dlg()).getByLabelText('Custom text color')).toHaveValue('#ffffff'); });
    // Perturb the draft, then Reset.
    fireEvent.change(within(dlg()).getByLabelText('Icon text or emoji'), { target: { value: 'Z' } });
    fireEvent.click(within(dlg()).getByLabelText('Reset to the value this editor opened with'));

    await waitFor(() => { expect(within(dlg()).getByLabelText('Icon text or emoji')).toHaveValue('A'); });
    expect(within(dlg()).getByLabelText('Custom text color')).toHaveValue('#ffffff');
  });

  /**
   * RED-5 lock (fallback preserved): a slot with NO stored source but a
   * data-URI snapshot must still seed as an upload on save — the LAST-RESORT
   * branch's semantics are unchanged by this work. It locks the fallback so it
   * cannot be silently broken while touching the source branch above it.
   *
   * Asserts the STORAGE type only (the view shows `Custom` for any config).
   */
  it('RED-5 lock: a SOURCELESS data-URI prefill stays an upload on save', async () => {
    const PNG = 'data:image/png;base64,U09VUkNFTA==';
    // No `uiMarker.icon` ⇒ no source ⇒ the snapshot string is the fallback.
    const SLOT_SNAP = { ...SLOT_S, faviconSnapshot: PNG };
    mockSendMessage.mockResolvedValue(stateWith([], [SLOT_SNAP]));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'More options for slot 5' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to Global Rules' }));
    const dlg = () => screen.getByRole('dialog', { name: /New Global Page Rule/ });

    await waitFor(() => { expect(within(dlg()).getByRole('button', { name: 'Save' })).toBeEnabled(); });
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSendMessage.mock.calls.map((c) => (c[0] as { action?: string }).action)).toContain('CREATE_RULE');
    });
    const call = mockSendMessage.mock.calls.find((c) => (c[0] as { action?: string }).action === 'CREATE_RULE');
    expect((call?.[0] as { payload?: { favicon?: { type?: string } } }).payload?.favicon?.type).toBe('upload');
  });

  /**
   * RED-6 (prefill + upload): seeding from an UPLOAD source must keep it an
   * upload on save. This is the guard for the `iconSourceToIconConfig` choice —
   * the lossy `iconSourceToDraft`/`fromIconFieldValue` pair carries NO config,
   * and `resolveDraftFavicon` then classifies the draft as `type:'url'`.
   *
   * Asserts the STORAGE type only. The view shows `Custom` for any config (a
   * known cosmetic split in the dual-model editor); asserting the tab would be
   * wrong.
   */
  it('RED-6 prefilling from an UPLOAD source keeps it an upload on save', async () => {
    const PNG = 'data:image/png;base64,VVBM1PUFQ';
    const SLOT_UPLOAD = {
      ...SLOT_S,
      uiMarker: { customTitle: 'Slot S Title', icon: { type: 'upload', value: PNG } },
    };
    mockSendMessage.mockResolvedValue(stateWith([], [SLOT_UPLOAD]));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'More options for slot 5' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to Global Rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    await waitFor(() => { expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled(); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSendMessage.mock.calls.map((c) => (c[0] as { action?: string }).action)).toContain('CREATE_RULE');
    });
    const call = mockSendMessage.mock.calls.find((c) => (c[0] as { action?: string }).action === 'CREATE_RULE');
    expect((call?.[0] as { payload?: { favicon?: { type?: string } } }).payload?.favicon?.type).toBe('upload');
  });

  /**
   * RED-6b (apply a chain record + upload): the `Use chain` APPLY path must be
   * source-faithful too. It used the lossy pair (`fromIconFieldValue(
   * iconSourceToDraft(...))`), so applying an upload record saved `type:'url'`.
   */
  it('RED-6b applying a chain record from an UPLOAD source keeps it an upload on save', async () => {
    const PNG = 'data:image/png;base64,VVBM1PUFQ';
    const RULE_UPLOAD = { ...RULE_R, favicon: { type: 'upload', value: PNG } };
    mockSendMessage.mockResolvedValue(stateWith([RULE_UPLOAD], []));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    const tabs = () => within(dialog).getByRole('tablist', { name: 'Icon source' });
    fireEvent.click(within(tabs()).getByRole('tab', { name: /Use chain/i }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Apply the .* to this field/i }));

    await waitFor(() => { expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled(); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSendMessage.mock.calls.map((c) => (c[0] as { action?: string }).action)).toContain('CREATE_RULE');
    });
    const call = mockSendMessage.mock.calls.find((c) => (c[0] as { action?: string }).action === 'CREATE_RULE');
    expect((call?.[0] as { payload?: { favicon?: { type?: string } } }).payload?.favicon?.type).toBe('upload');
  });

  /**
   * Restored (the deleted rev473 case, re-anchored on the CURRENT-PAGE entry):
   * applying a chain RECORD via `Use` must keep it a recipe — this is the
   * "order" invariant (source BEFORE the value's shape). Entry B is used so the
   * current-page path (`iconSource: currentPageIconSource`) is covered too.
   */
  it('apply on a chain record keeps the RECIPE (a Use never flattens it to an upload) — entry B', async () => {
    mockSendMessage.mockResolvedValue(stateWith([RULE_RECIPE], []));
    render(<SidebarApp />);
    await awaitEntryBSynced();

    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
    const dlg = () => screen.getByRole('dialog', { name: /New Global Page Rule/ });

    // `Use chain` tab → the rule row's `Use`.
    fireEvent.click(within(within(dlg()).getByRole('tablist', { name: 'Icon source' })).getByRole('tab', { name: /Use chain/i }));
    fireEvent.click(await within(dlg()).findByRole('button', { name: /Apply the .* to this field/i }));

    // STRUCTURAL, not a tab read: the persisted payload must keep the RECIPE.
    // (A tab read is a weaker proxy — the picker's local value can lag the
    // parent pair during the tab→apply sequence, which is exactly what made this
    // case flaky. The contract under test is the SAVED type.)
    await waitFor(() => { expect(within(dlg()).getByRole('button', { name: 'Save' })).toBeEnabled(); });
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSendMessage.mock.calls.map((c) => (c[0] as { action?: string }).action)).toContain('CREATE_RULE');
    });
    const call = mockSendMessage.mock.calls.find((c) => (c[0] as { action?: string }).action === 'CREATE_RULE');
    const favicon = (call?.[0] as { payload?: { favicon?: { type?: string; backgroundColor?: string } } }).payload?.favicon;
    expect(favicon?.type).toBe('template');
    expect(favicon?.backgroundColor).toBe('#2563EB');
  });

  /**
   * RED-8 (open + recipe on the CURRENT-PAGE entry): opening `＋` must prefill
   * from the winning rule's SOURCE, so the modal opens on `Custom` with the
   * recipe's fields — the entry-B counterpart of RED-1.
   */
  it('RED-8 opening from the CURRENT PAGE prefills the winning recipe (entry B)', async () => {
    mockSendMessage.mockResolvedValue(stateWith([RULE_RECIPE], []));
    render(<SidebarApp />);
    await awaitEntryBSynced();

    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
    const dlg = () => screen.getByRole('dialog', { name: /New Global Page Rule/ });

    const selectedTabs = () => {
      const list = within(dlg()).getByRole('tablist', { name: 'Icon source' });
      return Array.from(list.querySelectorAll('[role="tab"]'))
        .filter((t) => t.getAttribute('aria-selected') === 'true')
        .map((t) => t.textContent.trim());
    };
    await waitFor(() => { expect(selectedTabs()).toEqual(['Custom Icon']); });
    expect(within(dlg()).getByLabelText('Custom background color')).toHaveValue('#2563eb');
    expect(within(dlg()).getByLabelText('Icon text or emoji')).toHaveValue('A');
  });

  /**
   * RED-7: an OPEN modal must not be re-seeded by later page-state changes — the
   * prefill props are live page state, so a deps-driven effect silently wiped
   * edits the user had already made. The edit here is a deterministic `typeUrl`,
   * and the prop change is a second entry that sets `rulePrefill` (which flips
   * `defaultUrl`), so the case does not depend on timers or storage events.
   */
  it('RED-7 keeps the user\'s draft when page props change while the modal is open', async () => {
    mockSendMessage.mockResolvedValue(stateWith([], [SLOT_S]));
    render(<SidebarApp />);
    await awaitSlotRowSynced();

    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
    const dlg = () => screen.getByRole('dialog', { name: /New Global Page Rule/ });
    const urlBox = () => within(dlg()).getByRole('textbox', { name: /Match URL/ });
    await waitFor(() => { expect(urlBox()).toBeInTheDocument(); });

    fireEvent.change(urlBox(), { target: { value: 'https://typed.example/' } });
    expect(urlBox()).toHaveValue('https://typed.example/');

    // Prop change while open: the slot's menu sets `rulePrefill` → `defaultUrl`.
    fireEvent.click(screen.getByRole('button', { name: 'More options for slot 5' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to Global Rules' }));

    expect(urlBox()).toHaveValue('https://typed.example/');
  });
});