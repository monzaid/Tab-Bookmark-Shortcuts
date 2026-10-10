/**
 * T20a (A12/D9) — field-level diff values must be rendered as HUMAN TEXT from a
 * STRUCTURED value (`ImportFieldValue`), never from an internal signature.
 *
 * The diff carries a discriminated value, so the renderer switches on `kind` —
 * there is no string to parse and therefore no `startsWith` prefix guessing
 * (which is the pattern this iteration removed elsewhere).
 */
import { describe, it, expect } from 'vitest';
import { formatFieldValue, formatFieldDiff } from '@ui/shared/import-field-format';
import { matchTypeLabel } from '@shared/match-type-labels';
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

describe('T20a — field view dispatched by record status (A12)', () => {
  const view = (f: ImportFieldDiff, status: ImportRecordStatus) => formatFieldDiff(f, status);

  it('kept + unchanged ⇒ state "unchanged" AND the machine value', () => {
    // The value is reported because "unchanged" alone does not say WHAT stayed
    // the same — and for a facet that is not a list column (an icon, a priority)
    // the value would then appear nowhere on the screen.
    const v: ImportFieldValue = { kind: 'text', value: 'Same' };
    expect(view({ field: 'title', before: v, after: v, changed: false }, 'kept')).toEqual({
      label: 'Title',
      state: 'unchanged',
      before: null,
      after: 'Same',
    });
  });

  it('an unchanged facet the record does NOT have carries NO value, not an empty string', () => {
    // A slot has no priority: there is no value to name. `null` (not `''`) is
    // what lets the renderer draw its own dash instead of an empty cell.
    expect(view({ field: 'priority', before: null, after: null, changed: false }, 'kept')).toEqual({
      label: 'Priority',
      state: 'unchanged',
      before: null,
      after: null,
    });
  });

  it('replaced still reports BOTH sides (status does NOT short-circuit replaced)', () => {
    expect(
      view(
        { field: 'title', before: { kind: 'text', value: 'Old' }, after: { kind: 'text', value: 'New' }, changed: true },
        'replaced',
      ),
    ).toEqual({ label: 'Title', state: 'changed', before: 'Old', after: 'New' });
  });

  it('a changed facet carries ONE side per slot — never two "before"s', () => {
    // The structural claim behind the arrow: `before` is only set when there IS
    // a before. A renderer drawing `before → after` unconditionally would print
    // "None →" for a file-only record, which the shape now makes unrepresentable.
    const icon: ImportFieldValue = { kind: 'url', value: 'https://x' };
    const changed = view(
      { field: 'icon', before: null, after: icon, changed: true },
      'replaced',
    );
    expect(changed.before).toBe('None'); // explicit: the machine had NO icon
    expect(changed.after).toBe('URL (https://x)');

    const unchanged = view({ field: 'icon', before: icon, after: icon, changed: false }, 'replaced');
    expect(unchanged.state).toBe('unchanged');
    expect(unchanged.before).toBeNull();
    expect(unchanged.after).toBe('URL (https://x)');
  });

  it('added carries the value on the AFTER slot only, with state "added"', () => {
    const out = view(
      { field: 'icon', before: null, after: { kind: 'url', value: 'https://n' }, changed: true },
      'added',
    );
    expect(out).toEqual({ label: 'Icon', state: 'added', before: null, after: 'URL (https://n)' });
  });

  it('deleted carries the LAST value on the BEFORE slot only, never "→ None"', () => {
    const out = view(
      { field: 'icon', before: { kind: 'local-ref', key: 'icon:slot-3' }, after: null, changed: true },
      'deleted',
    );
    expect(out).toEqual({
      label: 'Icon',
      state: 'removed',
      before: 'Local icon (icon:slot-3)',
      after: null,
    });
    // No surviving side ⇒ no arrow can be drawn, which is the point.
    expect(out.after).toBeNull();
  });

  it('added / deleted with no value carry no value at all (the renderer draws a dash)', () => {
    expect(view({ field: 'icon', before: null, after: null, changed: false }, 'added')).toEqual({
      label: 'Icon', state: 'added', before: null, after: null,
    });
    expect(view({ field: 'icon', before: null, after: null, changed: false }, 'deleted')).toEqual({
      label: 'Icon', state: 'removed', before: null, after: null,
    });
  });

  it('the record status WINS over `changed`: an added record reports "added"', () => {
    // `added` describes a change of EXISTENCE — the record is not on the machine
    // at all — so a before→after pair would misstate what the import does.
    const out = view(
      { field: 'title', before: null, after: { kind: 'text', value: 'New' }, changed: true },
      'added',
    );
    expect(out.state).toBe('added');
    expect(out.before).toBeNull();
  });

  it('names the two NEW facets (Match URL / Match Type), never "Icon"', () => {
    const url = view(
      { field: 'match-url', before: null, after: { kind: 'text', value: 'https://n' }, changed: true },
      'added',
    );
    expect(url.label).toBe('Match URL');
    expect(url.after).toBe('https://n');
    const type = view(
      { field: 'match-type', before: null, after: { kind: 'text', value: 'Exact URL' }, changed: true },
      'added',
    );
    expect(type.label).toBe('Match Type');
    expect(type.after).toBe('Exact URL');
  });
});

describe('T20a — the match MODE is localised (one source of names)', () => {
  it('renders the mode through the shared labels, not the contract value', () => {
    // The rule form says "Exact URL"; a diff saying "exact" would name the same
    // concept twice. Both sides now read from MATCH_TYPE_LABELS.
    expect(matchTypeLabel('exact')).toBe('Exact URL');
    expect(matchTypeLabel('regex')).toBe('Regex pattern');
  });

  it('shows an unrecognised value verbatim rather than blanking it', () => {
    expect(matchTypeLabel('glob')).toBe('glob');
  });
});