/**
 * U2 (P11) — the settings page must distinguish three top-level states:
 *   loading / failed / genuinely empty.
 *
 * RED guard: the pre-fix code has no top-level loading or error state, so
 * assertions ①②④ fail (no "Loading settings...", no Retry, and an empty
 * command list still renders "Loading commands...").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

type Mode = 'pending' | 'reject' | 'success' | 'empty';

let stateMode: 'pending' | 'reject' | 'success' = 'success';
let commandsMode: Mode = 'success';

const commands = Array.from({ length: 21 }, (_, i) => ({
  name: i < 20 ? `${i % 2 === 0 ? 'save' : 'switch'}-slot-${String(Math.floor(i / 2) + 1)}` : 'next-match',
  description: i < 20 ? `${i % 2 === 0 ? 'Save' : 'Switch'} slot ${String(Math.floor(i / 2) + 1)}` : 'Next match',
  shortcut: i < 3 ? `Ctrl+Shift+${String(i + 1)}` : null,
}));

const mockSendMessage = vi.fn(async (msg: { action: string }) => {
  if (msg.action === 'GET_COMMANDS') {
    if (commandsMode === 'pending') return new Promise(() => {});
    if (commandsMode === 'reject') throw new Error('commands unavailable');
    if (commandsMode === 'empty') return { result: { success: true, commands: [] } };
    return { result: { success: true, commands } };
  }
  if (msg.action === 'GET_STATE') {
    if (stateMode === 'pending') return new Promise(() => {});
    if (stateMode === 'reject') throw new Error('state unavailable');
    return {
      result: {
        success: true,
        sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

describe('U2 (P11) — settings top-level three-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateMode = 'success';
    commandsMode = 'success';
  });

  it('should render an explicit loading state while requests are pending', () => {
    stateMode = 'pending';
    commandsMode = 'pending';

    render(<SettingsApp />);

    expect(screen.getByText(/Loading settings/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('should render an alert with Retry when loading fails', async () => {
    stateMode = 'reject';

    render(<SettingsApp />);

    await waitFor(() => {
      // The pre-existing Toast also exposes role="alert"; the new error region
      // is an addition, not a replacement (plan: 叠加，不是替换).
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((text) => text.includes('Failed to load settings'))).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('should recover when Retry succeeds', async () => {
    stateMode = 'reject';

    render(<SettingsApp />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    stateMode = 'success';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getAllByRole('row').length).toBe(22);
    });
  });

  it('should show an empty state (not "Loading commands...") when commands are genuinely empty', async () => {
    commandsMode = 'empty';

    render(<SettingsApp />);

    await waitFor(() => {
      expect(screen.getByText('No commands available')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading commands...')).toBeNull();
  });
});