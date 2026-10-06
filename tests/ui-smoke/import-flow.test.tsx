/**
 * T18 — the rebuilt import section: dimension modes + diff + a constant,
 * quantized confirmation dialog.
 *
 * Structure/copy assertions only (jsdom). The points that must hold:
 *  - a dimension the package carried shows a group + a mode selector;
 *  - a dimension the package did NOT carry shows "not included" and NO selector
 *    (A2 — a selector there would be a lie);
 *  - Apply ALWAYS opens the confirmation dialog, even with zero deletions (D7);
 *  - the QUANTITY in that dialog follows the intent the user actually chose
 *    (D7 — "quantify the FINAL selection"), not the fixed default intent that
 *    INSPECT computed with (§3.2: the mode governs only "file-missing");
 *  - "Export backup" is a SIBLING of the confirm action — clicking it must NOT
 *    proceed (A9: making backup an implicit prerequisite would re-create the
 *    forced-backup defect);
 *  - the file string READ AT INSPECT is the one APPLY sends, with configVersion
 *    (D12: no re-read, no fingerprint).
 *
 * The inspection fixture is NOT hand-written: it is produced by the REAL
 * `computeDiff(...)` under the default intent, so the "the UI reads a fixture"
 * false-green of T18-D7 cannot recur — a fixture whose `status:'deleted'` rows
 * no single intent would ever produce cannot be built here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import type {
  ImportInspection,
  SyncState,
  SlotDefinition,
  PageRule,
  UrlMatchDefinition,
} from '@shared/types';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';
import { computeDiff } from '@shared/import-diff';
import type { ExportPackage, PortableSlotDef, PortableRule } from '@shared/export-package';

// ─── Real fixtures (the same shapes the service diffs) ───────────────────────

const exact = (value: string): UrlMatchDefinition => ({ type: 'exact', value });

function curSlot(id: number, title: string): SlotDefinition {
  return {
    id,
    urlMatch: exact(`https://s${String(id)}.example/`),
    strategy: 'inherit',
    uiMarker: {},
    titleSnapshot: title,
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function curRule(id: string, value: string): PageRule {
  return {
    id,
    urlMatch: exact(value),
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * current: slots 1,2,3 / rules r1,r2,r3.
 * file:    slot 2 (changed title → "both sides", replaced) + rule r4 (new).
 * ⇒ file-missing (the ONLY rows a mode may delete): slots 1 & 3, rules r1..r3.
 */
const CURRENT: SyncState = {
  configVersion: 5,
  matchSettings: { ...DEFAULT_MATCH_SETTINGS },
  switchDirection: 'next',
  autoBindGlobal: false,
  slots: [curSlot(1, 'S1'), curSlot(2, 'S2'), curSlot(3, 'S3')],
  rules: [curRule('r1', 'https://a.example/'), curRule('r2', 'https://b.example/'), curRule('r3', 'https://c.example/')],
};

const FILE_SLOT_2: PortableSlotDef = {
  id: 2,
  urlMatch: exact('https://s2.example/'),
  marker: {},
  titleSnapshot: 'FILE-S2',
  faviconSnapshot: '',
};
const FILE_RULE_4: PortableRule = { id: 'r4', urlMatch: exact('https://d.example/'), priority: 0 };

const PKG: ExportPackage = {
  schemaVersion: 1,
  generator: { name: 'test', version: '1' },
  exportedAt: '2026-10-05T00:00:00.000Z',
  scope: { slots: true, rules: true },
  slots: [FILE_SLOT_2],
  rules: [FILE_RULE_4],
};

/** Slots-only package — used for the A2 "not carried" case. */
const PKG_SLOTS_ONLY: ExportPackage = {
  ...PKG,
  scope: { slots: true, rules: false },
  slots: [FILE_SLOT_2],
  rules: undefined,
};

const FILE_TEXT = JSON.stringify(PKG);

/** Build an inspection from the REAL diff (default intent), never by hand. */
function makeInspection(pkg: ExportPackage, current: SyncState, version = 5): ImportInspection {
  const diff = computeDiff(pkg, current);
  return {
    diff,
    dimensions: diff.dimensions,
    tolerant: [],
    domainViolations: [],
    overlaps: [],
    configVersion: version,
  };
}

const DEFAULT_INSPECTION = makeInspection(PKG, CURRENT);
const SLOTS_ONLY_INSPECTION = makeInspection(PKG_SLOTS_ONLY, CURRENT);

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
function installMock(inspection: ImportInspection = DEFAULT_INSPECTION) {
  mockSendMessage.mockImplementation((msg: { action?: string }) => {
    if (msg.action === 'IMPORT_INSPECT') {
      return Promise.resolve({ result: { success: true, inspection } });
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
        sync: { ...CURRENT },
        local: {
          bindings: [], cycleCursors: [], lastSuccessSlotId: null,
          recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [],
        },
      },
    });
  });
}

async function openImportSection(inspection: ImportInspection = DEFAULT_INSPECTION) {
  installMock(inspection);
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

/** Open the constant confirm dialog (Apply always opens it — D7). */
async function openConfirmDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId('import-apply'));
  const dialog = await screen.findByRole('dialog');
  return dialog;
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

    const dialog = await openConfirmDialog();
    // D7: the quantity must follow the mode the user CHOSE. Rules carry 3
    // file-missing records (r1..r3); slots stay incremental → 0.
    const text = dialog.textContent;
    expect(text).toMatch(/delete 3 rules/i);
    expect(text).toMatch(/cannot be undone/i);
    expect(text).not.toMatch(/no records/i);

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

  it('D7: the confirm quantity reflects the CURRENT intent — slots:overwrite warns about its deletes', async () => {
    await openImportSection();
    await selectFile();

    // Default (incremental) counts nothing irreversible.
    let dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete no records/i);
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    // Switch slots to overwrite: slots 1 & 3 are file-missing ⇒ really deleted.
    fireEvent.change(screen.getByTestId('import-mode-slots'), { target: { value: 'overwrite' } });
    dialog = await openConfirmDialog();
    const text = dialog.textContent;
    expect(text).toMatch(/delete 2 slots/i);
    expect(text).toMatch(/cannot be undone/i);
    expect(text).not.toMatch(/no records/i);
  });

  it('D7: a per-record "take" override deletes under incremental and is counted', async () => {
    await openImportSection();
    await selectFile();

    // Slot 1 is file-missing; incremental keeps it unless explicitly taken.
    expect((screen.getByTestId('import-mode-slots')).value).toBe('incremental');
    fireEvent.click(screen.getByRole('button', { name: 'Take S1' }));

    const dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete 1 slots/i);
  });

  it('a dimension the package did NOT carry has no selector (A2)', async () => {
    await openImportSection(SLOTS_ONLY_INSPECTION);
    await selectFile();

    expect(screen.getByTestId('import-absent-rules')).toBeTruthy();
    expect(screen.queryByTestId('import-mode-rules')).toBeNull();
  });

  it('the confirm dialog appears even with ZERO deletions (D7 — constant)', async () => {
    await openImportSection();
    await selectFile();

    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete no records/i);
  });

  it('Export backup does NOT proceed — it is a sibling of the confirm action (A9)', async () => {
    await openImportSection();
    await selectFile();

    const dialog = await openConfirmDialog();

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
});