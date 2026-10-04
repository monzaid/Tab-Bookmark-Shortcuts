/**
 * ChainTierList — the reusable `override > slot > rule > site` record table.
 *
 * Review item 6: a LAYER is not a row. Several records can sit on the same layer
 * while addressing the same tab (slot 1 and slot 3 both bound to tab 12, and
 * every rule whose pattern matches), so the list is built from the chain's NODES
 * — one row per stored record — grouped by layer. A layer with no record still
 * gets one placeholder row, so "this layer exists but sets nothing" stays
 * visible instead of the list silently shrinking.
 *
 * One implementation serves the title picker (`FieldEditor`), the icon picker
 * (`IconFieldEditor`) and the rule form, so the rows, the labels, the winner
 * marker and the actions cannot diverge between surfaces or dimensions.
 */

import type { ReactNode } from 'react';
import type { ChainNode, ChainResult, TierKey, TierOwner } from '@shared/field-chain';
import { TIER_NAME, sourceBadge, type FieldWord } from './source-description';

/** The resolution order, highest priority first. */
const TIER_ORDER: readonly TierKey[] = ['override', 'slot', 'rule', 'site'];

/**
 * Layers whose value cannot be blanked per field from an editing surface.
 *
 * A rule carries BOTH dimensions in one record and a site value is a captured
 * snapshot, so "clear just the title of this rule" is not a write these surfaces
 * can make. They are reported instead of being offered a button that would lie.
 */
const NOT_PER_FIELD_CLEARABLE: ReadonlySet<TierKey> = new Set<TierKey>(['rule', 'site']);

export interface ChainTierListProps {
  chain: ChainResult;
  /** Id prefix so several lists can coexist on one page. */
  idPrefix: string;
  /** Which dimension is being described — used by the row tooltips. */
  field: FieldWord;
  /**
   * Review item 1: selecting a row hands the node back so the caller can PREVIEW
   * that record's value. Selecting is not applying — the preview must not depend
   * on which row the editor happens to be showing.
   */
  onSelectNode?: (node: ChainNode) => void;
  /** The currently previewed record, marked in the list. */
  selectedOwner?: TierOwner | null;
  /** Badge click → jump to the owning row (only for records that exist). */
  onJumpToOwner?: (owner: TierOwner) => void;
  /**
   * Copy THIS record's value into the field the user is editing.
   *
   * Offered for EVERY layer that carries a value, including `rule`: "apply the
   * rule's title to this field" is a plain copy, and the rule editing form needs
   * exactly that (review item 8).
   */
  onApplyTier?: (kind: TierKey, value: string, owner: TierOwner) => void;
  /** Clear THIS record's own value. Hidden for the layers that cannot be cleared. */
  onClearTier?: (owner: TierOwner) => void;
  /** Optional extra per-row trailing content. */
  renderAction?: (owner: TierOwner) => ReactNode;
  /** `tabId` of the tab this chain belongs to — shown on the Page record. */
  tabId?: number | null;
}

/** Identity key for a node, used to mark the selected row. */
function ownerKey(owner: TierOwner): string {
  switch (owner.kind) {
    case 'override':
      return `override-${String(owner.tabId)}`;
    case 'slot':
      return `slot-${String(owner.slotId)}`;
    case 'rule':
      return `rule-${owner.ruleId}`;
    case 'site':
      return 'site';
  }
}

export function ChainTierList({
  chain,
  idPrefix,
  field,
  onSelectNode,
  selectedOwner,
  onJumpToOwner,
  onApplyTier,
  onClearTier,
  renderAction,
  tabId = null,
}: ChainTierListProps) {
  const selectedKey = selectedOwner ? ownerKey(selectedOwner) : null;

  return (
    <ul className="tbs-chain-tiers" data-chain-tiers={idPrefix}>
      {TIER_ORDER.flatMap((kind) => {
        const nodes = chain.nodes.filter((n) => n.owner.kind === kind);

        // No record on this layer: one disabled row, so the layer still shows up.
        if (nodes.length === 0) {
          return [
            <li
              key={`${kind}-empty`}
              className="tbs-chain-tiers__item"
              data-tier={kind}
              data-winner="false"
              data-empty="true"
            >
              <span className="tbs-chain-tiers__badge tbs-chain-tiers__badge--static">
                {TIER_NAME[kind]}
              </span>
              <span className="tbs-chain-tiers__value">—</span>
              <span className="tbs-chain-tiers__actions" />
            </li>,
          ];
        }

        return nodes.map((node) => {
          const isSelected = selectedKey !== null && ownerKey(node.owner) === selectedKey;
          const canClear = onClearTier !== undefined && !NOT_PER_FIELD_CLEARABLE.has(kind);
          return (
            <li
              key={ownerKey(node.owner)}
              className="tbs-chain-tiers__item"
              data-tier={kind}
              data-winner={node.winner ? 'true' : 'false'}
              data-empty={node.value === null ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
              data-owner={ownerKey(node.owner)}
            >
              <button
                type="button"
                className="tbs-chain-tiers__badge"
                // Selecting previews this record (item 1); it never writes.
                onClick={() => { onSelectNode?.(node); }}
                disabled={!onSelectNode}
                title={`Preview the ${sourceBadge(node.owner, tabId)} value`}
              >
                {sourceBadge(node.owner, tabId)}
              </button>

              <span className="tbs-chain-tiers__value" title={node.value ?? undefined}>
                {node.value ?? '—'}
              </span>

              <span className="tbs-chain-tiers__actions">
                {onApplyTier && node.value !== null && (
                  <button
                    type="button"
                    className="tbs-chain-tiers__btn"
                    onClick={() => { onApplyTier(kind, node.value as string, node.owner); }}
                    aria-label={`Apply the ${sourceBadge(node.owner, tabId)} ${field} to this field`}
                    title="Apply this value here"
                  >
                    Use
                  </button>
                )}
                {canClear && node.value !== null && (
                  <button
                    type="button"
                    className="tbs-chain-tiers__btn tbs-chain-tiers__btn--danger"
                    onClick={() => { onClearTier?.(node.owner); }}
                    aria-label={`Clear the ${sourceBadge(node.owner, tabId)} ${field}`}
                    title="Clear this layer"
                  >
                    Clear
                  </button>
                )}
                {onJumpToOwner && (
                  <button
                    type="button"
                    className="tbs-chain-tiers__btn"
                    onClick={() => { onJumpToOwner(node.owner); }}
                    aria-label={`Jump to the ${sourceBadge(node.owner, tabId)} record`}
                    title="Jump to this record"
                  >
                    ↗
                  </button>
                )}
                {renderAction && <span className="tbs-chain-tiers__action">{renderAction(node.owner)}</span>}
              </span>
            </li>
          );
        });
      })}
    </ul>
  );
}