/**
 * Style-coverage guard for the shared component chain.
 *
 * The manual acceptance review found that `RuleFormFields`, `FieldEditor`,
 * `RadioGroup` and `EmptyState` shipped with class names that had **no CSS
 * definition at all** — the UI rendered unstyled. Logic tests passed because
 * none of them looked at the stylesheets.
 *
 * This guard closes that gap: every `tbs-*` class name used by the shared
 * component chain (and by the dashboard markers) must be defined somewhere
 * under `src/ui/styles/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STYLE_DIR = resolve(process.cwd(), 'src/ui/styles');
const SHARED_DIR = resolve(process.cwd(), 'src/ui/shared');

/** Read every stylesheet once and concatenate (comments included is fine). */
function readAllCss(): string {
  return readdirSync(STYLE_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(STYLE_DIR, f), 'utf-8'))
    .join('\n');
}

/** Collect every `tbs-...` token that appears in a source file's JSX/strings. */
function collectClassTokens(source: string): Set<string> {
  const tokens = new Set<string>();
  // Matches class names inside className="..." / template literals.
  for (const match of source.matchAll(/tbs-[a-z0-9-]+/g)) {
    tokens.add(match[0]);
  }
  return tokens;
}

/** A class is "defined" when it appears as a selector (optionally with a modifier). */
function isDefined(css: string, cls: string): boolean {
  return css.includes(`.${cls}`);
}

describe('shared component chain — every used class has a CSS definition', () => {
  const css = readAllCss();

  const files = readdirSync(SHARED_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ name: f, path: join(SHARED_DIR, f) }));

  it('should find the shared component sources', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('should define every tbs-* class used by src/ui/shared components', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file.path, 'utf-8');
      for (const cls of collectClassTokens(source)) {
        // `tbs-inline-field__reset` etc. are matched by the base name check.
        if (!isDefined(css, cls)) {
          missing.push(`${file.name} -> .${cls}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('should define the dashboard marker classes used by settings/App.tsx', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/ui/settings/App.tsx'), 'utf-8');
    const required = [
      'tbs-settings__chain-badge',
      'tbs-settings__anchor-badge',
      'tbs-settings__delivery',
      'tbs-settings__row--disabled',
      // Review round 4: the post-write cue reuses the jump-to-row highlight.
      'tbs-settings__row--jump',
    ];
    const missing = required.filter((cls) => !isDefined(css, cls));
    expect(missing).toEqual([]);
    // Sanity: the tokens really are used by the settings surface. The last one is
    // applied through the shared constant, so it is referenced, not spelled out.
    for (const cls of required.filter((c) => c !== 'tbs-settings__row--jump')) {
      expect(source.includes(cls)).toBe(true);
    }
    expect(source.includes('JUMP_HIGHLIGHT_CLASS')).toBe(true);
  });

  it('should pair the Dashboard Edit fields in two grid tracks that collapse when narrow', () => {
    // The Dashboard's Edit panel and `RuleFormFields`' own pair must agree: two
    // tracks when there is room, one when the panel is narrow. A plain
    // `1fr 1fr` (the old rule) would squeeze both editors on a 288px sidebar.
    expect(css).toMatch(/\.tbs-settings__rule-form-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*559px\)\s*\{[^}]*\.tbs-settings__rule-form-grid/);
  });

  it('should keep the sidebar source popover free of a separate trigger element', () => {
    // Review round 4 removed the dot trigger; the popover is opened by hovering
    // the value itself. A leftover rule for the old element would mean the CSS
    // and the markup disagree about what the hover target is.
    expect(css.includes('.tbs-source-hover__trigger')).toBe(false);
  });

  it('should place the source popover outside the sidebar stacking/clipping context', () => {
    // Review round 6: as an in-flow child the popover was clipped by the
    // sidebar's `overflow: hidden` / scroll containers and painted under the
    // sticky header. It is portalled to `<body>` now, so it must be `fixed` with
    // a z-index above every sidebar layer (menus are 200, modals 500).
    expect(css).toMatch(/\.tbs-source-popover\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.tbs-source-popover\s*\{[^}]*z-index:\s*2147483000/);
    // The old in-flow, hover-driven rules must be gone, since they cannot reach
    // a node that lives outside the wrapper's subtree.
    expect(css).not.toMatch(/\.tbs-source-hover__popover/);
  });
});