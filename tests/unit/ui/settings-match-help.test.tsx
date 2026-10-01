/**
 * ACC#7 — the Global Matching Settings section ships an in-app reference.
 *
 * It must document every control in that section, including the four knob
 * combinations and the strictest Priority level, so the behaviour is explained
 * where the user configures it (rather than only in the design docs).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

const mockSendMessage = vi.fn().mockImplementation(async (msg: { action: string }) => {
  if (msg.action === 'GET_COMMANDS') {
    return { result: { success: true, commands: [] } };
  }
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: {
          configVersion: 1,
          matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
          switchDirection: 'next',
          autoBindGlobal: true,
          slots: [],
          rules: [],
        },
        local: {
          bindings: [],
          cycleCursors: [],
          lastSuccessSlotId: null,
          recoverySessions: [],
          recoverySnapshots: [],
          tabOverrides: [],
          iconCache: {},
          diagnostics: [],
        },
      },
    };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

async function openStrategySection(): Promise<void> {
  render(<SettingsApp />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
}

describe('Global Matching Settings — in-app reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expose a collapsed reference in the Global Matching Settings section', async () => {
    await openStrategySection();

    const summary = await screen.findByText('How these settings work');
    expect(summary).toBeInTheDocument();
    // Collapsed by default so the section stays scannable.
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it('should document every control and all four knob combinations once expanded', async () => {
    await openStrategySection();

    fireEvent.click(await screen.findByText('How these settings work'));

    for (const heading of [
      /^Knob combinations$/,
      /^Tie-break priority/,
      /^Direction of switching$/,
      /^Auto-bind behaviour$/,
      /^When nothing can be resolved$/,
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    // All four combinations, keyed by their knob values.
    for (const combination of [
      /Tab ID: Exists \+ Rule Check: Match/,
      /Tab ID: Exists \+ Rule Check: No match/,
      /Tab ID: No tab ID \+ Rule Check: Match/,
      /Tab ID: No tab ID \+ Rule Check: No match/,
    ]) {
      expect(screen.getAllByText(combination).length).toBeGreaterThan(0);
    }
    // The strictest tier is spelled out (user ruling Q1-B).
    expect(screen.getAllByText(/must still be open AND its URL must still match/).length).toBeGreaterThan(0);
    // And the unresolved outcome is explained.
    expect(screen.getAllByText(/Tab Not Found/).length).toBeGreaterThan(0);
  });
});