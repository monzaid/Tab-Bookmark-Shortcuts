/**
 * T14 — sidebar modal reuse of the shared field set, and the chain-derived
 * prefill (SC8 / DT4 / Q11).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

function stateWith(rules: unknown[], slots: unknown[] = [], overrides: unknown[] = [], bindings: unknown[] = []) {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
        switchDirection: 'next',
        autoBindGlobal: true,
        slots,
        rules,
      },
      local: {
        bindings,
        cycleCursors: [],
        lastSuccessSlotId: null,
        recoverySessions: [],
        recoverySnapshots: [],
        tabOverrides: overrides,
        iconCache: {},
        diagnostics: [],
      },
    },
  };
}

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([
      { id: 42, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Site Title', favIconUrl: 'https://site/f.ico', active: true, incognito: false, status: 'complete' },
    ]),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

const SLOT_S = {
  id: 5,
  urlMatch: { type: 'exact', value: 'https://example.com/page' },
  strategy: 'inherit',
  uiMarker: { customTitle: 'Slot S Title' },
  titleSnapshot: 'Slot S Title',
  faviconSnapshot: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const RULE_R = {
  id: 'r1',
  urlMatch: { type: 'exact', value: 'https://example.com/page' },
  priority: 100,
  title: 'Rule R Title',
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('T14: sidebar create-rule modal', () => {
  it('reuses the shared field set and has no mode checkbox', async () => {
    mockSendMessage.mockResolvedValue(stateWith([]));
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    expect(within(dialog).getByRole('textbox', { name: /Match URL/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Match Type' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Title source' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Icon source' })).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: /Priority/ })).toBeInTheDocument();

    // IMP-18 item 6: the "Auto-apply on match" checkbox is gone.
    expect(within(dialog).queryByText(/Auto-apply on match/)).toBeNull();
    // DT5: creation is labelled as unsaved.
    expect(within(dialog).getByText(/not saved yet/)).toBeInTheDocument();
  });

  it('does not render Clear in the create variant', async () => {
    mockSendMessage.mockResolvedValue(stateWith([]));
    render(<SidebarApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });
    expect(within(dialog).queryByText('Clear title')).toBeNull();
    expect(within(dialog).queryByText('Clear icon')).toBeNull();
  });

  it('prefills the Title from the CHAIN (slot wins over the rule here)', async () => {
    mockSendMessage.mockResolvedValue(
      stateWith([RULE_R], [SLOT_S], [], [{ slotId: 5, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }]),
    );
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    // The slot tier is above the rule tier → the prefill must be the slot value.
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Custom title text')).toHaveValue('Slot S Title');
    });
  });

  it('prefills a tab override when one wins the chain', async () => {
    mockSendMessage.mockResolvedValue(
      stateWith(
        [RULE_R],
        [SLOT_S],
        [{ tabId: 42, title: 'Override O', createdAt: '2026-01-01T00:00:00Z' }],
        [{ slotId: 5, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
      ),
    );
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    await waitFor(() => {
      expect(within(dialog).getByLabelText('Custom title text')).toHaveValue('Override O');
    });
  });
});