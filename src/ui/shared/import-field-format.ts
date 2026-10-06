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
 * One field's display line for a record row, dispatched by the RECORD's status.
 *
 * `added` / `deleted` describe a change of EXISTENCE, not a before→after pair:
 * a deleted row has `before` set and `after` null, and rendering it as
 * "unchanged" or "A → None" would misstate what the import does. They therefore
 * report the value they carry. Only `kept` / `replaced` (the cases where both
 * sides may exist) use the "unchanged" / arrow wording (A12).
 */
const FIELD_LABELS: Record<ImportFieldDiff['field'], string> = {
  title: 'Title',
  icon: 'Icon',
  'match-url': 'Match URL',
  'match-type': 'Match Type',
};

export function formatFieldDiffLine(diff: ImportFieldDiff, status: ImportRecordStatus): string {
  const label = FIELD_LABELS[diff.field];

  if (status === 'added') {
    const value = formatFieldValue(diff.after);
    return value === 'None' ? `${label}: added` : `${label}: added (${value})`;
  }
  if (status === 'deleted') {
    const value = formatFieldValue(diff.before);
    return value === 'None' ? `${label}: removed` : `${label}: removed (${value})`;
  }

  if (diff.changed) {
    return `${label}: ${formatFieldValue(diff.before)} → ${formatFieldValue(diff.after)}`;
  }
  return `${label}: unchanged`;
}