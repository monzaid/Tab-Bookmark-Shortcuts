/**
 * A12/D9: render an import-diff field value as human-readable text.
 *
 * The diff carries `ImportFieldValue` — a STRUCTURED, renderable value — not an
 * internal comparison signature. So this module does NO parsing, NO
 * `startsWith` prefix guessing: it switches on the discriminated `kind`. That is
 * deliberate: re-deriving meaning from a string prefix would be (a) a second
 * parallel implementation of the shape `import-diff.ts` already owns, and
 * (b) the exact "infer semantics from a prefix" pattern this iteration removed.
 */

import type { ImportFieldDiff, ImportFieldValue, ImportRecordStatus } from '@shared/types';

/** Render one facet value. `null` = this side has no value. */
export function formatFieldValue(v: ImportFieldValue | null): string {
  if (v === null) return 'None';
  switch (v.kind) {
    case 'text':
      return v.value;
    case 'url':
      return `URL (${v.value})`;
    case 'local-ref':
      return `Local icon (${v.key})`;
    case 'recipe':
      return `Recipe icon (background ${v.bgColor || '—'}, text ${v.text || '—'}, text colour ${v.textColor || '—'})`;
  }
}

/**
 * The target machine's value for one facet, ready to print beside "unchanged".
 *
 * Returns `''` for a facet the record does not have (a slot has no priority, and
 * either side may be absent), so the caller can omit the value entirely rather
 * than print an empty pair of parentheses.
 */
export function unchangedValue(diff: ImportFieldDiff): string {
  const value = formatFieldValue(diff.before);
  return value === 'None' ? '' : value;
}

/**
 * What a field line is asserting about one facet.
 *
 * Kept as a closed set rather than a free string: the renderer colours and
 * labels by state, so a typo here must be a type error, not an unstyled word.
 */
export type FieldState = 'changed' | 'unchanged' | 'added' | 'removed';

/**
 * One facet, split into the parts a readable row needs.
 *
 * Why SPLIT rather than one sentence: the old renderer produced a single string
 * (`Title: S2 → FILE-S2`) that the UI printed as one run-on line. Five of those
 * per record left the reader no column to scan — the labels, the values and the
 * state all sat in the same word stream, so "which field changed?" meant reading
 * every line. The parts are handed over separately so the LIST can put them in
 * columns; the wording itself is unchanged.
 *
 * `before`/`after` are BOTH set only when the field genuinely changed. Otherwise
 * exactly one of them carries the single value and the other is `null`, so the
 * renderer cannot draw an arrow for a field that did not change — the previous
 * code achieved the same thing with string concatenation, where getting it wrong
 * produced only a wrong-looking sentence rather than a wrong structure.
 */
export interface FieldView {
  /** The column label ("Match URL"), spelled the same on every row. */
  label: string;
  state: FieldState;
  /** The target machine's side. `null` = not applicable to this state. */
  before: string | null;
  /** The file's side. `null` = not applicable to this state. */
  after: string | null;
}

const FIELD_LABELS: Record<ImportFieldDiff['field'], string> = {
  title: 'Title',
  icon: 'Icon',
  'match-url': 'Match URL',
  'match-type': 'Match Type',
  priority: 'Priority',
};

/**
 * One field's view for a record row, dispatched by the RECORD's status.
 *
 * `added` / `deleted` describe a change of EXISTENCE, not a before→after pair:
 * a deleted row has `before` set and `after` null, and presenting it as
 * "unchanged" or "A → None" would misstate what the import does. They therefore
 * carry the single value they have.
 *
 * An UNCHANGED facet still carries the machine's value. Saying only "unchanged"
 * left the reader unable to tell WHAT was unchanged without scrolling back to
 * the row — and for the fields that are not columns of the list (an icon, a
 * priority) the value was then nowhere on screen at all.
 */
export function formatFieldDiff(diff: ImportFieldDiff, status: ImportRecordStatus): FieldView {
  const label = FIELD_LABELS[diff.field];

  /**
   * A single carried value, or `null` when there is nothing to print.
   *
   * Both "the record has no such value" (`'None'`) and "the value is the empty
   * string" (a rule with no title) collapse to `null`, so the renderer draws its
   * own placeholder rather than an empty cell. The two are different facts but
   * they print identically — and an empty cell is what made the old
   * `Title: added ()` look like a rendering bug.
   */
  const sole = (v: string): string | null => (v === 'None' || v === '' ? null : v);

  if (status === 'added') {
    // The file's side only: there is no machine value to compare against, and
    // "unchanged" would be a lie about a record that does not exist yet.
    return { label, state: 'added', before: null, after: sole(formatFieldValue(diff.after)) };
  }
  if (status === 'deleted') {
    // The LAST value, never "→ None": the record is being removed whole, so
    // there is no surviving side for an arrow to point at.
    return { label, state: 'removed', before: sole(formatFieldValue(diff.before)), after: null };
  }

  if (diff.changed) {
    // Both sides verbatim, INCLUDING an explicit `None` — an icon going from
    // nothing to a recipe is exactly the case the arrow exists to show.
    return {
      label,
      state: 'changed',
      before: formatFieldValue(diff.before),
      after: formatFieldValue(diff.after),
    };
  }

  const value = unchangedValue(diff);
  return { label, state: 'unchanged', before: null, after: value === '' ? null : value };
}