/**
 * MaskedSummary — "3 other records also describe this tab", with the list.
 *
 * Review item 5: the point of this panel is that several records address the
 * SAME tabId — e.g. Page 1, Page 2, slot 1 and slot 2 all recorded for one tab —
 * and the user must see all of them, not a single "Overridden by Slot 3" line.
 * It is therefore built from the chain's NODES (which already enumerate every
 * record for the tab) rather than from a one-per-layer list.
 *
 * Review items 2 / 6: no "Clear this layer" button here. Clearing a layer is
 * what the `Use chain` list already offers, next to the value it would remove;
 * repeating it in this summary gave two controls for one job and let the user
 * clear a layer from a panel that does not show what that layer holds.
 *
 * The first few rows are inline; the rest collapse behind an expand toggle so a
 * heavily-shared tab cannot push the actual form off screen.
 */

import { useState } from 'react';
import type { ChainNode, TierOwner } from '@shared/field-chain';
import { sourceBadge, sourceDescription, type FieldWord } from './source-description';

/** How many rows are shown before the "…and N more" toggle. */
const INLINE_LIMIT = 3;

export interface MaskedSummaryProps {
  /** Every record on this tab, highest priority first. */
  nodes: ChainNode[];
  /**
   * How many open tabs the pattern matches, when that number is known. Omitted
   * on surfaces that cannot observe it.
   */
  matched?: number;
  /** Badge click → jump to the owning row. */
  onJumpToOwner?: (owner: TierOwner) => void;
  /** One label used by both the "Title"/"Icon" wording and the ids. */
  fieldLabel: string;
  /** Which dimension is described — drives the row sentences. */
  field: FieldWord;
  idPrefix: string;
  /** The tab this chain describes; the Page rows name it. */
  tabId?: number | null;
  /** Which record the surface itself edits, so it can be called out as "this". */
  selfOwner?: TierOwner | null;
}

/** A stable key for a node, since several nodes can share a layer. */
function nodeKey(node: ChainNode): string {
  switch (node.owner.kind) {
    case 'override':
      return `override-${String(node.owner.tabId)}`;
    case 'slot':
      return `slot-${String(node.owner.slotId)}`;
    case 'rule':
      return `rule-${node.owner.ruleId}`;
    case 'site':
      return 'site';
  }
}

export function MaskedSummary({
  nodes,
  matched,
  onJumpToOwner,
  fieldLabel,
  field,
  idPrefix,
  tabId = null,
  selfOwner = null,
}: MaskedSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  // A record that sets nothing does not "describe" the tab's value.
  const records = nodes.filter((n) => n.value !== null);
  if (records.length === 0) return null;

  const shown = expanded ? records : records.slice(0, INLINE_LIMIT);
  const hidden = records.length - shown.length;

  return (
    /**
     * Review item 3 (round 6): the panel sits INSIDE an open inline editor, so
     * every pointer interaction with it used to tear that editor down — the
     * input's blur committed and closed the box, and the row's own click handler
     * counted the summary as "the row was clicked".
     *
     * `onMouseDown` is the reliable hook: a `click` listener on an ANCESTOR still
     * fires (and by then focus has already moved and the editor is gone), whereas
     * stopping the mousedown keeps the focus where it is and prevents the row
     * underneath from reacting at all.
     */
    <div
      className="tbs-masked"
      role="status"
      data-field={idPrefix}
      onMouseDown={(event) => {
        // Buttons still need their own mousedown (badge jump / expand), so only
        // the inert parts are swallowed; the buttons stop propagation themselves.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <p
        className="tbs-masked__summary"
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      >
        {matched !== undefined && <>{'Matches '}<strong>{matched}</strong>{' tabs · '}</>}
        <strong>{records.length}</strong>
        {` ${records.length === 1 ? 'record describes' : 'records describe'} this tab`}
        <span className="tbs-masked__subject">{` · ${fieldLabel}`}</span>
      </p>

      <ul
        className="tbs-masked__list"
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      >
        {shown.map((node) => {
          const isSelf = selfOwner !== null && sameKindAndId(selfOwner, node.owner);
          return (
            <li key={nodeKey(node)} className="tbs-masked__item" data-owner={nodeKey(node)}>
              <button
                type="button"
                className="tbs-masked__badge"
                // Keep the focus (and therefore the open editor) intact while the
                // jump is performed; the jump moves focus deliberately afterwards.
                onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={(event) => { event.stopPropagation(); onJumpToOwner?.(node.owner); }}
                disabled={!onJumpToOwner}
                title={sourceDescription(node.owner, tabId, field)}
              >
                {sourceBadge(node.owner, tabId)}
              </button>
              <span className="tbs-masked__note">
                {isSelf ? 'the record this panel edits' : sourceDescription(node.owner, tabId, field)}
              </span>
              {node.value !== null && (
                <span className="tbs-masked__value" title={node.value}>{node.value}</span>
              )}
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          className="tbs-masked__expand"
          // Expanding is pure disclosure: the editor must survive it, so the
          // input keeps focus.
          onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onClick={(event) => { event.stopPropagation(); setExpanded(true); }}
        >
          {`…and ${String(hidden)} more`}
        </button>
      )}
    </div>
  );
}

function sameKindAndId(a: TierOwner, b: TierOwner): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'slot') return a.slotId === (b as { slotId: number }).slotId;
  if (a.kind === 'override') return a.tabId === (b as { tabId: number }).tabId;
  if (a.kind === 'rule') return a.ruleId === (b as { ruleId: string }).ruleId;
  return true;
}