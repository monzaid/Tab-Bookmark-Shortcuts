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
import { DEFAULT_MATCH_SETTINGS, defaultImportIntent } from '@shared/types';
import type { ImportIntent } from '@shared/types';
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
  // A recipe icon so the icon facet genuinely CHANGES vs slot 2's (icon-less)
  // target: that makes the arrow branch render a real value, so the
  // "no raw signature in the DOM" assertion cannot pass vacuously.
  marker: { icon: { kind: 'recipe', bgColor: '#123456', text: 'FS', textColor: '#abcdef' } },
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

/** Build an inspection from the REAL diff, never by hand. */
function makeInspection(
  pkg: ExportPackage,
  current: SyncState,
  version = 5,
  intent?: ImportIntent,
): ImportInspection {
  const diff = computeDiff(pkg, current, intent);
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
/**
 * Toggled by a test to model the current-state read failing AFTER the app has
 * mounted (mount itself must succeed, or the whole settings app is an error).
 */
let failStateRead = false;

/**
 * The text the file input yields. Defaults to the shared package; a case that
 * injects an inspection built from a DIFFERENT package must set this too, or the
 * UI's own recompute (from the file) and the injected inspection would disagree —
 * in production both derive from the same file text.
 */
let fileText = FILE_TEXT;

function installMock(inspection: ImportInspection = DEFAULT_INSPECTION, current: SyncState = CURRENT) {
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
    if (msg.action === 'GET_STATE' && failStateRead) {
      return Promise.reject(new Error('state unavailable'));
    }
    return Promise.resolve({
      result: {
        success: true,
        sync: { ...current },
        local: {
          bindings: [], cycleCursors: [], lastSuccessSlotId: null,
          recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [],
        },
      },
    });
  });
}

/**
 * `current` is the machine state GET_STATE reports, and `pkgText` is the file the
 * input yields. In production the inspection is computed from the SAME file and
 * the SAME live state (its computation does not depend on the intent; its result
 * is under the default intent). So a case that diffs a different basis or package
 * must pass them here too — otherwise the UI's own recompute and the injected
 * inspection would disagree (and that mismatch would mask a real divergence).
 */
async function openImportSection(
  inspection: ImportInspection = DEFAULT_INSPECTION,
  current: SyncState = CURRENT,
  pkgText: string = FILE_TEXT,
) {
  // G1: the inputs must describe ONE situation. Coverage is deliberately narrow:
  // this asserts `pkgText` ↔ `inspection` agree on `dimensions` (which does not
  // depend on the intent — it is derived from which dimensions the package
  // carries). It does NOT assert that `current` shares the same basis, so do not
  // read this as "all three are tied". It still catches the common mistake: a
  // file that does not match the injected inspection.
  expect(computeDiff(JSON.parse(pkgText) as ExportPackage, current).dimensions).toEqual(
    inspection.dimensions,
  );
  fileText = pkgText;
  installMock(inspection, current);
  const { SettingsApp } = await import('@ui/settings/App');
  render(<SettingsApp />);
  const nav = await screen.findByRole('button', { name: 'Import / Export' });
  fireEvent.click(nav);
  await screen.findByRole('heading', { name: /import/i });
}

async function selectFile() {
  const input = screen.getByTestId('import-file-input');
  fireEvent.change(input, { target: { files: [makeFile(fileText)] } });
  await screen.findByTestId('import-diff');
}

/**
 * Open the constant confirm dialog (Apply always opens it — D7). Choosing a file
 * also fetches the current state, so Apply stays disabled until that settles;
 * wait for it rather than assuming the inspect round-trip alone was enough.
 */
async function openConfirmDialog(): Promise<HTMLElement> {
  const apply = screen.getByTestId('import-apply');
  await waitFor(() => { expect(apply).not.toBeDisabled(); });
  fireEvent.click(apply);
  return screen.findByRole('dialog');
}

describe('T18 — import section: dimension modes, diff, quantized confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failStateRead = false;
  });

  it('shows a mode selector per carried dimension, and Apply opens the quantized confirm', async () => {
    await openImportSection();
    await selectFile();

    // Carried dimensions expose a group + mode selector.
    expect(screen.getByTestId('import-dim-rules')).toBeTruthy();
    expect(screen.getByTestId('import-mode-rules')).toBeTruthy();

    fireEvent.change(screen.getByTestId('import-mode-rules'), { target: { value: 'overwrite' } });

    const dialog = await openConfirmDialog();
    // D7: the quantity is the product of the intent the user holds. The DEFAULT
    // now accepts every applicable record, so the file-missing set (slots 1 & 3,
    // rules r1..r3) is exactly what the dialog counts.
    const text = dialog.textContent;
    expect(text).toMatch(/delete 2 slots and 3 rules/i);
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

    // The default already deletes the file-missing set (slots 1 & 3, rules r1..r3).
    let dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete 2 slots and 3 rules/i);
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    // Switching to OVERWRITE cannot delete more than "every file-missing record",
    // so the count is UNCHANGED — the mode is not an additive axis once every row
    // is already accepted. This is what stops a mode switch from silently
    // widening the blast radius.
    fireEvent.change(screen.getByTestId('import-mode-slots'), { target: { value: 'overwrite' } });
    dialog = await openConfirmDialog();
    const text = dialog.textContent;
    expect(text).toMatch(/delete 2 slots and 3 rules/i);
    expect(text).toMatch(/cannot be undone/i);
    expect(text).not.toMatch(/no records/i);
  });

  it('D7: a per-record "take" override deletes under incremental and is counted', async () => {
    await openImportSection();
    await selectFile();

    // Slot 1 is file-missing and accepted BY DEFAULT (mode stays incremental) —
    // "incremental ≠ delete nothing" is expressed by the per-record override.
    expect(screen.getByTestId('import-mode-slots')).toHaveValue('incremental');
    const keepS1 = screen.getByRole('checkbox', { name: 'Take S1' });
    expect(keepS1).toBeChecked();
    fireEvent.click(keepS1); // decline it ⇒ keep the target's own slot

    const dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete 1 slots and 3 rules/i);
  });

  it('keeps the checkbox, the status badge and the delete count in lockstep (one source)', async () => {
    // The checkbox is a VIEW of the live row status, not a second boolean. This
    // walks EVERY record row and asserts checked ⟺ status !== 'kept', so a
    // regression that reintroduced an independent flag would drift and red here.
    await openImportSection();
    await selectFile();

    const rows = Array.from(
      screen.getByTestId('import-diff').querySelectorAll('ul.tbs-settings__import-records > li'),
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const status = row.querySelector('.tbs-status-badge__label')?.textContent ?? '';
      expect(box.checked, `${status} row`).toBe(status !== 'kept');
    }
  });

  it('a declined file-missing row stays declined when the mode switches to overwrite (one source)', async () => {
    // The trap this guards: `take` is not "no override", and a mode switch must
    // NOT silently re-state a decision the user already made. The default
    // accepts the file-missing rows; declining S1 writes an explicit `keep`
    // override that OUTLIVES the mode change. The box is a view of the status,
    // so the two cannot disagree — and the mode cannot undo the user's choice.
    await openImportSection();
    await selectFile();

    const keepS1 = screen.getByRole('checkbox', { name: 'Take S1' });
    expect(keepS1).toBeChecked(); // default: accept every applicable row
    fireEvent.click(keepS1);
    expect(screen.getByRole('checkbox', { name: 'Take S1' })).not.toBeChecked();

    fireEvent.change(screen.getByTestId('import-mode-slots'), { target: { value: 'overwrite' } });
    expect(screen.getByRole('checkbox', { name: 'Take S1' })).not.toBeChecked();

    const dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete 1 slots and 3 rules/i);
  });

  it('a BOTH-SIDES row is reachable both ways: uncheck ⇒ kept, check ⇒ replaced (not a delete)', async () => {
    // The core of the new control: on a both-sides row BOTH directions change
    // something. Slot 2 differs (file title "FILE-S2" vs target "S2"), so it is
    // `replaced` by default; unchecking keeps the target, and checking restores
    // the take. A both-sides row is NOT a deletion in either direction.
    await openImportSection();
    await selectFile();

    // Climb from the CONTROL to its own row. Reading the whole `ul` would be
    // vacuous: slot 1 / slot 3 are `kept` by default, so `/kept/` would pass
    // whether or not S2's toggle worked at all.
    const row2 = () => {
      const box = screen.getByTestId('import-record-slot-2');
      const li = box.closest('li');
      if (li === null) throw new Error('slot 2 checkbox has no row');
      return li.textContent;
    };

    const s2 = screen.getByRole('checkbox', { name: 'Take S2' });
    expect(s2).toBeChecked(); // default: take the file ⇒ replaced
    // BEFORE: replaced — so the AFTER state proves the click changed something.
    expect(row2()).toMatch(/replaced/);

    // Uncheck ⇒ keep ⇒ this row is retained.
    fireEvent.click(s2);
    expect(screen.getByRole('checkbox', { name: 'Take S2' })).not.toBeChecked();
    expect(row2()).toMatch(/kept/);
    expect(row2()).not.toMatch(/replaced/); // and not both words at once

    // Re-check ⇒ replaced again.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Take S2' }));
    expect(screen.getByRole('checkbox', { name: 'Take S2' })).toBeChecked();
    expect(row2()).toMatch(/replaced/);

    // Neither direction is a DELETION: the count is the file-missing set alone
    // (slots 1 & 3, rules r1..r3) in BOTH states, so accepting or declining the
    // both-sides row 2 never adds to it.
    let dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete 2 slots and 3 rules/i);
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Take S2' })); // decline
    dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete 2 slots and 3 rules/i);
  });

  it('a file-only row is accepted and cannot be declined (added is always applied)', async () => {
    // `added` cannot honour `keep`: the package's own records are always applied,
    // so the control is checked and DISABLED rather than a dead toggle.
    await openImportSection();
    await selectFile();

    // r4 has no title, so its accessible name is the match URL (as the Keep/Take
    // buttons always were); query by the row's own testid to stay unambiguous.
    const added = screen.getByTestId('import-record-rule-r4');
    expect(added).toBeChecked();
    expect(added).toBeDisabled();
  });

  it('T20a: a record row expands to field-level lines, decoded not raw (A12/D9)', async () => {
    await openImportSection();
    await selectFile();

    // Slot 2 is "both sides, replaced": title differs, icon unchanged — real
    // `fields` produced by `computeDiff`, not hand-written.
    const fieldsBox = screen.getByTestId('import-fields-slot-2');
    expect(fieldsBox.textContent).toMatch(/Fields/i);

    const titleLine = screen.getByTestId('import-field-slot-2-title');
    expect(titleLine.textContent).toMatch(/Title: S2 → FILE-S2/);

    const iconLine = screen.getByTestId('import-field-slot-2-icon');
    // The icon genuinely changed (recipe added) ⇒ the arrow branch renders a
    // REAL value, so the anti-leak assertion below is not vacuous.
    expect(iconLine.textContent).toMatch(/Icon: None → Recipe icon/i);

    // D9: no raw diff signature may reach the DOM.
    expect(fieldsBox.textContent).not.toMatch(/recipe:|local-ref:|url:/);
    expect(fieldsBox.textContent).not.toMatch(/\|/);
  });

  it('T20a: added rows carry the value and never say "unchanged" (A12/D9)', async () => {
    // Rule r4 is file-only ⇒ `added` in the real (default-intent) diff.
    await openImportSection();
    await selectFile();

    const addedTitle = screen.getByTestId('import-field-rule-r4-title').textContent;
    expect(addedTitle).toMatch(/Title: added/i);
    expect(addedTitle).not.toMatch(/unchanged/i);

    const addedIcon = screen.getByTestId('import-field-rule-r4-icon').textContent;
    expect(addedIcon).toBe('Icon: added'); // no value ⇒ bare form
  });

  it('T20a: deleted rows report "removed" with the last value, never "→ None" (A12/D9)', async () => {
    // A real diff computed under slots:overwrite — the same call the service
    // makes — so slots 1 & 3 are genuinely `deleted`.
    const base = defaultImportIntent();
    const overwriteSlots = {
      ...base,
      dimensionModes: { ...base.dimensionModes, slots: 'overwrite' as const },
    };
    await openImportSection(makeInspection(PKG, CURRENT, 5, overwriteSlots), CURRENT);
    await selectFile();
    // The UI recomputes the diff under its OWN intent, so set the mode to
    // overwrite too — otherwise the live view (incremental ⇒ kept) would differ
    // from the injected inspection. In production both come from the user's mode.
    fireEvent.change(screen.getByTestId('import-mode-slots'), { target: { value: 'overwrite' } });

    const title = screen.getByTestId('import-field-slot-1-title').textContent;
    expect(title).toBe('Title: removed (S1)');

    const icon = screen.getByTestId('import-field-slot-1-icon').textContent;
    expect(icon).toBe('Icon: removed'); // no value ⇒ bare form
    expect(icon).not.toMatch(/unchanged|None/);
  });

  it('shows the Settings VALUES — three strategy states, all distinguishable', async () => {
    // The settings dimension carried values all along; this surfaces them. The
    // per-slot strategy has THREE states that must not collapse into one another:
    //   absent (the file carries nothing for the slot) ⇒ `inherit (by default)`
    //   explicit 'inherit'                            ⇒ `inherit`
    //   an explicit MatchRuleSettings object          ⇒ a summary
    // Absent is NOT explicit inherit (that resets the target); an object must not
    // degrade to `inherit`.
    const withSettings: ExportPackage = {
      ...PKG,
      scope: { slots: true, rules: true, settings: true },
      settings: {
        matchSettings: { tabIdMode: 'no-exists', ruleCheckMode: 'no-match', priority: 'none' },
        switchDirection: 'previous',
        autoBindGlobal: false,
        // 1 = absent (target-only) · 2 = explicit 'inherit' · 3 = explicit object.
        slotStrategies: {
          2: 'inherit',
          3: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
        },
      },
    };
    const base = defaultImportIntent();
    const current: SyncState = {
      ...CURRENT,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
    };
    await openImportSection(
      makeInspection(withSettings, current, 5, base),
      current,
      JSON.stringify(withSettings),
    );
    await selectFile();

    const box = screen.getByTestId('import-settings-values');
    // Globals compare current → file.
    expect(box.textContent).toMatch(/Match settings: .*exists.*→.*no-exists/);
    expect(box.textContent).toMatch(/Switch direction: next → previous/);
    expect(box.textContent).toMatch(/Auto-bind: true → false/);

    // ABSENT (slot 1) vs EXPLICIT inherit (slot 2) vs OBJECT (slot 3) — all three
    // must be distinguishable.
    expect(screen.getByTestId('import-slot-strategy-1').textContent).toMatch(/inherit \(by default\)/);
    expect(screen.getByTestId('import-slot-strategy-2').textContent).toMatch(/inherit$/);
    expect(screen.getByTestId('import-slot-strategy-2').textContent).not.toMatch(/by default/);
    const slot3 = screen.getByTestId('import-slot-strategy-3').textContent;
    // slot 3's TARGET strategy really is `inherit` — the arrow's LEFT side may
    // say so. The right side carries the file's object and must NOT degrade to
    // `inherit`, so pin the direction: the concrete triple follows the arrow.
    // (The old `not.toMatch(/inherit/)` failed once the target side read its own
    // value honestly — it conflated "the file's value" with "anywhere in the line".)
    expect(slot3).toMatch(/inherit → Tab ID exists, Rule check match, Priority tabId/);
    expect(slot3).not.toMatch(/→ inherit/);
  });

  it('a dimension the package did NOT carry has no selector (A2)', async () => {
    await openImportSection(SLOTS_ONLY_INSPECTION, CURRENT, JSON.stringify(PKG_SLOTS_ONLY));
    await selectFile();

    expect(screen.getByTestId('import-absent-rules')).toBeTruthy();
    expect(screen.queryByTestId('import-mode-rules')).toBeNull();
  });

  it('the confirm dialog appears even with ZERO deletions (D7 — constant)', async () => {
    await openImportSection();
    await selectFile();

    expect(screen.queryByRole('dialog')).toBeNull();
    // Independent, named guard for BOTH halves of the D7 point: the dialog is
    // constant AND the count is an honest number under the default intent — not
    // merely "some dialog opened".
    const dialog = await openConfirmDialog();
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toMatch(/delete 2 slots and 3 rules/i);
  });

  it('D7: an unreadable current state says "unknown", never "no records"', async () => {
    await openImportSection();
    // The app has mounted; now the current-state read fails.
    failStateRead = true;
    await selectFile();

    // The count is uncomputable ⇒ the dialog must NOT assert an all-clear.
    const dialog = await openConfirmDialog();
    expect(dialog.textContent).not.toMatch(/no records/i);
    expect(dialog.textContent).toMatch(/unknown/i);
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

  it('expanding Fields lists Title / Icon / Match URL / Match Type with both sides', async () => {
    await openImportSection();
    await selectFile();

    const fields = screen.getByTestId('import-fields-slot-2');
    const text = fields.textContent;
    // All four facets of the record are shown, so "which part changed" is
    // answerable — the match definition used to be invisible.
    expect(text).toMatch(/Title:/);
    expect(text).toMatch(/Icon:/);
    expect(text).toMatch(/Match URL:/);
    expect(text).toMatch(/Match Type:/);
    // A changed facet carries BOTH concrete values; an unchanged one says so.
    expect(text).toMatch(/Title: S2 → FILE-S2/);
    expect(text).toMatch(/Match URL: unchanged/);
  });

  it('a changed MATCH is shown with both concrete values (not "unchanged")', async () => {
    // The file moves slot 7's match away from the target's: with four facets,
    // that change is now visible — before, every field read "unchanged" and the
    // row looked identical to a no-op.
    const target: SyncState = { ...CURRENT, slots: [curSlot(7, 'S7')] };
    const file: ExportPackage = {
      ...PKG,
      slots: [{ id: 7, urlMatch: exact('https://moved.example/'), titleSnapshot: 'S7', faviconSnapshot: '', marker: {} }],
    };
    await openImportSection(makeInspection(file, target), target, JSON.stringify(file));
    await selectFile();

    const text = screen.getByTestId('import-fields-slot-7').textContent;
    expect(text).toMatch(/Match URL: https:\/\/s7\.example\/ → https:\/\/moved\.example\//);
  });

  it('lists slots by slot NUMBER with the number in the label, whatever order the file used', async () => {
    // The file carries its slots in a NON-numeric order. A fixed 1–10 set shown
    // in file order is unscannable, and a bare title does not say which slot a
    // row is — so both the order and the identity must come from the number.
    const reversed: ExportPackage = {
      ...PKG,
      slots: [...(PKG.slots ?? [])].reverse(),
    };
    await openImportSection(makeInspection(reversed, CURRENT), CURRENT, JSON.stringify(reversed));
    await selectFile();

    const rows = screen.getByTestId('import-dim-slots')
      .querySelectorAll('ul.tbs-settings__import-records > li > span:first-child');
    const labels = Array.from(rows).map((el) => el.textContent);
    expect(labels).toEqual(['Slot 1 — S1', 'Slot 2 — S2', 'Slot 3 — S3']);
  });

  it('an untitled slot shows its number ONCE (the diff label already is "Slot N")', async () => {
    // The diff falls back to `Slot N` when a record has no title, so composing
    // "number + label" naively yields "Slot 5 — Slot 5". Slots with no title are
    // exactly the ones where the number carries the whole identity.
    const untitled: SyncState = {
      ...CURRENT,
      slots: [{ ...curSlot(1, '') }, { ...curSlot(2, '') }],
    };
    // The file side of slot 2 carries no title either, so the diff falls back to
    // its placeholder for BOTH sides of the row.
    const untitledPkg: ExportPackage = {
      ...PKG,
      slots: [{ ...FILE_SLOT_2, titleSnapshot: '' }],
    };
    await openImportSection(makeInspection(untitledPkg, untitled), untitled, JSON.stringify(untitledPkg));
    await selectFile();

    const slots = screen.getByTestId('import-dim-slots');
    expect(slots.textContent).not.toMatch(/Slot 1 — Slot 1/);
    const rows = slots.querySelectorAll('ul.tbs-settings__import-records > li > span:first-child');
    expect(Array.from(rows).map((el) => el.textContent)).toEqual(['Slot 1', 'Slot 2']);
  });

  it('an ADDED slot with no title shows its number once (the third fallback branch)', async () => {
    // "File-has, target-missing" is the third place the diff falls back to
    // `Slot N` (the file side has no title). The target has no slot 7 at all, so
    // the record is `added` and the row's identity comes entirely from the number.
    const target: SyncState = { ...CURRENT, slots: [] };
    const file: ExportPackage = {
      ...PKG,
      slots: [{ id: 7, urlMatch: exact('https://s7.example/'), titleSnapshot: '', faviconSnapshot: '', marker: {} }],
    };
    await openImportSection(makeInspection(file, target), target, JSON.stringify(file));
    await selectFile();

    const row = screen.getByTestId('import-dim-slots')
      .querySelector('ul.tbs-settings__import-records > li > span:first-child');
    expect(row?.textContent).toBe('Slot 7');
  });

  it('a version conflict re-checks the file instead of dead-ending on a bare server string (F4)', async () => {
    await openImportSection();
    await selectFile();

    // The state moved between INSPECT and APPLY, so the write is refused.
    const base = mockSendMessage.getMockImplementation();
    mockSendMessage.mockImplementation((msg: { action?: string }) => {
      if (msg.action === 'IMPORT_APPLY') {
        return Promise.resolve({
          result: {
            success: false,
            errorCode: 'CONFIG_CONFLICT',
            message: 'Version conflict: expected 141, current is 142',
          },
        });
      }
      return base
        ? (base(msg) as Promise<unknown>)
        : Promise.resolve({ result: { success: true } });
    });

    mockSendMessage.mockClear();
    const dialog = await openConfirmDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm import/i }));

    // The draft is rebuilt against the NEW state — the user gets a way forward
    // without having to reselect the file themselves.
    await waitFor(() => {
      const reChecks = mockSendMessage.mock.calls.filter(
        (c) => (c[0] as { action?: string }).action === 'IMPORT_INSPECT',
      );
      expect(reChecks.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByTestId('import-diff')).toBeTruthy();
    expect(screen.getByText(/re-checked/i)).toBeTruthy();
    // The raw backend string must NOT be what the user reads.
    expect(screen.queryByText(/Version conflict: expected/i)).toBeNull();
  });

  // ─── Default = accept every record (user ruling: "default all selected") ────

  it('default all-take: every applicable row is checked, and the file-missing set is counted', async () => {
    await openImportSection();
    await selectFile();

    // Accept-everything default: nothing the package can apply is left unchecked.
    for (const name of ['Take S1', 'Take S2', 'Take S3']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked();
    }
    const dialog = await openConfirmDialog();
    // file-missing = slots 1 & 3, rules r1..r3 (both-sides/added are never deletes).
    expect(dialog.textContent).toMatch(/delete 2 slots and 3 rules/i);
  });

  it('default all-take: a both-sides row is accepted (replaced) and is not a deletion', async () => {
    await openImportSection();
    await selectFile();

    const s2 = screen.getByRole('checkbox', { name: 'Take S2' });
    expect(s2).toBeChecked();
    const li = screen.getByTestId('import-record-slot-2').closest('li');
    expect(li?.textContent).toMatch(/replaced/);
    expect(li?.textContent).not.toMatch(/deleted/);
  });

  it('declining a default-accepted row keeps it and lowers the deletion count', async () => {
    await openImportSection();
    await selectFile();

    const keepS1 = screen.getByRole('checkbox', { name: 'Take S1' });
    expect(keepS1).toBeChecked();
    fireEvent.click(keepS1);
    expect(screen.getByRole('checkbox', { name: 'Take S1' })).not.toBeChecked();

    const li = screen.getByTestId('import-record-slot-1').closest('li');
    expect(li?.textContent).toMatch(/kept/);

    const dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/delete 1 slots and 3 rules/i);
  });

  it('a declination survives the version-conflict re-check (resetIntent=false path)', async () => {
    // The user's choices must survive a re-inspect: only the state-derived
    // numbers change, not their decisions. This change must NOT touch that path.
    await openImportSection();
    await selectFile();

    const keepS1 = screen.getByRole('checkbox', { name: 'Take S1' });
    expect(keepS1).toBeChecked();
    fireEvent.click(keepS1);
    expect(screen.getByRole('checkbox', { name: 'Take S1' })).not.toBeChecked();

    // The state moved between INSPECT and APPLY ⇒ the write is refused and the
    // draft is re-checked WITHOUT resetting the intent.
    const base = mockSendMessage.getMockImplementation();
    mockSendMessage.mockImplementation((msg: { action?: string }) => {
      if (msg.action === 'IMPORT_APPLY') {
        return Promise.resolve({
          result: { success: false, errorCode: 'CONFIG_CONFLICT', message: 'Version conflict' },
        });
      }
      return base ? (base(msg) as Promise<unknown>) : Promise.resolve({ result: { success: true } });
    });

    const dialog = await openConfirmDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm import/i }));
    await waitFor(() => { expect(screen.getByText(/re-checked/i)).toBeTruthy(); });

    // The re-check must NOT silently re-select the declined row.
    expect(screen.getByRole('checkbox', { name: 'Take S1' })).not.toBeChecked();
  });

  it('an unreadable current state yields NO take overrides (nothing to build them from)', async () => {
    // The default all-take is DERIVED from a diff against the live state. Without
    // that state there is no diff to derive it from, so the intent stays the
    // plain default (no overrides) — rows keep their incremental status and the
    // dialog reports "unknown" rather than an assumed all-clear.
    await openImportSection();
    failStateRead = true; // the state read fails AFTER mount
    await selectFile();

    expect(screen.getByRole('checkbox', { name: 'Take S1' })).not.toBeChecked();
    const dialog = await openConfirmDialog();
    expect(dialog.textContent).toMatch(/unknown/i);
  });
});