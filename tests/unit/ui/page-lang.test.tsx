/**
 * U9 (P5) — page entry language declarations must match the interface language.
 *
 * SCOPE DISCIPLINE (v3 BLK-U9): this suite asserts ONLY the five hard-coded
 * whitelist entries owned by U9. It deliberately does NOT enumerate
 * `src/ui/*\/index.html`, and it deliberately makes no statement about the
 * orphan page removed by U1 — doing so would couple U9 to U1 and leave U9
 * unfixably red until U1 lands.
 *
 *   - "the removed orphan page directory is gone" -> owned by U1's guard test
 *   - "repo-wide no zh-CN / no CJK fallback"      -> owned by no-cjk-in-ui.test.tsx
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WHITELIST = ['sidebar', 'settings', 'recovery', 'import-preview', 'conflict-confirm'] as const;

const readEntry = (page: string) =>
  readFileSync(resolve(process.cwd(), `src/ui/${page}/index.html`), 'utf-8');

describe('U9 (P5) — the five U9-owned page entries declare lang="en"', () => {
  it.each(WHITELIST)('src/ui/%s/index.html contains lang="en"', (page) => {
    expect(readEntry(page)).toContain('lang="en"');
  });

  it.each(WHITELIST)('src/ui/%s/index.html does not contain lang="zh-CN"', (page) => {
    expect(readEntry(page)).not.toContain('lang="zh-CN"');
  });
});