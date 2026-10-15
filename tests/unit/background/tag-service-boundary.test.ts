/**
 * T9 — structural guard: `TagService` holds NO delivery entry point (A-a/I1).
 *
 * The design's invariant — "tags never affect rule behaviour" — is guaranteed by
 * a MODULE BOUNDARY, not by callers remembering not to call. So the guard reads
 * the source and asserts the delivery vocabulary is ABSENT: there is nothing in
 * this file that could trigger a re-application of a rule even if a future edit
 * wanted to.
 *
 * Written the same "assert a property of the source" way as the layer-boundary
 * token-owner checks, and it fails if the token reappears (unlike a one-off grep
 * at commit time, which would not catch a later reintroduction).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../helpers/strip-comments';

const SOURCE = readFileSync('src/background/tag-service.ts', 'utf8');

describe('T9: TagService cannot deliver (A-a/I1)', () => {
  // Comments may DISCUSS the invariant, so the scan runs on code, not prose.
  const CODE = stripComments(SOURCE);

  const FORBIDDEN = [
    'applyToMatchingTabs',
    'redeliver',
    'FieldDeliveryService',
    'fieldDeliveryService',
  ] as const;

  for (const token of FORBIDDEN) {
    it(`does not reference \`${token}\``, () => {
      expect(CODE).not.toContain(token);
    });
  }

  it('does not import rule-service (which is where delivery lives)', () => {
    expect(CODE).not.toContain('rule-service');
    expect(CODE).not.toContain('RuleService');
  });

  it('the guard is not vacuous: the code it scans is non-empty', () => {
    // A guard that scans nothing would pass forever — assert it has content.
    expect(CODE.length).toBeGreaterThan(200);
    expect(CODE).toContain('class TagService');
  });
});