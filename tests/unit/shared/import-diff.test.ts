/**
 * T8 — import diff, intent application, match-overlap detection.
 *
 * Semantics locked by the design:
 *   - §3.2 mode table — the mode governs ONLY "file-missing, target-has";
 *     "both sides" is decided by the diff and behaves the SAME in both modes.
 *   - A4 — per-dimension mode is the default; a sparse per-record override wins.
 *   - A12 — record-level by default, field-level (title / icon) expandable.
 *   - D7 — quantify only the IRREVERSIBLE deletes (slots/rules), not replacements.
 *   - D10 — overlap = EXACT same Match URL + Match Type; semantic overlap
 *     (different strings, same matched URL) is deliberately NOT reported.
 *
 * All four functions are pure: no storage, no mutation of their inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDiff,
  applyIntent,
  findMatchOverlaps,
  quantifyDeletions,
} from '@shared/import-diff';
import { defaultImportIntent, DEFAULT_MATCH_SETTINGS } from '@shared/types';
import type {
  SyncState,
  SlotDefinition,
  PageRule,
  ImportIntent,
  ImportDiff,
  UrlMatchDefinition,
} from '@shared/types';
import type { ExportPackage, PortableSlotDef, PortableRule } from '@shared/export-package';

// ─── Builders ────────────────────────────────────────────────────────────────

const exact = (value: string): UrlMatchDefinition => ({ type: 'exact', value });

function slot(id: number, overrides: Partial<SlotDefinition> = {}): SlotDefinition {
  return {
    id,
    urlMatch: exact(`https://s${String(id)}.example/`),
    strategy: 'inherit',
    uiMarker: {},
    titleSnapshot: `S${String(id)}`,
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rule(id: string, value: string, overrides: Partial<PageRule> = {}): PageRule {
  return {
    id,
    urlMatch: exact(value),
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sync(slots: SlotDefinition[], rules: PageRule[]): SyncState {
  return {
    configVersion: 3,
    matchSettings: { ...DEFAULT_MATCH_SETTINGS },
    switchDirection: 'next',
    autoBindGlobal: false,
    slots,
    rules,
  };
}

function portableSlot(id: number): PortableSlotDef {
  return {
    id,
    urlMatch: exact(`https://s${String(id)}.example/`),
    marker: {},
    titleSnapshot: `S${String(id)}`,
    faviconSnapshot: '',
  };
}

function portableRule(id: string, value: string): PortableRule {
  return { id, urlMatch: exact(value), priority: 0 };
}

function pkg(parts: {
  slots?: PortableSlotDef[];
  rules?: PortableRule[];
  settings?: ExportPackage['settings'];
}): ExportPackage {
  return {
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-05T00:00:00.000Z',
    scope: { slots: parts.slots !== undefined, rules: parts.rules !== undefined },
    slots: parts.slots,
    rules: parts.rules,
    settings: parts.settings,
  };
}

const overwriteSlots = (): ImportIntent => {
  const base = defaultImportIntent();
  return { ...base, dimensionModes: { ...base.dimensionModes, slots: 'overwrite' } };
};

function statusOf(diff: ImportDiff, kind: 'slot' | 'rule', id: number | string): string | undefined {
  return diff.records.find((r) => r.kind === kind && r.id === id)?.status;
}

// ─── Shared fixture ──────────────────────────────────────────────────────────
// current: slots 1,2,3  |  file: slots 2 (changed), 4 (new)  → 1 & 3 are
// "file-missing, target-has" and are the ONLY rows the mode may flip.
const CURRENT = sync([slot(1), slot(2), slot(3)], [rule('rule-a', 'https://a.example/')]);
// Make slot 2 genuinely differ so "both sides" is observable.
const fileSlot2 = portableSlot(2);
fileSlot2.titleSnapshot = 'FILE-S2';
const FILE = pkg({ slots: [fileSlot2, portableSlot(4)] });

describe('T8: computeDiff — mode governs only "file-missing, target-has"', () => {
  it('incremental keeps file-missing target records (A1 default)', () => {
    const diff = computeDiff(FILE, CURRENT); // default intent = incremental
    expect(statusOf(diff, 'slot', 1)).toBe('kept');
    expect(statusOf(diff, 'slot', 3)).toBe('kept');
    expect(statusOf(diff, 'slot', 2)).toBe('replaced');
    expect(statusOf(diff, 'slot', 4)).toBe('added');
  });

  it('overwrite deletes file-missing target records', () => {
    const diff = computeDiff(FILE, CURRENT, overwriteSlots());
    expect(statusOf(diff, 'slot', 1)).toBe('deleted');
    expect(statusOf(diff, 'slot', 3)).toBe('deleted');
    // both-sides + file-only behave IDENTICALLY to incremental (§3.2)
    expect(statusOf(diff, 'slot', 2)).toBe('replaced');
    expect(statusOf(diff, 'slot', 4)).toBe('added');
  });

  it('reports which dimensions the package actually carried (A2/A3)', () => {
    const diff = computeDiff(FILE, CURRENT);
    expect(diff.dimensions).toEqual({ slots: true, rules: false, settings: false, shortcuts: false });
  });

  it('expands title / icon field-level changes (A12)', () => {
    const diff = computeDiff(FILE, CURRENT);
    const row = diff.records.find((r) => r.kind === 'slot' && r.id === 2);
    const title = row?.fields.find((f) => f.field === 'title');
    expect(title).toEqual({ field: 'title', before: 'S2', after: 'FILE-S2', changed: true });
    const icon = row?.fields.find((f) => f.field === 'icon');
    expect(icon?.changed).toBe(false); // neither side carries an icon
  });

  it('a dimension that was NOT carried contributes no rows', () => {
    const diff = computeDiff(FILE, CURRENT);
    expect(diff.records.some((r) => r.kind === 'rule')).toBe(false);
  });
});

describe('T8: applyIntent — produces the final state, both sides decided by diff', () => {
  it('incremental keeps 1 & 3, takes the file for 2, adds 4', () => {
    const final = applyIntent(FILE, CURRENT, defaultImportIntent());
    expect(final.slots.map((s) => s.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(final.slots.find((s) => s.id === 2)?.titleSnapshot).toBe('FILE-S2');
    // rules dimension not carried → untouched
    expect(final.rules).toEqual(CURRENT.rules);
  });

  it('overwrite leaves only the file-carried records (2 & 4)', () => {
    const final = applyIntent(FILE, CURRENT, overwriteSlots());
    expect(final.slots.map((s) => s.id).sort((a, b) => a - b)).toEqual([2, 4]);
  });

  it('a per-record "keep" override wins over the dimension mode (A4)', () => {
    const base = defaultImportIntent();
    const intent: ImportIntent = {
      ...base,
      dimensionModes: { ...base.dimensionModes, slots: 'overwrite' },
      recordOverrides: [{ kind: 'slot', id: 1, action: 'keep' }],
    };
    const final = applyIntent(FILE, CURRENT, intent);
    // slot 1 was "file-missing" → overwrite would delete it, but the override keeps it
    expect(final.slots.map((s) => s.id).sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });

  it('a per-record "keep" on a both-sides row preserves the TARGET record', () => {
    const base = defaultImportIntent();
    const intent: ImportIntent = {
      ...base,
      recordOverrides: [{ kind: 'slot', id: 2, action: 'keep' }],
    };
    const final = applyIntent(FILE, CURRENT, intent);
    expect(final.slots.find((s) => s.id === 2)?.titleSnapshot).toBe('S2'); // target's own
    const diff = computeDiff(FILE, CURRENT, intent);
    expect(statusOf(diff, 'slot', 2)).toBe('kept');
  });

  it('is pure — never mutates the package or the current state', () => {
    const currentBefore = JSON.stringify(CURRENT);
    const fileBefore = JSON.stringify(FILE);
    const a = applyIntent(FILE, CURRENT, defaultImportIntent());
    const b = applyIntent(FILE, CURRENT, defaultImportIntent());
    expect(JSON.stringify(CURRENT)).toBe(currentBefore);
    expect(JSON.stringify(FILE)).toBe(fileBefore);
    expect(a).toEqual(b);
    expect(a).not.toBe(CURRENT);
  });

  it('applies carried settings; leaves them alone when not carried', () => {
    const withSettings = pkg({
      slots: [],
      settings: {
        matchSettings: { tabIdMode: 'no-exists', ruleCheckMode: 'no-match', priority: 'none' },
        switchDirection: 'previous',
        autoBindGlobal: true,
        slotStrategies: {},
      },
    });
    const final = applyIntent(withSettings, CURRENT, defaultImportIntent());
    expect(final.switchDirection).toBe('previous');
    expect(final.autoBindGlobal).toBe(true);

    const untouched = applyIntent(FILE, CURRENT, defaultImportIntent());
    expect(untouched.matchSettings).toEqual(CURRENT.matchSettings);
    expect(untouched.switchDirection).toBe(CURRENT.switchDirection);
  });
});

describe('T8: quantifyDeletions — only irreversible deletes (D7)', () => {
  it('counts a per-record override deletion made under incremental', () => {
    const base = defaultImportIntent();
    const intent: ImportIntent = {
      ...base,
      recordOverrides: [{ kind: 'slot', id: 3, action: 'take' }],
    };
    const final = applyIntent(FILE, CURRENT, intent);
    expect(final.slots.some((s) => s.id === 3)).toBe(false);
    expect(quantifyDeletions(final, CURRENT).slots).toBe(1);
  });

  it('overwrite counts every file-missing record as a deletion', () => {
    const final = applyIntent(FILE, CURRENT, overwriteSlots());
    expect(quantifyDeletions(final, CURRENT)).toEqual({ slots: 2, rules: 0 });
  });

  it('does NOT count replacements as deletions (D7: replacements are redoable)', () => {
    const final = applyIntent(FILE, CURRENT, defaultImportIntent());
    expect(quantifyDeletions(final, CURRENT)).toEqual({ slots: 0, rules: 0 });
  });

  it('counts rule deletions too', () => {
    const current = sync([], [rule('rule-a', 'https://a.example/'), rule('rule-b', 'https://b.example/')]);
    const file = pkg({ rules: [portableRule('rule-a', 'https://a.example/')] });
    const base = defaultImportIntent();
    const intent: ImportIntent = { ...base, dimensionModes: { ...base.dimensionModes, rules: 'overwrite' } };
    const final = applyIntent(file, current, intent);
    expect(quantifyDeletions(final, current)).toEqual({ slots: 0, rules: 1 });
  });
});

describe('T8: findMatchOverlaps — exact Match URL + Match Type (D10)', () => {
  it('reports two rules with an identical urlMatch as one overlap', () => {
    const state = sync([], [
      rule('rule-a', 'https://a.example/'),
      rule('rule-b', 'https://a.example/'),
    ]);
    const overlaps = findMatchOverlaps(state);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].recordIds.sort()).toEqual(['rule-a', 'rule-b']);
    expect(overlaps[0].urlMatch).toEqual(exact('https://a.example/'));
  });

  it('does NOT report semantic overlap (different strings) — deliberate (D10)', () => {
    const state = sync([], [
      rule('rule-a', 'https://a\\.com/.*'),
      rule('rule-b', 'https://a\\.com/x'),
    ]);
    expect(findMatchOverlaps(state)).toHaveLength(0);
  });

  it('is a pure function of the final state (same input → same output)', () => {
    const state = sync([], [rule('r1', 'https://x/'), rule('r2', 'https://x/')]);
    expect(findMatchOverlaps(state)).toEqual(findMatchOverlaps(state));
    expect(findMatchOverlaps(state)).toHaveLength(1);
  });

  it('is not fooled by a different Match Type on the same value', () => {
    const state = sync([], [
      rule('r1', 'https://x/'),
      { ...rule('r2', 'https://x/'), urlMatch: { type: 'regex', value: 'https://x/' } },
    ]);
    expect(findMatchOverlaps(state)).toHaveLength(0);
  });
});