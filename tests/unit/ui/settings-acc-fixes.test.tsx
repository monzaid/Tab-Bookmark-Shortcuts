import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SettingsApp } from '@ui/settings/App';

/**
 * ACC#2 / ACC#5 / ACC#6a — settings-page fixes discovered in manual acceptance.
 * - #2  the Global Matching Settings section must reuse the settings row layout.
 * - #5  editing a per-slot Custom knob must NOT silently collapse the slot back
 *       to "Inherit global" when the async write fails.
 * - #6a Priority has meaning only for combination 1, so it must be hidden when
 *       Tab ID = "No tab ID" (its stored value is preserved, not cleared).
 */

const STATE = (over: { slots?: unknown[] } = {}) => ({
  result: {
    success: true,
    commands: [],
    sync: {
      configVersion: 1,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: over.slots ?? [],
      rules: [],
    },
    local: {},
  },
});

let mockSendMessage: ReturnType<typeof vi.fn>;

/** `impl` returns a plain value; the mock wraps it in a resolved promise. */
function installChrome(impl: (msg: { action: string; payload?: unknown }) => unknown) {
  mockSendMessage = vi.fn((msg: { action: string; payload?: unknown }) => Promise.resolve(impl(msg)));
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
}

async function openStrategy() {
  render(<SettingsApp />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
}

describe('ACC#2: Global Matching Settings uses the shared settings row layout', () => {
  beforeEach(() => {
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE();
      return { result: { success: true } };
    });
  });

  it('renders each global control row with the settings row class', async () => {
    await openStrategy();

    // The Switch Direction and Auto-bind rows already carry the row class.
    const directionRow = screen.getByText('Switch Direction').closest('label');
    expect(directionRow?.classList.contains('tbs-settings__row')).toBe(true);

    // The knobs container is a single styled block in the same row family.
    const knobs = document.querySelector('.tbs-settings__knobs');
    expect(knobs).not.toBeNull();
  });

  it('defines the row / knobs classes in settings.css (no unstyled controls)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/settings.css'), 'utf8');
    expect(css).toMatch(/\.tbs-settings__row\b/);
    expect(css).toMatch(/\.tbs-settings__knobs\b/);
  });
});

describe('ACC#5: per-slot Custom edit is never silently discarded', () => {
  it('keeps Strategy=Custom and the edited knob when the write FAILS', async () => {
    const slots = [
      {
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: 'inherit',
        uiMarker: {},
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE({ slots });
      if (msg.action === 'SET_SLOT_STRATEGY') {
        return { result: { success: false, errorCode: 'CONFIG_CONFLICT', message: 'conflict' } };
      }
      return { result: { success: true } };
    });

    await openStrategy();

    // Switch slot 1 to Custom.
    const slotStrategy = screen.getByRole('combobox', { name: 'Strategy for slot 1' });
    fireEvent.change(slotStrategy, { target: { value: 'custom' } });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Strategy for slot 1' })).toHaveValue('custom');
    });

    // Now edit one knobs control (the write will fail).
    const ruleCheck = screen.getByLabelText('Slot 1 Rule Check');
    fireEvent.change(ruleCheck, { target: { value: 'no-match' } });

    // The user's Custom selection and edited value must survive the failure.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Strategy for slot 1' })).toHaveValue('custom');
    });
    expect(screen.getByLabelText('Slot 1 Rule Check')).toHaveValue('no-match');
  });
});

describe('ACC#6a: Priority is hidden when Tab ID = "No tab ID"', () => {
  beforeEach(() => {
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE();
      return { result: { success: true } };
    });
  });

  it('hides the global Priority control when tabIdMode is no-exists', async () => {
    await openStrategy();

    expect(screen.getByLabelText('Global Priority')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Global Tab ID'), { target: { value: 'no-exists' } });

    await waitFor(() => {
      expect(screen.queryByLabelText('Global Priority')).toBeNull();
    });

    // The stored value is PRESERVED (payload keeps priority='tabId'), not cleared.
    const lastCall = mockSendMessage.mock.calls.at(-1)?.[0] as
      | { action: string; payload?: { matchSettings?: { priority?: string } } }
      | undefined;
    expect(lastCall?.action).toBe('SET_GLOBAL_STRATEGY');
    expect(lastCall?.payload?.matchSettings?.priority).toBe('tabId');
  });

  it('hides Priority in the per-slot Custom expansion too, keeping the value', async () => {
    const slots = [
      {
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'rule-check' },
        uiMarker: {},
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE({ slots });
      return { result: { success: true } };
    });

    await openStrategy();

    expect(screen.getByLabelText('Slot 1 Priority')).toHaveValue('rule-check');
    fireEvent.change(screen.getByLabelText('Slot 1 Tab ID'), { target: { value: 'no-exists' } });

    await waitFor(() => {
      expect(screen.queryByLabelText('Slot 1 Priority')).toBeNull();
    });

    const call = mockSendMessage.mock.calls.at(-1)?.[0] as
      | { action: string; payload?: { strategy?: { priority?: string } } }
      | undefined;
    expect(call?.action).toBe('SET_SLOT_STRATEGY');
    expect(call?.payload?.strategy?.priority).toBe('rule-check');
  });
});