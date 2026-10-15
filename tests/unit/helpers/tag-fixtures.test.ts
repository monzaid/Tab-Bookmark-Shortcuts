/**
 * T3 — the tag fixtures must stay byte-for-byte aligned with the T1 contract.
 *
 * A fixture that drifts from the contract is worse than no fixture: 63 test
 * files will be migrated onto these defaults (T19), so a stray field or an
 * `undefined` where the contract requires `[]` would fan out silently.
 *
 * Hence the assertions are on SHAPE and on the REQUIRED-not-optional property
 * (P1: `tagIds` defaults to `[]`, never `undefined`), not on "the factory ran".
 */
import { describe, it, expect } from 'vitest';
import { makeTagDefinition, makeTaggedRule, makeSyncStateWithTags } from '../../helpers/tag-fixtures';

describe('T3: makeTagDefinition shape mirrors TagDefinition', () => {
  it('carries exactly id/name/backgroundColor/textColor', () => {
    expect(Object.keys(makeTagDefinition()).sort()).toEqual([
      'backgroundColor', 'id', 'name', 'textColor',
    ]);
  });

  it('applies overrides without adding keys', () => {
    const tag = makeTagDefinition({ name: 'urgent' });
    expect(tag.name).toBe('urgent');
    expect(Object.keys(tag).sort()).toEqual(['backgroundColor', 'id', 'name', 'textColor']);
  });

  it('is deterministic for a given id (no hidden randomness in assertions)', () => {
    expect(makeTagDefinition({ id: 't1' })).toEqual(makeTagDefinition({ id: 't1' }));
  });
});

describe('T3: makeTaggedRule satisfies the required tagIds (P1)', () => {
  it('defaults tagIds to an EMPTY ARRAY, not undefined', () => {
    const rule = makeTaggedRule();
    expect(rule.tagIds).toEqual([]);
    // The distinction matters: `undefined` would be a type error under P1, and
    // an object literal silently lacking the key is exactly what T19 migrates.
    expect(Object.prototype.hasOwnProperty.call(rule, 'tagIds')).toBe(true);
  });

  it('accepts explicit tags and keeps the rest of the rule shape', () => {
    const rule = makeTaggedRule({ tagIds: ['t1', 't2'] });
    expect(rule.tagIds).toEqual(['t1', 't2']);
    expect(rule.urlMatch.type).toBe('exact');
  });
});

describe('T3: makeSyncStateWithTags is a complete SyncState', () => {
  it('carries tags plus the rest of the required state', () => {
    const state = makeSyncStateWithTags([makeTagDefinition({ id: 't1', name: 'work' })]);
    expect(state.tags.map((t) => t.name)).toEqual(['work']);
    expect(state.rules).toEqual([]);
    expect(state.slots).toEqual([]);
    expect(state.configVersion).toBe(0);
  });

  it('defaults to an empty vocabulary when called with no tags', () => {
    expect(makeSyncStateWithTags().tags).toEqual([]);
  });
});