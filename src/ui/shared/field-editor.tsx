/**
 * FieldEditor — the shared per-field editor (S4a / DT5 / DT7 / DT9 / DT12).
 *
 * Owns the title/icon field UI for every entry point. It branches on the
 * field's OWN props only (DT1: no `if (surface === 'sidebar')`), and the ability
 * to clear is supplied by the caller's single derivation point (`variant` in
 * `RuleFormFields`), never computed here.
 *
 * Review item 3.1 reshaped this component:
 * - the source picker is a TAB STRIP, not a radio group;
 * - `Use chain` renders the whole `override > slot > rule > site` table with
 *   every tier listed, even the empty ones;
 * - the `↺` reset moved INSIDE the text input, matching the Match URL control,
 *   and is icon-only;
 * - switching back to the "set" tab restores the value that was there before
 *   (seeded from `lastValue`), instead of opening an empty box.
 *
 * Two actions with deliberately different semantics (DT7):
 * - `↺` — PURELY FRONT-END: reverts the in-memory edit to the baseline. Never
 *   writes storage.
 * - `Clear` — ALWAYS immediate (DT12): writes storage, triggers a redelivery,
 *   and is eligible for the atomic UndoBar.
 */

import { useMemo, useState } from 'react';
import { Button, FormField } from './components';
import { Tabs } from './tabs';
import type { TabItem } from './tabs';
import { ChainTierList } from './chain-tier-list';
import { MaskedSummary } from './masked-summary';
import { IconFieldEditor } from './icon-field-editor';
import type { IconFieldValue } from './icon-field-editor';
import { toIconFieldValue, fromIconFieldValue } from './icon-mode-adapter';
import type { IconConfig } from '@ui/components/IconEditor';
import type { ChainResult, TierKey, TierOwner } from '@shared/field-chain';

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
  /**
   * The value to seed the "set" tab with when the user switches back to it.
   * A `null` is a genuine "no previous value" and the box starts empty.
   */
  lastValue?: string | null;
  /** The resolved chain, for the tier table / masking / the unknown (`-`) state. */
  chain: ChainResult;
  baseline: FieldBaseline;
  onResetEdit: () => void;
  onClearChain: () => void;
  clearing?: boolean;
  /**
   * Review item 6: inside `Use chain`, copy ONE record's value into this layer,
   * or clear ONE record's own value. Both act on the RECORD the user picked — a
   * layer can hold several records, so a layer-keyed action could not say which
   * one it meant.
   */
  onApplyTier?: (kind: TierKey, value: string, owner: TierOwner) => void;
  onClearTier?: (owner: TierOwner) => void;
  /**
   * Review item 1: the record whose value the preview should show, and the
   * callback that selects it. Absent when the surface has no preview.
   */
  previewOwner?: TierOwner | null;
  onSelectPreview?: (owner: TierOwner) => void;
  /**
   * Review item 5: the record THIS surface edits, so the summary can label it
   * and the source popover logic can skip it.
   */
  selfOwner?: TierOwner | null;
  /** The tab this chain describes — Page rows name it. */
  tabId?: number | null;
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
  /**
   * Item 6.1: hide the `Use chain` tab on a surface that has no chain yet (a
   * rule being created). Derived by the caller, never guessed here.
   */
  allowUseChain?: boolean;
  /**
   * `Set from Match URL` action, offered on the create surfaces so the user can
   * pull the title/icon the pattern resolves to instead of retyping it.
   */
  onFetchFromMatchUrl?: () => void;
}

const ICON_TABS_BASE: readonly TabItem[] = [
  { id: 'set', label: 'Custom Icon' },
  { id: 'use-chain', label: 'Use chain' },
];

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

/**
 * Item 2.2: each dimension editor announces WHICH field it edits.
 *
 * Without a heading the two editors read as an undifferentiated stack of tab
 * strips ("Title source" / "Icon source" are only accessible names), so a
 * sighted user cannot tell which one is which.
 */
const FIELD_HEADING: Record<'title' | 'icon', string> = {
  title: 'Title',
  icon: 'Icon',
};

/**
 * Item 2.5: the icon picker's own value, held OUTSIDE the parent's `FieldMode`.
 *
 * `FieldMode` cannot distinguish Icon URL / Upload / Custom Icon, so deriving the
 * picker's value from it on every render reset the selection to `Icon URL` and
 * made the other three tabs unclickable. This keeps the richer value locally and
 * only re-derives it when the parent's value genuinely changes to something the
 * local state does not already represent (e.g. a "Use matched icon" fill, or a
 * different row opening).
 */
function useIconFieldState(
  mode: FieldMode,
  iconConfig: IconConfig | undefined,
): [IconFieldValue, (next: IconFieldValue) => void] {
  const [state, setState] = useState<IconFieldValue>(() => toIconFieldValue(mode, iconConfig));
  const [lastProps, setLastProps] = useState<{ mode: FieldMode; iconConfig?: IconConfig }>({ mode, iconConfig });

  // Derive during render (not in an effect) so the picker never paints a stale
  // tab while the parent is mid-update.
  if (!sameIconSource(lastProps, mode, iconConfig) && !matchesLocal(state, mode, iconConfig)) {
    setLastProps({ mode, iconConfig });
    setState(toIconFieldValue(mode, iconConfig));
  }

  return [state, setState];
}

/** Whether the incoming parent value is already what the picker is showing. */
function matchesLocal(state: IconFieldValue, mode: FieldMode, iconConfig: IconConfig | undefined): boolean {
  if (mode.kind === 'use-chain') return state.mode === 'use-chain';
  if (iconConfig) return state.mode === 'custom' && state.iconConfig?.dataUri === iconConfig.dataUri;
  // `url` and `upload` both surface as a plain string; either one is an
  // acceptable representation of the same value.
  return (state.mode === 'url' || state.mode === 'upload') && state.value === mode.value;
}

function sameIconSource(
  previous: { mode: FieldMode; iconConfig?: IconConfig },
  mode: FieldMode,
  iconConfig: IconConfig | undefined,
): boolean {
  return modesEqual(previous.mode, mode) && iconConfigsEqual(previous.iconConfig, iconConfig);
}

/** Whether two baselines are the same value (drives the icon snapshot above). */
function sameBaseline(a: FieldBaseline, b: FieldBaseline): boolean {
  return modesEqual(a.mode, b.mode) && iconConfigsEqual(a.iconConfig, b.iconConfig);
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
  onApplyTier,
  onClearTier,
  previewOwner = null,
  onSelectPreview,
  selfOwner = null,
  tabId = null,
  canClearChain = false,
  submitMode,
  onJumpToOwner,
  impactDefaultExpanded = false,
  impactSummary,
  disabled = false,
  idPrefix = 'field',
  allowUseChain = true,
  onFetchFromMatchUrl,
}: FieldEditorProps) {
  const isTitle = field === 'title';
  const prefix = `${idPrefix}-${field}`;

  /**
   * Items 7 / 9 / 10: when `Use chain` is NOT offered, the `use-chain` mode is
   * not merely hidden — it is UNREPRESENTABLE on this surface, and leaving the
   * picker in it made the field impossible to fill (the tab strip had no
   * selected tab and the text input was gated behind `kind === 'set'`). Every
   * rule created that way silently stored no title/icon, which is exactly the
   * "the rule has no title and the tab never updates" defect.
   *
   * So the displayed tab is the "set" tab whenever the chain is unavailable,
   * regardless of what the incoming mode happens to be.
   */
  const shownKind: 'set' | 'use-chain' = allowUseChain ? mode.kind : 'set';
  /** The text the input shows: only a genuine `set` mode carries a value. */
  const shownValue = mode.kind === 'set' ? mode.value : '';

  /**
   * Review item 1 (round 6): the icon dimension keeps its own "opened with"
   * snapshot.
   *
   * `↺` restores `baseline`, and for the icon dimension the baseline is only
   * `FieldMode` + `iconConfig` — a lossy pair that maps back to a `url`/`upload`/
   * `custom` sub-mode. Restoring it therefore left the picker's richer local
   * value (`iconField`) untouched, so the visible tab and preview did not move
   * and the button looked dead. Snapshotting the PICKER's own value alongside
   * makes `↺` restore exactly what the user opened with, in the picker's
   * vocabulary.
   */
  const [openedIconField, setOpenedIconField] = useState<IconFieldValue>(
    () => toIconFieldValue(baseline.mode, baseline.iconConfig),
  );
  const [lastBaseline, setLastBaseline] = useState<FieldBaseline>(baseline);
  // Derive during render, like `useIconFieldState` above, so the snapshot can
  // never lag the baseline it is supposed to mirror (e.g. a different row).
  if (!sameBaseline(lastBaseline, baseline)) {
    setLastBaseline(baseline);
    setOpenedIconField(toIconFieldValue(baseline.mode, baseline.iconConfig));
  }

  /** Put the icon picker back to the value it opened with. */
  const resetIconEdit = () => {
    setIconField(openedIconField);
    const converted = fromIconFieldValue(openedIconField);
    onChange(converted.mode);
    if (converted.iconConfig !== undefined) onIconConfigChange?.(converted.iconConfig);
    if (submitMode.kind === 'draft') {
      submitMode.onDraftChange({ mode: converted.mode, iconConfig: converted.iconConfig });
    }
    onResetEdit();
  };

  // Item 2.5: the icon picker needs a richer value than `FieldMode` can express,
  // so its state lives here. Called UNCONDITIONALLY (the icon branch below
  // returns early, but hooks may not sit behind a branch) — it is inert for the
  // title dimension.
  const [iconField, setIconField] = useIconFieldState(mode, iconConfig);

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

  const useChainNote = canClearChain
    ? 'Clears this layer \u2014 the value falls back to the next one in the chain.'
    : 'This field stays unset \u2014 other layers will decide.';

  const hintId = `${prefix}-use-chain-hint`;
  const impactId = `${prefix}-impact`;

  const describedBy = [
    mode.kind === 'use-chain' ? hintId : null,
    impactDefaultExpanded ? impactId : null,
  ].filter(Boolean).join(' ') || undefined;

  const items = useMemo<TabItem[]>(() => {
    // `Custom Title` vs `Custom Icon` is a label difference only; the icon tab
    // itself renders the full `IconFieldEditor` underneath (item 3.2).
    const setTab: TabItem = isTitle
      ? { id: 'set', label: 'Custom Title' }
      : ICON_TABS_BASE[0];
    const useChainTab: TabItem = {
      id: 'use-chain',
      label: 'Use chain',
      ...(winnerOwner ? { badge: winnerOwner.kind === 'slot' ? `Slot ${String(winnerOwner.slotId)}` : winnerOwner.kind.charAt(0).toUpperCase() + winnerOwner.kind.slice(1) } : {}),
    };
    // Item 6.1 / IMP-7: the chain tab is a CAPABILITY, not a per-surface branch.
    if (!allowUseChain) return [setTab];
    return [setTab, useChainTab];
  }, [allowUseChain, isTitle, winnerOwner]);

  const goSet = (value: string) => {
    const nextMode: FieldMode = { kind: 'set', value };
    onChange(nextMode);
    if (submitMode.kind === 'draft') {
      submitMode.onDraftChange({ mode: nextMode, iconConfig });
    }
  };

  const handleTabChange = (id: string) => {
    if (id === 'set') {
      // Item 3.1: switching back to the custom tab restores the previous text
      // instead of presenting an empty box.
      const seeded = lastValue ?? (mode.kind === 'set' ? mode.value : '');
      goSet(seeded);
      return;
    }
    const nextMode: FieldMode = { kind: 'use-chain' };
    onChange(nextMode);
    if (submitMode.kind === 'draft') {
      submitMode.onDraftChange({ mode: nextMode, iconConfig });
    }
  };

  const handleValueChange = (value: string) => { goSet(value); };

  // Items 2 / 3.2: the ICON dimension is delegated wholesale to the reusable
  // icon picker. Rendering an outer tab strip too would nest two tab strips with
  // the same accessible name ("Icon source"), which is both ambiguous for a
  // screen reader and redundant — `IconFieldEditor` already owns the
  // Icon URL / Upload / Custom Icon / Use chain tabs and the tier table.
  if (!isTitle) {
    // Item 2.5: the sub-mode (Icon URL vs Upload vs Custom Icon) CANNOT be kept
    // in the parent's `FieldMode` — that model has no room for it, so converting
    // down and back up snapped the picker to `Icon URL` on every render, which is
    // why only that one tab was clickable. `iconField` (declared with the other
    // hooks above) holds a value the round trip cannot destroy; the parent's mode
    // + config remain the working value that is saved.
    return (
      <div className="tbs-field-editor" data-field={field} data-dirty={dirty ? 'true' : 'false'}>
        <div className="tbs-field-editor__title-bar">
          <h4 className="tbs-field-editor__heading">{FIELD_HEADING.icon}</h4>
          {onFetchFromMatchUrl && (
            <button
              type="button"
              className="tbs-field-editor__fetch"
              onClick={onFetchFromMatchUrl}
              disabled={disabled}
            >
              Use matched icon
            </button>
          )}
        </div>

        <IconFieldEditor
          value={iconField}
          onChange={(next) => {
            setIconField(next);
            const converted = fromIconFieldValue(next);
            onChange(converted.mode);
            if (converted.iconConfig !== undefined) onIconConfigChange?.(converted.iconConfig);
            if (submitMode.kind === 'draft') {
              submitMode.onDraftChange({ mode: converted.mode, iconConfig: converted.iconConfig });
            }
          }}
          chain={chain}
          allowUseChain={allowUseChain}
          showPreview
          idPrefix={prefix}
          disabled={disabled}
          {...(onJumpToOwner ? { onJumpToOwner } : {})}
          {...(onApplyTier ? { onApplyTier } : {})}
          {...(onClearTier ? { onClearTier } : {})}
          {...(previewOwner ? { previewOwner } : {})}
          {...(onSelectPreview ? { onSelectPreview } : {})}
          tabId={tabId}
          // Items 8 / 1 (round 6): the ICON dimension needs the same `↺ Reset` the
          // title dimension has, and it must restore the PICKER's value (tab +
          // sub-mode + preview), not just the lossy parent pair.
          onReset={resetIconEdit}
        />

        {/* Review item 2 (round 6): NO summary here.
            `IconFieldEditor` already renders the record summary for the icon
            dimension from the same `chain.nodes`, so a second one here printed
            the identical list twice — the "two masking summaries" report. The inner one is
            the survivor because it is the component that owns the icon surface
            (and the only one present where `allowUseChain` shows its own list). */}

        <div className="tbs-field-editor__actions">
          {canClearChain && (
            <Button variant="danger" size="sm" onClick={onClearChain} loading={clearing} disabled={disabled}>
              Clear icon
            </Button>
          )}
        </div>
        <p className="tbs-field-editor__immediate">Applies immediately</p>
      </div>
    );
  }

  return (
    <div className="tbs-field-editor" data-field={field} data-dirty={dirty ? 'true' : 'false'}>
      <div className="tbs-field-editor__title-bar">
        {/* Item 2.2: name the dimension, so "which field is this" is answerable. */}
        <h4 className="tbs-field-editor__heading">{FIELD_HEADING.title}</h4>
        {onFetchFromMatchUrl && (
          <button
            type="button"
            className="tbs-field-editor__fetch"
            onClick={onFetchFromMatchUrl}
            disabled={disabled}
          >
            Use matched title
          </button>
        )}
      </div>

      <Tabs
        items={items}
        // `shownKind`, not `mode.kind`: when the chain is unavailable there is no
        // `use-chain` tab, so reporting it would leave the strip with NO selected
        // tab (issue 1 — the tier table then rendered on a surface that must not
        // show it).
        value={shownKind}
        onChange={handleTabChange}
        label="Title source"
        idPrefix={prefix}
        disabled={disabled}
        {...(describedBy ? { ariaDescribedBy: describedBy } : {})}
      />

      {/* Only the title dimension reaches here (the icon case returned above). */}
      {shownKind === 'use-chain' && (
        <>
          <p id={hintId} className="tbs-field-editor__note">{useChainNote}</p>
          <ChainTierList
            chain={chain}
            idPrefix={prefix}
            field={field}
            tabId={tabId}
            {...(onJumpToOwner ? { onJumpToOwner } : {})}
            // Items 2 / 6 / 8: per-record "apply this value here" / "clear this
            // record". The record — not the layer — is the unit, because a layer
            // can hold several.
            {...(onApplyTier ? { onApplyTier } : {})}
            {...(onClearTier ? { onClearTier } : {})}
            {...(previewOwner ? { selectedOwner: previewOwner } : {})}
            {...(onSelectPreview ? { onSelectNode: (node: { owner: TierOwner }) => { onSelectPreview(node.owner); } } : {})}
          />
        </>
      )}

      {shownKind === 'set' && (
        // The sub-input label must NOT repeat the tab's text, or the
        // accessibility tree would expose two controls with the same name.
        <FormField label="Custom title text" htmlFor={`${prefix}-value`}>
          <div className="tbs-inline-field">
            <input
              id={`${prefix}-value`}
              type="text"
              value={shownValue}
              onChange={(e) => { handleValueChange(e.target.value); }}
              disabled={disabled}
            />
            {/* Item 3.1: icon-only reset, on the RIGHT of the input, matching
                the Match URL control. Purely front-end (DT7). */}
            <button
              type="button"
              className="tbs-inline-field__reset"
              onClick={onResetEdit}
              disabled={!dirty || disabled}
              aria-label="Reset this edit"
              title="Reset this edit"
            >
              ↺
            </button>
          </div>
        </FormField>
      )}

      {shownKind === 'set' && (
        <div className="tbs-field-editor__current">
          <span className="tbs-field-editor__value">{displayValue}</span>
          {winnerOwner && (
            <button
              type="button"
              className="tbs-field-editor__badge"
              onClick={() => onJumpToOwner?.(winnerOwner)}
              aria-label={`Jump to ${winnerOwner.kind === 'slot' ? `Slot ${String(winnerOwner.slotId)}` : winnerOwner.kind} source`}
            >
              {winnerOwner.kind === 'slot' ? `Slot ${String(winnerOwner.slotId)}` : winnerOwner.kind.charAt(0).toUpperCase() + winnerOwner.kind.slice(1)}
            </button>
          )}
        </div>
      )}

      {/* Review items 2 / 5: EVERY record on this tab, no clear buttons. */}
      <MaskedSummary
        nodes={chain.nodes}
        field={field}
        {...(onJumpToOwner ? { onJumpToOwner } : {})}
        {...(selfOwner ? { selfOwner } : {})}
        tabId={tabId}
        fieldLabel="Title"
        idPrefix={prefix}
      />

      {impactDefaultExpanded && (
        <div id={impactId} className="tbs-field-editor__impact" role="region" aria-label="Impact preview">
          <p>{impactSummary ?? 'This removes the value this layer owns. Lower layers will decide again.'}</p>
        </div>
      )}

      <div className="tbs-field-editor__actions">
        {/* DT7 (2) / DT12: always immediate; eligible for the atomic UndoBar. */}
        {canClearChain && (
          <Button variant="danger" size="sm" onClick={onClearChain} loading={clearing} disabled={disabled}>
            Clear title
          </Button>
        )}
      </div>

      {/* DT12: the immediate-write marker is required and visually separate. */}
      <p className="tbs-field-editor__immediate">Applies immediately</p>
    </div>
  );
}