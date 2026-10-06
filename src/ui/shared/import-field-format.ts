/**
 * A12/D9: render an import-diff field value as human-readable text.
 *
 * `computeDiff` compares both sides through ONE canonical representation, so an
 * icon facet arrives as a SIGNATURE (`import-diff.ts` `portableIconSignature`):
 *   - `url:<url>`
 *   - `local-ref:<key>`
 *   - `recipe:<bgColor>|<text>|<textColor>`
 *
 * Those signatures are an INTERNAL representation and must never reach the DOM
 * (`recipe:#ffffff|AB|#000000` is a leak, not a sentence). This is the single
 * place that decodes them back into words, so the rule lives in exactly one
 * module and cannot drift between surfaces.
 *
 * A title facet is already plain text and passes through unchanged; `null`
 * (an empty facet, per `fieldDiff`) becomes "None".
 */

import type { ImportFieldDiff } from '@shared/types';

/** Decode one facet value into display text. */
export function formatFieldValue(field: ImportFieldDiff['field'], raw: string | null): string {
  if (raw === null || raw === '') return 'None';
  if (field === 'title') return raw;

  if (raw.startsWith('url:')) return `URL (${raw.slice('url:'.length)})`;

  if (raw.startsWith('local-ref:')) {
    return `Local icon (${raw.slice('local-ref:'.length)})`;
  }

  if (raw.startsWith('recipe:')) {
    const [background, text, textColor] = raw.slice('recipe:'.length).split('|');
    return `Recipe icon (background ${background || '—'}, text ${text || '—'}, text colour ${textColor || '—'})`;
  }

  // Defensive: an unrecognised shape is shown verbatim rather than dropped —
  // losing a value silently would be worse than showing an odd string.
  return raw;
}

/**
 * One field's display line for a record row. `changed: false` is rendered as
 * "unchanged" (A12) rather than repeating the identical value twice.
 */
export function formatFieldDiffLine(diff: ImportFieldDiff): string {
  const label = diff.field === 'title' ? 'Title' : 'Icon';
  if (!diff.changed) return `${label}: unchanged`;
  return `${label}: ${formatFieldValue(diff.field, diff.before)} → ${formatFieldValue(diff.field, diff.after)}`;
}