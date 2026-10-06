/**
 * T1 — portable export package schema + bidirectional mapping.
 *
 * A14: the package must NOT mirror `SyncState`. Export-time icons are already
 * rewritten, and internal fields (`configVersion` / timestamps) must not leak.
 * G4-A: "what the package carried" has to be an enumerable fact — an absent
 * dimension is an ABSENT key, an empty-but-carried dimension is `[]`.
 */
import { describe, it, expect } from 'vitest';
import type { SyncState, SlotDefinition, PageRule, MatchRuleSettings } from '@shared/types';
import {
  syncStateToPackage,
  packageToSyncPatch,
  isExportPackage,
} from '@shared/export-package';

const SETTINGS_GLOBAL: MatchRuleSettings = { tabIdMode: 'no-exists', ruleCheckMode: 'no-match', priority: 'none' };
const SETTINGS_SLOT3: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'rule-check' };

function makeSlot(id: number, extra: Partial<SlotDefinition> = {}): SlotDefinition {
  const n = String(id);
  return {
    id,
    urlMatch: { type: 'exact', value: `https://slot-${n}.example.com` },
    strategy: 'inherit',
    uiMarker: {},
    titleSnapshot: `Slot ${n}`,
    faviconSnapshot: `https://slot-${n}.example.com/favicon.ico`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...extra,
  };
}

function makeRule(id: string): PageRule {
  return {
    id,
    urlMatch: { type: 'regex', value: `^https://r-${id}\\.example\\.com/.*$` },
    priority: 5,
    title: `Rule ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  };
}

function makeState(): SyncState {
  const slots = [1, 2, 3].map((id) =>
    makeSlot(id, id === 3 ? { strategy: SETTINGS_SLOT3 } : {}),
  );
  slots.push(
    makeSlot(4, {
      uiMarker: {
        customTitle: 'Custom 4',
        icon: { type: 'url', value: 'https://icons.example.com/a.png' },
      },
    }),
  );
  return {
    configVersion: 7,
    matchSettings: SETTINGS_GLOBAL,
    switchDirection: 'previous',
    autoBindGlobal: false,
    slots,
    rules: [makeRule('a'), makeRule('b'), makeRule('c')],
  };
}

const ALL = { slots: true, rules: true, settings: true, shortcuts: true };
const SHORTCUTS = { global: [], perSlot: {} };

describe('T1: export package mapping', () => {
  it('round-trips all four dimensions without loss (G4-A)', () => {
    const state = makeState();
    const pkg = syncStateToPackage(state, ALL, { shortcuts: SHORTCUTS });
    const patch = packageToSyncPatch(pkg, state);
    const { slots, rules, settings } = patch;

    expect(slots).toEqual(state.slots);
    expect(rules).toEqual(state.rules);
    expect(settings).toBeDefined();
    expect(settings?.matchSettings).toEqual(state.matchSettings);
    expect(settings?.switchDirection).toBe('previous');
    expect(settings?.autoBindGlobal).toBe(false);
    expect(settings?.slotStrategies[3]).toEqual(SETTINGS_SLOT3);
  });

  it('does not mirror SyncState: strategy is stripped from slots[] (D3)', () => {
    const pkg = syncStateToPackage(makeState(), ALL, { shortcuts: SHORTCUTS });
    const portableSlots = pkg.slots ?? [];
    expect(portableSlots).toHaveLength(4);
    for (const slot of portableSlots) {
      expect(slot).not.toHaveProperty('strategy');
    }
    // The per-slot strategy lives in the settings dimension instead.
    expect(pkg.settings?.slotStrategies[3]).toEqual(SETTINGS_SLOT3);
  });

  it('absent dimension ⇒ absent key, not []/undefined key (A2/A3)', () => {
    const pkg = syncStateToPackage(makeState(), { slots: true, rules: false, settings: false, shortcuts: false });

    expect('rules' in pkg).toBe(false);
    expect('settings' in pkg).toBe(false);
    expect('shortcuts' in pkg).toBe(false);
    expect('slots' in pkg).toBe(true);
  });

  it('carried-but-empty dimension ⇒ empty array (A3 three-state)', () => {
    const empty: SyncState = { ...makeState(), rules: [] };
    const pkg = syncStateToPackage(empty, { slots: false, rules: true, settings: false, shortcuts: false });
    expect(pkg.rules).toEqual([]);
  });

  it('never leaks configVersion / createdAt / updatedAt into the package JSON (D5)', () => {
    const pkg = syncStateToPackage(makeState(), ALL, { shortcuts: SHORTCUTS });
    const json = JSON.stringify(pkg);
    expect(json).not.toContain('"configVersion"');
    expect(json).not.toContain('"createdAt"');
    expect(json).not.toContain('"updatedAt"');
  });

  it('package carries schemaVersion + generator + exportedAt + scope (D11)', () => {
    const scope = { slots: true, rules: false, settings: true, shortcuts: false };
    const pkg = syncStateToPackage(makeState(), scope);
    expect(pkg.schemaVersion).toBe(1);
    expect(typeof pkg.generator.name).toBe('string');
    expect(typeof pkg.generator.version).toBe('string');
    expect(typeof pkg.exportedAt).toBe('string');
    expect(pkg.scope).toEqual(scope);
  });

  it('isExportPackage accepts a real package and rejects junk', () => {
    const pkg = syncStateToPackage(makeState(), ALL);
    expect(isExportPackage(pkg)).toBe(true);
    expect(isExportPackage(null)).toBe(false);
    expect(isExportPackage({})).toBe(false);
    expect(isExportPackage({ schemaVersion: 2 })).toBe(false);
    expect(isExportPackage({ schemaVersion: 1 })).toBe(false);
    expect(isExportPackage({ schemaVersion: 1, generator: {}, exportedAt: 'x', scope: {} })).toBe(true);
  });

  it('isExportPackage rejects a wrong CONTAINER type, but not an ABSENT dimension', () => {
    const base = { schemaVersion: 1, generator: {}, exportedAt: 'x', scope: {} };

    // Absent dimensions stay legal (A2: "not carried") — the positive case above
    // must not be collateral damage of the container tightening.
    expect(isExportPackage(base)).toBe(true);
    expect(isExportPackage({ ...base, slots: [], rules: [] })).toBe(true);

    // A PRESENT dimension must be the right container: otherwise the malformed
    // value reaches `computeDiff` and THROWS instead of failing cleanly.
    expect(isExportPackage({ ...base, slots: 'x' })).toBe(false);
    expect(isExportPackage({ ...base, slots: {} })).toBe(false);
    expect(isExportPackage({ ...base, rules: 'x' })).toBe(false);
    expect(isExportPackage({ ...base, settings: 'x' })).toBe(false);
    expect(isExportPackage({ ...base, settings: [] })).toBe(false);
    expect(isExportPackage({ ...base, shortcuts: 5 })).toBe(false);
  });
});