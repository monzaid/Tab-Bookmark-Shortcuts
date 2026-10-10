/**
 * T16 — Dashboard rewrite: A10 `DashboardRow` contract, IMP-4 inline multi-row
 * drafts with per-row Save, IMP-5 winner+badge cells, G1 summary sentence,
 * D-9 `Edit {label}`, delivery copy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';
import { resolveFieldChain } from '@shared/field-chain';
import { JUMP_HIGHLIGHT_CLASS } from '@ui/shared/use-jump-to-row';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';
import type { ChainResult, TierOwner } from '@shared/field-chain';
import type { DashboardRow, SyncState } from '@shared/types';

function chainWith(ruleTitle: string | null, siteKnown: boolean): ChainResult {
  const sync: SyncState = {
    ...createDefaultSyncState(),
    rules: ruleTitle
      ? [{ id: 'r1', urlMatch: { type: 'exact', value: 'https://a.com/' }, priority: 0, title: ruleTitle, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]
      : [],
  };
  const local = siteKnown
    ? { ...createDefaultLocalState(), siteSnapshot: [{ tabId: 7, title: 'Site', faviconHref: null, capturedAt: '2026-01-01T00:00:00Z' }] }
    : createDefaultLocalState();
  return resolveFieldChain('title', { sync, local, tabId: 7, tabUrl: 'https://a.com/' });
}

function emptyChain(): ChainResult {
  return resolveFieldChain('title', { sync: createDefaultSyncState(), local: createDefaultLocalState(), tabId: -1, tabUrl: '' });
}

function row(overrides: Partial<DashboardRow> & { id: string }): DashboardRow {
  return {
    kind: 'override',
    label: 'Tab 7',
    url: 'https://a.com/',
    anchor: { kind: 'override', tabId: 7 } as TierOwner,
    tabId: 7,
    chain: { title: chainWith('Rule R', true), favicon: emptyChain() },
    delivery: 'ok',
    ...overrides,
  };
}

let rows: DashboardRow[] = [];

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string }) => {
  if (msg.action === 'GET_DASHBOARD') return { result: { success: true, rows } };
  if (msg.action === 'GET_STATE') {
    return { result: { success: true, sync: createDefaultSyncState(), local: createDefaultLocalState() } };
  }
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() }, getURL: (p: string) => p },
  tabs: { query: vi.fn().mockResolvedValue([]), get: vi.fn(), update: vi.fn(), create: vi.fn(), onActivated: { addListener: vi.fn(), removeListener: vi.fn() }, onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

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

describe('T16: Dashboard', () => {
  it('shows the empty state when nothing is customized', async () => {
    await openDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Nothing customized yet/)).toBeInTheDocument();
    });
  });

  it('shows the winner value with a source badge in the cell (IMP-5)', async () => {
    rows = [row({ id: 'cp-7' })];
    await openDashboard();
    await waitFor(() => {
      expect(screen.getByText('Rule R')).toBeInTheDocument();
    });
    // The winning source is surfaced as a text badge next to the value.
    expect(screen.getAllByText('rule').length).toBeGreaterThan(0);
  });

  it('expands two rows with INDEPENDENT Save enablement (IMP-4)', async () => {
    rows = [row({ id: 'cp-7', label: 'Tab 7' }), row({ id: 'cp-8', label: 'Tab 8', tabId: 8, anchor: { kind: 'override', tabId: 8 } })];
    await openDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tab 8' }));

    const form7 = await screen.findByRole('form', { name: 'Edit Tab 7' });
    const form8 = await screen.findByRole('form', { name: 'Edit Tab 8' });

    // Change row 7's title text.
    const save7 = within(form7).getByRole('button', { name: 'Save' });
    const save8 = within(form8).getByRole('button', { name: 'Save' });

    fireEvent.change(within(form7).getByLabelText('Custom title text'), { target: { value: 'Changed' } });

    expect(save7).not.toBeDisabled();
    // The other row's Save stays disabled — dirty is per-row (IMP-19/RK-4).
    expect(save8).toBeDisabled();
  });

  it('uses the readable label for the edit control, not the internal id (D-9)', async () => {
    rows = [row({ id: 'cp-7', label: 'Tab 7' })];
    await openDashboard();
    expect(await screen.findByRole('button', { name: 'Edit Tab 7' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit cp-7' })).toBeNull();
  });

  it('renders the delivery copy for a protected page', async () => {
    rows = [row({ id: 'cp-7', delivery: 'protected' })];
    await openDashboard();
    await waitFor(() => {
      expect(screen.getByText("Can't rewrite this page")).toBeInTheDocument();
    });
  });

  it('renders the degraded delivery copy', async () => {
    rows = [row({ id: 'cp-7', delivery: 'degraded' })];
    await openDashboard();
    await waitFor(() => {
      expect(screen.getByText("Limited: can't restore the site value")).toBeInTheDocument();
    });
  });

  it('does NOT count `unknown` rows in the "none can be applied here" summary (G1-a)', async () => {
    rows = [
      row({ id: 'cp-7', delivery: 'unknown' }),
      row({ id: 'cp-8', delivery: 'unknown', tabId: 8, label: 'Tab 8' }),
      row({ id: 'cp-9', delivery: 'ok', tabId: 9, label: 'Tab 9' }),
    ];
    await openDashboard();
    await waitFor(() => {
      expect(screen.queryByText(/none can be applied here/)).toBeNull();
    });
  });

  it('shows the summary sentence with the correct singular form when a protected row exists', async () => {
    rows = [
      row({ id: 'cp-7', delivery: 'protected' }),
    ];
    await openDashboard();
    await waitFor(() => {
      expect(screen.getByText('1 item · none can be applied here')).toBeInTheDocument();
    });
  });

  it('confirms a destructive Clear before sending (D-20)', async () => {
    rows = [row({ id: 'cp-7' })];
    await openDashboard();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Tab 7' }));

    expect(mockSendMessage.mock.calls.some((c) => (c[0] as { action: string }).action === 'REMOVE_TAB_OVERRIDE')).toBe(false);
    const dialog = await screen.findByRole('dialog', { name: 'Clear selection?' });
    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'REMOVE_TAB_OVERRIDE' }));
    });
  });

  /**
   * Review round 4 — the Edit panel pairs its two editors.
   *
   * The Dashboard used to stack them by passing `grid={false}`, which made its
   * Edit panel a visibly different shape from the `New Rule` / `Edit Rule`
   * panels it is modelled on. Both must now go through the two-track pair.
   */
  it('renders the Title/Icon editors side by side, like New Rule does (review)', async () => {
    rows = [row({ id: 'cp-7' })];
    await openDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    const form = await screen.findByRole('form', { name: 'Edit Tab 7' });

    // The pair wrapper carries the 2-track grid…
    const pair = form.querySelector('.tbs-settings__rule-form-grid');
    expect(pair).not.toBeNull();
    // …and it holds exactly the two dimension editors.
    const fields = Array.from(pair!.querySelectorAll('.tbs-field-editor')).map((el) => el.getAttribute('data-field'));
    expect(fields).toEqual(['title', 'icon']);
  });

  /**
   * Review round 4 — the post-write cue.
   *
   * A successful Save collapses the panel and reloads the table; without a cue
   * the user cannot tell WHICH row just changed. The edited row must therefore
   * be highlighted with the same treatment a `jumpTo` uses. The rule-hit case is
   * the important one: its `hit-N` row does not exist after the write, so the cue
   * has to follow the row to the `cp-N` override it was promoted into.
   */
  it('highlights the edited row after a successful Save (review)', async () => {
    rows = [row({ id: 'cp-7' })];
    await openDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    const form = await screen.findByRole('form', { name: 'Edit Tab 7' });
    fireEvent.change(within(form).getByLabelText('Custom title text'), { target: { value: 'Updated' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(document.querySelector('tr[data-dash-entry="cp-7"]')?.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(true);
    });
  });

  it('follows a promoted rule-hit row to its new override id (review)', async () => {
    rows = [row({
      id: 'hit-7',
      kind: 'rule-hit',
      label: 'Tab 7',
      tabId: 7,
      ruleId: 'r1',
      anchor: { kind: 'rule', ruleId: 'r1' } as TierOwner,
    })];
    await openDashboard();

    // The write turns the managed tab into an explicit override row.
    const original = mockSendMessage.getMockImplementation();
    mockSendMessage.mockImplementation((msg: { action: string }) => {
      if (msg.action === 'SET_TAB_OVERRIDE') {
        rows = [row({ id: 'cp-7' })];
        return { result: { success: true } };
      }
      return original?.(msg) as unknown;
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    const form = await screen.findByRole('form', { name: 'Edit Tab 7' });
    fireEvent.change(within(form).getByLabelText('Custom title text'), { target: { value: 'Promoted' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(document.querySelector('tr[data-dash-entry="cp-7"]')?.classList.contains(JUMP_HIGHLIGHT_CLASS)).toBe(true);
    });
  });

  /**
   * Review round 3 — the rule-hit (managed tab) write path.
   *
   * A `rule-hit` row owns no stored value of its own: it is the "managed tab"
   * view over a tab whose value comes from a rule. Editing it must PROMOTE the
   * tab to a Page-level override — the exact symptom reported was `Tab x updated`
   * while the row, the title and the icon all stayed unchanged. A surface that
   * silently writes nothing is indistinguishable from success here, so this test
   * asserts the message that the background must receive.
   */
  it('rule-hit Save promotes the tab to a Page-level override (regression)', async () => {
    rows = [row({
      id: 'hit-7',
      kind: 'rule-hit',
      label: 'Tab 7',
      tabId: 7,
      ruleId: 'r1',
      anchor: { kind: 'rule', ruleId: 'r1' } as TierOwner,
    })];
    await openDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tab 7' }));
    const form = await screen.findByRole('form', { name: 'Edit Tab 7' });
    fireEvent.change(within(form).getByLabelText('Custom title text'), { target: { value: 'Promoted' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'SET_TAB_OVERRIDE',
        payload: expect.objectContaining({ tabId: 7, title: 'Promoted' }),
      }));
    });
  });

  it('rule-hit Clear disables the rule that drives the managed tab', async () => {
    rows = [row({
      id: 'hit-7',
      kind: 'rule-hit',
      label: 'Tab 7',
      tabId: 7,
      ruleId: 'r1',
      anchor: { kind: 'rule', ruleId: 'r1' } as TierOwner,
    })];
    await openDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Clear Tab 7' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear selection?' });
    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATE_RULE',
        payload: expect.objectContaining({ ruleId: 'r1', enabled: false }),
      }));
    });
  });
});

/**
 * The Clear renames plus the new search / Source filter.
 *
 * The two bulk actions are destructive and they cover DIFFERENT sets, so these
 * pin down both: the words (Clear, not Reset) and the scope each button acts on.
 */
describe('Data Dashboard — Clear labels and the list filters', () => {
  /** Three rows, one per Source, with distinguishable titles and URLs. */
  function variedRows(): DashboardRow[] {
    return [
      row({
        id: 'cp-7',
        kind: 'override',
        label: 'Tab 7',
        url: 'https://docs.example/guide',
        chain: { title: chainWith('Docs Guide', true), favicon: emptyChain() },
      }),
      row({
        id: 'slot-2',
        kind: 'slot',
        label: 'Slot 2',
        slotId: 2,
        tabId: undefined,
        url: 'https://mail.example/inbox',
        chain: { title: chainWith('Mail Inbox', true), favicon: emptyChain() },
      }),
      row({
        id: 'hit-9',
        kind: 'rule-hit',
        label: 'Tab 9',
        tabId: 9,
        ruleId: 'r1',
        url: 'https://news.example/today',
        anchor: { kind: 'rule', ruleId: 'r1' } as TierOwner,
        chain: { title: chainWith('News Today', true), favicon: emptyChain() },
      }),
    ];
  }

  /** Row ids currently rendered, read off the DOM (the visible set). */
  function visibleRowIds(): string[] {
    return Array.from(document.querySelectorAll('[data-dash-entry]'))
      .map((el) => el.getAttribute('data-dash-entry') ?? '');
  }

  beforeEach(() => {
    rows = variedRows();
  });

  it('names the bulk actions Clear, and each label states its own scope', async () => {
    await openDashboard();

    // "Clear Shown (N)" — NOT "Clear All". The button acts on the rows the list
    // is DRAWING, and a name saying "All" while a filter hides rows is the exact
    // mismatch that let a filtered view wipe the whole panel.
    expect(screen.getByRole('button', { name: 'Clear shown items' }).textContent)
      .toBe('Clear Shown (3)');
    // The selected count starts at zero.
    expect(screen.getByRole('button', { name: 'Clear selected items' }).textContent)
      .toBe('Clear Selected (0)');
    // "Reset" is the word for undoing an EDIT (DT7); it must not label a bulk
    // clear, where it would collide with the Reset inside the row editors.
    expect(screen.queryByRole('button', { name: /Reset (All|Shown|selected)/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear All/ })).toBeNull();
  });

  it('updates the Clear Selected count as rows are ticked', async () => {
    await openDashboard();

    // The row checkbox is named by the row's BADGE (`entry.label`), not its
    // title — existing behaviour the renaming does not touch.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tab 7' }));
    expect(screen.getByRole('button', { name: 'Clear selected items' }).textContent)
      .toBe('Clear Selected (1)');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slot 2' }));
    expect(screen.getByRole('button', { name: 'Clear selected items' }).textContent)
      .toBe('Clear Selected (2)');
  });

  it('searches by TITLE and by URL, not by the source badge', async () => {
    await openDashboard();
    const search = screen.getByTestId('dashboard-search');

    fireEvent.change(search, { target: { value: 'mail' } });
    expect(visibleRowIds()).toEqual(['slot-2']);

    // Case-insensitive, and it matches the URL too — the reader copies a
    // fragment of what they see in either column.
    fireEvent.change(search, { target: { value: 'NEWS.EXAMPLE' } });
    expect(visibleRowIds()).toEqual(['hit-9']);

    // A term matching nothing leaves no rows (and the empty state is shown
    // rather than a stale list).
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(visibleRowIds()).toEqual([]);

    // Clearing the box restores everything.
    fireEvent.change(search, { target: { value: '' } });
    expect(visibleRowIds()).toHaveLength(3);
  });

  it('filters by Source, offering only the Sources actually present', async () => {
    await openDashboard();
    const select = screen.getByTestId('dashboard-source-filter');

    // Named for what they ARE, not by the row's id-bearing badge ("Tab 9") —
    // a filter over labels would be a filter over ids.
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent))
      .toEqual(['Any Source', 'This Page', 'Slot', 'Rule']);

    fireEvent.change(select, { target: { value: 'slot' } });
    expect(visibleRowIds()).toEqual(['slot-2']);

    fireEvent.change(select, { target: { value: 'rule-hit' } });
    expect(visibleRowIds()).toEqual(['hit-9']);

    fireEvent.change(select, { target: { value: 'any' } });
    expect(visibleRowIds()).toHaveLength(3);
  });

  it('offers only the Sources present, so the control cannot offer an empty result', async () => {
    // Every row is a slot ⇒ "Rule" would be a filter guaranteed to show nothing.
    // Indexing is safe here: `variedRows()` builds three entries inline.
    const slotOnly: DashboardRow[] = variedRows().filter((r) => r.kind === 'slot');
    expect(slotOnly).toHaveLength(1);
    rows = slotOnly;
    await openDashboard();

    expect(Array.from(screen.getByTestId('dashboard-source-filter').querySelectorAll('option'))
      .map((o) => o.textContent)).toEqual(['Any Source', 'Slot']);
  });

  it('combines the search and the Source filter (both must hold)', async () => {
    await openDashboard();
    const search = screen.getByTestId('dashboard-search');
    const select = screen.getByTestId('dashboard-source-filter');

    // "example" matches all three URLs; the Source filter then narrows it.
    fireEvent.change(search, { target: { value: 'example' } });
    expect(visibleRowIds()).toHaveLength(3);

    fireEvent.change(select, { target: { value: 'override' } });
    expect(visibleRowIds()).toEqual(['cp-7']);

    // A Source value that is present but has no title match yields nothing —
    // the two are ANDed, not ORed.
    fireEvent.change(search, { target: { value: 'mail' } });
    expect(visibleRowIds()).toEqual([]);
  });

  it('says how many rows are hidden, so the bulk scope is visible before the click', async () => {
    await openDashboard();

    // No filter ⇒ no count line at all (it would be noise on an unfiltered list).
    expect(screen.queryByTestId('dashboard-filter-count')).toBeNull();

    fireEvent.change(screen.getByTestId('dashboard-search'), { target: { value: 'mail' } });
    expect(screen.getByTestId('dashboard-filter-count').textContent)
      .toBe('Showing 1 of 3 items');
  });

  it('prunes the selection when a filter hides a selected row', async () => {
    // The header box compares `selected.size` with the VISIBLE count, so a
    // hidden-but-selected row would leave the box drawn unchecked while every
    // visible row was ticked — and the next click would silently drop it.
    await openDashboard();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tab 7' }));
    expect(screen.getByRole('button', { name: 'Clear selected items' }).textContent)
      .toBe('Clear Selected (1)');

    // "mail" matches only slot-2, so the selected Tab 7 row goes off screen.
    fireEvent.change(screen.getByTestId('dashboard-search'), { target: { value: 'mail' } });

    // The hidden row is no longer selected: the count and the visible list agree.
    expect(screen.getByRole('button', { name: 'Clear selected items' }).textContent)
      .toBe('Clear Selected (0)');
    expect(screen.getByRole('checkbox', { name: 'Select all dashboard items' })).not.toBeChecked();
  });

  it('selects only the VISIBLE rows, and disables the box when none are visible', async () => {
    await openDashboard();

    fireEvent.change(screen.getByTestId('dashboard-search'), { target: { value: 'mail' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all dashboard items' }));

    // Exactly the one visible row — a select-all that reached hidden rows would
    // make the next Clear Selected destroy something off screen.
    expect(screen.getByRole('button', { name: 'Clear selected items' }).textContent)
      .toBe('Clear Selected (1)');

    // A filter hiding EVERYTHING cannot leave a live "select all": with an empty
    // visible set the box would otherwise be a switch over an unknown set.
    fireEvent.change(screen.getByTestId('dashboard-search'), { target: { value: 'zzz' } });
    expect(screen.getByRole('checkbox', { name: 'Select all dashboard items' })).toBeDisabled();
  });

  it('clears ONLY the shown rows — a hidden row survives', async () => {
    // The reported defect: with a Source filter on, this button wiped every row
    // including the ones the filter had hidden. Its scope is the SHOWN list.
    await openDashboard();

    fireEvent.change(screen.getByTestId('dashboard-search'), { target: { value: 'Docs' } });
    expect(visibleRowIds()).toEqual(['cp-7']);

    const button = screen.getByRole('button', { name: 'Clear shown items' });
    // The count in the label IS the scope, so it says 1 — not 3.
    expect(button.textContent).toBe('Clear Shown (1)');

    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Clear shown items?' });
    expect(dialog.textContent).toMatch(/1 item shown/);

    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      const writes = mockSendMessage.mock.calls
        .map((c) => c[0] as { action: string; payload?: { tabId?: number; slotId?: number } })
        .filter((m) => m.action === 'REMOVE_TAB_OVERRIDE' || m.action === 'UPDATE_SLOT_UI_MARKER');

      // Exactly the ONE shown row (the override cp-7 = tab 7). The hidden slot
      // row must not be written.
      expect(writes).toHaveLength(1);
      expect(writes[0]?.action).toBe('REMOVE_TAB_OVERRIDE');
      expect(writes[0]?.payload?.tabId).toBe(7);
      expect(writes.some((w) => w.action === 'UPDATE_SLOT_UI_MARKER')).toBe(false);
    });
  });

  it('cannot be used to wipe everything when the filter matches nothing', async () => {
    // The literal reported sequence: filter to an empty result, then click. The
    // button must be inert — an empty shown list means there is nothing to clear.
    await openDashboard();

    fireEvent.change(screen.getByTestId('dashboard-search'), { target: { value: 'zzz' } });
    expect(visibleRowIds()).toEqual([]);

    const button = screen.getByRole('button', { name: 'Clear shown items' });
    expect(button.textContent).toBe('Clear Shown (0)');
    expect(button).toBeDisabled();

    // And clicking it does not even open the confirmation, let alone write.
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      mockSendMessage.mock.calls.some(
        (c) => ['REMOVE_TAB_OVERRIDE', 'UPDATE_SLOT_UI_MARKER'].includes((c[0] as { action: string }).action),
      ),
    ).toBe(false);
  });

  it('clears only the rows of the selected Source', async () => {
    await openDashboard();

    fireEvent.change(screen.getByTestId('dashboard-source-filter'), { target: { value: 'slot' } });
    expect(visibleRowIds()).toEqual(['slot-2']);
    expect(screen.getByRole('button', { name: 'Clear shown items' }).textContent)
      .toBe('Clear Shown (1)');

    fireEvent.click(screen.getByRole('button', { name: 'Clear shown items' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear shown items?' });
    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      const writes = mockSendMessage.mock.calls
        .map((c) => c[0] as { action: string; payload?: { tabId?: number; slotId?: number } })
        .filter((m) => m.action === 'REMOVE_TAB_OVERRIDE' || m.action === 'UPDATE_SLOT_UI_MARKER');
      expect(writes).toHaveLength(1);
      expect(writes[0]?.action).toBe('UPDATE_SLOT_UI_MARKER');
      expect(writes[0]?.payload?.slotId).toBe(2);
    });
  });

  it('clears everything once the filter is off (the unfiltered case still works)', async () => {
    // The scope narrowing must not cost the ordinary case: with no filter, the
    // shown list IS every row.
    await openDashboard();

    expect(screen.getByRole('button', { name: 'Clear shown items' }).textContent)
      .toBe('Clear Shown (3)');

    fireEvent.click(screen.getByRole('button', { name: 'Clear shown items' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear shown items?' });
    expect(dialog.textContent).toMatch(/3 items shown/);
    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      const writes = mockSendMessage.mock.calls
        .map((c) => c[0] as { action: string })
        .filter((m) => m.action === 'REMOVE_TAB_OVERRIDE' || m.action === 'UPDATE_SLOT_UI_MARKER');
      // The override and the slot — a rule-hit row owns no stored value of its
      // own (its Clear disables the rule), which is long-standing behaviour this
      // change does not touch.
      expect(writes).toHaveLength(2);
    });
  });
});