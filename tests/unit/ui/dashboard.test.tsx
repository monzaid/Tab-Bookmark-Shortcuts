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