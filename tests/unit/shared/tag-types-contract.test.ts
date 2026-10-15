/**
 * T1 — tag data model + package contract + fifth dimension (guardrail origin).
 *
 * Every assertion here pins an INVARIANT of the contract, not "a function was
 * called":
 *   - the `as const satisfies Record<keyof T, true>` allowlist families stay in
 *     sync with their interfaces (R1/R2) — a missing key is a COMPILE error;
 *   - `PortableTag` carries NO `id` (A4/S2: identity travels as a name);
 *   - the fifth dimension is present in every place the other four are, so
 *     "4 cards, 5 dimensions" cannot happen (D0/R7/R11).
 *
 * The last case is deliberately a `@ts-expect-error`: `PageRule.tagIds` is
 * REQUIRED (P1), and the only honest way to assert a required field is to show
 * that omitting it does not compile. It runs in `typecheck`, not at runtime.
 */
import { describe, it, expect } from 'vitest';
import { PACKAGE_FIELD_ALLOWLIST, syncStateToPackage } from '@shared/export-package';
import { defaultImportIntent } from '@shared/types';
import type { PageRule, SyncState, TagDefinition } from '@shared/types';

describe('T1: package field allowlists mirror the new shapes (R1/R2)', () => {
  it('rule allowlist carries `tags` (inlined names, A3)', () => {
    expect(PACKAGE_FIELD_ALLOWLIST.rule).toContain('tags');
  });

  it('root allowlist carries `tags` (root-level vocabulary, A3)', () => {
    expect(PACKAGE_FIELD_ALLOWLIST.root).toContain('tags');
  });

  it('tag allowlist is EXACTLY name/backgroundColor/textColor — no `id` (A4/S2)', () => {
    // Positive: the three fields a portable tag actually carries.
    expect([...PACKAGE_FIELD_ALLOWLIST.tag].sort()).toEqual(['backgroundColor', 'name', 'textColor']);
    // Negative: identity must NOT travel in the package.
    expect(PACKAGE_FIELD_ALLOWLIST.tag).not.toContain('id');
  });
});

describe('T1: fifth dimension model is complete (D0/R7/R11)', () => {
  it('defaultImportIntent().dimensionModes has exactly the 5 dimensions', () => {
    expect(Object.keys(defaultImportIntent().dimensionModes).sort()).toEqual([
      'rules', 'settings', 'shortcuts', 'slots', 'tags',
    ]);
  });

  it('the tag dimension starts incremental — the safer default (A1)', () => {
    expect(defaultImportIntent().dimensionModes.tags).toBe('incremental');
  });
});

describe('T1: TagDefinition shape (C1/S1)', () => {
  it('carries id/name/backgroundColor/textColor — colours are appearance, not identity', () => {
    const tag: TagDefinition = {
      id: 'tag-1',
      name: 'work',
      backgroundColor: '#ff0000',
      textColor: '#ffffff',
    };
    expect(Object.keys(tag).sort()).toEqual(['backgroundColor', 'id', 'name', 'textColor']);
  });
});

describe('T1: required fields stay required across the shapes (P1)', () => {
  it('a PageRule without `tagIds` does not compile', () => {
    // @ts-expect-error — `tagIds` is REQUIRED (P1). This assertion lives in
    // `typecheck`: if the field were relaxed to optional, the directive would
    // become "unused" and `tsc` would fail, which is the point.
    const ruleWithoutTagIds: PageRule = {
      id: 'r1',
      urlMatch: { type: 'exact', value: 'https://example.com/' },
      priority: 0,
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
    };
    void ruleWithoutTagIds;
  });

  it('a TagDefinition without colours does not compile', () => {
    // @ts-expect-error — colours are part of the durable entity (S1).
    const tagWithoutColours: TagDefinition = { id: 't', name: 'work' };
    void tagWithoutColours;
  });
});

describe('T1: sync state carries the tag table (C1/A6)', () => {
  it('SyncState exposes `tags` as a list of definitions', () => {
    const state = {
      configVersion: 1,
      slots: [],
      rules: [],
      tags: [{ id: 't1', name: 'work', backgroundColor: '#f00', textColor: '#fff' }],
    } satisfies Pick<SyncState, 'configVersion' | 'slots' | 'rules' | 'tags'>;
    expect(state.tags).toHaveLength(1);
    expect(state.tags[0]?.name).toBe('work');
  });

  it('export-package maps the tag table without inventing ids', () => {
    // The shape mapping exists at T1; the self-consistency diff is T11's.
    const sync = {
      configVersion: 1,
      slots: [],
      rules: [],
      tags: [{ id: 't1', name: 'work', backgroundColor: '#f00', textColor: '#fff' }],
    } as unknown as SyncState;
    const pkg = syncStateToPackage(sync, { tags: true });
    expect(pkg.tags).toEqual([{ name: 'work', backgroundColor: '#f00', textColor: '#fff' }]);
  });
});