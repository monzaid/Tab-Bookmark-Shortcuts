import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../helpers/strip-comments';

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
/**
 * The class families this guard owns: the settings surfaces' own prefix, plus
 * the field-row prefix introduced with the label │ value │ state layout.
 *
 * `tbs-field-` is here rather than left to a "visually obvious" convention
 * because it is exactly as invisible when undefined: the row would render as a
 * styleless run of spans, which is the layout bug the prefix was added to fix.
 */
const CLASS_TOKEN = /tbs-(?:settings__|field-|tag-chip|tag-selector|tag-picker|search-field)[a-zA-Z0-9_-]+/g;

/**
 * Classes assembled at runtime, so their full literal never appears in the
 * source. They must be listed here explicitly — an unlisted dynamic class is
 * exactly the case this guard cannot see.
 */
const DYNAMIC_CLASS_ALLOWLIST: readonly string[] = [
  // Assembled as `tbs-tag-selector__new--${layout}`, so the token the scanner can
  // see is the PREFIX. Both concrete members are defined in base.css
  // (`--stacked` / `--grid`); this entry only covers the un-satisfiable prefix.
  'tbs-tag-selector__new--',
];

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
 * How many tracks a `grid-template-columns` value declares.
 *
 * Counted by walking the string with a paren DEPTH counter rather than by
 * splitting on commas: `minmax(64px, 88px)` contains a comma that is NOT a
 * track separator, and a naive split counts one rule as two tracks. A regex
 * lookahead for "comma not inside parens" is possible but is exactly the kind of
 * pattern that reads as correct and silently miscounts — correcting it took a
 * failing test, so it is written as the loop it actually is.
 *
 * @param value the declaration's VALUE (no `grid-template-columns:` prefix)
 */
function countTracks(value: string): number {
  let depth = 0;
  let count = 0;
  let inToken = false;
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && /\s/.test(ch)) {
      inToken = false;
    } else if (!inToken) {
      inToken = true;
      count += 1;
    }
  }
  return count;
}

/**
 * Comments are stripped before matching. A `tbs-settings__foo` inside prose is
 * not a rendered class, so flagging it would be a false positive — the same
 * reason `layer-boundary.test.ts` strips comments. Over-stripping can only lose
 * matches inside comments and can never hide a real class usage.
 *
 * The stripper is the ONE shared, string-aware helper
 * (`tests/helpers/strip-comments.ts`), so this step has a single spelling.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every `.ts`/`.tsx` under `src/ui` that mentions one of the owned prefixes. */
function sourcesUsingPrefix(): string[] {
  // Matched with the SAME pattern the scan uses — derived from `CLASS_TOKEN`
  // rather than re-spelled. A second, hand-written list here would silently leave
  // a file that only uses a NEWLY-OWNED prefix out of the scan, and the guard
  // would then pass by not looking (which is exactly what happened when the tag
  // family was added: `MENTIONS` still named only the old two prefixes, so the
  // new classes were never scanned and a PLANTED undefined tag class did not
  // fail the suite). Deriving keeps the two in lockstep by construction.
  const MENTIONS = new RegExp(CLASS_TOKEN.source);
  return walk(UI_ROOT)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => MENTIONS.test(stripComments(readFileSync(f, 'utf8'))));
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
  it('defines every owned class the settings surfaces use', () => {
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

    const MUST_FLAG = [
      'tbs-settings__definitely-not-defined-xyz',
      // The field-row family is owned too: an undefined one is equally invisible.
      'tbs-field-definitely-not-defined-xyz',
      // Rule Tags iteration (T18): the chip and selector families joined the
      // guard, so the detector must flag an undefined member of EACH — otherwise
      // the new prefix would be scanned but never actually discriminated.
      'tbs-tag-chip-planted-xyz',
      'tbs-tag-selector-planted-xyz',
      // The picker family (import/export panels) joined too, for the same reason:
      // a new prefix that is scanned but never discriminated would pass vacuously.
      'tbs-tag-picker-planted-xyz',
      // ...and the search wrapper (the clear button's positioning context).
      'tbs-search-field-planted-xyz',
    ];
    const MUST_NOT_FLAG = [
      // The real tag-family classes ARE defined (proving the flagger is not
      // simply returning everything matching a new prefix).
      'tbs-tag-chip',
      'tbs-tag-chip__label',
      'tbs-tag-chip__remove',
      'tbs-tag-chip-input',
      'tbs-tag-chip-input__field',
      'tbs-tag-chip-input__candidates',
      'tbs-tag-selector',
      'tbs-tag-selector__list',
      'tbs-tag-selector__option',
      'tbs-tag-selector__swatch',
      'tbs-tag-picker',
      'tbs-tag-picker__option',
      'tbs-tag-picker__chip',
      'tbs-search-field',
      'tbs-search-field__clear',
      'tbs-shared-search',
      'tbs-field-row',
      'tbs-field-row__label',
      'tbs-field-row__value',
      'tbs-field-row__state',
      'tbs-settings__content',
      'tbs-settings__table',
      'tbs-settings__panel',
      'tbs-settings__card',
      'tbs-settings__card-head',
      'tbs-settings__import-diff',
      'tbs-settings__import-records',
      'tbs-settings__commit',
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

describe('search boxes keep the keyboard focus ring', () => {
  const searchBlocks = (): string => {
    const css = stylesheets();
    // Every rule whose selector mentions the search input, comments stripped: a
    // selector quoted in prose is not a rule.
    return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*\.tbs-shared-search[^{}]*)\{([^}]*)\}/g)]
      .map((m) => `${m[1]}{${m[2]}}`)
      .join('\n');
  };

  /**
   * The defect this pins: `:focus { outline: none }` was added to refine the MOUSE
   * state (a border colour change), and because the global ring is drawn with
   * `outline`, that one declaration also removed the ring for KEYBOARD users — a
   * keyboard user tabbing into any search box saw only a 1px border shift. The
   * accessibility rules require a visible ring, so the mouse rule must not be the
   * only focus rule.
   */
  it('re-asserts a focus-visible outline (the mouse-focus rule alone is not enough)', () => {
    const blocks = searchBlocks();
    // The ring is present and uses the shared ring token...
    expect(blocks).toMatch(/\.tbs-shared-search:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-focus-ring\)/);
    // ...and it is NOT cancelled by a later `outline: none` on the same selector.
    const focusRules = [...blocks.matchAll(/\.tbs-shared-search:(focus|focus-visible)\s*\{([^}]*)\}/g)];
    expect(focusRules.length).toBeGreaterThanOrEqual(2);
    const suppressors = focusRules.filter(([, , body]) => /outline:\s*(none|0)/.test(body));
    expect(suppressors, 'a bare `:focus` must not cancel the ring').toEqual([]);
  });

  it('hides the native clear decoration (ours replaces it, uniformly)', () => {
    // Otherwise two clear affordances can appear at once — the browser's ✕ and
    // ours — and WebKit's is unstyled while Firefox draws none.
    expect(searchBlocks()).toMatch(/-webkit-search-cancel-button/);
  });

  it('does NOT set a per-site font size on the search input', () => {
    // The drift that motivated the component: the candidate tray shrank its box to
    // 12px while every other box was 13px. One box, one size — and the wrapping
    // surface may not override it.
    const css = stylesheets();
    const candidate = /\.tbs-tag-chip-input__candidate-search[^{]*\{([^}]*)\}/.exec(css);
    if (candidate !== null) {
      expect(candidate[1]).not.toMatch(/font-size/);
    }
    // The input itself takes the app's input size.
    expect(searchBlocks()).toMatch(/\.tbs-shared-search\s*\{[^}]*font-size:\s*var\(--font-size-md\)/);
  });
});

describe('the search wrapper does not add space of its own', () => {
  const css = (): string => stylesheets().replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * The defect this pins: the wrapper carried `flex: 1 1 160px` to size the INPUT
   * inside a horizontal toolbar. `flex-basis` is a MAIN-AXIS length, so inside the
   * candidate tray's COLUMN container the same declaration became a 160px HEIGHT —
   * a large gap above and below that one search box, and nowhere else.
   *
   * A basis is only meaningful when the container's axis is known, so the rule is:
   * the DEFAULT must not carry one, and only the row-oriented toolbars may add it.
   */
  it('the default wrapper declares no flex-basis', () => {
    const block = /(?:^|\})\s*\.tbs-search-field\s*\{([^}]*)\}/.exec(css());
    expect(block).not.toBeNull();
    const body = block?.[1] ?? '';
    expect(body).toMatch(/display:\s*flex/);
    // No LENGTH basis in any spelling (`flex: 1 1 160px`, `flex-basis: 160px`).
    // Narrowed to a length unit on purpose: `flex: 1 1 auto` legitimately contains
    // digits (grow/shrink), and an assertion that banned them would red on the very
    // form this is here to protect.
    expect(body).not.toMatch(/flex(-basis)?\s*:\s*[^;]*(?:px|rem|em|%|vw|vh|ch|pt)/);
  });

  it('the column container clears it explicitly', () => {
    // Belt and braces: the tray's section is the container that broke, so its own
    // rule states that the wrapper takes no main-axis space. Written as an explicit
    // override rather than relying on the default, because a future toolbar-centred
    // default must not be able to reintroduce the gap here.
    const block = /\.tbs-tag-chip-input__tray-section\s*>\s*\.tbs-search-field\s*\{([^}]*)\}/.exec(css());
    expect(block, 'the tray section must state the wrapper takes no height').not.toBeNull();
    expect(block?.[1] ?? '').toMatch(/flex:\s*0\s+0\s+auto/);
  });

  it('a wrapper carries no vertical spacing of its own', () => {
    // The gap was not padding — it was the basis — but a padding/margin on the
    // wrapper would produce the same visible symptom, so both are excluded.
    const body = /(?:^|\})\s*\.tbs-search-field\s*\{([^}]*)\}/.exec(css())?.[1] ?? '';
    expect(body).not.toMatch(/(?:^|;)\s*margin(?:-top|-bottom)?\s*:/);
    expect(body).not.toMatch(/(?:^|;)\s*padding(?:-top|-bottom)?\s*:/);
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

describe('the tag system has ONE source for its shared numbers', () => {
  /**
   * The default appearance and the list display limit are each a fact about the tag
   * TABLE, so they belong to the shared layer — and the UI forms had literal copies.
   * `#6B7280` / `#FFFFFF` appeared in four places and `10` in two, which is how "the
   * default" comes to mean two different greys, or one list shows twelve tags and
   * another ten while both claim the same judgement.
   */
  const uiSources = (): string => {
    const files = walk(UI_ROOT).filter((f) => /\.tsx?$/.test(f));
    return files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  };

  it('no UI file hardcodes the default tag appearance', () => {
    const src = uiSources();
    // Scoped to the DEFAULT GREY, which is the value that identifies this pair.
    // `#FFFFFF` is deliberately NOT asserted on: it is also a legitimate palette
    // entry (`PRESET_TEXT_COLORS`) and the auto-contrast result, so banning it
    // everywhere would forbid those — a guard that fails on correct code is a
    // change detector, not an invariant. The pair travels together through
    // `DEFAULT_TAG_APPEARANCE`, so asserting the grey is enough to prove it.
    expect(src).not.toContain('#6B7280');
    // ...and the definition really is reachable from the shared layer, so the
    // assertion above cannot pass by the value having moved somewhere unusable.
    const shared = readFileSync(resolve(process.cwd(), 'src/shared/export-package.ts'), 'utf8');
    expect(shared).toContain('DEFAULT_TAG_BACKGROUND');
    expect(shared).toContain('DEFAULT_TAG_APPEARANCE');
  });

  it('both tag pickers take their display limit from the shared constant', () => {
    // A private `= 10` in either file is the drift this guards: two numbers claiming
    // to be "the point where this table becomes a wall".
    for (const rel of ['src/ui/shared/tag-selector.tsx', 'src/ui/shared/tag-chip-input.tsx']) {
      const src = stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));
      expect(src, `${rel} must not define its own limit`).not.toMatch(/=\s*10\s*;/);
      expect(src, `${rel} must import the shared limit`).toContain('TAG_LIST_DISPLAY_LIMIT');
    }
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

  /**
   * The fields are laid out as label │ value │ state COLUMNS rather than one
   * run-on line per field. jsdom cannot verify the rendering, so this asserts
   * the STRUCTURE that makes it hold: a grid row with exactly three tracks, the
   * value being the one that wraps, and the state carrying its own word (never
   * colour alone — same rule as `StatusBadge`).
   */
  it('lays a field out as a three-track grid, not a sentence', () => {
    const row = block(/\.tbs-field-row\s*\{([^}]*)\}/);
    expect(row).not.toBe('');
    expect(row).toMatch(/display:\s*grid\b/);
    // Three explicit tracks. Counted from the declaration rather than by
    // matching a literal track list: the sizes are free to change (that is
    // styling), the NUMBER of columns is the invariant.
    const tracks = /grid-template-columns:([^;]*)/.exec(row)?.[1] ?? '';
    expect(tracks).not.toBe('');
    expect(countTracks(tracks)).toBe(3);

    // The label column must not shrink to nothing: a squashed label is how the
    // "labels line up" property silently dies on a narrow pane.
    expect(tracks).toMatch(/minmax\(\s*\d+px/);

    // The VALUE track is the only flexible one, so it is the one that wraps.
    const value = block(/\.tbs-field-row__value\s*\{([^}]*)\}/);
    expect(value).not.toBe('');
    expect(value).toMatch(/min-width:\s*0\b/);
    expect(value).toMatch(/overflow-wrap:\s*anywhere|word-break:\s*break-word/);

    // The state word is text, so colour is a second channel rather than the only
    // one. Asserting the rule exists is what keeps a future tint from dropping
    // the word (WCAG: never colour alone).
    const state = block(/\.tbs-field-row__state\s*\{([^}]*)\}/);
    expect(state).not.toBe('');
    expect(state).toMatch(/font-size:/);
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