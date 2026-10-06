import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `tbs-settings__*` class the settings surfaces render must be defined in
 * one of the stylesheets. A class that is spelled in JSX but defined nowhere is
 * invisible: it reads as "styled" to the author and renders as nothing, and no
 * type/compiler check can see it. This is the table, not the memory.
 *
 * Scope note: the prefix is NOT owned by `App.tsx` alone. Four source files use
 * it (App, MatchSettingsHelp, inline-editor-shell, use-jump-to-row), so the scan
 * is a recursive walk of `src/ui` — a hard-coded file list would go stale and the
 * guard would silently claim coverage it no longer has.
 */
const UI_ROOT = resolve(process.cwd(), 'src/ui');
const CSS_DIR = resolve(process.cwd(), 'src/ui/styles');
const CLASS_TOKEN = /tbs-settings__[a-zA-Z0-9_-]+/g;

/**
 * Classes assembled at runtime, so their full literal never appears in the
 * source. They must be listed here explicitly — an unlisted dynamic class is
 * exactly the case this guard cannot see.
 */
const DYNAMIC_CLASS_ALLOWLIST: readonly string[] = [];

/**
 * "Make this flex child fill the row" — asserted as the PROPERTY FAMILY, not one
 * spelling, because `flex-basis:100%`, `flex:1 1 100%` and `width:100%` are all
 * correct and naming one would red on a valid rewrite (a change detector).
 *
 * The leading `(?<![\w-])` is load-bearing, not decoration: without it the
 * `width:100%` alternative also matches inside `min-width:100%` / `max-width:100%`,
 * so a rule that does NOT fill the row would satisfy the assertion — a guard that
 * cannot fail (the very shape this iteration keeps catching). Trailing `\b` is
 * deliberately absent on the `flex-basis:`/`width:` alternatives: `100%` ends in
 * `%`, after which a word boundary does not exist.
 */
const FULL_WIDTH = /(?<![\w-])(?:flex-basis:\s*100%|flex\s*:[^;]*\b100%|width:\s*100%)/;

/**
 * Comments are stripped before matching. A `tbs-settings__foo` inside prose is
 * not a rendered class, so flagging it would be a false positive — the same
 * reason `layer-boundary.test.ts` strips comments. Over-stripping can only lose
 * matches inside comments and can never hide a real class usage.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every `.ts`/`.tsx` under `src/ui` that mentions the class prefix. */
function sourcesUsingPrefix(): string[] {
  return walk(UI_ROOT)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => stripComments(readFileSync(f, 'utf8')).includes('tbs-settings__'));
}

function stylesheets(): string {
  return readdirSync(CSS_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(CSS_DIR, f), 'utf8'))
    .join('\n');
}

/**
 * Classes used in `source` that no stylesheet defines. Comments are stripped on
 * BOTH sides: a mention in prose is not a usage, and — just as importantly — a
 * selector written inside a CSS comment is not a DEFINITION. Stripping only the
 * source would let a commented-out selector satisfy a class that no rule styles.
 */
function undefinedClasses(source: string, css: string): string[] {
  const used = new Set([...stripComments(source).matchAll(CLASS_TOKEN)].map((m) => m[0]));
  const defined = stripComments(css);
  return [...used].filter((c) => {
    if (DYNAMIC_CLASS_ALLOWLIST.includes(c)) return false;
    // The trailing guard keeps `__import-dim` from being satisfied by
    // `__import-dim-something`; a class is defined only by its OWN selector.
    return !new RegExp(`${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_-])`).test(defined);
  });
}

/** Is the import zone styled as a drop target (the dashed-box idiom)? */
function importZoneIsDropCue(css: string): boolean {
  const block = /\.tbs-settings__import-zone[^{]*\{([^}]*)\}/.exec(css);
  return block !== null && /dashed/.test(block[1]);
}

describe('settings classes ↔ stylesheets', () => {
  it('defines every tbs-settings__ class the settings surfaces use', () => {
    const cssFiles = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
    // Non-empty: a renamed directory or a wrong root would otherwise make the
    // offender scan vacuously pass ("found nothing" in "looked nowhere").
    expect(cssFiles.length).toBeGreaterThan(0);

    const css = stylesheets();
    expect(css.length).toBeGreaterThan(0);

    // Two separate non-emptiness checks, and neither is a COUNT:
    //  (1) the walk found files at all — a broken UI_ROOT or a wrong prefix would
    //      otherwise scan nothing and pass vacuously;
    //  (2) it found at least one USER — the scan must be looking at real input.
    // Deliberately NOT `>= N`: the current number of users is not a fact the guard
    // may depend on. Merging two files, or a file legitimately ceasing to use the
    // prefix, would turn a bare count into a false failure — the same "unmoored
    // count" this iteration keeps catching. Scope is guaranteed STRUCTURALLY (the
    // walk covers every .ts/.tsx under src/ui, so a user cannot be out of range),
    // so presence is all this needs to assert.
    const scanned = walk(UI_ROOT).filter((f) => /\.tsx?$/.test(f));
    expect(scanned.length).toBeGreaterThan(0);

    const sources = sourcesUsingPrefix();
    expect(sources.length).toBeGreaterThanOrEqual(1);

    const offenders = sources.flatMap((f) => undefinedClasses(readFileSync(f, 'utf8'), css));
    expect(offenders).toEqual([]);
  });

  /**
   * The scan above only proves "the surfaces are clean right now". This case
   * table proves the DETECTOR can discriminate — otherwise the guard could be
   * vacuous — and that stripping comments does not hide real usages.
   */
  it('flags an undefined class and accepts defined ones (case table)', () => {
    const css = stylesheets();

    const MUST_FLAG = ['tbs-settings__definitely-not-defined-xyz'];
    const MUST_NOT_FLAG = [
      'tbs-settings__content',
      'tbs-settings__table',
      'tbs-settings__import-diff',
      'tbs-settings__import-dim',
      'tbs-settings__import-records',
      'tbs-settings__import-actions',
      'tbs-settings__result-shortcut',
      'tbs-settings__batch-bar',
      'tbs-settings__toggle',
      'tbs-settings__summary',
      'tbs-settings__loading',
      'tbs-settings__error',
      // Prose must NOT be read as a usage (comments are stripped).
      '// see tbs-settings__planted-in-a-comment for details',
      '/* tbs-settings__planted-in-a-block-comment */',
    ];

    for (const c of MUST_FLAG) expect(undefinedClasses(c, css), `MUST_FLAG: ${c}`).toEqual([c]);
    for (const c of MUST_NOT_FLAG) expect(undefinedClasses(c, css), `MUST_NOT_FLAG: ${c}`).toEqual([]);

    // A class only "defined" inside a CSS comment is NOT defined: the source
    // strips comments, so the stylesheet must strip them too, or a commented-out
    // selector would read as a definition and the class would render unstyled.
    const commented = `/* .tbs-settings__commented-out-only { color: red; } */\n`;
    expect(undefinedClasses('tbs-settings__commented-out-only', commented)).toEqual([
      'tbs-settings__commented-out-only',
    ]);
  });
});

describe('affordance matches behaviour', () => {
  /**
   * A dashed, centred box is the universal "drop a file here" idiom. Styling the
   * import zone that way without any `onDrop` handler promises an interaction
   * that does not exist — the user drags, nothing happens, and they must go find
   * the button. The rule: a drop-target LOOK requires a drop HANDLER.
   */
  it('does not style the import zone as a drop target unless a drop handler exists', () => {
    const dropCue = importZoneIsDropCue(stylesheets());
    // The handler is looked for in EVERY source under src/ui, not just App.tsx:
    // reading one file would make the guard silently blind if the import zone is
    // ever moved — the same "scope narrower than the claim" bug this file already
    // fixed for the class scan.
    const hasDropHandler = walk(UI_ROOT)
      .filter((f) => /\.tsx?$/.test(f))
      .some((f) => /onDrop|onDragOver/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(dropCue && !hasDropHandler).toBe(false);
  });
});

describe('import fields expansion', () => {
  /**
   * Comments are stripped on the CSS side too: a selector quoted in prose is not
   * a rule (the same reason the class scan strips both sides).
   */
  const css = () => stripComments(stylesheets());
  const block = (pattern: RegExp): string => pattern.exec(css())?.[1] ?? '';

  /**
   * The Fields `<details>` is the 5th flex child of a record row
   * (`li { display:flex; flex-wrap:wrap; align-items:center }`). With no basis it
   * shared the line, so expanding it changed its own width and re-wrapped the
   * row; with no min-width/overflow-wrap a long field value overflows instead of
   * wrapping. jsdom has no layout engine, so this asserts the STRUCTURE that
   * makes the fix hold (cf. `sidebar-source-hover.test.tsx`).
   */
  it('gives the Fields panel its own full-width row and lets long values wrap', () => {
    // The PROPERTY FAMILY, not one spelling: a full-width flex child may be
    // written `flex-basis:100%`, `flex:1 1 100%` or `width:100%`, and an
    // assertion that named only one would red on a correct rewrite (a change
    // detector, not an invariant guard). What must hold is the EFFECT.
    const panel = block(/\.tbs-settings__import-fields\s*\{([^}]*)\}/);
    expect(panel).not.toBe('');
    expect(panel).toMatch(FULL_WIDTH);
    expect(panel).toMatch(/min-width:\s*0\b/);

    const list = block(/\.tbs-settings__import-fields\s+ul\s*\{([^}]*)\}/);
    expect(list).not.toBe('');
    expect(list).toMatch(/min-width:\s*0\b/);
    expect(list).toMatch(/overflow-wrap:\s*anywhere|word-break:\s*break-word/);
  });

  it('the full-width pattern accepts every spelling and is not fooled by min/max-width', () => {
    // A case table for the pattern itself. Without it, dropping the lookbehind
    // would leave the guard passing on rules that do NOT fill the row
    // (`min-width:100%`), i.e. a guard that cannot fail. Each row is a claim
    // about the pattern, not about the stylesheet.
    for (const ok of ['flex-basis:100%', 'flex: 1 1 100%', 'width:100%']) {
      expect(FULL_WIDTH.test(ok), `should match: ${ok}`).toBe(true);
    }
    // The whole `*-width` family, not just the two spellings that were found by
    // hand: the lookbehind rejects the CLASS, so this is a spec, not a patch.
    for (const no of [
      'min-width:100%',
      'max-width:100%',
      'padding:0; min-width:100%',
      'min-width:0',
      'border-width:100%',
      'outline-width:100%',
      'column-width:100%',
      'max-inline-size:100%',
    ]) {
      expect(FULL_WIDTH.test(no), `should NOT match: ${no}`).toBe(false);
    }
  });

  it('documents what the full-width pattern does NOT claim to cover', () => {
    // KNOWN LIMITS — the pattern matches TEXT, not the CSS property model.
    //   GROUP A — legal spellings it does NOT match (a rewrite could add them):
    //     - `inline-size:100%`   the logical equivalent of `width`
    //     - `width : 100%`       a space before the colon
    //   GROUP B — a legal spelling it DOES match, differing from the canonical
    //     `flex:1 1 100%` in ONE dimension: `flex-grow` (0 vs 1). Both permit
    //     shrinking (`flex-shrink:1`), and in this row neither grows — the panel
    //     already owns its line — so the two spellings look identical here:
    //     - `flex:0 1 100%`
    // Both groups are pinned as checked facts, so a later change to the pattern
    // confronts the limit instead of silently "fixing" it by accident.
    // RED HERE IS NOT NECESSARILY A REGRESSION: tightening the pattern (e.g. to
    // reject `flex:0 1 100%`, or to accept `inline-size`) is a legitimate
    // improvement and will turn this case red on purpose. Update the row that
    // stopped holding — do not read it as a behaviour change in the stylesheet.
    // Each row carries WHY it holds, so a red names the limit that moved —
    // a bare `expected true to be false` would not say which behaviour changed.
    expect(FULL_WIDTH.test('inline-size: 100%'), 'the logical equivalent of width is not matched').toBe(false);
    expect(FULL_WIDTH.test('width : 100%'), 'a space before the colon is not matched').toBe(false);
    expect(FULL_WIDTH.test('flex:0 1 100%'), 'canonical form differs only in flex-grow (0 vs 1)').toBe(true);
  });

  it('does not tint the record status as plain text (the status is a badge now)', () => {
    // `> li > span:nth-child(2)` was written to colour a plain-text status; the
    // status is a StatusBadge now, so the rule (specificity 0,2,1) would override
    // the badge's own colour — the very thing the badge exists to express.
    expect(css()).not.toMatch(
      /\.tbs-settings__import-records\s*>\s*li\s*>\s*span:nth-child\(2\)/,
    );
  });
});