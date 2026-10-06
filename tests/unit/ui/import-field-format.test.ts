/**
 * T20a (A12/D9) — field-level diff values must be rendered as HUMAN TEXT from a
 * STRUCTURED value (`ImportFieldValue`), never from an internal signature.
 *
 * The diff carries a discriminated value, so the renderer switches on `kind` —
 * there is no string to parse and therefore no `startsWith` prefix guessing
 * (which is the pattern this iteration removed elsewhere).
 */
import { describe, it, expect } from 'vitest';
import { formatFieldValue, formatFieldDiffLine } from '@ui/shared/import-field-format';
import type { ImportFieldDiff, ImportFieldValue, ImportRecordStatus } from '@shared/types';

describe('T20a — structured value → human', () => {
  it('null (no value on this side) renders as "None"', () => {
    expect(formatFieldValue(null)).toBe('None');
  });

  it('a text value passes through unchanged', () => {
    expect(formatFieldValue({ kind: 'text', value: 'My page' })).toBe('My page');
  });

  it('a url value renders as a readable label', () => {
    expect(formatFieldValue({ kind: 'url', value: 'https://example.com/f.ico' })).toBe(
      'URL (https://example.com/f.ico)',
    );
  });

  it('a local-ref value renders as a readable label', () => {
    expect(formatFieldValue({ kind: 'local-ref', key: 'icon:slot-1' })).toBe(
      'Local icon (icon:slot-1)',
    );
  });

  it('a recipe value renders as words, keeping the three facets', () => {
    const out = formatFieldValue({
      kind: 'recipe',
      bgColor: '#ffffff',
      text: 'AB',
      textColor: '#000000',
    });
    expect(out).toMatch(/recipe icon/i);
    expect(out).toContain('#ffffff');
    expect(out).toContain('AB');
    expect(out).toContain('#000000');
    expect(out).not.toContain('recipe:');
    expect(out).not.toContain('|');
  });

  it('tolerates empty recipe facets', () => {
    const out = formatFieldValue({ kind: 'recipe', bgColor: '#fff', text: '', textColor: '' });
    expect(out).toMatch(/recipe icon/i);
    expect(out).not.toContain('recipe:');
  });
});

describe('T20a — field line dispatched by record status (A12)', () => {
  const line = (f: ImportFieldDiff, status: ImportRecordStatus) => formatFieldDiffLine(f, status);

  it('kept + unchanged ⇒ "unchanged"', () => {
    const v: ImportFieldValue = { kind: 'text', value: 'Same' };
    expect(line({ field: 'title', before: v, after: v, changed: false }, 'kept')).toBe(
      'Title: unchanged',
    );
  });

  it('replaced still uses the arrow pair (status does NOT short-circuit replaced)', () => {
    expect(
      line(
        { field: 'title', before: { kind: 'text', value: 'Old' }, after: { kind: 'text', value: 'New' }, changed: true },
        'replaced',
      ),
    ).toBe('Title: Old → New');
  });

  it('replaced with an icon that did NOT change says "unchanged" (real fixture shape)', () => {
    const icon: ImportFieldValue = { kind: 'url', value: 'https://x' };
    expect(line({ field: 'icon', before: icon, after: icon, changed: false }, 'replaced')).toBe(
      'Icon: unchanged',
    );
  });

  it('added carries the value and never says "unchanged"', () => {
    const out = line(
      { field: 'icon', before: null, after: { kind: 'url', value: 'https://n' }, changed: true },
      'added',
    );
    expect(out).toBe('Icon: added (URL (https://n))');
    expect(out).not.toMatch(/unchanged/i);
  });

  it('deleted carries the LAST value and never says "unchanged" or "→ None"', () => {
    const out = line(
      { field: 'icon', before: { kind: 'local-ref', key: 'icon:slot-3' }, after: null, changed: true },
      'deleted',
    );
    expect(out).toBe('Icon: removed (Local icon (icon:slot-3))');
    expect(out).not.toMatch(/unchanged/i);
    expect(out).not.toMatch(/None/);
  });

  it('added / deleted with no value render bare (no empty parentheses)', () => {
    expect(line({ field: 'icon', before: null, after: null, changed: false }, 'added')).toBe(
      'Icon: added',
    );
    expect(line({ field: 'icon', before: null, after: null, changed: false }, 'deleted')).toBe(
      'Icon: removed',
    );
  });

  it('a changed title renders the arrow pair even when the record was added', () => {
    // `added` short-circuits to the value form — the arrow is for kept/replaced.
    const out = line(
      { field: 'title', before: null, after: { kind: 'text', value: 'New' }, changed: true },
      'added',
    );
    expect(out).toBe('Title: added (New)');
  });
});