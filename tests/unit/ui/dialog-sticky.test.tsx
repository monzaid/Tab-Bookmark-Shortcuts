/**
 * T12 — dialog header/footer stickiness (IMP-2) + dead `--tbs-*` layer removal (②N2).
 *
 * A CSS-reading test (same style as slot-action-button-sizing.test.tsx): the
 * assertions describe the stylesheet contract rather than a rendered layout,
 * because jsdom has no layout engine.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

describe('T12: dialog header/footer are sticky inside the scrolling dialog', () => {
  const css = readFileSync(resolve(root, 'src/ui/styles/base.css'), 'utf8');

  function ruleFor(selector: string): string {
    const idx = css.indexOf(selector);
    expect(idx).toBeGreaterThan(-1);
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  it('the dialog itself is the scroll container', () => {
    const rule = ruleFor('.tbs-dialog {');
    expect(rule).toContain('overflow-y: auto');
  });

  it('the header is sticky to the top with an opaque background', () => {
    const rule = ruleFor('.tbs-dialog__header {');
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('top: 0');
    expect(rule).toContain('var(--color-bg)');
  });

  it('the footer is sticky to the bottom with an opaque background', () => {
    const rule = ruleFor('.tbs-dialog__footer {');
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('bottom: 0');
    expect(rule).toContain('var(--color-bg)');
  });

  it('uses no !important', () => {
    expect(css).not.toContain('!important');
  });
});

describe('T12: the dead --tbs-* style layer is gone', () => {
  it('src/ui/shared/global.css no longer exists (zero imports)', () => {
    expect(existsSync(resolve(root, 'src/ui/shared/global.css'))).toBe(false);
  });

  it('src/ui/sidebar/sidebar.css no longer exists (zero imports)', () => {
    expect(existsSync(resolve(root, 'src/ui/sidebar/sidebar.css'))).toBe(false);
  });

  it('the LIVE stylesheet src/ui/styles/sidebar.css is untouched', () => {
    expect(existsSync(resolve(root, 'src/ui/styles/sidebar.css'))).toBe(true);
  });

  it('the token stylesheet remains the single source', () => {
    expect(existsSync(resolve(root, 'src/ui/styles/tokens.css'))).toBe(true);
  });
});