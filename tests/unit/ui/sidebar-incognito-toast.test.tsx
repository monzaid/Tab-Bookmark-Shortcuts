/**
 * FIX-1 (sidebar): `incognito_blocked` is a *successful* outcome
 * (`success: true`) that still needs a user-visible toast.
 *
 * The pre-fix sidebar only raised a toast on `!result.success`, so a blocked
 * incognito switch silently did nothing. Design §4 / DT8 require the toast:
 * `Incognito access not authorized`.
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
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
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

/** Route responses by action so the sidebar stays hydrated. */
function respondWith(slot1Switch: unknown): void {
  mockSendMessage.mockImplementation((message: { action?: string }) => {
    if (message.action === 'SWITCH_SLOT') return Promise.resolve(slot1Switch);
    return Promise.resolve(BASE_STATE);
  });
}

/** Click the bound slot-1 row (the row itself is the switch trigger). */
async function clickSlot1(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('listitem', { name: /Slot 1:/ })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('listitem', { name: /Slot 1:/ }));
}

describe('FIX-1 — sidebar surfaces the incognito_blocked toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FIX-1 RED: shows "Incognito access not authorized" for an incognito_blocked outcome', async () => {
    respondWith({ result: { success: true, outcome: { type: 'incognito_blocked' } } });
    render(<SidebarApp />);

    await clickSlot1();

    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert').map((a) => a.textContent);
      expect(alerts.some((t) => t.includes('Incognito access not authorized'))).toBe(true);
    });
  });

  it('FIX-1: a successful switch does NOT raise the incognito toast', async () => {
    respondWith({ result: { success: true, outcome: { type: 'switched' } } });
    render(<SidebarApp />);

    await clickSlot1();

    // Give the async handler a chance to (not) set a toast.
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SWITCH_SLOT' }),
      );
    });
    const alerts = screen.queryAllByRole('alert').map((a) => a.textContent);
    expect(alerts.some((t) => t.includes('Incognito access not authorized'))).toBe(false);
  });
});