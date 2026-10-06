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
const APP = resolve(UI_ROOT, 'settings/App.tsx');
const CLASS_TOKEN = /tbs-settings__[a-zA-Z0-9_-]+/g;

/**
 * Classes assembled at runtime, so their full literal never appears in the
 * source. They must be listed here explicitly — an unlisted dynamic class is
 * exactly the case this guard cannot see.
 */
const DYNAMIC_CLASS_ALLOWLIST: readonly string[] = [];

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

/** Classes used in `source` that no stylesheet defines. */
function undefinedClasses(source: string, css: string): string[] {
  const used = new Set([...stripComments(source).matchAll(CLASS_TOKEN)].map((m) => m[0]));
  return [...used].filter((c) => {
    if (DYNAMIC_CLASS_ALLOWLIST.includes(c)) return false;
    // The trailing guard keeps `__import-dim` from being satisfied by
    // `__import-dim-something`; a class is defined only by its OWN selector.
    return !new RegExp(`${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_-])`).test(css);
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

    // Scope non-emptiness: a wrong UI_ROOT, a broken walk, or a changed prefix
    // would otherwise scan nothing and pass. Four files use the prefix today, so
    // the floor is 4 — a drop below that means the scan stopped seeing its input.
    const sources = sourcesUsingPrefix();
    expect(sources.length).toBeGreaterThanOrEqual(4);

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
    const hasDropHandler = /onDrop|onDragOver/.test(stripComments(readFileSync(APP, 'utf8')));
    expect(dropCue && !hasDropHandler).toBe(false);
  });
});