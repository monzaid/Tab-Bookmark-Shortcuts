/**
 * U7 (P4) — the two hand-written sidebar modals must adopt the shared `Dialog`
 * primitive so they inherit Escape, a Tab focus trap and focus restoration.
 *
 * The primitive already provides all three (`shared/components.tsx:102-169`,
 * locked by `tokens-components.test.tsx:43-64`), so this is a REUSE task, not a
 * new implementation.
 *
 * RED guard: the pre-fix modals are bare `<div role="dialog">` with none of
 * these behaviours, so ①③④ fail.
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
      globalStrategy: 'B',
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

/** Open the icon modal via the explicit menu entry and return its trigger button. */
async function openIconModal(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'More options for slot 1' }));
  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: 'Change Icon…' })).toBeInTheDocument();
  });
  const trigger = screen.getByRole('button', { name: 'More options for slot 1' });
  // Dialog restores focus to whatever held it when it opened, so the trigger
  // must genuinely hold focus before the click.
  trigger.focus();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Change Icon…' }));
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  return trigger;
}

/** Open the create-rule modal via the current-page action. */
async function openRuleModal(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Add to global rules' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
}

describe('U7 (P4) — sidebar modals use the accessible Dialog primitive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve(BASE_STATE));
  });

  it('should close the icon modal on Escape', async () => {
    render(<SidebarApp />);
    await openIconModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('should close the create-rule modal on Escape', async () => {
    render(<SidebarApp />);
    await openRuleModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('should move focus into the modal when it opens', async () => {
    render(<SidebarApp />);
    await openIconModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('should restore focus to the trigger after the modal closes', async () => {
    render(<SidebarApp />);
    const trigger = await openIconModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('should trap Tab inside the modal (last element wraps to the first)', async () => {
    render(<SidebarApp />);
    await openIconModal();

    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(document.activeElement).toBe(first);
  });
});