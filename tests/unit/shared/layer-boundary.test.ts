import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Recursive `.ts`/`.tsx` walker. */
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
 * (`@background`, `@content`, `@ui`, `@adapters`). Nothing under it may resolve
 * OUTSIDE itself — an aliased or relative escape is a dependency inversion.
 *
 * Enforcement is an ALLOWLIST, not a list of forbidden prefixes: every module
 * specifier must be RELATIVE and must RESOLVE to a path still under
 * `src/shared`. Enumerating "statement shape × forbidden prefix" can never be
 * complete (it misses new aliases and third-party packages); asserting the
 * boundary PROPERTY is.
 *
 * No tooling enforces this (the eslint config has no boundary rule), so this
 * guard is the table, not the memory.
 */
const SHARED_ROOT = resolve(process.cwd(), 'src/shared');

const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^"']+)['"]/g;

/**
 * Strip comments FIRST. `field-chain.ts` contains prose like
 * `from 'the site value is an empty string'`, which the specifier pattern would
 * otherwise read as an import (a REAL false positive today). Over-stripping only
 * reduces matches inside comments and can never hide a real import, so the
 * direction of error is safe.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Specifiers in `source` (a file at `filePath`) that leave `src/shared`. */
function specifierOffenders(source: string, filePath: string): string[] {
  const out: string[] = [];
  for (const [, spec] of stripComments(source).matchAll(SPECIFIER)) {
    // (1) MUST be relative: a bare specifier (`zod`, `@ui/x`) resolves against
    // node_modules/aliases, never inside shared, so `resolve()` alone would
    // wrongly place `'zod'` under shared.
    // (2) MUST stay under shared: `../ui/x` is relative but escapes.
    const resolved = resolve(dirname(filePath), spec);
    const inside = resolved === SHARED_ROOT || resolved.startsWith(SHARED_ROOT + sep);
    if (!spec.startsWith('.') || !inside) {
      out.push(`${relative(process.cwd(), filePath)}: ${spec}`);
    }
  }
  return out;
}

function offendersIn(files: string[]): string[] {
  return files.flatMap((f) => specifierOffenders(readFileSync(f, 'utf8'), f));
}

describe('layer boundary', () => {
  it('has zero specifiers resolving outside src/shared', () => {
    const files = walk(SHARED_ROOT);

    // Non-empty assertion: a renamed dir or a wrong root would otherwise make the
    // offender scan vacuously pass (finding "nothing" in "nowhere").
    expect(files.length).toBeGreaterThan(0);

    expect(offendersIn(files)).toEqual([]);
  });

  /**
   * The scan above only proves "the repo is clean right now". This case table
   * proves the DETECTOR can actually discriminate — otherwise the guard could be
   * vacuous (the "table, not the memory" discipline).
   */
  it('flags every resolution form that leaves src/shared, and nothing else', () => {
    const fakeFile = join(SHARED_ROOT, 'probe.ts');
    const flagged = (s: string) => specifierOffenders(s, fakeFile).length > 0;

    const MUST_FLAG = [
      "import { A } from '@ui/x';",
      "import {\n  A,\n} from '@ui/x';",
      "export { A } from '@ui/x';",
      "export * from '@ui/x';",
      "import '@ui/x';",
      "const m = await import('@ui/x');",
      "const m = require('@ui/x');",
      "import { A } from '../ui/x';",
      "import { A } from '@background/x';",
      "import { A } from '@adapters/x';",
      "import { z } from 'zod';", // third-party: the old denylist missed it
      "import { A } from '@ui/NEW_ALIAS/x';", // a future alias: no list to update
    ];
    const MUST_NOT_FLAG = [
      '// see @ui/x for details',
      "const t = '@ui'",
      "// copied from '@ui/x' long ago",
      "/* copied from '@ui/x' */",
      "// from 'the site value is an empty string'", // real repo false positive
      "import { A } from './x';",
      "import {\n  A,\n} from './x';",
      "export { A } from './x';",
      "export * from './x';",
      "import './x';",
      "const m = await import('./x');",
      "const m = require('./x');",
      "import type { A } from './x';",
    ];

    for (const s of MUST_FLAG) expect(flagged(s), `MUST_FLAG: ${s}`).toBe(true);
    for (const s of MUST_NOT_FLAG) expect(flagged(s), `MUST_NOT_FLAG: ${s}`).toBe(false);
  });
});

const SRC_ROOT = resolve(process.cwd(), 'src');
const TOKEN_OWNER = resolve(SRC_ROOT, 'shared/icon-ref.ts');

describe('local-icon token ownership', () => {
  /**
   * The prefix literal has exactly ONE owner. Consumers must import the constant;
   * a re-spelled literal (in any quote form) is what this guard exists for — it
   * would let one side drift when the prefix changes.
   *
   * The pattern is deliberately the BARE `local-icon`, so every form is caught
   * (`'…'`, `"…"`, a template literal, and `'local-icon:foo'`). A future
   * `'local-icon-v2:'` also matches — that is CORRECT: a new variant should come
   * from the owner (as a new constant) rather than a second literal.
   */
  it('keeps the local-icon token in its single owner', () => {
    const files = walk(SRC_ROOT);

    // Non-empty assertion: without it a renamed root would pass vacuously.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter((f) => resolve(f) !== TOKEN_OWNER)
      .filter((f) => /local-icon/.test(stripComments(readFileSync(f, 'utf8'))));

    expect(offenders).toEqual([]);
  });

  /**
   * Proves the detector can discriminate — a bare literal with no comment
   * stripping would flag `icon-ref.ts`'s own prose (and `recipe-renderer.ts`'s).
   */
  it('flags every spelling of the token, and ignores prose', () => {
    const flagged = (s: string) => /local-icon/.test(stripComments(s));

    const MUST_FLAG = [
      "const X = 'local-icon:';",
      'const X = "local-icon:";',
      'const X = `local-icon:`;',
      "const X = 'local-icon:foo';",
      "const X = 'local-icon-v2:';",
    ];
    const MUST_NOT_FLAG = [
      '// it never matched `local-icon:` so it stayed unknown',
      '/* local-icon: handled by the owner */',
      "const ref = 'local-ref';",
      "const kind = 'local-ref' as IconValueKind;",
    ];

    for (const s of MUST_FLAG) expect(flagged(s), `MUST_FLAG: ${s}`).toBe(true);
    for (const s of MUST_NOT_FLAG) expect(flagged(s), `MUST_NOT_FLAG: ${s}`).toBe(false);
  });
});