/**
 * U8 (P9) — the UI layer must be language-consistent: zero CJK characters
 * anywhere under `src/ui/**`.
 *
 * This guard is the single closure evidence for decisions DR1 (interface
 * language = EN), DR4 (`components/IconEditor.tsx`) and DR5
 * (`settings/App.tsx:323`), and it also prevents future regressions.
 *
 * Scope is deliberately limited to `src/ui/**` (plan Out of Scope: `src/`
 * outside the UI currently has 0 CJK hits and is not this task's remit).
 *
 * RED guard: 12 CJK lines exist pre-fix, so this fails immediately.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CJK = /[\u4e00-\u9fff]/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

describe('U8 (P9) — no CJK characters anywhere in src/ui', () => {
  it('should have zero lines containing CJK in src/ui/**/*.{ts,tsx}', () => {
    const files = walk(resolve(process.cwd(), 'src/ui')).filter((f) => /\.tsx?$/.test(f));

    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf-8')
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (CJK.test(line)) {
            offenders.push(`${file.replace(process.cwd(), '').replace(/\\/g, '/')}:${String(index + 1)} :: ${line.trim()}`);
          }
        });
    }

    expect(offenders).toEqual([]);
    // Sanity: the walk must actually have found the UI sources.
    expect(files.length).toBeGreaterThan(10);
  });
});