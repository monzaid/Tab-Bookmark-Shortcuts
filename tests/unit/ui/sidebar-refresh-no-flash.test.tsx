/**
 * F2 (regression from U6) — a REFRESH (non-first load) must not flash the whole
 * shell, unmount open modals, or drop drafts.
 *
 * `loadState` now starts with `loading: true` on EVERY call, and the render
 * early-returns the full-page "Loading..." shell whenever `state.loading` is
 * true. So every `storage.onChanged` / post-save refresh blanks the sidebar:
 * footer + slot list disappear, an open modal is unmounted (losing its draft)
 * and `UndoBar` restarts its countdown.
 *
 * Expected: during a refresh the shell stays, the footer stays, and an open
 * modal keeps its in-progress draft.
 *
 * RED guard: pre-fix the refresh re-enters the full-page loading branch, so
 * ①③④ fail ("Loading..." appears, footer + dialog vanish).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

type StorageListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

let storageListener: StorageListener | null = null;

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
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: {
      addListener: vi.fn((listener: StorageListener) => {
        storageListener = listener;
      }),
      removeListener: vi.fn(),
    },
  },
});

/** Open the slot icon modal and type a draft into the text field. */
async function openIconModalWithDraft(): Promise<HTMLInputElement> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'More options for slot 1' }));
  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: 'Change Icon…' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Change Icon…' }));
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  const input = screen.getByLabelText<HTMLInputElement>('Icon text or emoji');
  fireEvent.change(input, { target: { value: 'A' } });
  expect(input.value).toBe('A');
  return input;
}

/** Await the storage listener the app registers on mount. */
function getStorageListener(): StorageListener {
  if (storageListener === null) {
    throw new Error('storage listener was not registered');
  }
  return storageListener;
}

describe('F2 — refresh must not flash the shell or drop modal drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageListener = null;
    mockSendMessage.mockImplementation(() => Promise.resolve(BASE_STATE));
  });

  it('should keep the shell + footer and an open modal during a storage refresh', async () => {
    render(<SidebarApp />);
    const draftInput = await openIconModalWithDraft();

    // A background write lands → sidebar triggers a state refresh.
    const listener = getStorageListener();
    act(() => {
      listener({ localState: { newValue: {} } }, 'local');
    });

    // No whole-shell loading takeover.
    expect(screen.queryByText('Loading...')).toBeNull();
    // Shell + footer survive the refresh.
    expect(screen.getByRole('application', { name: 'Tab Bookmarks Sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
    // The modal is not unmounted and the draft survives.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>('Icon text or emoji').value).toBe('A');
    expect(draftInput).toBeInTheDocument();
  });

  it('should still show the full-page loading shell on the very first load', async () => {
    let resolveState: (value: unknown) => void = () => {};
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') {
        return new Promise((resolve) => {
          resolveState = resolve;
        });
      }
      return Promise.resolve({ result: { success: true, commands: [] } });
    });

    render(<SidebarApp />);

    // First paint: genuinely nothing loaded yet → loading shell is correct.
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    act(() => {
      resolveState(BASE_STATE);
    });

    await waitFor(() => {
      expect(screen.getByRole('list', { name: '10 bookmark slots' })).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).toBeNull();
  });
});