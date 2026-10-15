/**
 * T4 — tag domain functions (identity, limits, dangling strip, self-consistency).
 *
 * These assertions target INVARIANTS, and the case tables are DISCRIMINATIVE:
 * each pairs a case that must be flagged with one that must not, so the test
 * cannot pass by the predicate being vacuously true (the `layer-boundary.test.ts`
 * discipline). "`x` is not a duplicate" only means something next to "`y` is".
 *
 * The identity rule under test is C2/I4: uniqueness is `trim`ed byte-for-byte
 * equality, and COLOUR never participates.
 */
import { describe, it, expect } from 'vitest';
import type { TagDefinition, PageRule } from '@shared/types';
import type { PortableRule, PortableTag } from '@shared/export-package';
import {
  normalizeTagName,
  findDuplicateTagId,
  isTagNameValid,
  isTagColorValid,
  isRuleTagIdsValid,
  stripDanglingTagIds,
  resolveRuleTagNames,
  resolveTagIdsByName,
  collectRuleTagNames,
  selfConsistencyDiff,
  findOrphanTagIds,
  countTagReferences,
  TAG_NAME_MAX,
  RULE_TAG_MAX,
} from '@shared/tags';

const tag = (id: string, name: string, bg = '#000', fg = '#fff'): TagDefinition => ({
  id, name, backgroundColor: bg, textColor: fg,
});

const rule = (id: string, tagIds: string[]): PageRule => ({
  id,
  urlMatch: { type: 'exact', value: `https://${id}/` },
  priority: 0,
  tagIds,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('T4: normalizeTagName trims only (C2)', () => {
  it('strips leading/trailing whitespace and nothing else', () => {
    expect(normalizeTagName('  work  ')).toBe('work');
    expect(normalizeTagName('work')).toBe('work');
    // Internal whitespace is NOT collapsed and case is NOT folded.
    expect(normalizeTagName('  in  progress ')).toBe('in  progress');
    expect(normalizeTagName('  Work ')).toBe('Work');
  });
});

describe('T4: identity is trim-equal bytes, case-sensitive, colour-blind (C2/I4)', () => {
  // Discriminative case table: [given name, candidate, exclude, expected hit id]
  const cases: Array<{ name: string; candidate: string; exclude?: string; expect: string | null; why: string }> = [
    { name: 'work',  candidate: ' work ',  expect: 't1', why: 'surrounding whitespace is not identity' },
    { name: ' work ', candidate: 'work',   expect: 't1', why: 'same, from the other side' },
    { name: 'Work',  candidate: 'work',    expect: null, why: 'CASE distinguishes tags (C2)' },
    { name: 'work',  candidate: 'works',   expect: null, why: 'prefix is not a match' },
    { name: 'in  progress', candidate: 'in progress', expect: null, why: 'inner whitespace is identity' },
    { name: 'work',  candidate: 'work', exclude: 't1', expect: null, why: 'renaming to itself is not a duplicate' },
    { name: 'work',  candidate: 'work', exclude: 't9', expect: 't1', why: 'exclude only drops the named id' },
  ];

  for (const c of cases) {
    it(`'${c.candidate}' vs live '${c.name}'${c.exclude ? ` (exclude ${c.exclude})` : ''} -> ${String(c.expect)} — ${c.why}`, () => {
      expect(findDuplicateTagId([tag('t1', c.name)], c.candidate, c.exclude)).toBe(c.expect);
    });
  }

  it('colour never participates in identity (S1/I4)', () => {
    const live = [tag('t1', 'work', '#ff0000')];
    // Same name, wildly different colours => still a duplicate.
    expect(findDuplicateTagId(live, ' work ', undefined)).toBe('t1');
  });
});

describe('T4: limits are C3 (<=32 chars, <=8 tags per rule, no total cap)', () => {
  it(`a name of exactly ${String(TAG_NAME_MAX)} chars is valid; one more is not`, () => {
    expect(TAG_NAME_MAX).toBe(32);
    expect(isTagNameValid('a'.repeat(32))).toBe(true);
    expect(isTagNameValid('a'.repeat(33))).toBe(false);
  });

  it('validity measures the TRIMMED name (a padded 32-char name is fine)', () => {
    expect(isTagNameValid(`  ${'a'.repeat(32)}  `)).toBe(true);
    expect(isTagNameValid(`  ${'a'.repeat(33)}  `)).toBe(false);
  });

  it('an empty name is invalid', () => {
    expect(isTagNameValid('   ')).toBe(false);
  });

  it(`<=${String(RULE_TAG_MAX)} DISTINCT ids pass; ${String(RULE_TAG_MAX + 1)} distinct fail`, () => {
    expect(RULE_TAG_MAX).toBe(8);
    expect(isRuleTagIdsValid(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe(true);
    expect(isRuleTagIdsValid(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).toBe(false);
  });

  it('duplicates do not count toward the limit (dedupe before comparing)', () => {
    // 9 entries but only 2 distinct => within the limit (C3 talks about TAGS).
    expect(isRuleTagIdsValid(['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b'])).toBe(true);
  });
});

describe('isTagColorValid admits the two standard hex forms and nothing else', () => {
  it('accepts #RRGGBB in either case and the #RGB shorthand', () => {
    // The shorthand is not a nicety: `#fff` is what the existing fixtures and the
    // import default carry, so rejecting it would leave a stored tag uneditable
    // without also changing a colour the user was happy with.
    for (const value of ['#3366cc', '#3366CC', '#fff', '#FFF', '#0aF']) {
      expect(isTagColorValid(value)).toBe(true);
    }
  });

  it('rejects anything that is not a hex colour — the value becomes CSS', () => {
    // The security half: `backgroundColor` is applied as an inline style, so an
    // unchecked string is a way to write arbitrary CSS into the page. Every
    // non-hex spelling must fail, including the ones a browser would ALSO accept
    // (`red`, `rgb(...)`) — the point is one format, not "whatever CSS takes".
    for (const value of [
      'red', 'rgb(1,2,3)', 'transparent', 'currentColor',
      '#12345', '#1234567', '123456', '#', '',
      '#12345g', '#3366cc; background: url(x)',
      'red; background-image: url(https://evil/)',
    ]) {
      expect(isTagColorValid(value)).toBe(false);
    }
  });

  it('is not fooled by surrounding whitespace', () => {
    // Anchored at both ends, so a padded value cannot smuggle a suffix past the
    // check and then be stored verbatim.
    expect(isTagColorValid(' #fff ')).toBe(false);
    expect(isTagColorValid('#fff\n')).toBe(false);
  });
});

describe('T4: stripDanglingTagIds keeps ORDER and is empty-safe (D3/I2)', () => {
  const live = [tag('t1', 'one'), tag('t2', 'two')];

  it('removes only ids absent from the live table, preserving input order', () => {
    expect(stripDanglingTagIds(['t2', 'gone', 't1'], live)).toEqual(['t2', 't1']);
  });

  it('an all-dangling input yields []', () => {
    expect(stripDanglingTagIds(['gone'], live)).toEqual([]);
  });

  it('an empty table removes everything (nothing is live)', () => {
    expect(stripDanglingTagIds(['t1', 'gone'], [])).toEqual([]);
  });

  it('empty input stays empty', () => {
    expect(stripDanglingTagIds([], live)).toEqual([]);
  });

  it('is idempotent (stripping a stripped list changes nothing)', () => {
    const once = stripDanglingTagIds(['t2', 'gone', 't1'], live);
    expect(stripDanglingTagIds(once, live)).toEqual(once);
  });
});

describe('T4: resolveRuleTagNames follows tagIds order (write path for export)', () => {
  it('maps ids to names in tagIds order, dropping ids with no live definition', () => {
    const live = [tag('t1', 'one'), tag('t2', 'two')];
    expect(resolveRuleTagNames(['t2', 't1'], live)).toEqual(['two', 'one']);
    expect(resolveRuleTagNames(['t2', 'gone'], live)).toEqual(['two']);
  });
});

describe('T4: resolveTagIdsByName reuses local ids and REPORTS misses (A-e)', () => {
  it('resolves a hit to the LOCAL id and leaves the colour decision to the caller', () => {
    const live = [tag('local-1', 'work', '#red')];
    expect(resolveTagIdsByName(['work'], live)).toEqual({ resolved: ['local-1'], missing: [] });
  });

  it('reports unresolved names rather than inventing ids (no creation here)', () => {
    const live = [tag('local-1', 'work')];
    expect(resolveTagIdsByName(['work', 'urgent'], live)).toEqual({
      resolved: ['local-1'],
      missing: ['urgent'],
    });
  });

  it('matches by trim-equal name, case-sensitively', () => {
    const live = [tag('local-1', 'work')];
    expect(resolveTagIdsByName([' work '], live).resolved).toEqual(['local-1']);
    expect(resolveTagIdsByName(['Work'], live).missing).toEqual(['Work']);
  });
});

describe('T4: collectRuleTagNames is the export-side difference input (S3)', () => {
  it('unions every rule\u2019s inlined names', () => {
    const rules: PortableRule[] = [
      { id: 'r1', urlMatch: { type: 'exact', value: 'a' }, priority: 0, tags: ['work', 'urgent'] },
      { id: 'r2', urlMatch: { type: 'exact', value: 'b' }, priority: 0, tags: ['urgent'] },
    ];
    expect(collectRuleTagNames(rules).sort()).toEqual(['urgent', 'work']);
  });

  it('is empty when no rule carries tags', () => {
    expect(collectRuleTagNames([])).toEqual([]);
  });
});

describe('T4: selfConsistencyDiff is the ONE definition of the difference (A-f)', () => {
  const vocab: PortableTag[] = [
    { name: 'work', backgroundColor: '#000', textColor: '#fff' },
  ];
  const ruleWith = (id: string, tags: string[]): PortableRule => ({
    id, urlMatch: { type: 'exact', value: id }, priority: 0, tags,
  });

  it('returns names a rule references but the vocabulary lacks (sorted, deduped)', () => {
    const rules = [ruleWith('r1', ['urgent', 'work']), ruleWith('r2', ['urgent', 'later'])];
    expect(selfConsistencyDiff(rules, vocab)).toEqual(['later', 'urgent']);
  });

  it('is EMPTY when the file is self-consistent (the export-side target state)', () => {
    expect(selfConsistencyDiff([ruleWith('r1', ['work'])], vocab)).toEqual([]);
  });

  it('is EMPTY when nothing is referenced (no false positive)', () => {
    expect(selfConsistencyDiff([ruleWith('r1', [])], vocab)).toEqual([]);
    expect(selfConsistencyDiff([], vocab)).toEqual([]);
  });

  it('produces the SAME array for inputs that describe the same difference', () => {
    // Guards the "two derivations drift" failure: same difference, same output.
    const a = selfConsistencyDiff([ruleWith('r1', ['x']), ruleWith('r2', ['x'])], []);
    const b = selfConsistencyDiff([ruleWith('r9', ['x'])], []);
    expect(a).toEqual(b);
    expect(a).toEqual(['x']);
  });
});

describe('T4: orphan detection and reference counting (C3/C4)', () => {
  it('findOrphanTagIds returns tags no rule references, in table order', () => {
    const live = [tag('t1', 'used'), tag('t2', 'orphan-a'), tag('t3', 'orphan-b')];
    const rules = [rule('r1', ['t1'])];
    expect(findOrphanTagIds(live, rules)).toEqual(['t2', 't3']);
  });

  it('reports nothing orphaned when every tag is referenced', () => {
    const live = [tag('t1', 'used')];
    expect(findOrphanTagIds(live, [rule('r1', ['t1'])])).toEqual([]);
  });

  it('counts the RULES referencing a tag (the Confirm impact number, C4)', () => {
    const rules = [rule('r1', ['t1', 't2']), rule('r2', ['t1']), rule('r3', [])];
    expect(countTagReferences('t1', rules)).toBe(2);
    expect(countTagReferences('t2', rules)).toBe(1);
    expect(countTagReferences('t3', rules)).toBe(0);
  });
});