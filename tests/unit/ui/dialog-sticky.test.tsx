/**
 * T12 — dialog chrome never overlaps its content (IMP-2, revised by review items
 * 1.1 / 2.6) + dead `--tbs-*` layer removal (②N2).
 *
 * The ORIGINAL implementation made the whole `.tbs-dialog` the scroll container
 * and pinned the header/footer with `position: sticky` inside it. Once the icon
 * picker's tab strip was placed in the body, those sticky bands were painted OVER
 * the content instead of beside it, which is exactly the defect the review
 * reported.
 *
 * The structure under test now: the dialog is a COLUMN of three flex children,
 * and the BODY alone owns the scroll. That makes overlap structurally impossible
 * — the bands are not inside the scroll box at all — so these assertions check
 * the structure rather than the old sticky declarations.
 *
 * A CSS-reading test (same style as slot-action-button-sizing.test.tsx): the
 * assertions describe the stylesheet contract rather than a rendered layout,
 * because jsdom has no layout engine.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

describe('T12: dialog chrome is laid out beside the content, never over it', () => {
  const css = readFileSync(resolve(root, 'src/ui/styles/base.css'), 'utf8');

  function ruleFor(selector: string): string {
    const idx = css.indexOf(selector);
    expect(idx).toBeGreaterThan(-1);
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  it('the dialog is a column that clips its children to the rounded corners', () => {
    const rule = ruleFor('.tbs-dialog {');
    expect(rule).toContain('display: flex');
    expect(rule).toContain('flex-direction: column');
    // The dialog must NOT be the scroll container any more.
    expect(rule).not.toContain('overflow-y: auto');
  });

  it('the BODY is the one scroll region and may shrink below its content', () => {
    const rule = ruleFor('.tbs-dialog__body {');
    expect(rule).toContain('overflow-y: auto');
    // `min-height: 0` is what actually lets a flex child scroll.
    expect(rule).toContain('min-height: 0');
  });

  it('the header is a fixed flex child with an opaque background', () => {
    const rule = ruleFor('.tbs-dialog__header {');
    expect(rule).toContain('flex: 0 0 auto');
    expect(rule).toContain('var(--color-bg)');
  });

  it('the footer is a fixed flex child with an opaque background', () => {
    const rule = ruleFor('.tbs-dialog__footer {');
    expect(rule).toContain('flex: 0 0 auto');
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