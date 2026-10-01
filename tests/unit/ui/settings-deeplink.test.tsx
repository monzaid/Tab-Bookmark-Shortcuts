/**
 * U4 (P1) — the settings page must CONSUME `location.hash` so a deep link
 * actually lands on the target section.
 *
 * Bearing: no `location.hash` / `hashchange` handling exists anywhere in
 * `src/ui/**` today, so the footer's existing `#diagnostics` link silently
 * lands on "Slots & Shortcuts". Both the new `#import-export` link and the
 * pre-existing `#diagnostics` link are fixed by the same mechanism.
 *
 * RED guard: assertions ①②④ fail on the pre-fix code (no hash consumption).
 *
 * `open-page.ts:44-50` performs a HASH-ONLY `tabs.update` (no reload) when the
 * settings tab is already open, so a `hashchange` listener is a requirement,
 * not a nicety.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

const mockSendMessage = vi.fn((msg: { action: string }) => {
  if (msg.action === 'GET_COMMANDS') {
    return Promise.resolve({ result: { success: true, commands: [] } });
  }
  return Promise.resolve({
    result: {
      success: true,
      sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
      local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
    },
  });
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

const setHash = (hash: string) => {
  window.location.hash = hash;
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom keeps location.hash between tests — reset to the no-hash default.
  window.location.hash = '';
});

describe('U4 (P1) — settings consumes location.hash', () => {
  it('should open the Import / Export section from #import-export', async () => {
    setHash('#import-export');

    render(<SettingsApp />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Import / Export' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Slots & Shortcuts' })).toBeNull();
  });

  it('should open the Diagnostics section from #diagnostics (pre-existing broken link)', async () => {
    setHash('#diagnostics');

    render(<SettingsApp />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument();
    });
  });

  it('should fall back to Slots when no hash is present', async () => {
    render(<SettingsApp />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Slots & Shortcuts' })).toBeInTheDocument();
    });
  });

  it('should follow a hashchange while the page is already open', async () => {
    render(<SettingsApp />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Slots & Shortcuts' })).toBeInTheDocument();
    });

    act(() => {
      window.location.hash = '#rules';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Page Rewrite Rules' })).toBeInTheDocument();
    });
  });

  it('should ignore an unknown hash and keep the default section', async () => {
    setHash('#not-a-section');

    render(<SettingsApp />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Slots & Shortcuts' })).toBeInTheDocument();
    });
  });
});