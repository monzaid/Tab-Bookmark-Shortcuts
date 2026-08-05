/**
 * Rule create/update success feedback uses a floating Toast, matching the
 * Data Dashboard Edit success style.
 *
 * - Create success: New Rule form auto-hides, a "rule created" Toast appears.
 * - Update success: InlineRuleEditor auto-hides, a "Rule updated" Toast appears.
 * - Error paths (VERSION_CONFLICT etc.) are unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

// ─── Settings integration ───────────────────────────────────────────────────

const RULES = [
  {
    id: 'r1',
    urlMatch: { type: 'exact', value: 'https://example.com/a' },
    mode: 'auto',
    priority: 0,
    title: 'Rule A',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'r2',
    urlMatch: { type: 'exact', value: 'https://example.com/b' },
    mode: 'auto',
    priority: 0,
    title: 'Rule B',
    enabled: true,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

let createBehavior: 'success' | 'duplicate' = 'success';

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string }) => {
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: { configVersion: 2, globalStrategy: 'B', slots: [], rules: RULES },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  if (msg.action === 'GET_COMMANDS') {
    return { result: { success: true, commands: [] } };
  }
  if (msg.action === 'CREATE_RULE') {
    if (createBehavior === 'duplicate') {
      return { result: { success: false, errorCode: 'DUPLICATE_RULE', message: 'A rule with the same match pattern already exists.' } };
    }
    return { result: { success: true, rule: { id: 'new-rule' } } };
  }
  if (msg.action === 'UPDATE_RULE') {
    return { result: { success: true, rule: { ...RULES[0], title: 'Saved' } } };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: undefined,
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

async function openRulesSection() {
  render(<SettingsApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Page Rules' }));
  await waitFor(() => {
    expect(screen.getByRole('table', { name: 'Page rules' })).toBeInTheDocument();
  });
}

describe('Bug 2 (settings): create success auto-hides the form with a success Toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBehavior = 'success';
  });

  it('auto-hides the New Rule form and shows a "rule created" success Toast', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Create new rule' }));
    const form = await screen.findByRole('form', { name: 'Create new rule' });

    fireEvent.change(document.getElementById('rf-url')!, { target: { value: 'https://new.example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_RULE' }));
    });

    // Form auto-hides after a successful save
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Create new rule' })).not.toBeInTheDocument();
    });

    // Success Toast appears (same style as the Data Dashboard Edit success)
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('rule created');
    expect(toast.className).toContain('tbs-toast');
  });

  it('resets the form fields after a successful create', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Create new rule' }));
    const form = await screen.findByRole('form', { name: 'Create new rule' });

    fireEvent.change(document.getElementById('rf-url')!, { target: { value: 'https://kept.example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    // Success Toast is shown and the form auto-hides
    await waitFor(() => {
      expect(screen.findByRole('alert')).resolves.toHaveTextContent('rule created');
    });
    expect(screen.queryByRole('form', { name: 'Create new rule' })).not.toBeInTheDocument();
  });

  it('shows a "rule created" success Toast for wildcard patterns (conversion still applied)', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Create new rule' }));
    const form = await screen.findByRole('form', { name: 'Create new rule' });

    // Switch to regex and enter a wildcard pattern (auto-converted)
    fireEvent.click(within(form).getByLabelText('Regex'));
    fireEvent.change(document.getElementById('rf-url')!, { target: { value: 'https://example.com/*' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('rule created');
    expect(toast.className).toContain('tbs-toast');
  });

  it('keeps the existing error display for duplicate rules (no success Toast)', async () => {
    createBehavior = 'duplicate';
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Create new rule' }));
    const form = await screen.findByRole('form', { name: 'Create new rule' });

    fireEvent.change(document.getElementById('rf-url')!, { target: { value: 'https://dup.example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => {
      expect(within(form).getByRole('alert')).toHaveTextContent(/same match pattern/);
    });
    // No success toast for the error path
    expect(document.querySelector('.tbs-toast--success')).toBeNull();
  });
});

describe('Bug 2 (settings): update success auto-hides the editor with a "Rule updated" Toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBehavior = 'success';
  });

  it('auto-hides the editor and shows a "Rule updated" success Toast', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    const form = await screen.findByRole('form', { name: 'Edit rule r1' });

    fireEvent.click(within(form).getByRole('button', { name: 'Update Rule' }));

    // Editor auto-hides after a successful update
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Edit rule r1' })).not.toBeInTheDocument();
    });
    // "✓ Rule updated" success Toast appears (same style as Data Dashboard Edit)
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Rule updated');
    expect(toast.className).toContain('tbs-toast');
  });

  it('collapses only the saved editor and shows a single Toast', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r2' }));

    const form1 = await screen.findByRole('form', { name: 'Edit rule r1' });
    await screen.findByRole('form', { name: 'Edit rule r2' });

    // Update only r1
    fireEvent.click(within(form1).getByRole('button', { name: 'Update Rule' }));

    // r1 editor collapses; r2 stays expanded
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Edit rule r1' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('form', { name: 'Edit rule r2' })).toBeInTheDocument();
    // A "Rule updated" success Toast appears
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Rule updated');
  });
});
