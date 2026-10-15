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

/**
 * The stylesheets each ENTRY POINT actually loads, read from its own import list.
 *
 * This is the dimension the coverage scan above cannot see: that scan concatenates
 * every stylesheet under `src/ui/styles/`, so a class defined in `settings.css`
 * "has a definition" even when the entry point rendering it never loads that file.
 * That is exactly how the sidebar's New-Rule modal shipped with an entirely
 * unstyled tag control: the classes were defined, just not anywhere the modal could
 * reach. Derived from the imports rather than hard-coded, so a new import is
 * reflected without editing the test.
 */
const UI_ROOT = resolve(process.cwd(), 'src/ui');
const STYLES = resolve(process.cwd(), 'src/ui/styles');

function entryStylesheets(entrySource: string): string[] {
  return [...entrySource.matchAll(/import\s+'(?:@ui\/styles|\.\.?\/styles)\/([a-z0-9-]+)\.css'/g)]
    .map((m) => join(STYLES, `${m[1]}.css`));
}
function entrySource(rel: string): string {
  return readFileSync(join(UI_ROOT, rel), 'utf-8');
}
/** Every stylesheet an entry point can reach, including its `@import` chain. */
function reachableCss(rel: string): string {
  const queue = entryStylesheets(entrySource(rel));
  const seen = new Set<string>();
  let out = '';
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf-8');
    out += text;
    for (const m of text.matchAll(/@import\s+'(?:\.\/)?([a-z0-9-]+)\.css'/g)) {
      queue.push(join(STYLES, `${m[1]}.css`));
    }
  }
  return out;
}

/** A class is defined by a rule whose selector contains it. */
function defines(css: string, cls: string): boolean {
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

  /**
   * Reachability, not just existence.
   *
   * The scan above proves every class HAS a definition somewhere; this proves the
   * entry points that RENDER the affected components can actually load one. The
   * dependency graph is declared here (rather than inferred by walking imports)
   * because it is a REVIEW fact: "which entry points render this component" is the
   * claim being verified, and inferring it would let a new consumer be added
   * without the graph being updated.
   */
  it('should style every shared component in EVERY entry point that renders it', () => {
    const CONSUMERS: Array<{
      /** The file whose CSS IMPORTS define what this surface can load. */
      entry: string;
      /** The file that renders the components (may differ from `entry`). */
      surface: string;
      /** Import specifiers the surface must mention, for the claim to be live. */
      renders: string[];
      classes: string[];
    }> = [
      {
        // The New Global Page Rule modal renders the shared field set, so the tag
        // control and the look-up field must be reachable from the SIDEBAR's own
        // stylesheets — the settings page loading them proves nothing for it.
        entry: 'sidebar/App.tsx',
        surface: 'sidebar/App.tsx',
        renders: ['@ui/shared/rule-form-fields', '@ui/shared/tag-selector'],
        classes: [
          'tbs-tag-selector',
          'tbs-tag-selector__list',
          'tbs-tag-selector__option',
          'tbs-tag-selector__selected',
          'tbs-tag-selector__pill',
          'tbs-tag-selector__chip',
          'tbs-tag-selector__new',
          'tbs-shared-search',
        ],
      },
      {
        // The settings entry point is `main.tsx` (it is what imports the
        // stylesheets); the surface that renders the control is `App.tsx`.
        entry: 'settings/main.tsx',
        surface: 'settings/App.tsx',
        renders: ['@ui/shared/rule-form-fields', '@ui/shared/tag-selector'],
        classes: ['tbs-tag-selector', 'tbs-shared-search', 'tbs-form-error'],
      },
    ];

    const failures: string[] = [];
    for (const c of CONSUMERS) {
      const reachable = reachableCss(c.entry);
      // The declared consumer must actually import the component: a stale entry in
      // this table would otherwise assert reachability for a surface that no longer
      // uses the control (a guard passing by not looking).
      const surfaceText = entrySource(c.surface);
      const rendersAtLeastOne = c.renders.some((spec) => surfaceText.includes(spec));
      if (!rendersAtLeastOne) failures.push(`${c.surface} declares consumers it does not import`);
      for (const cls of c.classes) {
        if (!defines(reachable, cls)) failures.push(`${c.entry} cannot reach a rule for .${cls}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the reachability guard can FAIL (a settings-only class is not reachable from the sidebar)', () => {
    // The case table: proves the check above discriminates rather than passing
    // because everything is reachable. `tbs-settings__panel` is defined — in
    // settings.css — and the sidebar does not load that file.
    const sidebar = reachableCss('sidebar/App.tsx');
    expect(defines(readAllCss(), 'tbs-settings__panel')).toBe(true);
    expect(defines(sidebar, 'tbs-settings__panel')).toBe(false);
    // ...and base.css IS reachable, so the check is not simply returning nothing.
    expect(defines(sidebar, 'tbs-form-field')).toBe(true);
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