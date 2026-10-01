/**
 * F3 (regression from U7) — `Change Icon…` must PRE-LOAD the existing icon on
 * the FIRST open.
 *
 * `IconEditorModal` keeps its `iconConfig` in state seeded from `initialIcon`,
 * and `IconEditor` seeds its internal state from that `value` at mount. Since
 * `Dialog` returns `null` while closed, the editor is mounted only on open —
 * but at that moment the parent's `iconConfig` is still the value captured when
 * the (always-mounted) modal was created, i.e. a blank default. The correct
 * `initialIcon` only reaches the modal in a later effect, which the already
 * mounted editor never reads.
 *
 * Visible defect: the first open shows an empty blue default (so the user
 * believes there is no icon) and any edit replaces the real icon on Apply.
 *
 * RED guard: pre-fix no `<img alt="Icon preview">` is rendered on the first
 * open (the canvas placeholder is shown instead).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();
const mockTabsQuery = vi.fn();

const EXISTING_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

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
          uiMarker: { customTitle: 'Example', icon: { type: 'upload', value: EXISTING_ICON } },
          titleSnapshot: 'Example',
          faviconSnapshot: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
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

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: mockTabsQuery,
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

describe('F3 — first open of the icon editor pre-loads the existing icon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabsQuery.mockResolvedValue([]);
    mockSendMessage.mockImplementation(() => Promise.resolve(BASE_STATE));
  });

  it('should pre-load the slot icon on the first open (slot instance)', async () => {
    render(<SidebarApp />);

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

    // The existing icon must be shown immediately — not a blank default.
    const preview = screen.getByAltText('Icon preview');
    expect(preview).toHaveAttribute('src', EXISTING_ICON);
  });

  it('should pre-load the current-page favicon on the first open (current-page instance)', async () => {
    mockTabsQuery.mockResolvedValue([
      {
        id: 7,
        url: 'https://example.com',
        title: 'Example',
        favIconUrl: EXISTING_ICON,
        active: true,
        windowId: 1,
      },
    ]);

    render(<SidebarApp />);

    const trigger = await screen.findByRole('button', { name: 'Change tab icon (double-click)' });
    fireEvent.doubleClick(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const preview = screen.getByAltText('Icon preview');
    expect(preview).toHaveAttribute('src', EXISTING_ICON);
  });
});