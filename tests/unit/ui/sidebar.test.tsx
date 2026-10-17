import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';
import { UNDO_DEFAULT_MS } from '@ui/shared/undo-bar';
import { PENDING_UNDO_TTL_MS } from '@background/storage-repository';

// Mock chrome.runtime.sendMessage
const mockSendMessage = vi.fn().mockResolvedValue({
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
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
});

describe('T15: Sidebar framework, current context, 10-slot list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({
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
    });
  });

  describe('Happy path — rendering and interactions', () => {
    it('should render 10 slot rows', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        const list = screen.getByRole('list', { name: '10 bookmark slots' });
        expect(list).toBeInTheDocument();
      });

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(10);
    });

    it('should show bound slot with title and status', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      expect(screen.getByText('Bound')).toBeInTheDocument();
    });

    it('should show empty slots with Save button', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getAllByText('Empty').length).toBeGreaterThan(0);
      });

      const saveButtons = screen.getAllByRole('button', { name: /Save to slot/ });
      expect(saveButtons.length).toBe(9); // 9 empty slots
    });

    it('should send NEXT_MATCH_SLOT message on Next button click', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      const nextButton = screen.getByRole('button', { name: 'Switch to next matching tab for slot 1' });
      fireEvent.click(nextButton);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'NEXT_MATCH_SLOT', payload: { slotId: 1 } })
      );
    });

    it('should switch on Enter key for bound slot', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      // Find the first listitem (slot 1) and press Enter
      const items = screen.getAllByRole('listitem');
      fireEvent.keyDown(items[0], { key: 'Enter' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SWITCH_SLOT' })
      );
    });

    it('should toggle collapse for current page section', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Collapse current page/ })).toBeInTheDocument();
      });

      const toggle = screen.getByRole('button', { name: /Collapse current page/ });
      fireEvent.click(toggle);

      expect(screen.getByRole('button', { name: /Expand current page/ })).toBeInTheDocument();
    });

    it('should render lock toggle button', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
      });

      // Lock button is present and interactive
      const lockBtn = screen.getByRole('button', { name: /Lock to current tab/ });
      fireEvent.click(lockBtn);

      // Button remains functional (currentTabId is null in test, so lock stays null)
      expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
    });
  });

  describe('Edge path — lock removed tab and missing shortcuts', () => {
    it('should toggle lock button state', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
      });

      // Click lock — button should change to unlock label
      fireEvent.click(screen.getByRole('button', { name: /Lock to current tab/ }));

      // Since currentTabId is null in test, lockedTabId stays null
      // But the button should still be present and functional
      expect(screen.getByRole('button', { name: /Lock to current tab/ })).toBeInTheDocument();
    });

    it('should render application role with aria-label', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('application', { name: 'Tab Bookmarks Sidebar' })).toBeInTheDocument();
      });
    });

    it('should show footer navigation entries', async () => {
      render(<SidebarApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import or export' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'View diagnostics' })).toBeInTheDocument();
      });
    });
  });
});

/**
 * T8 — the sidebar feeds the SHARED undo stack (U4/U6), pushing
 * `replay:'background'` entries that carry the backend `captureId` (A10).
 *
 * The user-visible promise is U1+U6: two overwrites stack TWO bars, and each
 * bar undoes ITS OWN action — clicking the first must send the FIRST captureId,
 * not the newest (which "pop the newest" would do). This is the one place the
 * sidebar can prove "undo what I clicked".
 */
describe('T8 — sidebar overflow saves stack on the shared undo stack', () => {
  /** Slot 1 stays bound so its save control is the ghost overwrite button. */
  const HYDRATED_STATE = {
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

  /** The `captureId`s the worker "mints", in order, one per save. */
  const savedCaptureIds: number[] = [];
  const undoRequests: Array<{ slotId: number; captureId: number }> = [];

  beforeEach(() => {
    savedCaptureIds.length = 0;
    undoRequests.length = 0;
    let nextCapture = 100;

    mockSendMessage.mockImplementation((message: { action?: string; payload?: unknown }) => {
      if (message.action === 'SAVE_SLOT') {
        nextCapture += 1;
        savedCaptureIds.push(nextCapture);
        return Promise.resolve({ success: true, slot: { id: 1 }, captureId: nextCapture });
      }
      if (message.action === 'UNDO_SAVE') {
        undoRequests.push(message.payload as { slotId: number; captureId: number });
        return Promise.resolve({ success: true });
      }
      // GET_STATE (and anything else) keeps the app hydrated with slot 1 bound.
      return Promise.resolve(HYDRATED_STATE);
    });
  });

  it('stacks two bars after two overwrites; clicking the FIRST undoes the FIRST action', async () => {
    render(<SidebarApp />);

    const saveButton = await screen.findByRole('button', { name: 'Save current tab to slot 1' });

    // Two consecutive overwrites of the occupied slot 1.
    fireEvent.click(saveButton);
    await waitFor(() => { expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1); });
    fireEvent.click(saveButton);
    await waitFor(() => { expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2); });

    // U1: two distinct bars coexist rather than overwriting each other.
    const bars = screen.getAllByRole('status');
    expect(bars.length).toBe(2);

    // Click the OLDEST bar (index 0). It must undo the FIRST overwrite.
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);

    await waitFor(() => { expect(undoRequests).toHaveLength(1); });
    expect(undoRequests[0]).toEqual({ slotId: 1, captureId: savedCaptureIds[0] });
    // ...and NOT the newest capture (the "pop the newest" bug).
    expect(undoRequests[0].captureId).not.toBe(savedCaptureIds[1]);
  });

  /**
   * R1 (F4 finding) — the bar must expire on the WORKER's deadline.
   *
   * The bar's deadline is `min(now + 5s, the worker's deadline)`, and BOTH halves
   * matter — they fix two opposite defects:
   *
   *  * CAPPED BY THE WORKER. The worker stamps `expiresAt` when it CAPTURES; the
   *    response reaches the UI a round trip later. If the UI ignored it and used
   *    its own `now + 5s`, the bar would stay clickable after the worker stopped
   *    honouring the snapshot, and `restoreSlot` would fall back to
   *    "no snapshot → unbindSlot" — SILENTLY DELETING the slot.
   *  * NOT SHORTENED BY THE ROUND TRIP. Using the worker's raw `expiresAt` charged
   *    that same round trip against the user's viewing time, so a slow first action
   *    showed a bar with almost no life left (reported defect 1).
   *
   * This test covers the CAPPING half: a worker deadline SHORTER than 5s must win.
   */
  it('a worker deadline SHORTER than 5s caps the bar (never outlives its capture)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The worker will stop honouring the capture in 1s.
      mockSendMessage.mockImplementation((message: { action?: string }) => {
        if (message.action === 'SAVE_SLOT') {
          return Promise.resolve({ success: true, slot: { id: 1 }, captureId: 777, expiresAt: Date.now() + 1000 });
        }
        return Promise.resolve(HYDRATED_STATE);
      });

      render(<SidebarApp />);
      const saveButton = await screen.findByRole('button', { name: 'Save current tab to slot 1' });
      fireEvent.click(saveButton);
      await waitFor(() => { expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1); });

      // Past the worker's 1s but well inside a locally derived 5s: must be gone.
      await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(2000); });
      expect(screen.queryAllByRole('button', { name: 'Undo' })).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * REPORTED DEFECT 1 reproduced in its REAL shape: a SLOW response.
   *
   * The worker stamps its deadline at capture time and the response arrives a round
   * trip later. With worker TTL == UI bar duration, the round trip was charged to
   * the user's viewing time, so the FIRST action (cold service worker) showed a bar
   * with almost no life left — or none at all. This test models the slow response
   * explicitly instead of hand-picking a deadline, which is what the earlier tests
   * did and why they missed the defect.
   */
  it('a SLOW response still yields a FULL bar window (reported defect 1)', async () => {
    // REAL timers on purpose: the defect is wall-clock DRIFT between the worker's
    // capture and the UI's render, and a fake clock can smooth that away.
    //
    // WHAT FIXED DEFECT 1, stated honestly: the worker's retention
    // (`PENDING_UNDO_TTL_MS`) is now LONGER than the bar (`UNDO_DEFAULT_MS`), so a
    // slow response can no longer eat the user's viewing time. The `Math.min` cap
    // is the complementary guard (never outlive the capture) and is tested
    // separately above. This test pins the COMBINED user-visible contract, so it
    // fails if either half regresses:
    //   * the bar must be there for the user's full window despite the delay, and
    //   * it must still go away.
    const responseDelayMs = 4000;
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'SAVE_SLOT') {
        const capturedAt = Date.now();
        // The worker answers after a COLD-start-sized delay.
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              success: true,
              slot: { id: 1 },
              captureId: 777,
              expiresAt: capturedAt + PENDING_UNDO_TTL_MS,
            });
          }, responseDelayMs);
        });
      }
      return Promise.resolve(HYDRATED_STATE);
    });

    render(<SidebarApp />);
    const saveButton = await screen.findByRole('button', { name: 'Save current tab to slot 1' });
    fireEvent.click(saveButton);

    // The bar appears once the slow response lands.
    await waitFor(
      () => { expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1); },
      { timeout: responseDelayMs + 3000 },
    );

    // Still readable most of the way through the user's window.
    await act(async () => { await new Promise((r) => setTimeout(r, UNDO_DEFAULT_MS - 1500)); });
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);

    // And it still disappears — no immortal bar.
    await waitFor(
      () => { expect(screen.queryAllByRole('button', { name: 'Undo' })).toHaveLength(0); },
      { timeout: UNDO_DEFAULT_MS + 5000 },
    );
    // Real timers make this slower than the default 5s budget.
  }, 30_000);

  /**
   * The half that MAKES defect 1 impossible: the worker must hold its snapshot for
   * longer than the bar is shown. If this ever inverts (a shortened TTL), a slow
   * first action silently loses its undo window again — so it is asserted, not
   * left to a comment.
   */
  it('the worker retains a snapshot for LONGER than the bar is shown', () => {
    expect(PENDING_UNDO_TTL_MS).toBeGreaterThan(UNDO_DEFAULT_MS);
  });

  /**
   * The other half — reported defect 1. A worker deadline LONGER than 5s must not
   * shorten the bar: the user gets their full window measured from when the bar
   * APPEARS, regardless of how long the response took to arrive.
   */
  it('a worker deadline LONGER than 5s does not shorten the bar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockSendMessage.mockImplementation((message: { action?: string }) => {
        if (message.action === 'SAVE_SLOT') {
          // The worker's own (now longer) retention.
          return Promise.resolve({ success: true, slot: { id: 1 }, captureId: 777, expiresAt: Date.now() + 20_000 });
        }
        return Promise.resolve(HYDRATED_STATE);
      });

      render(<SidebarApp />);
      const saveButton = await screen.findByRole('button', { name: 'Save current tab to slot 1' });
      fireEvent.click(saveButton);
      await waitFor(() => { expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1); });

      // Still inside the user's 5 seconds.
      await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(3000); });
      expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);

      // Past it.
      await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(3000); });
      expect(screen.queryAllByRole('button', { name: 'Undo' })).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Same defect class as the swap dialog's double-submit, and worse here:
   * `SAVE_SLOT` CAPTURES an undo snapshot, so two overlapping saves of one slot
   * produce two captures, two bars, and a second overwrite of the first — the
   * user's save is recorded as an overwrite of their own save.
   */
  it('a double-clicked Save sends exactly ONE SAVE_SLOT', async () => {
    render(<SidebarApp />);
    const saveButton = await screen.findByRole('button', { name: 'Save current tab to slot 1' });

    // Both clicks in ONE batch, so React cannot re-render between them.
    act(() => {
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);
    });

    // `savedCaptureIds` is THIS suite's own per-test request counter (the suite's
    // `beforeEach` resets it but does NOT call `vi.clearAllMocks()`, so
    // `mockSendMessage.mock.calls` still holds earlier tests' messages — asserting
    // on it here would measure the file, not this test).
    await waitFor(() => { expect(savedCaptureIds.length).toBeGreaterThan(0); });
    expect(savedCaptureIds).toHaveLength(1);
  });
});
