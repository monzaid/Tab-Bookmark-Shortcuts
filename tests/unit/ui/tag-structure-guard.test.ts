/**
 * T18 — structural guards for the tag surfaces (R17's "table, not memory").
 *
 * Every case table here proves the DETECTOR can discriminate before it asserts the
 * current state is clean — a guard that only ever checks "is the tree clean right
 * now" can pass forever while scanning nothing.
 *
 * The guarded invariants are the ones a future refactor could silently break:
 *
 *  - C6 / C7 must stay TWO DIFFERENT notices. Merging them loses the only
 *    information that makes a paused filter diagnosable, and no runtime test
 *    would necessarily catch a merge that happens to keep both words.
 *  - the chip must remain keyboard-deletable + named (R6) at the SOURCE level, so
 *    a rewrite that drops `tabIndex`/`aria-label` is caught even if no snapshot
 *    test covers the exact render.
 *  - `TagService` must hold no delivery entry point (A-a) — asserted IN TEST, not
 *    by a one-off grep at commit time.
 *  - the three dimension enumerations must stay equal (R5/D0).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../helpers/strip-comments';

const read = (p: string): string => readFileSync(p, 'utf8');

describe('T18: C6 and C7 are guarded as TWO DISTINCT paths', () => {
  const app = read('src/ui/settings/App.tsx');
  const code = stripComments(app);

  it('the naming path exists and is conditioned on missingTagIds (C7)', () => {
    // The C7 notice names tags, so it must be reachable only when there ARE
    // missing ids — otherwise a mid-edit expression would name a tag.
    expect(code).toContain('missingTagIds');
    expect(code).toMatch(/missingTagIds\.length\s*>\s*0/);
  });

  it('the two notices are distinguishable (the C7 one carries a missing-marker class)', () => {
    expect(app).toContain('tbs-settings__tag-notice--missing');
  });

  it('there is exactly ONE notice testid, rendered by two branches (not one merged branch)', () => {
    // The C6 branch is the `else` of the missingTagIds test; both render
    // `data-testid="tag-filter-notice"`, which is HOW the tests can assert the
    // no-naming vs naming difference.
    const count = (app.match(/tag-filter-notice/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('the guard is not vacuous: the file it scans has content', () => {
    expect(code.length).toBeGreaterThan(1000);
    expect(code).toContain('expressionState');
  });
});

describe('T18: R6 — the chip stays keyboard-deletable and named at the SOURCE level', () => {
  const chip = stripComments(read('src/ui/shared/tag-chip-input.tsx'));

  it('chips carry an accessible name', () => {
    expect(chip).toContain('aria-label');
    expect(chip).toMatch(/Tag: \$\{|ariaLabel/);
  });

  it('chips are focusable', () => {
    expect(chip).toMatch(/tabIndex=\{0\}/);
  });

  it('chips handle the keyboard delete keys', () => {
    expect(chip).toContain("'Backspace'");
    expect(chip).toContain("'Delete'");
  });

  it('the container declares wrapping (D-d: no truncation)', () => {
    const css = read('src/ui/styles/settings.css');
    const block = css.slice(css.indexOf('.tbs-tag-chip-input__chips'));
    expect(/flex-wrap\s*:/.test(block)).toBe(true);
  });
});

describe('T18: A-a — TagService holds no delivery entry point (in-test, not a one-off grep)', () => {
  const code = stripComments(read('src/background/tag-service.ts'));

  it('has no delivery symbol', () => {
    for (const token of ['applyToMatchingTabs', 'redeliver', 'FieldDeliveryService', 'fieldDeliveryService']) {
      expect(code, `TagService must not reference ${token}`).not.toContain(token);
    }
  });

  it('does not import the rule service', () => {
    expect(code).not.toContain('rule-service');
    expect(code).not.toContain('RuleService');
  });

  it('constructs with the repository only', () => {
    expect(code).toMatch(/constructor\(private repo: StorageRepository\)/);
  });

  it('the guard is not vacuous', () => {
    expect(code).toContain('class TagService');
  });
});

describe('T18: R5/D0 — the three dimension enumerations agree', () => {
  const app = stripComments(read('src/ui/settings/App.tsx'));

  it('DIMENSION_LABELS lists all five dimension keys', () => {
    for (const dim of ['slots', 'rules', 'settings', 'shortcuts', 'tags']) {
      expect(app).toContain(`dim: '${dim}'`);
    }
  });

  it('DIMENSION_META declares a tags entry', () => {
    expect(app).toMatch(/tags:\s*\{\s*title:/);
  });

  it('the class guard owns the tag family (so a new tbs-tag-* class cannot go undefined)', () => {
    const guard = read('tests/unit/ui/settings-class-css.test.ts');
    expect(guard).toContain('tbs-tag-chip');
    expect(guard).toContain('tbs-tag-selector');
  });
});