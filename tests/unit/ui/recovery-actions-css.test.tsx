/**
 * ACC#1b regression: recovery action buttons must not let their labels overflow.
 *
 * `Switch to Previous Match` / `Switch to Next Match` are long labels. The base
 * `.tbs-btn` sets `white-space: nowrap`, so a flex item's automatic min-width
 * (= min-content = the full label width) is what keeps the text inside the box.
 * The recovery action rule previously overrode that with `min-width: 90px`,
 * which let the buttons shrink below their label width and clipped/overflowed
 * the text.
 *
 * Enforced by parsing the CSS source (jsdom does not apply external style
 * sheets), mirroring `slot-action-button-sizing.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CssRule {
  selector: string;
  body: string;
}

function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    rules.push({ selector: match[1].trim(), body: match[2].trim() });
  }
  return rules;
}

function findRule(css: string, pred: (rule: CssRule) => boolean): CssRule {
  const rule = parseRules(css).find(pred);
  if (!rule) throw new Error('Expected CSS rule not found');
  return rule;
}

function declValue(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
}

const RECOVERY_CSS = readFileSync(resolve(process.cwd(), 'src/ui/styles/recovery.css'), 'utf8');
const BASE_CSS = readFileSync(resolve(process.cwd(), 'src/ui/styles/base.css'), 'utf8');

describe('ACC#1b: recovery action buttons never overflow their labels', () => {
  it('the actions container wraps so long labels move to their own row', () => {
    const actions = findRule(RECOVERY_CSS, (r) => r.selector === '.tbs-recovery__actions');
    expect(declValue(actions.body, 'flex-wrap')).toBe('wrap');
  });

  it('the button rule does NOT pin a min-width below the label width', () => {
    const btnRule = findRule(
      RECOVERY_CSS,
      (r) => r.selector.includes('tbs-recovery__actions') && r.selector.includes('tbs-btn'),
    );
    const minWidth = declValue(btnRule.body, 'min-width');
    // No fixed small floor: either unset (⇒ automatic min-content protection) or
    // explicitly `auto`. A pixel min-width lets the box shrink under the label.
    expect(minWidth === null || minWidth === 'auto').toBe(true);
  });

  it('the button rule sizes to its content (auto flex-basis), not `0%`', () => {
    const btnRule = findRule(
      RECOVERY_CSS,
      (r) => r.selector.includes('tbs-recovery__actions') && r.selector.includes('tbs-btn'),
    );
    expect(declValue(btnRule.body, 'flex')).toBe('1 1 auto');
  });

  it('base button keeps its single-line label treatment (nowrap stays intact)', () => {
    const btn = findRule(BASE_CSS, (r) => r.selector.trim().endsWith('.tbs-btn'));
    expect(declValue(btn.body, 'white-space')).toBe('nowrap');
  });
});