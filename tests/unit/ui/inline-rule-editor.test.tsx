import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

/**
 * Module 2 (UI) — Edit Rule expands an inline editor below the row.
 * - Multiple rows can be expanded simultaneously, each with independent state
 * - Save sends UPDATE_RULE with expectedUpdatedAt (version check)
 * - VERSION_CONFLICT shows an error; Cancel collapses the editor
 */

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
    urlMatch: { type: 'regex', value: 'https://example\\.com/b.*' },
    mode: 'manual',
    priority: 5,
    title: 'Rule B',
    enabled: true,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

let updateBehavior: 'success' | 'version-conflict' = 'success';
/** Rules returned by GET_STATE — tests can mutate this to simulate external changes */
let stateRules = RULES;
let getStateCalls = 0;
/** Captured chrome.storage.onChanged listeners so tests can trigger refreshes */
const storageChangedListeners: Array<(changes: unknown, areaName: string) => void> = [];

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string }) => {
  if (msg.action === 'GET_STATE') {
    getStateCalls += 1;
    return {
      result: {
        success: true,
        sync: { configVersion: 2, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: stateRules },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  if (msg.action === 'GET_COMMANDS') {
    return { result: { success: true, commands: [] } };
  }
  if (msg.action === 'UPDATE_RULE') {
    if (updateBehavior === 'version-conflict') {
      return { result: { success: false, errorCode: 'VERSION_CONFLICT', message: 'Rule was modified elsewhere' } };
    }
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
    onChanged: {
      addListener: vi.fn((fn: (changes: unknown, areaName: string) => void) => {
        storageChangedListeners.push(fn);
      }),
      removeListener: vi.fn(),
    },
  },
});

async function openRulesSection() {
  render(<SettingsApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Page Rules' }));
  await waitFor(() => {
    expect(screen.getByRole('table', { name: 'Page rules' })).toBeInTheDocument();
  });
}

describe('Module 2 (UI): Inline rule editing in settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateBehavior = 'success';
    stateRules = RULES;
    getStateCalls = 0;
    storageChangedListeners.length = 0;
  });

  it('should expand an inline editor below the row when Edit is clicked (not a dialog)', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));

    await waitFor(() => {
      expect(screen.getByRole('form', { name: 'Edit rule r1' })).toBeInTheDocument();
    });

    // Must be inline in the document flow (inside the table), not a modal dialog
    const form = screen.getByRole('form', { name: 'Edit rule r1' });
    expect(form.closest('table')).toBe(screen.getByRole('table', { name: 'Page rules' }));
    // No modal overlay for editing
    expect(screen.queryByRole('dialog', { name: /edit rule/i })).not.toBeInTheDocument();
  });

  it('should support multiple editors expanded simultaneously with independent state', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r2' }));

    await waitFor(() => {
      expect(screen.getByRole('form', { name: 'Edit rule r1' })).toBeInTheDocument();
      expect(screen.getByRole('form', { name: 'Edit rule r2' })).toBeInTheDocument();
    });

    const form1 = screen.getByRole('form', { name: 'Edit rule r1' });
    const form2 = screen.getByRole('form', { name: 'Edit rule r2' });

    // Independent initial values
    expect(within(form1).getByLabelText('Match URL')).toHaveValue('https://example.com/a');
    expect(within(form2).getByLabelText('Match URL')).toHaveValue('https://example\\.com/b.*');

    // Editing one does not affect the other
    fireEvent.change(within(form1).getByLabelText('Custom Title'), { target: { value: 'Changed A' } });
    expect(within(form2).getByLabelText('Custom Title')).toHaveValue('Rule B');
  });

  it('should send UPDATE_RULE with expectedUpdatedAt on save', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    const form = await screen.findByRole('form', { name: 'Edit rule r1' });

    fireEvent.change(within(form).getByLabelText('Custom Title'), { target: { value: 'New Title' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Update Rule' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_RULE' }));
    });

    // Verify the payload carries the version marker captured at edit-open time
    const sent = mockSendMessage.mock.calls.map((call) => call[0] as {
      action: string;
      payload?: { ruleId?: string; title?: string; expectedUpdatedAt?: string };
    });
    const updateMsg = sent.find((m) => m.action === 'UPDATE_RULE');
    expect(updateMsg?.payload).toMatchObject({
      ruleId: 'r1',
      title: 'New Title',
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
    });
  });

  // Acceptance: after a successful update, the Edit Rule editor auto-hides and
  // a "✓ Rule updated" notice is shown below the interface.
  it('should auto-hide the editor and show a Rule updated notice after successful save', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    const form = await screen.findByRole('form', { name: 'Edit rule r1' });

    fireEvent.click(within(form).getByRole('button', { name: 'Update Rule' }));

    // Editor auto-hides
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Edit rule r1' })).not.toBeInTheDocument();
    });
    // "✓ Rule updated" success Toast appears (same style as Data Dashboard Edit)
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Rule updated');
    expect(toast.className).toContain('tbs-toast');
  });

  it('should show version conflict error when UPDATE_RULE returns VERSION_CONFLICT', async () => {
    updateBehavior = 'version-conflict';
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    const form = await screen.findByRole('form', { name: 'Edit rule r1' });

    fireEvent.click(within(form).getByRole('button', { name: 'Update Rule' }));

    await waitFor(() => {
      expect(within(form).getByRole('alert')).toBeInTheDocument();
    });
    // Editor stays open so the user can see the error
    expect(screen.getByRole('form', { name: 'Edit rule r1' })).toBeInTheDocument();
  });

  it('should collapse the editor on Cancel', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    const form = await screen.findByRole('form', { name: 'Edit rule r1' });

    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Edit rule r1' })).not.toBeInTheDocument();
    });
  });

  it('should show the exact version-conflict guidance message on VERSION_CONFLICT', async () => {
    updateBehavior = 'version-conflict';
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    const form = await screen.findByRole('form', { name: 'Edit rule r1' });

    fireEvent.click(within(form).getByRole('button', { name: 'Update Rule' }));

    await waitFor(() => {
      expect(within(form).getByRole('alert')).toHaveTextContent('This rule was modified elsewhere. Refresh and try again.');
    });
  });

  it('should freeze expectedUpdatedAt at editor-open time even if the list refreshes with a newer rule', async () => {
    await openRulesSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r1' }));
    await screen.findByRole('form', { name: 'Edit rule r1' });

    // Simulate an external change: storage event fires, list reloads, and the
    // same rule now carries a newer updatedAt from another channel.
    const callsBeforeRefresh = getStateCalls;
    stateRules = [{ ...RULES[0], updatedAt: '2026-06-01T12:00:00Z' }, RULES[1]];
    for (const listener of storageChangedListeners) listener({}, 'sync');
    await waitFor(() => {
      // GET_STATE was called again after the storage change
      expect(getStateCalls).toBeGreaterThan(callsBeforeRefresh);
    });

    const form = await screen.findByRole('form', { name: 'Edit rule r1' });
    fireEvent.click(within(form).getByRole('button', { name: 'Update Rule' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_RULE' }));
    });

    // The version marker must be the ORIGINAL updatedAt captured when the editor
    // was opened — not the refreshed one. Otherwise the version check is useless:
    // a stale edit would silently pass and overwrite the other channel's change.
    const sent = mockSendMessage.mock.calls.map((call) => call[0] as {
      action: string;
      payload?: { expectedUpdatedAt?: string };
    });
    const updateMsg = sent.find((m) => m.action === 'UPDATE_RULE');
    expect(updateMsg?.payload?.expectedUpdatedAt).toBe('2026-01-01T00:00:00Z');
  });
});
