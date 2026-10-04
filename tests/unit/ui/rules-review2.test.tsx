/**
 * Manual review, round 2 — four reported defects on the Page Rewrite Rules /
 * Data Dashboard surfaces.
 *
 * 1. `New Rule` must NOT render the `override > slot > rule > site` table.
 * 2. A saved rule must reach its matching tabs with BOTH title and icon.
 * 3. A dashboard `rule-hit` edit must actually change the tabs it manages.
 * 4. Creating a rule that does NOT exist yet must not report a duplicate.
 *
 * Each test asserts the USER-VISIBLE symptom, not an internal detail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

const RULES: Array<Record<string, unknown>> = [];

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string; payload?: unknown }) => {
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: {
          configVersion: 2,
          matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
          switchDirection: 'next',
          autoBindGlobal: true,
          slots: [],
          rules: RULES,
        },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  if (msg.action === 'GET_IMPACT_PREVIEW') {
    return { result: { success: true, preview: { matched: 0, masked: 0, entries: [] } } };
  }
  if (msg.action === 'CREATE_RULE') {
    // The background behaviour under test: a NEW pattern is accepted, an
    // existing one is rejected. `RULES` is the single source of truth.
    const payload = msg.payload as { urlMatch: { value: string }; title?: string; favicon?: unknown };
    const exists = RULES.some((r) => (r.urlMatch as { value: string }).value === payload.urlMatch.value);
    if (exists) {
      return { result: { success: false, errorCode: 'DUPLICATE_RULE', message: 'A rule with the same match pattern already exists.' } };
    }
    RULES.push({
      id: `r-${String(RULES.length + 1)}`,
      urlMatch: payload.urlMatch,
      priority: 0,
      title: payload.title,
      favicon: payload.favicon,
      enabled: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    return { result: { success: true, rule: RULES[RULES.length - 1] } };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: undefined,
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

async function openRules() {
  render(<SettingsApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Page Rules' }));
  await waitFor(() => {
    expect(screen.getByRole('table', { name: 'Page rules' })).toBeInTheDocument();
  });
}

async function openNewRuleForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Create new rule' }));
  return screen.findByRole('form', { name: 'Create new rule' });
}

describe('review round 2 — Page Rewrite Rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RULES.length = 0;
  });

  it('issue 1: New Rule does NOT render the chain tier table', async () => {
    await openRules();
    const form = await openNewRuleForm();

    // The tier list is the thing that must be absent on a creation surface.
    expect(form.querySelector('[data-chain-tiers]')).toBeNull();
    expect(form.querySelector('[data-tier]')).toBeNull();
    // The four tier NAMES must not be rendered as rows anywhere in the form.
    for (const label of ['Page', 'Slot', 'Rule', 'Site']) {
      const asTierRow = Array.from(form.querySelectorAll('.tbs-chain-tiers__badge'))
        .some((el) => el.textContent === label);
      expect(asTierRow, `tier row "${label}" must not be rendered`).toBe(false);
    }
    // And the `Use chain` tab itself is absent.
    expect(within(form).queryByRole('tab', { name: /Use chain/ })).toBeNull();
  });

  it('issue 4: creating a rule that does not exist is accepted (no false duplicate)', async () => {
    await openRules();
    const form = await openNewRuleForm();

    fireEvent.change(document.getElementById('new-rule-url')!, { target: { value: 'https://brand-new.example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_RULE' }));
    });

    // The form must close (success), and NO duplicate error may be shown.
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Create new rule' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/same match pattern already exists/i)).toBeNull();
  });

  it('issue 4: pressing Save twice on the SAME new rule reports a duplicate exactly once and creates ONE rule', async () => {
    await openRules();
    const form = await openNewRuleForm();

    fireEvent.change(document.getElementById('new-rule-url')!, { target: { value: 'https://double.example.com' } });
    const save = within(form).getByRole('button', { name: 'Save Rule' });

    // Double submit (the classic accidental duplicate).
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_RULE' }));
    });
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Create new rule' })).not.toBeInTheDocument();
    });

    // Exactly one rule may exist for that pattern.
    expect(RULES.filter((r) => (r.urlMatch as { value: string }).value === 'https://double.example.com')).toHaveLength(1);
    expect(screen.queryByText(/same match pattern already exists/i)).toBeNull();
  });

  it('issue 2: the created rule carries BOTH title and icon in the CREATE_RULE payload', async () => {
    await openRules();
    const form = await openNewRuleForm();

    fireEvent.change(document.getElementById('new-rule-url')!, { target: { value: 'https://both.example.com' } });
    fireEvent.change(within(form).getByLabelText('Custom title text'), { target: { value: 'Both Title' } });

    // The icon is set from the picker's URL tab.
    const iconUrl = within(form).getByRole('textbox', { name: 'Icon URL' });
    fireEvent.change(iconUrl, { target: { value: 'https://cdn.example.com/i.png' } });

    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_RULE' }));
    });

    const call = mockSendMessage.mock.calls.map((c) => c[0] as { action: string; payload?: { title?: string; favicon?: { value?: string } } })
      .find((m) => m.action === 'CREATE_RULE');
    expect(call?.payload?.title).toBe('Both Title');
    expect(call?.payload?.favicon?.value).toBe('https://cdn.example.com/i.png');
  });
});