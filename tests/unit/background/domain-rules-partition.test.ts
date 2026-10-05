/**
 * T3 — per-record domain partition (D15) replacing whole-package rejection.
 *
 * D15: a single bad record must not destroy the whole import. Unsafe regexes and
 * out-of-range domain values are collected per-record (with a reason) and the
 * remaining records are still accepted.
 *
 * Technique equivalence (design §6.1): B4 patterns are never executed, only
 * statically validated, so skipping == not writing == rejecting, except the
 * blast radius is one record instead of the file.
 */
import { describe, it, expect } from 'vitest';
import { partitionByDomainRules } from '@background/domain-rules';

describe('T3: partitionByDomainRules', () => {
  it('keeps good records and rejects an unsafe-regex rule (mixed package)', () => {
    const records = [
      { kind: 'rule' as const, id: 'good-1', urlMatch: { type: 'exact' as const, value: 'https://a.com' } },
      { kind: 'rule' as const, id: 'evil', urlMatch: { type: 'regex' as const, value: '(a+)+$' } },
      { kind: 'rule' as const, id: 'good-2', urlMatch: { type: 'exact' as const, value: 'https://b.com' } },
    ];

    const { accepted, rejectedWithReason } = partitionByDomainRules(records);

    expect(accepted.map((r) => r.id)).toEqual(['good-1', 'good-2']);
    expect(rejectedWithReason).toHaveLength(1);
    expect(rejectedWithReason[0].id).toBe('evil');
    expect(rejectedWithReason[0].reason).toMatch(/unsafe|regex|backtrack/i);
  });

  it('rejects a slot whose id is out of the 1..10 range', () => {
    const records = [
      { kind: 'slot' as const, id: 3, urlMatch: { type: 'exact' as const, value: 'https://ok.com' } },
      { kind: 'slot' as const, id: 11, urlMatch: { type: 'exact' as const, value: 'https://bad.com' } },
      { kind: 'slot' as const, id: 0, urlMatch: { type: 'exact' as const, value: 'https://zero.com' } },
    ];

    const { accepted, rejectedWithReason } = partitionByDomainRules(records);

    expect(accepted.map((r) => r.id)).toEqual([3]);
    expect(rejectedWithReason.map((r) => r.id).sort()).toEqual([0, 11]);
    expect(rejectedWithReason.every((r) => /slot id/i.test(r.reason))).toBe(true);
  });

  it('rejects an invalid urlMatch.type', () => {
    const records = [
      { kind: 'rule' as const, id: 'bad-type', urlMatch: { type: 'fuzzy' as never, value: 'x' } },
    ];

    const { accepted, rejectedWithReason } = partitionByDomainRules(records);

    expect(accepted).toHaveLength(0);
    expect(rejectedWithReason[0].reason).toMatch(/match type|urlMatch/i);
  });

  it('accepts an all-legal set with no rejections', () => {
    const records = [
      { kind: 'slot' as const, id: 1, urlMatch: { type: 'exact' as const, value: 'https://a.com' } },
      { kind: 'rule' as const, id: 'r1', urlMatch: { type: 'regex' as const, value: '^https://example\\.com/.*$' } },
    ];

    const { accepted, rejectedWithReason } = partitionByDomainRules(records);

    expect(accepted).toHaveLength(2);
    expect(rejectedWithReason).toHaveLength(0);
  });

  it('still accepts the broad (warn-tier) regex — warn ≠ reject (B4)', () => {
    const records = [
      { kind: 'rule' as const, id: 'broad', urlMatch: { type: 'regex' as const, value: '.*' } },
    ];

    const { accepted, rejectedWithReason } = partitionByDomainRules(records);

    expect(accepted).toHaveLength(1);
    expect(rejectedWithReason).toHaveLength(0);
  });
});