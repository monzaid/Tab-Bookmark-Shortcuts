/**
 * RuleFormFields — the shared rule form field set (S4b / DT8 / IMP-7).
 *
 * Every surface that edits a rule (sidebar create modal, settings "New Rule",
 * settings inline editor) renders THIS component, so field sets, validation and
 * copy are identical by construction (SC8). The only intentional difference
 * between surfaces is POSITION (IMP-3), which is the caller's concern.
 *
 * IMP-7 / G-2: `canClearChain` is derived in EXACTLY ONE place — here, from
 * `variant` — and passed down explicitly. No call site may hand-write the
 * boolean, and `FieldEditor` never re-derives it.
 */

import { useMemo } from 'react';
import { Button } from './components';
import { RadioGroup } from './radio-group';
import { FieldEditor } from './field-editor';
import type { FieldMode } from './field-editor';
import { validateRuleForm } from '@shared/form-validation';
import { wildcardToRegex } from '@shared/url-utils';
import type { ChainResult } from '@shared/field-chain';
import type { IconConfig } from '@ui/components/IconEditor';

export type RuleFormVariant = 'create' | 'edit';

export interface RuleFormFieldsValue {
  url: string;
  matchType: 'exact' | 'regex';
  titleMode: FieldMode;
  iconMode: FieldMode;
  iconConfig?: IconConfig;
  priority: number;
  enabled?: boolean;
}

export interface RuleFormFieldsProps {
  /** ONLY two states — the single source of the clear capability (IMP-7). */
  variant: RuleFormVariant;
  value: RuleFormFieldsValue;
  onChange: (patch: Partial<RuleFormFieldsValue>) => void;
  /** REQUIRED: never fall back to an implicit default (DT1). */
  prefill: { url: string };
  chain: ChainResult;
  titleChain: ChainResult;
  iconChain: ChainResult;
  baselineTitle: { mode: FieldMode };
  baselineIcon: { mode: FieldMode; iconConfig?: IconConfig };
  onResetTitleEdit: () => void;
  onResetIconEdit: () => void;
  onClearTitle: () => void;
  onClearIcon: () => void;
  clearing?: boolean;
  submitMode: { kind: 'immediate' } | { kind: 'draft'; dirty: boolean; onDraftChange: (next: { mode: FieldMode; iconConfig?: IconConfig }) => void };
  onJumpToOwner?: (owner: import('@shared/field-chain').TierOwner) => void;
  /** DT9: the Clear preview starts expanded where a global config is at risk. */
  impactDefaultExpanded?: boolean;
  impactTitleSummary?: string;
  impactIconSummary?: string;
  disabled?: boolean;
  showEnabled?: boolean;
  /** Id prefix so several instances can coexist (e.g. multiple inline editors). */
  idPrefix?: string;
}

export function RuleFormFields({
  variant,
  value,
  onChange,
  prefill,
  titleChain,
  iconChain,
  baselineTitle,
  baselineIcon,
  onResetTitleEdit,
  onResetIconEdit,
  onClearTitle,
  onClearIcon,
  clearing = false,
  submitMode,
  onJumpToOwner,
  impactDefaultExpanded = false,
  impactTitleSummary,
  impactIconSummary,
  disabled = false,
  showEnabled = false,
  idPrefix = 'rf',
}: RuleFormFieldsProps) {
  // ─── IMP-7: the ONE derivation point for the clear capability ──────────────
  const canClearChain = variant !== 'create';

  const urlId = `${idPrefix}-url`;
  const priorityId = `${idPrefix}-priority`;

  const validation = useMemo(
    () =>
      validateRuleForm({
        matchType: value.matchType,
        url: value.url,
        titleMode: value.titleMode.kind === 'set' ? 'set' : 'use-chain',
        titleValue: value.titleMode.kind === 'set' ? value.titleMode.value : '',
        iconMode: value.iconMode.kind === 'set' ? 'url' : 'use-chain',
        iconValue: value.iconMode.kind === 'set' ? value.iconMode.value : '',
        ...(value.iconConfig ? { iconConfig: { dataUri: value.iconConfig.dataUri ?? '' } } : {}),
      }),
    [value],
  );

  const matchUrlError = validation.errors.find((e) => e.field === 'matchUrl' && e.severity === 'block');
  const matchUrlWarn = validation.errors.find((e) => e.field === 'matchUrl' && e.severity === 'warn');
  const regexPreview = value.matchType === 'regex' && value.url.trim()
    ? wildcardToRegex(value.url.trim())
    : null;

  return (
    <div className="tbs-rule-form-fields" data-variant={variant}>
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
            aria-describedby={matchUrlError ? `${urlId}-error` : regexPreview ? `${urlId}-hint` : undefined}
            aria-invalid={matchUrlError ? true : undefined}
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
        {matchUrlWarn && (
          <span className="tbs-form-field__hint">{matchUrlWarn.message}</span>
        )}
        {matchUrlError && (
          <span id={`${urlId}-error`} role="alert" className="tbs-form-field__error">
            <span aria-hidden="true">⚠ </span>{matchUrlError.message}
          </span>
        )}
      </div>

      <RadioGroup
        label="Match Type"
        name={`${idPrefix}-match-type`}
        value={value.matchType}
        onChange={(next) => { onChange({ matchType: next as 'exact' | 'regex' }); }}
        options={[
          { value: 'exact', label: 'Exact URL' },
          { value: 'regex', label: 'Regex pattern' },
        ]}
        disabled={disabled}
        aria-describedby={regexPreview ? `${urlId}-hint` : undefined}
      />

      <FieldEditor
        field="title"
        idPrefix={`${idPrefix}-ed`}
        mode={value.titleMode}
        onChange={(mode) => { onChange({ titleMode: mode }); }}
        chain={titleChain}
        baseline={baselineTitle}
        onResetEdit={onResetTitleEdit}
        onClearChain={onClearTitle}
        clearing={clearing}
        canClearChain={canClearChain}
        submitMode={submitMode}
        onJumpToOwner={onJumpToOwner}
        impactDefaultExpanded={impactDefaultExpanded}
        impactSummary={impactTitleSummary}
        disabled={disabled}
      />

      <FieldEditor
        field="icon"
        idPrefix={`${idPrefix}-ed`}
        mode={value.iconMode}
        onChange={(mode) => { onChange({ iconMode: mode }); }}
        iconConfig={value.iconConfig}
        onIconConfigChange={(cfg) => { onChange({ iconConfig: cfg }); }}
        chain={iconChain}
        baseline={baselineIcon}
        onResetEdit={onResetIconEdit}
        onClearChain={onClearIcon}
        clearing={clearing}
        canClearChain={canClearChain}
        submitMode={submitMode}
        onJumpToOwner={onJumpToOwner}
        impactDefaultExpanded={impactDefaultExpanded}
        impactSummary={impactIconSummary}
        disabled={disabled}
      />

      <div className="tbs-form-field">
        <label htmlFor={priorityId} className="tbs-form-field__label">Priority (-100 to 100)</label>
        <input
          id={priorityId}
          type="number"
          min={-100}
          max={100}
          value={value.priority}
          onChange={(e) => { onChange({ priority: parseInt(e.target.value, 10) || 0 }); }}
          aria-describedby={`${priorityId}-hint`}
          disabled={disabled}
        />
        <span id={`${priorityId}-hint`} className="tbs-form-field__hint">Higher priority wins when several rules match.</span>
      </div>

      {showEnabled && (
        <div className="tbs-form-field">
          <label className="tbs-form-field__label">
            <input
              type="checkbox"
              checked={value.enabled !== false}
              onChange={(e) => { onChange({ enabled: e.target.checked }); }}
              disabled={disabled}
            />
            {' '}Enabled
          </label>
        </div>
      )}

      {submitMode.kind === 'draft' && (
        <div className="tbs-rule-form-fields__actions">
          <Button size="sm" variant="primary" disabled={!submitMode.dirty}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}