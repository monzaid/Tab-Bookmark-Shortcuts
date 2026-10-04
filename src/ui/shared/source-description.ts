/**
 * How a chain node is NAMED and EXPLAINED in the UI.
 *
 * Review item 7: a bare "Slot 8" badge does not tell the user what it means —
 * eight is the slot's own number, not a tab, and the reader has no way to know
 * that. Every surface that reports a source therefore has to say which record it
 * is AND what that record is doing to this tab.
 *
 * One module owns this so the sidebar popover, the Use chain list and the masked
 * summary cannot describe the same record in three different ways.
 */

import type { TierOwner } from '@shared/field-chain';

/** Which dimension is being described — used for the "original value" wording. */
export type FieldWord = 'title' | 'icon';

const FIELD_NOUN: Record<FieldWord, string> = { title: 'title', icon: 'icon' };

/** The plain tier name, with no address. */
export const TIER_NAME: Record<TierOwner['kind'], string> = {
  override: 'Page',
  slot: 'Slot',
  rule: 'Rule',
  site: 'Site',
};

/** Are these two addresses the same stored record? */
export function sameOwner(a: TierOwner, b: TierOwner): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'override':
      return a.tabId === (b as { tabId: number }).tabId;
    case 'slot':
      return a.slotId === (b as { slotId: number }).slotId;
    case 'rule':
      return a.ruleId === (b as { ruleId: string }).ruleId;
    case 'site':
      return true;
  }
}

/**
 * The short badge: "Slot 3", or "Page · tab 12" for an override.
 *
 * The override carries its tabId because that is the only thing distinguishing
 * one page record from another — and because the user asked to be told which tab
 * a page-level value came from.
 */
export function sourceBadge(owner: TierOwner, tabId: number | null): string {
  switch (owner.kind) {
    case 'slot':
      return `Slot ${String(owner.slotId)}`;
    case 'override':
      return tabId === null ? TIER_NAME.override : `Page · tab ${String(tabId)}`;
    default:
      return TIER_NAME[owner.kind];
  }
}

/**
 * The full sentence shown in a popover or a list row.
 *
 * Deliberately explicit about the mechanism ("its bound tab is this one"), since
 * the point of the text is to answer "why is this tab showing this value".
 */
export function sourceDescription(
  owner: TierOwner,
  tabId: number | null,
  field: FieldWord,
): string {
  switch (owner.kind) {
    case 'override':
      return tabId === null
        ? `Set on this page itself, and outranks the slot, rule and site ${FIELD_NOUN[field]}.`
        : `Set on this page (tab ${String(tabId)}), and outranks the slot, rule and site ${FIELD_NOUN[field]}.`;
    case 'slot':
      return `Set on slot ${String(owner.slotId)}, whose bound tab is this one, so it outranks the rule and site ${FIELD_NOUN[field]}.`;
    case 'rule':
      return `Set by a global page rule whose pattern matches this URL.`;
    case 'site':
      return `The page's own original ${FIELD_NOUN[field]}, used when nothing above it is set.`;
  }
}

/**
 * Should this surface show a source popover at all?
 *
 * Review item 7: when the winning record IS the record this surface edits, the
 * popover is noise — "Slot 8 · from slot 8" tells the user nothing they cannot
 * already see from the row they are hovering. The popover is only informative
 * when the value comes from somewhere ELSE in the chain.
 */
export function shouldShowSource(
  winner: { value: string | null; source: TierOwner } | null,
  self: TierOwner,
): boolean {
  if (!winner || winner.value === null) return false;
  return !sameOwner(winner.source, self);
}