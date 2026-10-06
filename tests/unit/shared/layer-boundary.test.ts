import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Recursive `.ts`/`.tsx` walker (skips nothing else here — `src/shared` is leaf). */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Layer boundary: `src/shared/**` is the LEAF every other layer depends on
 * (`@background`, `@content`, `@ui`, `@adapters`). Importing `@ui` from it would
 * be a dependency inversion — the first of its kind.
 *
 * No tooling enforces this (the eslint config has no boundary/no-restricted-imports
 * rule), so this guard is the table, not the memory — the same shape as the
 * `no-cjk-in-ui` guard.
 *
 * Only the `@shared → @ui` direction is forbidden: `@ui → @shared` is the normal,
 * intended direction and is deliberately NOT asserted here.
 */
describe('layer boundary', () => {
  it('has zero `@ui` imports anywhere in src/shared', () => {
    const files = walk(resolve(process.cwd(), 'src/shared'));

    // Non-empty assertion: a renamed dir or a wrong root would otherwise make the
    // offender scan vacuously pass (finding "nothing" in "nowhere").
    expect(files.length).toBeGreaterThan(0);

    // Match IMPORT statements only, not the `@ui` token in prose/comments.
    const uiImport = /(?:^|\n)\s*import\b[^\n]*from\s+['"]@ui\/|import\(\s*['"]@ui\/|from\s+['"]\.\.[/\\]ui[/\\]/;
    const offenders = files.filter((f) => uiImport.test(readFileSync(f, 'utf8')));

    expect(offenders).toEqual([]);
  });
});