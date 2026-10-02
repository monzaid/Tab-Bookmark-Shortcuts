/**
 * U5 (P2 + P6 + P8) — slot menu: delete semantics, pre-confirm, explicit edits.
 *
 * Design authority: `_context-output/designs/2026-07-14-...-ui-ux-design.md:199`
 * requires a second confirmation for slot unbinding. So the destructive action
 * must be BLOCKED behind a Confirm before any UNBIND_SLOT message is sent.
 *
 * Wording convergence (P6): `Reset` -> `Delete Slot`, toast `Slot N unbound`
 * -> `Slot N deleted`, error `Failed to unbind slot N` -> `Failed to delete slot N`.
 *
 * RED guard: the pre-fix menu item is `Reset` and clicking it sends UNBIND_SLOT
 * immediately with no confirmation, so ①②④ fail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

/**
 * T19 anchor migration: the Confirm primitive now enforces a ~120ms protection
 * window (CT3-b4) so the keypress/click that OPENED the dialog cannot activate
 * it. Tests that fire the confirmation programmatically must wait it out.
 */
async function flushConfirmGuard(): Promise<void> {
  await new Promise((r) => setTimeout(r, 150));
}

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

interface SentMessage {
  action?: string;
  payload?: { slotId?: number };
}

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

const unbindCalls = () =>
  mockSendMessage.mock.calls.filter((c) => (c[0] as SentMessage).action === 'UNBIND_SLOT');

function respondWith(unbindResult: unknown): void {
  mockSendMessage.mockImplementation((message: SentMessage) => {
    if (message.action === 'UNBIND_SLOT') return Promise.resolve(unbindResult);
    return Promise.resolve(BASE_STATE);
  });
}

async function openSlotMenu(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'More options for slot 1' }));
  await waitFor(() => {
    expect(screen.getByRole('menu', { name: 'Slot 1 actions' })).toBeInTheDocument();
  });
}

describe('U5 (P2 + P6 + P8) — slot menu delete + explicit edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respondWith({ success: true });
  });

  it('should name the destructive entry "Delete Slot" (no "Reset")', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    expect(screen.getByRole('menuitem', { name: 'Delete Slot' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Reset' })).toBeNull();
  });

  it('should not send UNBIND_SLOT until the confirm dialog is accepted', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Slot' }));

    // A confirmation must appear and nothing may be sent yet.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog').textContent).toContain('Delete Slot');
    expect(unbindCalls()).toHaveLength(0);
  });

  it('should keep the slot when the confirm dialog is cancelled', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Slot' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(unbindCalls()).toHaveLength(0);
  });

  it('should send UNBIND_SLOT after the confirm dialog is accepted', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Slot' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    await flushConfirmGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(unbindCalls()).toHaveLength(1);
    });
    expect(unbindCalls()[0]?.[0]).toEqual(expect.objectContaining({ action: 'UNBIND_SLOT', payload: { slotId: 1 } }));
  });

  it('should report the delete in the unified wording', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Slot' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    await flushConfirmGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const texts = screen.getAllByRole('alert').map((a) => a.textContent);
      expect(texts.some((t) => t.includes('Slot 1 deleted'))).toBe(true);
    });
  });

  it('should expose explicit edit entries so double-click is not required (P8)', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    expect(screen.getByRole('menuitem', { name: 'Rename Slot…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Change Icon…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit URL…' })).toBeInTheDocument();
  });

  it('should open the icon editor from the explicit menu entry (P8)', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Change Icon…' }));

    // The modal's own container/title is U7's concern (Dialog migration); U5
    // only has to prove the explicit entry reaches the icon editor.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('should start inline title editing from the explicit menu entry (P8)', async () => {
    render(<SidebarApp />);
    await openSlotMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Slot…' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Example')).toBeInTheDocument();
    });
  });
});