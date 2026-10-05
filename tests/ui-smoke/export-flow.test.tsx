/**
 * T19 — the independent export section (Q2=B-2: a section INSIDE settings,
 * alongside the import one; no new HTML page, no new build entry).
 *
 * Structure/copy assertions only (jsdom). The points that must hold:
 *  - the four fixed dimensions are checkboxes (D5/D1);
 *  - an EMPTY selection is blocked with a visible reason (D1 derived: "export
 *    nothing" is not a legal export);
 *  - Export sends `EXPORT_PACKAGE` with the chosen scope;
 *  - the package summary is shown BEFORE the download (show-then-download).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const PACKAGE_JSON = JSON.stringify({
  schemaVersion: 1,
  scope: { rules: true },
  slots: [],
  rules: [{ id: 'r1' }, { id: 'r2' }],
});

const mockSendMessage = vi.fn();

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

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
});

function installMock() {
  mockSendMessage.mockImplementation((msg: { action?: string }) => {
    if (msg.action === 'EXPORT_PACKAGE') {
      return Promise.resolve({ result: { success: true, package: PACKAGE_JSON } });
    }
    if (msg.action === 'GET_COMMANDS') {
      return Promise.resolve({ result: { success: true, commands: [] } });
    }
    return Promise.resolve({
      result: {
        success: true,
        sync: {
          configVersion: 5,
          matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
          switchDirection: 'next',
          autoBindGlobal: true,
          slots: [],
          rules: [],
        },
        local: {
          bindings: [], cycleCursors: [], lastSuccessSlotId: null,
          recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [],
        },
      },
    });
  });
}

async function openExportSection() {
  installMock();
  const { SettingsApp } = await import('@ui/settings/App');
  render(<SettingsApp />);
  const nav = await screen.findByRole('button', { name: 'Import / Export' });
  fireEvent.click(nav);
  // Two headings match /export/i ("Import / Export" + "Export"), so wait on the
  // section's own control instead of an ambiguous role query.
  await screen.findByTestId('export-dim-slots');
}

describe('T19 — independent export section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the four dimension checkboxes and blocks an empty selection (D1)', async () => {
    await openExportSection();

    for (const dim of ['slots', 'rules', 'settings', 'shortcuts']) {
      expect(screen.getByTestId(`export-dim-${dim}`)).toBeTruthy();
    }

    // Nothing checked yet → Export is blocked with a visible reason.
    const submit = screen.getByTestId('export-submit');
    expect(submit).toBeDisabled();
    expect(screen.getByTestId('export-empty-reason')).toBeTruthy();
  });

  it('exports the chosen scope and shows the package summary before download', async () => {
    await openExportSection();

    fireEvent.click(screen.getByTestId('export-dim-rules'));
    expect(screen.getByTestId('export-submit')).not.toBeDisabled();

    mockSendMessage.mockClear();
    fireEvent.click(screen.getByTestId('export-submit'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT_PACKAGE' }),
      );
    });
    const call = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'EXPORT_PACKAGE',
    );
    expect((call?.[0] as { payload: { scope: { rules?: boolean } } }).payload.scope).toEqual(
      expect.objectContaining({ rules: true }),
    );

    // Summary shown first; the download is a separate, explicit step.
    const summary = await screen.findByTestId('export-summary');
    expect(summary.textContent).toMatch(/rules/i);
    expect(screen.getByTestId('export-download')).toBeTruthy();
  });
});