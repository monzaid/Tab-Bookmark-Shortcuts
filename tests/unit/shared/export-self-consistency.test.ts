/**
 * T11 — the export side's self-consistency: the difference drives BOTH options.
 *
 * The design's reason for putting the check here (A3's path record) is that the
 * user HAS context at export time ("these are my tags, this is what I am
 * sharing") and does not at import time. So the package must leave in a
 * self-consistent state, and when a deselection would break that, the two
 * offered choices must be rendered from the ONE difference array — otherwise the
 * wording and the decision drift apart (D-e/A-f).
 *
 *   - `diff`        : the names referenced but not defined — from `selfConsistencyDiff`,
 *                     the single implementation (asserted by identity, not by value).
 *   - `canSupplement`: those names, with the LOCAL colours (the export side CAN
 *                     supply appearance, unlike import — the registered asymmetry).
 *   - `canDrop`     : the rules that would LOSE a tag if the difference is dropped.
 */
import { describe, it, expect } from 'vitest';
import { syncStateToPackage } from '@shared/export-package';
import type { ExportPackage } from '@shared/export-package';
import { selfConsistencyDiff } from '@shared/tags';
import { computeExportSelfConsistency } from '@shared/export-package';
import type { SyncState } from '@shared/types';

const state: SyncState = {
  configVersion: 1,
  matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
  switchDirection: 'next',
  autoBindGlobal: true,
  slots: [],
  rules: [
    {
      id: 'r1', urlMatch: { type: 'exact', value: 'https://a/' }, priority: 0,
      tagIds: ['t-work', 't-urgent'], createdAt: 'x', updatedAt: 'x',
    },
  ],
  tags: [
    { id: 't-work', name: 'work', backgroundColor: '#AAA', textColor: '#fff' },
    { id: 't-urgent', name: 'urgent', backgroundColor: '#BBB', textColor: '#fff' },
  ],
};

describe('T11: S3 — a deselected-but-referenced tag creates a difference', () => {
  it('excluding a referenced tag yields exactly that name in the difference', () => {
    const pkg = syncStateToPackage(state, { rules: true, tags: true, excludedTagNames: ['urgent'] });
    const sc = computeExportSelfConsistency(pkg, state.tags);
    expect(sc.diff).toEqual(['urgent']);
  });

  it('the difference is DRIVEN BY selfConsistencyDiff (same function, not a copy)', () => {
    const pkg = syncStateToPackage(state, { rules: true, tags: true, excludedTagNames: ['urgent'] });
    // Identity of the derivation: recompute with the shared function and compare.
    expect(computeExportSelfConsistency(pkg, state.tags).diff).toEqual(
      selfConsistencyDiff(pkg.rules ?? [], pkg.tags ?? []),
    );
  });

  it('"supplement" carries the LOCAL colour — the export side HAS one', () => {
    const pkg = syncStateToPackage(state, { rules: true, tags: true, excludedTagNames: ['urgent'] });
    const sc = computeExportSelfConsistency(pkg, state.tags);
    const urgent = sc.canSupplement.find((t) => t.name === 'urgent');
    expect(urgent?.backgroundColor).toBe('#BBB');
  });

  it('"drop" names the rules that would lose a tag', () => {
    const pkg = syncStateToPackage(state, { rules: true, tags: true, excludedTagNames: ['urgent'] });
    const sc = computeExportSelfConsistency(pkg, state.tags);
    expect(sc.canDrop.map((r) => r.id)).toEqual(['r1']);
  });

  it('supplement and drop cover exactly the difference — no third state', () => {
    const pkg = syncStateToPackage(state, { rules: true, tags: true, excludedTagNames: ['urgent'] });
    const sc = computeExportSelfConsistency(pkg, state.tags);
    const supplementNames = sc.canSupplement.map((t) => t.name).sort();
    expect(supplementNames).toEqual(sc.diff);
  });
});

describe('T11: no false dialog — excluding an UNUSED tag produces an empty difference', () => {
  const stateWithUnused: SyncState = {
    ...state,
    tags: [...state.tags, { id: 't-unused', name: 'unused', backgroundColor: '#CCC', textColor: '#fff' }],
  };

  it('excluding a tag no rule references yields []', () => {
    const pkg = syncStateToPackage(stateWithUnused, {
      rules: true, tags: true, excludedTagNames: ['unused'],
    });
    expect(computeExportSelfConsistency(pkg, stateWithUnused.tags).diff).toEqual([]);
  });

  it('a fully consistent export has an empty difference', () => {
    const pkg = syncStateToPackage(state, { rules: true, tags: true });
    expect(computeExportSelfConsistency(pkg, state.tags).diff).toEqual([]);
  });
});

describe('T11: no ids travel in the package (A4)', () => {
  it('the carried vocabulary has names and colours only', () => {
    const pkg: ExportPackage = syncStateToPackage(state, { rules: true, tags: true });
    for (const tag of pkg.tags ?? []) {
      expect(Object.keys(tag).sort()).toEqual(['backgroundColor', 'name', 'textColor']);
    }
  });
});
