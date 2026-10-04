/**
 * RuleFormFields — the shared rule form field set (S4b / DT8 / IMP-7).
 *
 * Every surface that edits a rule (sidebar create modal, settings "New Rule",
 * settings inline editor) renders THIS component, so field sets, validation and
 * copy are identical by construction (SC8). The only intentional difference
 * between surfaces is POSITION (IMP-3), which is the caller's concern.
 *
 * The field set is COMPOSED from smaller reusable components, so each control
 * has exactly one definition and a future surface can assemble a subset:
 *   - `MatchFields`  — Match URL + Match Type (kept together: both drive the preview)
 *   - `FieldEditor`  — the Title / Icon dimension editor (S4a)
 *   - `PriorityField`— the priority input
 *
 * IMP-7 / G-2: `canClearChain` is derived in EXACTLY ONE place — here, from
 * `variant` — and passed down explicitly. No call site may hand-write the
 * boolean, and `FieldEditor` never re-derives it.
 */

import { useMemo } from 'react';
import { Button } from './components';
import { FieldEditor } from './field-editor';
import type { FieldMode } from './field-editor';
import { MatchFields } from './match-fields';
import { PriorityField } from './priority-field';
import { ImpactPreview } from './impact-preview';
import { validateRuleDraft } from './rule-form-submit';
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
  /**
   * Item 6.1: a rule being CREATED has no chain of its own, so `Use chain` gets
   * nothing to fall back to. Derived from `variant` unless the caller overrides
   * it — the same single-derivation rule as `canClearChain` (IMP-7).
   */
  allowUseChain?: boolean;
  /** Item 3.1: the text the `Custom Title` tab restores when re-selected. */
  titleLastValue?: string | null;
  /** Item 3.1: the icon URL the `Custom Icon` tab restores when re-selected. */
  iconLastValue?: string | null;
  /**
   * Item 6.1: pull the title / icon the current Match URL resolves to, so a new
   * rule can start from the value the page would actually show.
   */
  onFetchTitleFromMatchUrl?: () => void;
  onFetchIconFromMatchUrl?: () => void;
  /**
   * Items 6.2 / 6.3: show `Matches N tabs · M masked` for the current pattern.
   * `excludeRuleId` keeps a rule from counting itself as the winner while edited.
   */
  showImpactPreview?: boolean;
  impactExcludeRuleId?: string;
  /**
   * Items 2 / 6 / 8: inside `Use chain`, copy ONE RECORD's value into this layer
   * or clear ONE record's own value. Keyed by the record, because a layer can
   * hold several records and a layer-keyed action could not name its target.
   */
  onApplyTier?: (kind: import('@shared/field-chain').TierKey, value: string, owner: import('@shared/field-chain').TierOwner, field: 'title' | 'icon') => void;
  onClearTier?: (owner: import('@shared/field-chain').TierOwner, field: 'title' | 'icon') => void;
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
  allowUseChain,
  titleLastValue,
  iconLastValue,
  onFetchTitleFromMatchUrl,
  onFetchIconFromMatchUrl,
  showImpactPreview = false,
  impactExcludeRuleId,
  onApplyTier,
  onClearTier,
}: RuleFormFieldsProps) {
  // ─── IMP-7: the ONE derivation point for the clear capability ──────────────
  const canClearChain = variant !== 'create';
  // Item 6.1: a creation surface has no chain yet, so the `Use chain` tab is
  // hidden there. Derived from `variant` here, exactly like `canClearChain`.
  const canUseChain = allowUseChain ?? (variant !== 'create');

  // One validation per render, shared by the inline Match URL messages AND the
  // MatchFields component (the validator that gates the save is the only one).
  const validation = useMemo(() => validateRuleDraft(value), [value]);
  const matchUrlError = validation.errors.find((e) => e.field === 'matchUrl' && e.severity === 'block');
  const matchUrlWarn = validation.errors.find((e) => e.field === 'matchUrl' && e.severity === 'warn');

  return (
    <div className="tbs-rule-form-fields" data-variant={variant}>
      <MatchFields
        value={{ url: value.url, matchType: value.matchType }}
        onChange={onChange}
        prefill={prefill}
        {...(matchUrlError ? { error: matchUrlError } : {})}
        {...(matchUrlWarn ? { warn: matchUrlWarn } : {})}
        idPrefix={idPrefix}
        disabled={disabled}
      />

      {/* Items 6.2 / 6.3: the exact impact of this pattern over the OPEN tabs. */}
      {showImpactPreview && (
        <ImpactPreview
          urlMatch={value.url.trim() ? { type: value.matchType, value: value.url } : null}
          {...(impactExcludeRuleId ? { excludeRuleId: impactExcludeRuleId } : {})}
          field="title"
          defaultExpanded={impactDefaultExpanded}
        />
      )}

      {/* Item 1 layout: the two dimension editors form one explicit pair, so the
          responsive grid has ONE stable hook instead of positional selectors. */}
      <div className="tbs-rule-form-fields__pair">
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
        allowUseChain={canUseChain}
        {...(titleLastValue !== undefined ? { lastValue: titleLastValue } : {})}
        {...(onFetchTitleFromMatchUrl ? { onFetchFromMatchUrl: onFetchTitleFromMatchUrl } : {})}
        {...(onApplyTier ? { onApplyTier: (kind: import('@shared/field-chain').TierKey, v: string, owner: import('@shared/field-chain').TierOwner) => { onApplyTier(kind, v, owner, 'title'); } } : {})}
        {...(onClearTier ? { onClearTier: (owner: import('@shared/field-chain').TierOwner) => { onClearTier(owner, 'title'); } } : {})}
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
        allowUseChain={canUseChain}
        {...(iconLastValue !== undefined ? { lastValue: iconLastValue } : {})}
        {...(onFetchIconFromMatchUrl ? { onFetchFromMatchUrl: onFetchIconFromMatchUrl } : {})}
        {...(onApplyTier ? { onApplyTier: (kind: import('@shared/field-chain').TierKey, v: string, owner: import('@shared/field-chain').TierOwner) => { onApplyTier(kind, v, owner, 'icon'); } } : {})}
        {...(onClearTier ? { onClearTier: (owner: import('@shared/field-chain').TierOwner) => { onClearTier(owner, 'icon'); } } : {})}
      />
      </div>

      <PriorityField
        value={value.priority}
        onChange={(priority) => { onChange({ priority }); }}
        idPrefix={idPrefix}
        disabled={disabled}
      />

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