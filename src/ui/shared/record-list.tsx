/**
 * RecordList — the ONE list both import/export panels render their records with.
 *
 * The export lists must look like the import lists. The reliable
 * way to get "identical" is to have one implementation, not two that are kept in
 * step by hand: this component owns the toolbar (search / Match Type filter /
 * select-all), the row layout (icon · title · Match URL · Match Type · Priority)
 * and the empty state, and each panel supplies only a row DESCRIPTOR.
 *
 * What stays with the caller is everything semantic: whether a row is ticked,
 * what ticking means (export = include, import = take), and whether it can be
 * changed. This component never decides those — it renders them.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { ImportFieldDiff, ImportRecordStatus, UrlMatchType } from '@shared/types';
import { MATCH_TYPE_LABELS } from '@shared/match-type-labels';
import { formatFieldDiff } from '@ui/shared/import-field-format';
import type { FieldState } from '@ui/shared/import-field-format';
import { IconPreview, previewFromFieldValue, type IconPreviewSource } from '@ui/shared/icon-preview';

// ─── Row descriptor ──────────────────────────────────────────────────────────

export interface RecordRow {
  /** Stable identity — the React key and the test-id suffix. */
  key: string;
  icon: IconPreviewSource;
  /** The primary text (a slot's "Slot 3 — title", or a rule's title). */
  title: string;
  matchUrl: string;
  /**
   * `null` = this side has no match type to report.
   *
   * A row that describes the target machine may legitimately have no record to
   * read (a record only the file carries), and rendering `—` keeps that distinct
   * from a value that IS `exact`. Defaulting to `exact` would show a value the
   * machine never had.
   */
  matchType: UrlMatchType | null;
  /** Rules only; omitted rows render no priority cell. */
  priority?: number;
  /** The row's own control (checkbox) and/or status badge. */
  trailing: ReactNode;
  /**
   * The row's own detail, rendered INSIDE the row directly under it.
   *
   * This is what keeps a record and its Fields from coming apart: a disclosure
   * placed after the whole list leaves the reader to work out which record a
   * block of field lines belongs to, and that association collapses as soon as
   * the list is long enough to scroll. Passing it here makes "these fields
   * belong to this record" a structural fact (the detail is a child of the
   * record's own `<li>`), not something the two lists merely happen to imply.
   */
  detail?: ReactNode;
  /**
   * Extra text the search should match beyond title + Match URL. A slot's
   * snapshot title is worth searching even when the label shown is the number.
   */
  searchText?: string;
}

export interface RecordListProps {
  rows: readonly RecordRow[];
  /** Accessible name for the list's toolbar group. */
  label: string;
  /** Test-id prefix, so two lists on one page stay addressable. */
  testIdPrefix: string;
  /** Message shown when rows exist but none match the current filters. */
  emptyFiltered?: string;
  /** Message shown when there are no rows at all. */
  emptyAll?: string;
  /** Select-all control. Omit to render no select-all (the row checkboxes then rule). */
  selectAll?: {
    /** True when every visible row is ticked. */
    allSelected: boolean;
    /** True when some but not all visible rows are ticked. */
    someSelected: boolean;
    onToggleAll: (checked: boolean) => void;
    /** Noun for the count line, e.g. "slots". */
    noun: string;
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

/** All filter values, plus "any" — the Match Type filter's own vocabulary. */
type MatchTypeFilter = 'any' | UrlMatchType;

export function RecordList({
  rows,
  label,
  testIdPrefix,
  emptyFiltered = 'No records match the current filters.',
  emptyAll = 'Nothing to show.',
  selectAll,
}: RecordListProps) {
  const [search, setSearch] = useState('');
  const [matchType, setMatchType] = useState<MatchTypeFilter>('any');

  /**
   * Filtering is case-insensitive substring matching over the title, the Match
   * URL and any extra search text. Deliberately NOT regex or fuzzy: the user is
   * looking for a page they recognise, and a surprising match is worse than a
   * missed one here.
   */
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (matchType !== 'any' && row.matchType !== matchType) return false;
      if (needle === '') return true;
      const haystack = `${row.title} ${row.matchUrl} ${row.searchText ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search, matchType]);

  const visibleCount = filtered.length;
  const isFiltering = search.trim() !== '' || matchType !== 'any';

  return (
    <div className="tbs-record-list" data-testid={testIdPrefix}>
      <div className="tbs-record-list__toolbar" role="group" aria-label={label}>
        <input
          type="search"
          className="tbs-settings__search"
          data-testid={`${testIdPrefix}-search`}
          value={search}
          placeholder="Search title or Match URL"
          aria-label={`Search ${label}`}
          onChange={(e) => { setSearch(e.currentTarget.value); }}
        />
        <select
          className="tbs-settings__filter-select"
          data-testid={`${testIdPrefix}-match-type`}
          value={matchType}
          aria-label={`Filter by Match Type`}
          onChange={(e) => { setMatchType(e.currentTarget.value as MatchTypeFilter); }}
        >
          <option value="any">Any Match Type</option>
          {(Object.keys(MATCH_TYPE_LABELS) as UrlMatchType[]).map((type) => (
            <option key={type} value={type}>{MATCH_TYPE_LABELS[type]}</option>
          ))}
        </select>
        {selectAll && (
          <label className="tbs-record-list__select-all">
            <input
              type="checkbox"
              data-testid={`${testIdPrefix}-select-all`}
              checked={selectAll.allSelected}
              // The indeterminate state is applied through the DOM property
              // (`indeterminate` is not an attribute), so it is set in a ref
              // callback rather than a prop.
              ref={(el) => {
                if (el) el.indeterminate = selectAll.someSelected && !selectAll.allSelected;
              }}
              onChange={(e) => { selectAll.onToggleAll(e.currentTarget.checked); }}
            />
            {selectAll.allSelected
              ? `Clear all ${selectAll.noun}`
              : `Select all ${selectAll.noun}`}
          </label>
        )}
        {/* The count is the filter's feedback: it says how many rows the search
            is acting on, which is the number the select-all checkbox applies to. */}
        <span className="tbs-record-list__count" data-testid={`${testIdPrefix}-count`} aria-live="polite">
          {isFiltering ? `${String(visibleCount)} of ${String(rows.length)}` : String(rows.length)}
        </span>
      </div>

      {rows.length === 0 && <p className="tbs-settings__hint">{emptyAll}</p>}
      {rows.length > 0 && visibleCount === 0 && (
        <p className="tbs-settings__hint" data-testid={`${testIdPrefix}-empty`}>{emptyFiltered}</p>
      )}

      {visibleCount > 0 && (
        <ul className="tbs-record-list__rows">
          {filtered.map((row) => (
            <li className="tbs-record-row" key={row.key} data-testid={`${testIdPrefix}-row-${row.key}`}>
              {/* The fields are laid out on a grid so the row's own cells and
                  any detail stay column-aligned; a `detail` spans the full
                  width on its own line. */}
              <div className="tbs-record-row__main">
                <IconPreview source={row.icon} size={16} />
                <span className="tbs-record-row__title" title={row.title}>{row.title}</span>
                <code className="tbs-record-row__match" title={row.matchUrl}>{row.matchUrl}</code>
                <span className="tbs-record-row__type">
                {row.matchType === null ? '—' : MATCH_TYPE_LABELS[row.matchType]}
              </span>
                {row.priority !== undefined && (
                  <span className="tbs-record-row__priority" title="Priority">
                    {String(row.priority)}
                  </span>
                )}
                <span className="tbs-record-row__trailing">{row.trailing}</span>
              </div>
              {row.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Field-level detail ──────────────────────────────────────────────────────

/** Human wording for the state column. One place, so the list and the CSS agree. */
const STATE_LABELS: Record<FieldState, string> = {
  changed: 'changed',
  unchanged: 'unchanged',
  added: 'added',
  removed: 'removed',
};

export interface RecordFieldsProps {
  fields: readonly ImportFieldDiff[];
  /** The RECORD's status — what decides added / removed / changed / unchanged. */
  status: ImportRecordStatus;
  /** `<details data-testid>` value, so a test can address one record's block. */
  testId: string;
  /** `<li data-testid>` prefix: `${testIdPrefix}-${field}`. */
  testIdPrefix: string;
}

/**
 * A record's Fields, as a three-column table rather than a run-on sentence.
 *
 * The problem this solves is SCANNABILITY. Each field used to render as one
 * string — `Title: S2 → FILE-S2`, `Match URL: unchanged (https://s2.example/)` —
 * printed as a single line of prose. Five of those under a record, several
 * records deep, gave the eye no column to run down: the label, the value and the
 * state were all in the same word stream, so "did the title change?" had to be
 * answered by reading every line in full.
 *
 * So the row is a grid of exactly three cells: the LABEL (fixed wording, so the
 * labels form a column), the VALUE (the before → after pair, or the single value
 * the state carries) and the STATE WORD. The arrow is written once, here, rather
 * than by each caller: two callers drawing their own separator is how the
 * wording drifts.
 *
 * The icon facet additionally shows the icons themselves. The text form
 * ("Local icon (icon:slot-3)") names a reference without saying what it looks
 * like, and a recipe is three colour/text values rather than a picture — so the
 * one facet whose VALUE is visual gets a preview, beside the text rather than
 * instead of it.
 */
export function RecordFields({ fields, status, testId, testIdPrefix }: RecordFieldsProps) {
  return (
    <details className="tbs-settings__import-fields" data-testid={testId}>
      <summary>Fields</summary>
      {/* No class of its own: the list is styled by the `import-fields` rule
          below it, and a second selector for the same box is how the two drift. */}
      <ul>
        {fields.map((f) => {
          const view = formatFieldDiff(f, status);
          return (
            <li
              className="tbs-field-row"
              key={f.field}
              data-testid={`${testIdPrefix}-${f.field}`}
              data-state={view.state}
            >
              <span className="tbs-field-row__label">{view.label}</span>
              <span className="tbs-field-row__value">
                {/* The preview belongs to the VALUE cell: it depicts the same
                    thing the adjacent text describes. */}
                {f.field === 'icon' && (f.before !== null || f.after !== null) && (
                  <span className="tbs-settings__field-icon">
                    <IconPreview source={previewFromFieldValue(f.before)} size={16} />
                    {view.state === 'changed' && (
                      <>
                        <span className="tbs-field-row__arrow" aria-hidden="true">→</span>
                        <IconPreview source={previewFromFieldValue(f.after)} size={16} />
                      </>
                    )}
                  </span>
                )}
                {/* `changed` shows both sides with an explicit arrow; every other
                    state shows the single value it carries. An EMPTY value cell
                    falls back to a dash, so a bare state ("Icon: added" with no
                    icon) still reads as a row rather than a blank gap. */}
                {view.before !== null && (
                  <span className="tbs-field-row__before">{view.before}</span>
                )}
                {view.before !== null && view.after !== null && (
                  <span className="tbs-field-row__arrow" aria-hidden="true">→</span>
                )}
                {view.after !== null && (
                  <span className="tbs-field-row__after">{view.after}</span>
                )}
                {view.before === null && view.after === null && (
                  <span className="tbs-field-row__none" aria-hidden="true">—</span>
                )}
              </span>
              <span className="tbs-field-row__state">{STATE_LABELS[view.state]}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}