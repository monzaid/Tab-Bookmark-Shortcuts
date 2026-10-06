/**
 * T20b — guard test: the orphan `import-preview` page and ALL of its reference
 * points must be gone.
 *
 * This is the SYMMETRIC counterpart of `candidate-selector-removed.test.ts`
 * (U1 built that guard for the candidate page; the same-iteration plan delegated
 * "retire import-preview" to this task). The `rg` counter-example anchors in the
 * plan run only at commit time and are NOT continuous guards — they cannot stop
 * a later re-introduction, which is the whole F1 theme (an orphan must not
 * come back).
 *
 * Scope: `src/**` + `tests/**` + `vite.config.ts`. Documentation mentions are
 * updated in the same commit but are not asserted here.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf-8');

/** Recursively collect every source file's text under a directory. */
function readDirRecursive(dir: string): string {
  let text = '';
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) text += readDirRecursive(rel);
    else text += read(rel);
  }
  return text;
}

describe('T20b — import-preview page fully removed', () => {
  it('should not have a POPULATED src/ui/import-preview directory', () => {
    const dir = resolve(root, 'src/ui/import-preview');
    // git cannot represent an empty directory, so a leftover empty dir is not a
    // revival (and asserting on it would be red locally / green in CI). Only a
    // directory that again contains FILES means the orphan returned.
    expect(existsSync(dir) && readdirSync(dir).length > 0).toBe(false);
  });

  it('should have no import-preview entry in vite.config.ts', () => {
    expect(read('vite.config.ts')).not.toContain('import-preview');
  });

  it('should not let the component symbols survive anywhere (no orphan revival)', () => {
    // src/ and tests/ both: a re-introduced component (even at a different path,
    // or imported dynamically) would resurrect the orphan this task retires.
    //
    // The forbidden names are assembled from SPLIT literals: a literal
    // occurrence in this file's own source would make the assertion match
    // ITSELF, and a path-based self-exclusion would silently break the moment
    // this file is renamed or moved (position coupling).
    const SYMBOL_TABLE = 'ImportPreview' + 'Table';
    const SYMBOL_PROPS = 'ImportPreview' + 'Props';
    const text = readDirRecursive('src') + readDirRecursive('tests');
    for (const symbol of [SYMBOL_TABLE, SYMBOL_PROPS]) {
      expect(text).not.toContain(symbol);
    }
  });
});