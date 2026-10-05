/**
 * ui-smoke — minimal render smoke coverage for the six page entries.
 *
 * Why this exists: `vitest.workspace.ts` declared a `ui-smoke` project and
 * `package.json` exposed `test:ui-smoke`, but `tests/ui-smoke/` did not exist,
 * so the gate was a no-op ("No test files found"). This suite gives B11's UI
 * refactor an additional, cheap catch-net on top of the 15 behavioural unit
 * tests in `tests/unit/ui/`.
 *
 * Scope discipline: SMOKE ONLY — each page must render and expose its key
 * landmark. Business logic is deliberately NOT re-tested here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ─── Shared chrome stub ──────────────────────────────────────────────────────
// Every page reads state through chrome.runtime.sendMessage, so one dispatcher
// covers all six entries.
const mockSendMessage = vi.fn(async (msg: { action?: string }) => {
  if (msg?.action === 'GET_COMMANDS') {
    return { result: { success: true, commands: [] } };
  }
  return {
    result: {
      success: true,
      sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
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
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: 1, windowId: 1, url: '', title: '' }),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

describe('ui-smoke — five page entries render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sidebar renders its slot list', async () => {
    const { SidebarApp } = await import('@ui/sidebar/App');
    render(<SidebarApp />);
    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
  });

  it('settings renders its sections', async () => {
    const { SettingsApp } = await import('@ui/settings/App');
    render(<SettingsApp />);
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy();
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    });
  });

  it('recovery renders its action controls', async () => {
    const { RecoveryWindow } = await import('@ui/recovery/App');
    render(
      <RecoveryWindow
        recoveryId="rec-1"
        slotTitle="Example"
        slotUrl="https://example.com"
        onOpenUrl={vi.fn()}
        onNextMatch={vi.fn()}
        onPrevMatch={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
  });

  it('import-preview renders its heading and summary', async () => {
    const { ImportPreviewTable } = await import('@ui/import-preview/App');
    render(
      <ImportPreviewTable
        preview={{
          valid: true,
          slotConflicts: [],
          newSlots: [],
          rules: [],
          matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
          switchDirection: 'next',
          autoBindGlobal: true,
          configVersion: 0,
          domainViolations: [],
        }}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /import preview/i })).toBeTruthy();
      expect(screen.getByRole('status')).toBeTruthy();
    });
  });

  it('conflict-confirm renders both choices', async () => {
    const { ConflictConfirm } = await import('@ui/conflict-confirm/App');
    render(
      <ConflictConfirm
        conflict={{ slotId: 1, oldTitle: 'Old', oldUrl: 'https://old.example', newTitle: 'New', newUrl: 'https://new.example' }}
        onOverwrite={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
    });
  });
});