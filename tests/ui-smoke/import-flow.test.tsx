/**
 * T18 — the rebuilt import section: dimension modes + diff + a constant,
 * quantized confirmation dialog.
 *
 * Structure/copy assertions only (jsdom). The points that must hold:
 *  - a dimension the package carried shows a group + a mode selector;
 *  - a dimension the package did NOT carry shows "not included" and NO selector
 *    (A2 — a selector there would be a lie);
 *  - Apply ALWAYS opens the confirmation dialog, even with zero deletions (D7);
 *  - "Export backup" is a SIBLING of the confirm action — clicking it must NOT
 *    proceed (A9: making backup an implicit prerequisite would re-create the
 *    forced-backup defect);
 *  - the file string READ AT INSPECT is the one APPLY sends, with configVersion
 *    (D12: no re-read, no fingerprint).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import type { ImportInspection } from '@shared/types';

const FILE_TEXT = '{"schemaVersion":1,"scope":{"rules":true}}';

const INSPECTION: ImportInspection = {
  diff: {
    records: [
      { kind: 'slot', id: 1, label: 'Slot 1', status: 'deleted', fields: [] },
      { kind: 'slot', id: 2, label: 'Slot 2', status: 'deleted', fields: [] },
      { kind: 'rule', id: 'r1', label: 'a.example', status: 'deleted', fields: [] },
      { kind: 'rule', id: 'r2', label: 'b.example', status: 'deleted', fields: [] },
      { kind: 'rule', id: 'r3', label: 'c.example', status: 'deleted', fields: [] },
    ],
    dimensions: { slots: true, rules: true, settings: false, shortcuts: false },
  },
  dimensions: { slots: true, rules: true, settings: false, shortcuts: false },
  tolerant: [],
  domainViolations: [],
  overlaps: [],
  configVersion: 5,
};

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

/** `Blob.text()` may be absent in older jsdom; provide a deterministic file. */
function makeFile(text: string): File {
  const file = new File([text], 'package.json', { type: 'application/json' });
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  }
  return file;
}

/**
 * Install the dispatcher BEFORE rendering: `loadState` runs on mount, and a
 * `sendRaw` that resolves to `undefined` would throw on `.configVersion` and
 * drop the whole section into its error state.
 */
function installMock(overrides?: Partial<ImportInspection>) {
  mockSendMessage.mockImplementation((msg: { action?: string }) => {
    if (msg.action === 'IMPORT_INSPECT') {
      return Promise.resolve({ result: { success: true, inspection: { ...INSPECTION, ...overrides } } });
    }
    if (msg.action === 'IMPORT_APPLY') {
      return Promise.resolve({ result: { success: true, configVersion: 6 } });
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

async function openImportSection(overrides?: Partial<ImportInspection>) {
  installMock(overrides);
  const { SettingsApp } = await import('@ui/settings/App');
  render(<SettingsApp />);
  const nav = await screen.findByRole('button', { name: 'Import / Export' });
  fireEvent.click(nav);
  await screen.findByRole('heading', { name: /import/i });
}

async function selectFile() {
  const input = screen.getByTestId('import-file-input');
  fireEvent.change(input, { target: { files: [makeFile(FILE_TEXT)] } });
  await screen.findByTestId('import-diff');
}

describe('T18 — import section: dimension modes, diff, quantized confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a mode selector per carried dimension, and Apply opens the quantized confirm', async () => {
    await openImportSection();
    await selectFile();

    // Carried dimensions expose a group + mode selector.
    expect(screen.getByTestId('import-dim-rules')).toBeTruthy();
    expect(screen.getByTestId('import-mode-rules')).toBeTruthy();

    fireEvent.change(screen.getByTestId('import-mode-rules'), { target: { value: 'overwrite' } });

    fireEvent.click(screen.getByTestId('import-apply'));

    const dialog = await screen.findByRole('dialog');
    const text = dialog.textContent;
    expect(text).toMatch(/delete 2 slots and 3 rules/i);
    expect(text).toMatch(/cannot be undone/i);

    mockSendMessage.mockClear();
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm import/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'IMPORT_APPLY' }),
      );
    });
    const applyCall = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'IMPORT_APPLY',
    );
    expect(applyCall).toBeDefined();
    const applyMessage = applyCall?.[0] as
      | { payload: { file: string; intent: { dimensionModes: { rules: string } } }; configVersion?: number }
      | undefined;
    expect(applyMessage?.payload.file).toBe(FILE_TEXT); // the SAME string read at INSPECT (D12)
    expect(applyMessage?.payload.intent.dimensionModes.rules).toBe('overwrite');
    expect(applyMessage?.configVersion).toBe(5); // from INSPECT (F4)
  });

  it('Export backup does NOT proceed — it is a sibling of the confirm action (A9)', async () => {
    await openImportSection();
    await selectFile();

    fireEvent.click(screen.getByTestId('import-apply'));
    const dialog = await screen.findByRole('dialog');

    mockSendMessage.mockClear();
    fireEvent.click(within(dialog).getByRole('button', { name: /export backup/i }));

    // Still open, and nothing applied.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      mockSendMessage.mock.calls.some((c) => (c[0] as { action?: string }).action === 'IMPORT_APPLY'),
    ).toBe(false);

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /confirm import/i }));
    await waitFor(() => {
      expect(
        mockSendMessage.mock.calls.some((c) => (c[0] as { action?: string }).action === 'IMPORT_APPLY'),
      ).toBe(true);
    });
  });

  it('a dimension the package did NOT carry has no selector (A2)', async () => {
    await openImportSection({
      diff: {
        records: INSPECTION.diff.records,
        dimensions: { slots: true, rules: false, settings: false, shortcuts: false },
      },
      dimensions: { slots: true, rules: false, settings: false, shortcuts: false },
    });
    await selectFile();

    expect(screen.getByTestId('import-absent-rules')).toBeTruthy();
    expect(screen.queryByTestId('import-mode-rules')).toBeNull();
  });

  it('the confirm dialog appears even with ZERO deletions (D7 — constant)', async () => {
    await openImportSection({
      diff: {
        records: [{ kind: 'rule', id: 'r1', label: 'a.example', status: 'added', fields: [] }],
        dimensions: { slots: false, rules: true, settings: false, shortcuts: false },
      },
      dimensions: { slots: false, rules: true, settings: false, shortcuts: false },
    });
    await selectFile();

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('import-apply'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});