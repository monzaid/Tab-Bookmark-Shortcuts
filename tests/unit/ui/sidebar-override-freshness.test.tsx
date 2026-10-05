/**
 * FIX-B (sidebar closure) — the sidebar must render the background's
 * MATERIALIZED state, not re-read the persisted record behind its back.
 *
 * The sidebar used to overwrite `local.tabOverrides` with a raw
 * `chrome.storage.local.get('localState')` read "for freshness". That raw value
 * is the DURABLE form (a recipe's `value` is `''`), so it undid the read-time
 * materialization the repository had just performed: a recipe override rendered
 * blank, and "Change Icon" could not seed the recipe back into the editor.
 *
 * These assertions are structural: the raw read must not happen at all, and the
 * materialized icon must be the one rendered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';
import type { LocalState, SyncState, TabOverride } from '@shared/types';

const RECIPE = { type: 'template' as const, value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' };
const PNG = 'data:image/png;base64,SIDEBARPNG';

/** What `getLocalState()` returns in production: the recipe's value is rendered. */
const materializedLocal: LocalState = {
  ...createDefaultLocalState(),
  bindings: [{ slotId: 1, tabId: 7, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
  tabOverrides: [{ tabId: 7, favicon: { ...RECIPE, value: PNG }, createdAt: '2026-01-01T00:00:00Z' } as TabOverride],
};

/** The PERSISTED form a raw storage read would find (recipe value stays ''). */
const persistedLocal: LocalState = {
  ...createDefaultLocalState(),
  bindings: [{ slotId: 1, tabId: 7, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
  tabOverrides: [{ tabId: 7, favicon: RECIPE, createdAt: '2026-01-01T00:00:00Z' } as TabOverride],
};

const syncState: SyncState = {
  ...createDefaultSyncState(),
  configVersion: 1,
  slots: [{
    id: 1,
    urlMatch: { type: 'exact', value: 'https://a.com/' },
    strategy: 'inherit',
    uiMarker: {},
    titleSnapshot: 'A',
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }],
};

const mockSendMessage = vi.fn().mockResolvedValue({
  result: { success: true, sync: syncState, local: materializedLocal },
});

/** The raw read the sidebar used to perform — now it must never be called. */
const rawLocalGet = vi.fn().mockResolvedValue({ localState: persistedLocal });

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 7, url: 'https://a.com/', title: 'A', favIconUrl: '' }]),
    get: vi.fn().mockResolvedValue({ id: 7 }),
    update: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: rawLocalGet },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  commands: { getAll: vi.fn().mockResolvedValue([]), onCommand: { addListener: vi.fn() } },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockResolvedValue({ result: { success: true, sync: syncState, local: materializedLocal } });
  rawLocalGet.mockResolvedValue({ localState: persistedLocal });
});

describe('FIX-B: the sidebar does not bypass the materialized override', () => {
  it('never re-reads chrome.storage.local for tabOverrides', async () => {
    render(<SidebarApp />);
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'GET_STATE' }));
    });
    // The raw override read is GONE — this is the structural proof.
    expect(rawLocalGet).not.toHaveBeenCalled();
  });

  it('renders the MATERIALIZED recipe icon, not the persisted empty value', async () => {
    render(<SidebarApp />);

    // The bound slot's row shows the override's materialized PNG. Had the raw
    // persisted record won, no <img> would carry this src.
    await waitFor(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      expect(imgs.some((i) => i.getAttribute('src') === PNG)).toBe(true);
    });
  });
});