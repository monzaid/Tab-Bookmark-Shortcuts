/**
 * IconFieldEditor — the reusable, five-tab icon source editor.
 *
 * Manual acceptance review (item 2): the icon editor must offer
 *   Icon URL / Upload / Custom Icon / Use chain
 * as MUTUALLY EXCLUSIVE tabs, show the whole `override > slot > rule > site`
 * chain (every tier listed even when it has no value) and keep a live canvas
 * preview. It must be a reusable class so the sidebar "Change Icon" modal and
 * every other surface render THE SAME component.
 *
 * Upload is its own tab and therefore the composite editor is rendered with
 * `hideUpload` — otherwise the same file could be picked from two places.
 */
import { useMemo, useRef } from 'react';
import { Tabs } from './tabs';
import type { TabItem } from './tabs';
import { ChainTierList } from './chain-tier-list';
import { MaskedSummary } from './masked-summary';
import { IconEditor, renderIconToDataUri } from '@ui/components/IconEditor';
import type { IconConfig } from '@ui/components/IconEditor';
import type { ChainNode, ChainResult, TierKey, TierOwner } from '@shared/field-chain';
import { sourceBadge, sourceDescription } from './source-description';

export type IconSourceMode = 'url' | 'upload' | 'custom' | 'use-chain';

export interface IconFieldValue {
  mode: IconSourceMode;
  /** Icon URL mode, or the resolved data URI for upload/custom. */
  value: string;
  /** Composite-editor state for the Custom Icon tab. */
  iconConfig?: IconConfig;
}

export interface IconFieldEditorProps {
  value: IconFieldValue;
  onChange: (next: IconFieldValue) => void;
  /** Resolved chain — drives the tier list, the winner badge and masking. */
  chain: ChainResult;
  /**
   * Offer the `Use chain` tab.
   *
   * `false` on creation surfaces: a not-yet-saved rule has no chain of its own,
   * so `Use chain` would have nothing to fall back to (item 6.1). The capability
   * is passed EXPLICITLY by the caller's single derivation point (IMP-7).
   */
  allowUseChain: boolean;
  /** Show the live canvas / image preview. */
  showPreview?: boolean;
  /** Id prefix so several editors can coexist. */
  idPrefix?: string;
  disabled?: boolean;
  onJumpToOwner?: (owner: TierOwner) => void;
  /** Items 2 / 6 / 8: per-record "apply this value here" / "clear this record". */
  onApplyTier?: (kind: TierKey, value: string, owner: TierOwner) => void;
  onClearTier?: (owner: TierOwner) => void;
  /**
   * Review item 1: the record whose icon the PREVIEW should show.
   *
   * Clicking a row in `Use chain` previews that record's icon, so the user sees
   * exactly what they are about to apply before writing anything. Without a
   * selection the preview keeps showing the effective value.
   */
  previewOwner?: TierOwner | null;
  onSelectPreview?: (owner: TierOwner) => void;
  /**
   * Review item 3: restore the value the editor had when it was opened.
   * Absent on surfaces with no captured baseline (the rule form manages its own).
   */
  onReset?: () => void;
  /** The record this surface edits, so the summary can label it. */
  selfOwner?: TierOwner | null;
  /** The tab this chain describes — Page rows name it. */
  tabId?: number | null;
}

export const ICON_SOURCE_LABEL: Record<TierOwner['kind'], string> = {
  override: 'Page',
  slot: 'Slot',
  rule: 'Rule',
  site: 'Site',
};

function tierLabel(owner: TierOwner): string {
  return owner.kind === 'slot' ? `Slot ${String(owner.slotId)}` : ICON_SOURCE_LABEL[owner.kind];
}

/** Identity of a record, so a selection can be matched to its node. */
function isSelected(a: TierOwner | null, b: TierOwner): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'slot') return a.slotId === (b as { slotId: number }).slotId;
  if (a.kind === 'override') return a.tabId === (b as { tabId: number }).tabId;
  if (a.kind === 'rule') return a.ruleId === (b as { ruleId: string }).ruleId;
  return true;
}

export function IconFieldEditor(props: IconFieldEditorProps) {
  const {
    onChange,
    chain,
    allowUseChain,
    showPreview = true,
    idPrefix = 'icon-src',
    disabled = false,
    onJumpToOwner,
    onApplyTier,
    onClearTier,
    previewOwner = null,
    onSelectPreview,
    onReset,
    selfOwner = null,
    tabId = null,
  } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Items 7 / 9 / 10: when `Use chain` is not offered, `use-chain` is not a
   * representable state. Leaving the picker in it selected NO tab (the strip has
   * no such tab) and rendered no panel, so the icon could never be set on a new
   * rule — which is why created rules had no icon and their tabs never updated.
   */
  const value: IconFieldValue = allowUseChain || props.value.mode !== 'use-chain'
    ? props.value
    : { mode: 'url', value: props.value.value };

  const items = useMemo<TabItem[]>(() => {
    const base: TabItem[] = [
      { id: 'url', label: 'Icon URL' },
      { id: 'upload', label: 'Upload' },
      { id: 'custom', label: 'Custom Icon' },
    ];
    if (allowUseChain) {
      // The winning tier is surfaced ON the tab, so the user sees what "use
      // chain" currently resolves to without opening it.
      const winnerOwner = chain.tiers[chain.winner.source]?.owner;
      base.push({
        id: 'use-chain',
        label: 'Use chain',
        ...(winnerOwner ? { badge: tierLabel(winnerOwner) } : {}),
      });
    }
    return base;
  }, [allowUseChain, chain]);

  /**
   * Review item 1: inside `Use chain`, the preview shows the icon of the record
   * the user SELECTED, not the effective value. The user is inspecting the
   * candidates, so the preview has to answer "what would this row give me?".
   * Selecting changes nothing else — the note under the preview says so.
   */
  const selectedNode: ChainNode | null = previewOwner
    ? (chain.nodes.find((n) => isSelected(previewOwner, n.owner)) ?? null)
    : null;
  const previewSource: TierOwner | null = previewOwner ?? null;

  const previewUri = useMemo(() => {
    if (value.mode === 'url') return value.value || null;
    if (value.mode === 'upload') return value.value || null;
    if (value.mode === 'custom') {
      return value.iconConfig ? renderIconToDataUri(value.iconConfig, 64) : null;
    }
    // `Use chain`: the selected record wins, else the effective value.
    if (value.mode === 'use-chain' && selectedNode) return selectedNode.value;
    return chain.winner.value;
  }, [value, chain, selectedNode]);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return;
      onChange({ mode: 'upload', value: result });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="tbs-icon-field" data-mode={value.mode}>
      {showPreview && (
        <div className="tbs-icon-field__preview-col">
          <div className="tbs-icon-field__preview" aria-label="Icon preview">
            {previewUri ? (
              // Decorative: the wrapper above already carries the accessible name,
              // so the inner image must not repeat it (avoids two nodes with the
              // same accessible name — the composite IconEditor has its own).
              <img className="tbs-icon-field__img" src={previewUri} alt="" />
            ) : (
              <span className="tbs-icon-field__placeholder" aria-hidden="true">—</span>
            )}
          </div>
          {/* Item 1: name WHICH record the preview is showing, otherwise the
              icon changes under the cursor with no explanation. */}
          {previewSource && selectedNode && (
            <p className="tbs-icon-field__preview-caption" data-preview-source>
              {`Previewing ${sourceBadge(previewSource, tabId)}`}
            </p>
          )}
        </div>
      )}

      <Tabs
        items={items}
        value={value.mode}
        onChange={(id) => { onChange({ ...value, mode: id as IconSourceMode }); }}
        label="Icon source"
        idPrefix={`${idPrefix}-tabs`}
        disabled={disabled}
      >
        {value.mode === 'url' && (
          <label className="tbs-icon-field__field">
            <span className="tbs-icon-field__label">Icon URL</span>
            <input
              type="text"
              value={value.value}
              placeholder="https:// or data: URI"
              onChange={(e) => { onChange({ ...value, mode: 'url', value: e.target.value }); }}
              disabled={disabled}
            />
          </label>
        )}

        {value.mode === 'upload' && (
          <div className="tbs-icon-field__field">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              style={{ display: 'none' }}
              aria-label="Upload icon file"
            />
            <button
              type="button"
              className="tbs-btn tbs-btn--secondary tbs-btn--sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              Choose File
            </button>
            {value.value && <span className="tbs-icon-field__hint">File selected</span>}
          </div>
        )}

        {value.mode === 'custom' && (
          <IconEditor
            value={value.iconConfig ?? { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' }}
            onChange={(cfg) => {
              onChange({ mode: 'custom', value: renderIconToDataUri(cfg, 64), iconConfig: cfg });
            }}
            size={48}
            hideUpload
            // Item 1.1: the composite editor's own preview is redundant now that
            // the picker renders ONE full-width preview above the tabs.
            hidePreview
          />
        )}

        {value.mode === 'use-chain' && (
          <div className="tbs-icon-field__chain">
            {/* The SAME record table the title picker uses, so both dimensions
                list every record (and every empty layer) identically. */}
            <ChainTierList
              chain={chain}
              idPrefix={`${idPrefix}-tiers`}
              field="icon"
              tabId={tabId}
              {...(onJumpToOwner ? { onJumpToOwner } : {})}
              // Items 2 / 6 / 8: per-record apply / clear.
              {...(onApplyTier ? { onApplyTier } : {})}
              {...(onClearTier ? { onClearTier } : {})}
              // Item 1: selecting a record previews its icon.
              {...(previewOwner ? { selectedOwner: previewOwner } : {})}
              {...(onSelectPreview ? { onSelectNode: (node: ChainNode) => { onSelectPreview(node.owner); } } : {})}
            />
            {selectedNode && (
              <p className="tbs-icon-field__note" data-selected-note>
                {sourceDescription(selectedNode.owner, tabId, 'icon')}
                {selectedNode.value === null
                  ? ' This record sets no icon.'
                  : ' Use copies it into the field you are editing.'}
              </p>
            )}
            <p className="tbs-icon-field__note">
              This layer stays unset — the value is taken from the chain above.
            </p>
          </div>
        )}
      </Tabs>

      {/* Review items 2 / 5: EVERY record on this tab, no clear buttons. */}
      <MaskedSummary
        nodes={chain.nodes}
        field="icon"
        {...(onJumpToOwner ? { onJumpToOwner } : {})}
        {...(selfOwner ? { selfOwner } : {})}
        tabId={tabId}
        fieldLabel="Icon"
        idPrefix={`${idPrefix}-masked`}
      />

      {/* Review item 3: restore the value captured when the editor opened.
          Deliberately NOT a close button — the user asked for the original
          data back, not for the editor to dismiss itself. */}
      {onReset && (
        <div className="tbs-icon-field__actions">
          <button
            type="button"
            className="tbs-btn tbs-btn--ghost tbs-btn--sm"
            onClick={onReset}
            disabled={disabled}
            aria-label="Reset to the value this editor opened with"
            title="Reset to the value this editor opened with"
          >
            ↺ Reset
          </button>
        </div>
      )}
    </div>
  );
}