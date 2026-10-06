/**
 * T20a (A12/D9) — field-level diff values must be rendered as HUMAN TEXT.
 *
 * `computeDiff` compares icons through a canonical signature
 * (`url:` / `local-ref:` / `recipe:a|b|c`). That signature is an internal
 * representation; showing it verbatim (`recipe:#ffffff|AB|#000000`) is an
 * internal-representation leak. These tests pin the decode AND assert the raw
 * signature never survives into the rendered line.
 */
import { describe, it, expect } from 'vitest';
import { formatFieldValue, formatFieldDiffLine } from '@ui/shared/import-field-format';
import type { ImportFieldDiff } from '@shared/types';

describe('T20a — field value formatting (signature → human)', () => {
  it('passes a title through unchanged', () => {
    expect(formatFieldValue('title', 'My page')).toBe('My page');
  });

  it('renders an empty facet as "None" (fieldDiff uses null for empty)', () => {
    expect(formatFieldValue('title', null)).toBe('None');
    expect(formatFieldValue('icon', '')).toBe('None');
  });

  it('decodes a url: signature into a readable label', () => {
    expect(formatFieldValue('icon', 'url:https://example.com/f.ico')).toBe(
      'URL (https://example.com/f.ico)',
    );
  });

  it('decodes a local-ref: signature into a readable label', () => {
    expect(formatFieldValue('icon', 'local-ref:icon:slot-1')).toBe('Local icon (icon:slot-1)');
  });

  it('decodes a recipe: signature and never leaks the raw form', () => {
    const out = formatFieldValue('icon', 'recipe:#ffffff|AB|#000000');
    expect(out).toMatch(/recipe icon/i);
    expect(out).toContain('#ffffff');
    expect(out).toContain('AB');
    expect(out).toContain('#000000');
    // The internal signature must NOT survive: no `recipe:` prefix, no pipes.
    expect(out).not.toContain('recipe:');
    expect(out).not.toContain('|');
  });

  it('tolerates a recipe with missing facets', () => {
    const out = formatFieldValue('icon', 'recipe:#fff||');
    expect(out).toMatch(/recipe icon/i);
    expect(out).not.toContain('recipe:');
  });
});

describe('T20a — one field line (A12 "A → B" / "unchanged")', () => {
  const line = (f: ImportFieldDiff) => formatFieldDiffLine(f);

  it('renders an unchanged field as "unchanged"', () => {
    expect(line({ field: 'title', before: 'Same', after: 'Same', changed: false })).toBe(
      'Title: unchanged',
    );
    expect(line({ field: 'icon', before: 'url:https://x', after: 'url:https://x', changed: false })).toBe(
      'Icon: unchanged',
    );
  });

  it('renders a changed title as an arrow pair', () => {
    expect(line({ field: 'title', before: 'Old', after: 'New', changed: true })).toBe('Title: Old → New');
  });

  it('renders a changed icon through the decoder (no signature leak)', () => {
    const out = line({ field: 'icon', before: null, after: 'recipe:#fff|X|#000', changed: true });
    expect(out).toMatch(/^Icon: None → /);
    expect(out).toMatch(/recipe icon/i);
    expect(out).not.toContain('recipe:');
  });
});