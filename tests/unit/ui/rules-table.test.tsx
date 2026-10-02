/**
 * T15 — Rules table rewrite: 7 columns + column order (IMP-9), Confirm (D-12),
 * `selectedIds` auto-prune (D-13 default (a)), four-state empty handling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

const RULES = [
  { id: 'r1', urlMatch: { type: 'exact', value: 'https://a.com/one' }, priority: 0, title: 'Alpha', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'r2', urlMatch: { type: 'exact', value: 'https://b.com/two' }, priority: 5, title: 'Beta', enabled: true, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  { id: 'r3', urlMatch: { type: 'exact', value: 'https://c.com/three' }, priority: 1, title: 'Gamma', enabled: true, createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' },
];

let stateRules: typeof RULES = RULES;
let deleteShouldFail = false;

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string; payload?: unknown }) => {
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: { configVersion: 2, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: stateRules },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  if (msg.action === 'DELETE_RULE') {
    if (deleteShouldFail) return { result: { success: false, errorCode: 'INTERNAL_ERROR', message: 'nope' } };
    return { result: { success: true } };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

async function openRulesSection() {
  render(<SettingsApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Page Rules' }));
  await waitFor(() => {
    expect(screen.getByRole('table', { name: 'Page rules' })).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stateRules = RULES;
  deleteShouldFail = false;
});

describe('T15: Rules table', () => {
  it('renders 7 columns in the IMP-9 order with no Mode column', async () => {
    await openRulesSection();
    const table = screen.getByRole('table', { name: 'Page rules' });
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent?.replace(/\s+/g, ' ').trim());
    expect(headers).toHaveLength(7);
    expect(headers[1]).toBe('Icon');
    expect(headers[2]).toContain('Title');
    expect(headers[3]).toContain('URL Pattern');
    expect(headers[4]).toContain('Priority');
    expect(headers[5]).toContain('Enabled');
    expect(headers[6]).toContain('Actions');
    expect(headers.join(' ')).not.toContain('Mode');
  });

  it('confirms a row delete before sending DELETE_RULE (D-12)', async () => {
    await openRulesSection();
    fireEvent.click(screen.getByRole('button', { name: /Delete rule Alpha/ }));

    // Nothing sent yet — the confirmation is shown first.
    expect(mockSendMessage.mock.calls.some((c) => (c[0] as { action: string }).action === 'DELETE_RULE')).toBe(false);
    const dialog = await screen.findByRole('dialog', { name: 'Delete rule?' });
    // Wait out the CT3-b4 protection window before activating the confirm button.
    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE_RULE' }));
    });
  });

  it('prunes a hidden id out of the selection (D-13 default (a))', async () => {
    await openRulesSection();
    const table = screen.getByRole('table', { name: 'Page rules' });

    // Select all three.
    fireEvent.click(within(table).getByLabelText('Select all rules'));
    await waitFor(() => {
      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    // Search so only Alpha remains visible.
    fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'Alpha' } });

    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });
  });

  it('reports partial failures honestly on batch delete (D-12)', async () => {
    deleteShouldFail = true;
    await openRulesSection();
    const table = screen.getByRole('table', { name: 'Page rules' });
    fireEvent.click(within(table).getByLabelText('Select all rules'));

    await waitFor(() => { expect(screen.getByText('3 selected')).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete selected rules?' });
    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const toast = screen.getByRole('alert');
      expect(toast.textContent).toContain('Deleted 0 of 3');
      expect(toast.textContent).toContain('3 failed');
    });
  });

  it('shows a no-match empty state with a Clear search action', async () => {
    await openRulesSection();
    fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'zzz-no-such' } });
    await waitFor(() => {
      expect(screen.getByText(/No rules match your search/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no rules at all', async () => {
    stateRules = [];
    await openRulesSection();
    await waitFor(() => {
      expect(screen.getByText(/No rules configured/)).toBeInTheDocument();
    });
  });

  it('does not render an internal rule id as the delete accessible name (D-11)', async () => {
    await openRulesSection();
    expect(screen.getByRole('button', { name: 'Delete rule Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete rule r1' })).toBeNull();
  });
});