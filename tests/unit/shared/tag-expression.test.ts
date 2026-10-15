/**
 * T5 — the tag boolean-expression engine (iterative parse + iterative evaluate).
 *
 * Two constraints are non-negotiable and shape every assertion here:
 *
 *  D1: neither parsing nor evaluation may CRASH on deep nesting. The stated
 *      consequence of a stack overflow is not "an error" — it is a blank
 *      settings page. So the 5000-deep case is CONSTRUCTED FOR REAL (not
 *      mocked) and asserted not to throw; a RangeError caught and asserted null
 *      is the failure detector.
 *
 *  C6 vs C7: these are DIFFERENT failure modes and must not be conflated.
 *      C6 = the expression itself is incomplete/empty (the user is mid-edit) =>
 *           no filter, and NO tag is named.
 *      C7 = the expression is complete but references a deleted tag =>
 *           no filter, and the missing tag IS named (via its insert-time name).
 *      Merging them regresses to "syntactically fine but silently empty".
 */
import { describe, it, expect } from 'vitest';
import type { TagDefinition } from '@shared/types';
import {
  parse,
  evaluate,
  evaluateExpression,
  resolveChipDisplayName,
  type ChipToken,
} from '@shared/tag-expression';

const tagDef = (id: string, name: string): TagDefinition => ({
  id, name, backgroundColor: '#000', textColor: '#fff',
});

/** A tag chip. `nameAtInsert` is the D2 fallback captured at insertion time. */
const t = (id: string, nameAtInsert = id): ChipToken => ({
  kind: 'tag', tagId: id, nameAtInsert, backgroundColorAtInsert: '#000',
});
const op = (o: 'AND' | 'OR' | 'NOT'): ChipToken => ({ kind: 'op', op: o });
const paren = (p: '(' | ')'): ChipToken => ({ kind: 'paren', p });

describe('T5: operator precedence NOT > AND > OR', () => {
  it('a OR b AND c parses as a OR (b AND c): a alone matches', () => {
    const r = parse([t('a'), op('OR'), t('b'), op('AND'), t('c')]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Rule has only `a`: (b AND c) is false, so `a OR false` is true.
    expect(evaluate(r.ast, new Set(['a']))).toBe(true);
    // Rule has only `b`: b alone cannot satisfy (b AND c) and a is absent.
    expect(evaluate(r.ast, new Set(['b']))).toBe(false);
    // Rule has b and c => true.
    expect(evaluate(r.ast, new Set(['b', 'c']))).toBe(true);
  });

  it('NOT binds tighter than AND: NOT a AND b is (NOT a) AND b', () => {
    const r = parse([op('NOT'), t('a'), op('AND'), t('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evaluate(r.ast, new Set(['b']))).toBe(true);   // NOT a = true, b = true
    expect(evaluate(r.ast, new Set(['a', 'b']))).toBe(false); // NOT a = false
  });

  it('NOT > OR: NOT a OR b is (NOT a) OR b', () => {
    const r = parse([op('NOT'), t('a'), op('OR'), t('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evaluate(r.ast, new Set(['a', 'b']))).toBe(true);  // b true
    expect(evaluate(r.ast, new Set(['a']))).toBe(false);      // NOT a false, b false
  });
});

describe('T5: parentheses actually change semantics', () => {
  const tags = [tagDef('a', 'a'), tagDef('b', 'b'), tagDef('c', 'c')];

  it('( a OR b ) AND c differs from a OR b AND c for a rule holding only `a`', () => {
    const withParens = evaluateExpression(
      [paren('('), t('a'), op('OR'), t('b'), paren(')'), op('AND'), t('c')],
      new Set(['a']), tags,
    );
    const withoutParens = evaluateExpression(
      [t('a'), op('OR'), t('b'), op('AND'), t('c')],
      new Set(['a']), tags,
    );
    expect(withParens.applied).toBe(true);
    expect(withoutParens.applied).toBe(true);
    // Without parens `a` wins via the OR; with parens the AND on c fails.
    expect(withoutParens.matched).toBe(true);
    expect(withParens.matched).toBe(false);
  });

  it('NOT a alone inverts', () => {
    const r = evaluateExpression([op('NOT'), t('a')], new Set(['a']), tags);
    expect(r).toEqual({ applied: true, matched: false, missingTagIds: [] });
  });
});

describe('T5: arity and pairing errors are rejected (never half-applied)', () => {
  const bad: Array<[string, ChipToken[]]> = [
    ['AND a (missing left)', [op('AND'), t('a')]],
    ['a AND (missing right)', [t('a'), op('AND')]],
    ['NOT (missing child)', [op('NOT')]],
    ['() empty group', [paren('('), paren(')')]],
    ['( a (unclosed)', [paren('('), t('a')]],
    ['a ) (stray close)', [t('a'), paren(')')]],
    ['a b (no operator)', [t('a'), t('b')]],
  ];
  for (const [label, chips] of bad) {
    it(`${label} => ok:false`, () => {
      expect(parse(chips).ok).toBe(false);
    });
  }
});

describe('T5: C6 — an incomplete/empty expression applies NO filter and names NOTHING', () => {
  const tags = [tagDef('a', 'a')];
  const incomplete: Array<[string, ChipToken[]]> = [
    ['empty', []],
    ['half-written a AND', [t('a'), op('AND')]],
    ['unclosed ( a', [paren('('), t('a')]],
  ];

  for (const [label, chips] of incomplete) {
    it(`${label} => applied:false, missingTagIds empty (no naming)`, () => {
      const r = evaluateExpression(chips, new Set(['a']), tags);
      expect(r.applied).toBe(false);
      // C6 names nothing: this is the "user is mid-edit" case, not a disappearance.
      expect(r.missingTagIds).toEqual([]);
      // And "no filter" means every rule passes — expressed as matched:true.
      expect(r.matched).toBe(true);
    });
  }
});

describe('T5: C7 — a COMPLETE expression referencing a deleted tag pauses and NAMES it', () => {
  const tags = [tagDef('a', 'a')];

  it('names the missing id and applies no filter', () => {
    const r = evaluateExpression([t('gone', 'old-tag')], new Set(['a']), tags);
    expect(r.applied).toBe(false);
    expect(r.missingTagIds).toEqual(['gone']);  // C7: named, unlike C6
    expect(r.matched).toBe(true);               // no filter => everything shown
  });

  it('C6 and C7 are distinguishable by missingTagIds alone', () => {
    const c6 = evaluateExpression([t('a'), op('AND')], new Set(['a']), tags);
    const c7 = evaluateExpression([t('gone', 'old-tag')], new Set(['a']), tags);
    expect(c6.applied).toBe(false);
    expect(c7.applied).toBe(false);
    expect(c6.missingTagIds).toEqual([]);
    expect(c7.missingTagIds).toEqual(['gone']);
  });
});

describe('T5: chip display name follows a rename, falls back to insert-time name (D2)', () => {
  it('a live tag shows its CURRENT name (rename follows: id unchanged)', () => {
    const tags = [tagDef('t1', 'renamed')];
    const chip: ChipToken = { kind: 'tag', tagId: 't1', nameAtInsert: 'old', backgroundColorAtInsert: '#000' };
    expect(resolveChipDisplayName(chip, tags)).toBe('renamed');
  });

  it('a deleted tag falls back to the insert-time name (D2), with no tombstone', () => {
    const chip: ChipToken = { kind: 'tag', tagId: 'gone', nameAtInsert: 'deprecated', backgroundColorAtInsert: '#000' };
    expect(resolveChipDisplayName(chip, [])).toBe('deprecated');
  });
});

describe('T5: D1 — 5000-deep nesting neither crashes nor hangs', () => {
  it('5000 nested NOTs parse and evaluate without a RangeError', () => {
    const chips: ChipToken[] = [];
    for (let i = 0; i < 5000; i += 1) chips.push(op('NOT'));
    chips.push(t('a'));

    let error: unknown = null;
    let ast = null;
    try {
      const r = parse(chips);
      expect(r.ok).toBe(true);
      if (r.ok) ast = r.ast;
    } catch (e) {
      error = e;
    }
    // The whole point: no stack overflow (an ANR/blank page, not a message).
    expect(error).toBeNull();

    let value: boolean | null = null;
    try {
      if (ast) value = evaluate(ast, new Set(['a']));
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
    expect(typeof value).toBe('boolean');
    // 5000 NOTs over `a`: even count => `a` holds.
    expect(value).toBe(true);
  });

  it('5000 nested parentheses parse and evaluate without a RangeError', () => {
    const chips: ChipToken[] = [];
    for (let i = 0; i < 5000; i += 1) chips.push(paren('('));
    chips.push(t('a'));
    for (let i = 0; i < 5000; i += 1) chips.push(paren(')'));

    let error: unknown = null;
    try {
      const r = parse(chips);
      expect(r.ok).toBe(true);
      if (r.ok) expect(evaluate(r.ast, new Set(['a']))).toBe(true);
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });
});