/**
 * U1 (P10) — guard test: the orphan `candidate-selector` page and ALL of its
 * reference points must be gone.
 *
 * This file is the SOLE owner of the "candidate-selector directory does not
 * exist" assertion (v3 plan: BLK-U9 decoupled U9's `page-lang.test.tsx` from
 * this concern; the repo-wide "no zh-CN / no CJK" fallback lives in
 * `no-cjk-in-ui.test.tsx`).
 *
 * Scope: `src/**` + `vite.config.ts` + `tests/**`. Documentation mentions
 * (`README.md`, `RELEASE_CANDIDATE.md`) are explicitly OUT of scope (Nit N9).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf-8');
const countOccurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe('U1 (P10) — candidate-selector page fully removed', () => {
  it('should not have a src/ui/candidate-selector directory', () => {
    expect(existsSync(resolve(root, 'src/ui/candidate-selector'))).toBe(false);
  });

  it('should have no candidate-selector entry in vite.config.ts', () => {
    expect(read('vite.config.ts')).not.toContain('candidate-selector');
  });

  it('should keep exactly 5 ui-smoke page cases (was 6)', () => {
    const source = read('tests/ui-smoke/pages.smoke.test.tsx');
    expect(countOccurrences(source, 'it(')).toBe(5);
  });

  it('should keep exactly 6 recovery-window cases and drop all candidate imports', () => {
    const source = read('tests/unit/ui/recovery-selector.test.tsx');
    // B1/B2: candidate=7 removed, Recovery=6 preserved.
    expect(countOccurrences(source, 'it(')).toBe(6);
    expect(source).not.toContain('CandidateSelectorApp');
    expect(source).not.toContain('TabCandidate');
  });
});