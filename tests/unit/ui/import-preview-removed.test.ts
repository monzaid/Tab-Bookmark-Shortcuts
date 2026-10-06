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

/**
 * Recursively collect every source file's text under a directory.
 *
 * `exclude` skips this guard file ITSELF: the symbol regex literal below lives
 * in `tests/`, so a naïve scan would match its own pattern text (a self-match,
 * not a real reference).
 */
const SELF = 'tests/unit/ui/import-preview-removed.test.ts';
function readDirRecursive(dir: string): string {
  let text = '';
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (rel === SELF) continue;
    if (entry.isDirectory()) text += readDirRecursive(rel);
    else text += read(rel);
  }
  return text;
}

describe('T20b — import-preview page fully removed', () => {
  it('should not have a src/ui/import-preview directory', () => {
    expect(existsSync(resolve(root, 'src/ui/import-preview'))).toBe(false);
  });

  it('should have no import-preview entry in vite.config.ts', () => {
    expect(read('vite.config.ts')).not.toContain('import-preview');
  });

  it('should not let the component symbols survive anywhere (no orphan revival)', () => {
    // src/ and tests/ both: a re-introduced component (even with a different
    // path) would resurrect the orphan this task retires.
    expect(readDirRecursive('src')).not.toMatch(/ImportPreviewTable|ImportPreviewProps/);
    expect(readDirRecursive('tests')).not.toMatch(/ImportPreviewTable|ImportPreviewProps/);
  });
});