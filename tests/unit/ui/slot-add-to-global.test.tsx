/**
 * Bug 1: Sidebar slot menu "Add to Global Rules" must prefill the rule modal
 * with the SLOT's own data (url value, title, icon, match type) — never with
 * current page data. The "+" button keeps its current-page prefill behavior.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CURRENT_PAGE_URL = 'https://current-page.test/here';

const REGEX_SLOT = {
  id: 1,
  urlMatch: { type: 'regex' as const, value: 'https://slot-regex\\.test/.*' },
  strategy: 'inherit' as const,
  uiMarker: { customTitle: 'Slot Custom Title' },
  titleSnapshot: 'Snapshot Title',
  faviconSnapshot: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const EXACT_SLOT = {
  id: 2,
  urlMatch: { type: 'exact' as const, value: 'https://exact-slot.test/page' },
  strategy: 'inherit' as const,
  uiMarker: {},
  titleSnapshot: 'Exact Slot Snapshot',
  faviconSnapshot: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function buildStatePayload() {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        globalStrategy: 'B',
        slots: [REGEX_SLOT, EXACT_SLOT],
        rules: [],
      },
      local: {
        bindings: [
          { slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' },
          { slotId: 2, tabId: 43, windowId: 1, boundAt: '2026-01-01T00:00:00Z' },
        ],
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
}

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
  },
  tabs: {
    query: vi.fn(async () => [
      { id: 99, url: CURRENT_PAGE_URL, title: 'Current Page Title', favIconUrl: '' },
    ]),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn(async () => ({})) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function openSlotAddToGlobal(slotNumber: number) {
  render(<SidebarApp />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: `More options for slot ${slotNumber}` })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: `More options for slot ${slotNumber}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Global Rules' }));
  await waitFor(() => {
    expect(screen.getByLabelText('Match URL')).toBeInTheDocument();
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Bug 1: "Add to Global Rules" prefills rule modal from slot data only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(async (message: { action: string }) => {
      if (message.action === 'GET_STATE') return buildStatePayload();
      if (message.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
      if (message.action === 'CREATE_RULE') return { result: { success: true } };
      return { result: { success: true } };
    });
  });

  it('prefills URL with the regex slot\'s own pattern, not current page URL', async () => {
    await openSlotAddToGlobal(1);

    const urlInput = screen.getByLabelText('Match URL') as HTMLInputElement;
    expect(urlInput.value).toBe('https://slot-regex\\.test/.*');
    expect(urlInput.value).not.toBe(CURRENT_PAGE_URL);
  });

  it('prefills Match Type with the slot\'s match type (regex)', async () => {
    await openSlotAddToGlobal(1);

    expect(screen.getByLabelText('Regex')).toBeChecked();
    expect(screen.getByLabelText('Exact URL')).not.toBeChecked();
  });

  it('prefills title from the slot (uiMarker customTitle)', async () => {
    await openSlotAddToGlobal(1);

    const titleInput = screen.getByLabelText('Custom title') as HTMLInputElement;
    expect(titleInput.value).toBe('Slot Custom Title');
  });

  it('prefills exact slot with its own URL and exact match type', async () => {
    await openSlotAddToGlobal(2);

    const urlInput = screen.getByLabelText('Match URL') as HTMLInputElement;
    expect(urlInput.value).toBe('https://exact-slot.test/page');
    expect(screen.getByLabelText('Exact URL')).toBeChecked();
  });

  it('sends CREATE_RULE with the slot\'s urlMatch (regex preserved)', async () => {
    await openSlotAddToGlobal(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_RULE',
          payload: expect.objectContaining({
            urlMatch: { type: 'regex', value: 'https://slot-regex\\.test/.*' },
          }),
        }),
      );
    });
  });

  // Regression guard: the "+" button MUST keep current-page prefill behavior.
  it('"+" button still prefills with current page data (unchanged behavior)', async () => {
    render(<SidebarApp />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add to global rules' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Match URL')).toBeInTheDocument();
    });

    const urlInput = screen.getByLabelText('Match URL') as HTMLInputElement;
    expect(urlInput.value).toBe(CURRENT_PAGE_URL);
    expect(screen.getByLabelText('Exact URL')).toBeChecked();
  });
});
