/**
 * FieldEditor — the shared per-field editor (S4a / DT5 / DT7 / DT9 / DT12).
 *
 * Owns the title/icon field UI for all four entry points. It branches on the
 * field's OWN props only (DT1: no `if (surface === 'sidebar')`), and the ability
 * to clear is supplied by the caller's single derivation point (`variant` in
 * `RuleFormFields`), never computed here.
 *
 * Two actions with deliberately different semantics (DT7):
 * - Reset this edit — PURELY FRONT-END: reverts the in-memory edit to the
 *   baseline. It never writes storage.
 * - Clear title / Clear icon — ALWAYS immediate (DT12): it writes storage and
 *   triggers a redelivery, and is eligible for the atomic UndoBar.
 */

import { useMemo } from 'react';
import { Button, FormField } from './components';
import { RadioGroup } from './radio-group';
import { IconEditor, renderIconToDataUri } from '@ui/components/IconEditor';
import type { IconConfig } from '@ui/components/IconEditor';
import type { ChainResult, TierOwner } from '@shared/field-chain';

// ─── Mode model (DT5) ────────────────────────────────────────────────────────

export type FieldMode =
  | { kind: 'set'; value: string }
  | { kind: 'use-chain' };

export interface FieldBaseline {
  mode: FieldMode;
  iconConfig?: IconConfig;
}

export interface SubmitModeDraft {
  kind: 'draft';
  dirty: boolean;
  onDraftChange: (next: { mode: FieldMode; iconConfig?: IconConfig }) => void;
}

export type SubmitMode = { kind: 'immediate' } | SubmitModeDraft;

export interface FieldEditorProps {
  field: 'title' | 'icon';
  mode: FieldMode;
  onChange: (mode: FieldMode) => void;
  iconConfig?: IconConfig;
  onIconConfigChange?: (config: IconConfig) => void;
  /** The last committed value (used to prefill a "set" editor). */
  lastValue?: string | null;
  /** The resolved chain, for badges / masking / the unknown (`-`) state. */
  chain: ChainResult;
  baseline: FieldBaseline;
  onResetEdit: () => void;
  onClearChain: () => void;
  clearing?: boolean;
  /** Present only while a masking tier can be cleared. */
  onClearMaskingOverride?: (owner: TierOwner) => void;
  /**
   * Capability flag. MUST be derived once by `RuleFormFields` from `variant` —
   * this component never re-derives it (IMP-7).
   */
  canClearChain?: boolean;
  submitMode: SubmitMode;
  /** Jump to the tier owner of a badge (F1/F1b). */
  onJumpToOwner?: (owner: TierOwner) => void;
  /** `impactDefaultExpanded` (DT9): the Clear preview starts open. */
  impactDefaultExpanded?: boolean;
  impactSummary?: string;
  disabled?: boolean;
  /** Id prefix so several editors can coexist on one page. */
  idPrefix?: string;
}

const TITLE_OPTIONS = [
  { value: 'set', label: 'Custom Title' },
  { value: 'use-chain', label: 'Use chain' },
];

const ICON_OPTIONS = [
  { value: 'set', label: 'Icon URL' },
  { value: 'use-chain', label: 'Use chain' },
];

const SOURCE_LABEL: Record<TierOwner['kind'], string> = {
  override: 'Page',
  slot: 'Slot',
  rule: 'Rule',
  site: 'Site',
};

function badgeLabel(owner: TierOwner): string {
  switch (owner.kind) {
    case 'slot':
      return `Slot ${String(owner.slotId)}`;
    case 'override':
      return 'Page';
    case 'rule':
      return 'Rule';
    case 'site':
      return 'Site';
  }
}

/** Equality of two modes — drives the derived `dirty` (DT12). */
function modesEqual(a: FieldMode, b: FieldMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'set' && b.kind === 'set') return a.value === b.value;
  return true;
}

function iconConfigsEqual(a?: IconConfig, b?: IconConfig): boolean {
  if (!a || !b) return a === b;
  return a.dataUri === b.dataUri && a.bgColor === b.bgColor && a.text === b.text && a.textColor === b.textColor;
}

export function FieldEditor({
  field,
  mode,
  onChange,
  iconConfig,
  onIconConfigChange,
  lastValue,
  chain,
  baseline,
  onResetEdit,
  onClearChain,
  clearing = false,
  onClearMaskingOverride,
  canClearChain = false,
  submitMode,
  onJumpToOwner,
  impactDefaultExpanded = false,
  impactSummary,
  disabled = false,
  idPrefix = 'field',
}: FieldEditorProps) {
  const isTitle = field === 'title';
  const label = isTitle ? 'Title source' : 'Icon source';
  const options = isTitle ? TITLE_OPTIONS : ICON_OPTIONS;
  const prefix = `${idPrefix}-${field}`;

  // DT12: `dirty` is DERIVED from the baseline, never set by hand.
  const dirty = useMemo(
    () => !modesEqual(mode, baseline.mode) || !iconConfigsEqual(iconConfig, baseline.iconConfig),
    [mode, baseline, iconConfig],
  );

  // The winning tier's OWNER — carries the address the badge jumps to.
  const winnerOwner: TierOwner | undefined = chain.tiers[chain.winner.source]?.owner;

  const winner = chain.winner;
  const unknownSite = winner.source === 'site' && winner.value === null && !chain.tiers.site.known;
  const displayValue = unknownSite ? '\u2014' : (winner.value ?? '\u2014');

  const useChainNote =
    baseline.mode.kind === 'use-chain' && canClearChain
      ? 'Clears this layer \u2014 the value falls back to the next one in the chain.'
      : 'This field stays unset \u2014 other layers will decide.';

  const hintId = `${prefix}-use-chain-hint`;
  const maskId = `${prefix}-mask`;
  const impactId = `${prefix}-impact`;

  const describedBy = [
    mode.kind === 'use-chain' ? hintId : null,
    chain.masked.length > 0 ? maskId : null,
    impactDefaultExpanded ? impactId : null,
  ].filter(Boolean).join(' ') || undefined;

  const handleModeChange = (next: string) => {
    const nextMode: FieldMode = next === 'set' ? { kind: 'set', value: lastValue ?? '' } : { kind: 'use-chain' };
    onChange(nextMode);
    if (submitMode.kind === 'draft') {
      submitMode.onDraftChange({ mode: nextMode, iconConfig });
    }
  };

  const handleValueChange = (value: string) => {
    const nextMode: FieldMode = { kind: 'set', value };
    onChange(nextMode);
    if (submitMode.kind === 'draft') {
      submitMode.onDraftChange({ mode: nextMode, iconConfig });
    }
  };

  return (
    <div className="tbs-field-editor" data-field={field} data-dirty={dirty ? 'true' : 'false'}>
      <RadioGroup
        label={label}
        name={`${prefix}-mode`}
        value={mode.kind}
        onChange={handleModeChange}
        options={options}
        disabled={disabled}
        aria-describedby={describedBy}
      />

      {mode.kind === 'use-chain' && (
        <p id={hintId} className="tbs-field-editor__note">
          {useChainNote}
        </p>
      )}

      {mode.kind === 'set' && (
        // The sub-input label must NOT repeat the radio option's text, or the
        // accessibility tree would expose two controls with the same name.
        <FormField label={isTitle ? 'Custom title text' : 'Custom icon URL'} htmlFor={`${prefix}-value`}>
          <input
            id={`${prefix}-value`}
            type="text"
            value={mode.value}
            onChange={(e) => { handleValueChange(e.target.value); }}
            disabled={disabled}
          />
        </FormField>
      )}

      {!isTitle && mode.kind === 'set' && (
        <IconEditor
          value={iconConfig ?? { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' }}
          onChange={(cfg) => {
            onIconConfigChange?.(cfg);
            if (submitMode.kind === 'draft') submitMode.onDraftChange({ mode, iconConfig: cfg });
          }}
          size={48}
        />
      )}

      <div className="tbs-field-editor__current">
        <span className="tbs-field-editor__value">{displayValue}</span>
        {winnerOwner && (
          <button
            type="button"
            className="tbs-field-editor__badge"
            onClick={() => onJumpToOwner?.(winnerOwner)}
            aria-label={`Jump to ${SOURCE_LABEL[winnerOwner.kind]} source`}
          >
            {badgeLabel(winnerOwner)}
          </button>
        )}
      </div>

      {chain.masked.length > 0 && (
        <p id={maskId} className="tbs-field-editor__masked">
          Overridden by {chain.masked.map(badgeLabel).join(', ')}
          {onClearMaskingOverride && chain.masked[0] && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onClearMaskingOverride(chain.masked[0]); }}
            >
              Clear the page setting
            </Button>
          )}
        </p>
      )}

      {impactDefaultExpanded && (
        <div id={impactId} className="tbs-field-editor__impact" role="region" aria-label="Impact preview">
          <p>{impactSummary ?? 'This removes the value this layer owns. Lower layers will decide again.'}</p>
        </div>
      )}

      <div className="tbs-field-editor__actions">
        {/* DT7 (1): purely front-end revert — never writes storage. */}
        <Button variant="ghost" size="sm" onClick={onResetEdit} disabled={!dirty || disabled}>
          {'\u21ba'} Reset this edit
        </Button>
        {/* DT7 (2) / DT12: always immediate; eligible for the atomic UndoBar. */}
        {canClearChain && (
          <Button variant="danger" size="sm" onClick={onClearChain} loading={clearing} disabled={disabled}>
            {isTitle ? 'Clear title' : 'Clear icon'}
          </Button>
        )}
      </div>

      {/* DT12: the immediate-write marker is required and visually separate. */}
      <p className="tbs-field-editor__immediate">Applies immediately</p>
    </div>
  );
}

/** Helper for callers: render an iconConfig to the data URI the editor stores. */
export function iconConfigToValue(config: IconConfig): string {
  return renderIconToDataUri(config, 64);
}