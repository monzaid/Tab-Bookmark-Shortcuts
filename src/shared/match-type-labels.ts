/**
 * The ONE place the two URL-match modes are named for a human.
 *
 * `UrlMatchType` is a contract value (`'exact' | 'regex'`) and must never be
 * rendered raw: the rule form and the import diff would then call the same
 * concept by two different names (`Exact URL` vs `exact`) — the drift a single
 * source exists to prevent.
 *
 * Lives in `src/shared` (not `src/ui`) because `import-diff.ts` — a shared
 * module the worker also loads — needs the names, and `src/shared` must never
 * depend on `src/ui`.
 */
import type { UrlMatchType } from './types';

export const MATCH_TYPE_LABELS: Record<UrlMatchType, string> = {
  exact: 'Exact URL',
  regex: 'Regex pattern',
};

/**
 * A contract value as its human name. An unrecognised value is shown verbatim
 * rather than blanked: a value the labels do not know is still the truth, and
 * hiding it would misreport what the file holds.
 */
export function matchTypeLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(MATCH_TYPE_LABELS, value)
    ? MATCH_TYPE_LABELS[value as UrlMatchType]
    : value;
}