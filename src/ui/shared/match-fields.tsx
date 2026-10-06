/**
 * MatchFields — the reusable "Match URL + Match Type" field group.
 *
 * Extracted verbatim out of `RuleFormFields` (DT8) so the URL-pattern half of a
 * rule form is a single named component that any surface can drop in. The two
 * controls are kept inseparable on purpose: the regex preview AND the Match URL
 * error node both depend on `matchType`, so splitting them would let the two
 * drift apart.
 *
 * Single validation source (E1): this component does NOT re-run the validator.
 * The blocking/warning issues are PASSED IN, already produced once by the parent
 * via `validateRuleForm`. A second local validation could disagree with the
 * validator that actually gates the save — the exact defect E1 removes.
 */

import { RadioGroup } from './radio-group';
import { MATCH_TYPE_LABELS } from '@shared/match-type-labels';
import { wildcardToRegex } from '@shared/url-utils';
import type { ValidationIssue } from '@shared/form-validation';

export interface MatchFieldsValue {
  url: string;
  matchType: 'exact' | 'regex';
}

export interface MatchFieldsProps {
  value: MatchFieldsValue;
  onChange: (patch: Partial<MatchFieldsValue>) => void;
  /** REQUIRED: the reset button's target — never an implicit default (DT1). */
  prefill: { url: string };
  /** Blocking issue for Match URL, if any (from the parent's single validation). */
  error?: ValidationIssue;
  /** Non-blocking Match URL warning, if any (E1-b: never blocks the save). */
  warn?: ValidationIssue;
  /** Id prefix so several instances can coexist (e.g. multiple inline editors). */
  idPrefix: string;
  disabled?: boolean;
}

export function MatchFields({
  value,
  onChange,
  prefill,
  error,
  warn,
  idPrefix,
  disabled = false,
}: MatchFieldsProps) {
  const urlId = `${idPrefix}-url`;

  // E1-a: the preview shows the string that will ACTUALLY be stored, so the
  // wildcard conversion is performed here exactly as the save path does it.
  const regexPreview =
    value.matchType === 'regex' && value.url.trim() ? wildcardToRegex(value.url.trim()) : null;

  return (
    <>
      <div className="tbs-form-field">
        <label htmlFor={urlId} className="tbs-form-field__label">
          Match URL <span aria-hidden="true">*</span>
        </label>
        <div className="tbs-inline-field">
          <input
            id={urlId}
            type="text"
            value={value.url}
            onChange={(e) => { onChange({ url: e.target.value }); }}
            aria-describedby={error ? `${urlId}-error` : regexPreview ? `${urlId}-hint` : undefined}
            aria-invalid={error ? true : undefined}
            disabled={disabled}
          />
          <button
            type="button"
            className="tbs-inline-field__reset"
            onClick={() => { onChange({ url: prefill.url }); }}
            aria-label="Reset Match URL"
            disabled={disabled}
          >
            ↺
          </button>
        </div>
        {regexPreview && (
          <span id={`${urlId}-hint`} className="tbs-form-field__hint">
            {regexPreview.converted ? `Will be saved as: ${regexPreview.pattern}` : 'Valid regular expression'}
          </span>
        )}
        {warn && (
          <span className="tbs-form-field__hint">{warn.message}</span>
        )}
        {error && (
          <span id={`${urlId}-error`} role="alert" className="tbs-form-field__error">
            <span aria-hidden="true">⚠ </span>{error.message}
          </span>
        )}
      </div>

      <RadioGroup
        label="Match Type"
        name={`${idPrefix}-match-type`}
        value={value.matchType}
        onChange={(next) => { onChange({ matchType: next as 'exact' | 'regex' }); }}
        options={[
          { value: 'exact', label: MATCH_TYPE_LABELS.exact },
          { value: 'regex', label: MATCH_TYPE_LABELS.regex },
        ]}
        disabled={disabled}
        // Item 2.1: one horizontal row, not two stacked lines.
        inline
        aria-describedby={regexPreview ? `${urlId}-hint` : undefined}
      />
    </>
  );
}