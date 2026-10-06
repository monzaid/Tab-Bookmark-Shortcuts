import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `tbs-settings__*` class the settings page renders must be defined in one
 * of the stylesheets. A class that is spelled in JSX but defined nowhere is
 * invisible: it reads as "styled" to the author and renders as nothing, and no
 * type/compiler check can see it. This is the table, not the memory.
 */
const APP = resolve(process.cwd(), 'src/ui/settings/App.tsx');
const CSS_DIR = resolve(process.cwd(), 'src/ui/styles');
const CLASS_TOKEN = /tbs-settings__[a-zA-Z0-9_-]+/g;

/**
 * Classes assembled at runtime, so their full literal never appears in the
 * source. They must be listed here explicitly — an unlisted dynamic class is
 * exactly the case this guard cannot see.
 */
const DYNAMIC_CLASS_ALLOWLIST: readonly string[] = [];

function stylesheets(): string {
  return readdirSync(CSS_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(CSS_DIR, f), 'utf8'))
    .join('\n');
}

/** Classes used in `source` that no stylesheet defines. */
function undefinedClasses(source: string, css: string): string[] {
  const used = new Set([...source.matchAll(CLASS_TOKEN)].map((m) => m[0]));
  return [...used].filter((c) => {
    if (DYNAMIC_CLASS_ALLOWLIST.includes(c)) return false;
    // The trailing guard keeps `__import-dim` from being satisfied by
    // `__import-dim-something`; a class is defined only by its OWN selector.
    return !new RegExp(`${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_-])`).test(css);
  });
}

describe('settings classes ↔ stylesheets', () => {
  it('defines every tbs-settings__ class the settings page uses', () => {
    const cssFiles = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
    // Non-empty: a renamed directory or a wrong root would otherwise make the
    // offender scan vacuously pass ("found nothing" in "looked nowhere").
    expect(cssFiles.length).toBeGreaterThan(0);

    const css = stylesheets();
    expect(css.length).toBeGreaterThan(0);

    expect(undefinedClasses(readFileSync(APP, 'utf8'), css)).toEqual([]);
  });

  /**
   * The scan above only proves "the page is clean right now". This case table
   * proves the DETECTOR can discriminate — otherwise the guard could be vacuous.
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
    ];

    for (const c of MUST_FLAG) expect(undefinedClasses(c, css), `MUST_FLAG: ${c}`).toEqual([c]);
    for (const c of MUST_NOT_FLAG) expect(undefinedClasses(c, css), `MUST_NOT_FLAG: ${c}`).toEqual([]);
  });
});