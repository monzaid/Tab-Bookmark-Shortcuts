/**
 * Manual review, round 2 — issue 4.
 *
 * Reported: saving a brand-new rule shows "A rule with the same match pattern
 * already exists", yet after a manual refresh the rule IS in the list.
 *
 * That combination (created + duplicate error) means CREATE_RULE was issued
 * MORE THAN ONCE for a single user action: the first call created the rule, the
 * second found the rule it had just created and returned DUPLICATE_RULE — and
 * that error is what the form displayed.
 *
 * The sidebar's create modal already guards with `if (saving) return;`. The
 * settings `New Rule` handler does not, so a second activation (double click, or
 * click + Enter) gets through before `saving` becomes true.
 *
 * RED guard: pre-fix two fast activations produce TWO CREATE_RULE messages.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

const rules: Array<Record<string, unknown>> = [];
let createCalls = 0;

const mockSendMessage = vi.fn().mockImplementation(async (msg: { action: string; payload?: unknown }) => {
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
          rules,
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
    createCalls += 1;
    const payload = msg.payload as { urlMatch: { value: string } };
    // A real background write is asynchronous; this delay is what lets a second
    // activation slip through before the first one returns.
    await new Promise((r) => setTimeout(r, 20));
    const exists = rules.some((r) => (r.urlMatch as { value: string }).value === payload.urlMatch.value);
    if (exists) {
      return { result: { success: false, errorCode: 'DUPLICATE_RULE', message: 'A rule with the same match pattern already exists.' } };
    }
    rules.push({
      id: `r-${String(rules.length + 1)}`,
      urlMatch: payload.urlMatch,
      priority: 0,
      enabled: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    return { result: { success: true, rule: rules[rules.length - 1] } };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  storage: { local: undefined, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

async function openNewRule() {
  render(<SettingsApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Page Rules' }));
  await waitFor(() => {
    expect(screen.getByRole('table', { name: 'Page rules' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create new rule' }));
  return screen.findByRole('form', { name: 'Create new rule' });
}

describe('issue 4 — a new rule is created exactly once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rules.length = 0;
    createCalls = 0;
  });

  it('a single save issues exactly ONE CREATE_RULE', async () => {
    const form = await openNewRule();
    fireEvent.change(document.getElementById('new-rule-url')!, { target: { value: 'https://once.example.com' } });

    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => {
      expect(createCalls).toBe(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Create new rule' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/same match pattern already exists/i)).toBeNull();
  });

  it('two FAST activations still issue exactly ONE CREATE_RULE (re-entrancy guard)', async () => {
    const form = await openNewRule();
    fireEvent.change(document.getElementById('new-rule-url')!, { target: { value: 'https://fast.example.com' } });

    const save = within(form).getByRole('button', { name: 'Save Rule' });
    // Two activations before the first response returns — the reported scenario.
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Create new rule' })).not.toBeInTheDocument();
    });

    expect(createCalls, 'the create must not be issued twice').toBe(1);
    expect(rules.filter((r) => (r.urlMatch as { value: string }).value === 'https://fast.example.com')).toHaveLength(1);
    // The false "duplicate" must never be shown on a rule that was just created.
    expect(screen.queryByText(/same match pattern already exists/i)).toBeNull();
  });

  it('a click followed by an Enter keypress also issues ONE create', async () => {
    const form = await openNewRule();
    const urlInput = document.getElementById('new-rule-url')!;
    fireEvent.change(urlInput, { target: { value: 'https://enter.example.com' } });

    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));
    fireEvent.keyDown(urlInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Create new rule' })).not.toBeInTheDocument();
    });
    expect(createCalls).toBe(1);
  });
});