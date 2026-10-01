/**
 * T26 (N3): the sidebar must react to `success: false` from the background.
 *
 * `handleUnbind` and `handleUndo` awaited the response but never inspected it,
 * so a rejected write still showed a success/info toast — the user saw "unbound"
 * for a slot that was still there, with no way to tell.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

const BASE_STATE = {
  result: {
    success: true,
    sync: {
      configVersion: 1,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true,
      slots: [
        {
          id: 1,
          urlMatch: { type: 'exact', value: 'https://example.com' },
          strategy: 'inherit',
          uiMarker: { customTitle: 'Example' },
          titleSnapshot: 'Example',
          faviconSnapshot: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      rules: [],
    },
    local: {
      bindings: [{ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
      cycleCursors: [],
      lastSuccessSlotId: 1,
      recoverySessions: [],
      recoverySnapshots: [],
      tabOverrides: [],
      iconCache: {},
      diagnostics: [],
    },
  },
};

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

/** Route responses by action so GET_STATE keeps the app hydrated. */
function respondWith(unbindResult: unknown, undoResult: unknown): void {
  mockSendMessage.mockImplementation((message: { action?: string }) => {
    if (message?.action === 'UNBIND_SLOT') return Promise.resolve(unbindResult);
    if (message?.action === 'UNDO_SAVE') return Promise.resolve(undoResult);
    return Promise.resolve(BASE_STATE);
  });
}

/**
 * Open slot 1's "more" menu, pick the destructive entry and confirm it.
 *
 * GE1 (plan-authorised): the entry was renamed `Reset` -> `Delete Slot` (P6)
 * and now requires a confirmation (P2). Only the LOCATORS and the interaction
 * FLOW are updated here; every `expect` judgement below is unchanged.
 */
async function clickReset(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'More options for slot 1' }));
  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: 'Delete Slot' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Slot' }));
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
}

describe('T26 (N3) — sidebar consumes the response `success` flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should surface an error (not a success) when UNBIND_SLOT fails', async () => {
    respondWith({ success: false, errorCode: 'CONFIG_CONFLICT', message: 'nope' }, BASE_STATE);
    render(<SidebarApp />);

    await clickReset();

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      const texts = alerts.map((a) => a.textContent ?? '');
      expect(texts.some((t) => t.includes('Failed to delete slot 1'))).toBe(true);
    });

    // The success/info wording must NOT appear.
    const texts = screen.getAllByRole('alert').map((a) => a.textContent ?? '');
    expect(texts.some((t) => t.includes('Slot 1 deleted'))).toBe(false);
  });

  it('should surface an error when UNDO_SAVE fails', async () => {
    respondWith(BASE_STATE, { success: false, errorCode: 'CONFIG_CONFLICT', message: 'nope' });

    // Undo bar only renders after a save; drive the save through the save button.
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message?.action === 'SAVE_SLOT') return Promise.resolve({ success: true });
      if (message?.action === 'UNDO_SAVE') return Promise.resolve({ success: false });
      return Promise.resolve(BASE_STATE);
    });

    render(<SidebarApp />);

    // Slot 1 is BOUND, so its save control is the ghost "Save current tab…" button.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save current tab to slot 1' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save current tab to slot 1' }));

    // An occupied slot produces the 5s undo bar.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Undo overwrite of slot 1' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo overwrite of slot 1' }));

    await waitFor(() => {
      const texts = screen.getAllByRole('alert').map((a) => a.textContent ?? '');
      expect(texts.some((t) => t === 'Undo failed' || t.includes('Undo failed'))).toBe(true);
    });
  });
});