/**
 * Bug 1 (sidebar): footer navigation must reuse an already-open tab.
 *
 * Primary path: sendMessage('OPEN_PAGE') to background.
 * Fallback path (background unavailable): local chrome.tabs with the same
 * hash-insensitive reuse logic — activate the open tab, hash-navigate if the
 * target hash differs, only create when nothing matches.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const tabsQuery = vi.fn();
const tabsUpdate = vi.fn();
const tabsCreate = vi.fn();
const runtimeSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: runtimeSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: tabsQuery,
    get: vi.fn(),
    update: tabsUpdate,
    create: tabsCreate,
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

const STATE_RESPONSE = {
  result: {
    success: true,
    sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
    local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
  },
};

const SETTINGS_URL = 'chrome-extension://test-id/src/ui/settings/index.html';

describe('Bug 1 (sidebar): footer buttons reuse already-open tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: background unavailable → local fallback path; no tabs open
    runtimeSendMessage.mockRejectedValue(new Error('background unavailable'));
    tabsQuery.mockResolvedValue([]);
    tabsUpdate.mockResolvedValue({});
    tabsCreate.mockResolvedValue({ id: 99 });
  });

  async function renderSidebar() {
    render(<SidebarApp />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
    });
  }

  it('should first try OPEN_PAGE via background message', async () => {
    runtimeSendMessage.mockImplementation(async (msg: { action: string }) => {
      if (msg.action === 'OPEN_PAGE') return { success: true };
      return STATE_RESPONSE;
    });

    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    await waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'OPEN_PAGE', payload: { url: SETTINGS_URL } }),
      );
    });
    // Background handled it — no local tabs.create
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('fallback: activates the open settings tab instead of creating', async () => {
    tabsQuery.mockImplementation(async (q: Record<string, unknown>) => {
      if (q && Object.keys(q).length === 0) {
        return [{ id: 5, url: SETTINGS_URL }];
      }
      return [];
    });

    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    await waitFor(() => {
      expect(tabsUpdate).toHaveBeenCalledWith(5, { active: true });
    });
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('fallback: creates a new tab when no settings tab is open', async () => {
    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    await waitFor(() => {
      expect(tabsCreate).toHaveBeenCalledWith({ url: SETTINGS_URL });
    });
  });

  it('fallback: diagnostics hash URL reuses open settings tab and hash-navigates', async () => {
    tabsQuery.mockImplementation(async (q: Record<string, unknown>) => {
      if (q && Object.keys(q).length === 0) {
        return [{ id: 5, url: SETTINGS_URL }];
      }
      return [];
    });

    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'View diagnostics' }));

    await waitFor(() => {
      expect(tabsUpdate).toHaveBeenCalledWith(5, { active: true });
    });
    expect(tabsUpdate).toHaveBeenCalledWith(5, { url: `${SETTINGS_URL}#diagnostics` });
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('should route Import/Export to the settings import-export section (U4 / P1)', async () => {
    runtimeSendMessage.mockImplementation((msg: { action: string }) =>
      Promise.resolve(msg.action === 'OPEN_PAGE' ? { success: true } : STATE_RESPONSE),
    );

    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Import or export' }));

    await waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OPEN_PAGE',
          payload: { url: `${SETTINGS_URL}#import-export` },
        }),
      );
    });
  });

  // ─── T12a: bounded retry FIRST; direct fallback only when the context is dead ───
  it('T12a RED: retries OPEN_PAGE before falling back (no second creator)', async () => {
    let attempts = 0;
    runtimeSendMessage.mockImplementation((msg: { action: string }) => {
      if (msg.action === 'OPEN_PAGE') {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('service worker waking'));
        return Promise.resolve({ success: true });
      }
      return Promise.resolve(STATE_RESPONSE);
    });

    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    await waitFor(() => {
      expect(attempts).toBeGreaterThanOrEqual(2);
    });
    // The retry succeeded, so the local fallback must NOT have created a tab.
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  });

describe('T12a: the misleading recovery toast is gone', () => {
  it('T12a: sidebar source contains no recovery-opening toast', async () => {
    // Assembled at runtime so this assertion does not itself add a static match.
    const needle = 'opening ' + 'recovery window';
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/ui/sidebar/App.tsx', 'utf-8');
    expect(source).not.toContain(needle);
  });
});
