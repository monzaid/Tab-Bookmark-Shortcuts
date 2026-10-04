/**
 * Field chain — the single READ-SIDE source of truth for title / favicon resolution.
 *
 * Priority tier (highest → lowest): `override > slot > rule > site`.
 *
 * This module is intentionally a set of PURE functions with no browser-API or
 * worker/UI dependency, so the three views (Current Page, slot, Data Dashboard)
 * and the delivery coordinator derive their values from the exact same code —
 * making "what the view shows equals what is delivered" a *construction*
 * guarantee instead of a lock-step test.
 *
 * Write-side concerns (persisting values, delivering `FIELD_APPLY`) deliberately
 * do NOT live here; they belong to `FieldDeliveryService` in `src/background/`.
 */

import type { LocalState, PageRule, SlotDefinition, SyncState } from './types';
import { isSafeFaviconProtocol, matchesUrl, selectWinningRule } from './url-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Which field of the chain is being resolved.
 * Title and favicon are two INDEPENDENT chains that never share a result.
 */
export type FieldKind = 'title' | 'favicon';

/** Where a tier value came from — used for badges and jump-to-row targeting. */
export type TierOwner =
  | { kind: 'override'; tabId: number }
  | { kind: 'slot'; slotId: number }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'site' };

export type TierKey = TierOwner['kind'];

export interface TierValue {
  /** The value this tier carries; `null` = not set (undefined / null / empty). */
  value: string | null;
  /** Address of this tier — drives badge → jump-to-row. */
  owner: TierOwner;
  /**
   * `false` only for the `site` tier when the original value has not been
   * captured yet (Q14). The UI renders `—` for an unknown site value, which
   * must be distinguishable from "the site value is an empty string".
   */
  known: boolean;
}

export interface ChainTiers {
  override?: TierValue;
  slot?: TierValue;
  rule?: TierValue;
  site: TierValue;
}

/**
 * ONE stored record that takes part in this tab's chain.
 *
 * The chain is not one value per layer: SEVERAL records can sit on the same
 * layer as long as they all address the same `tabId`. That is a real property of
 * the data model, not a hypothetical —
 *   - `bindings` is keyed by `slotId`, so slot 1 and slot 3 can both be bound to
 *     tab 12 (the repository only ever replaces the entry for the SAME slot),
 *   - every enabled rule whose pattern matches the URL is a candidate,
 *   - `tabOverrides` is keyed by `tabId` and `siteSnapshot` is one entry per
 *     `tabId`, so those two layers hold at most one record each.
 *
 * A list of nodes is therefore what the user has to be shown: "which records
 * describe THIS tab", not "which layer won".
 */
export interface ChainNode {
  /** Address of this record — what a badge, a jump and an apply target. */
  owner: TierOwner;
  /** The value this record carries; `null` = the record sets nothing. */
  value: string | null;
  /** True for the single record that currently provides the delivered value. */
  winner: boolean;
}

export interface ChainResult {
  winner: { value: string | null; source: TierKey };
  tiers: ChainTiers;
  /**
   * Every record on this tab, highest priority first. Multi-node per layer.
   */
  nodes: ChainNode[];
  /**
   * Records that carry a value but are covered by a higher RESOLVED record.
   *
   * The `rule` layer never appears here: a rule's value is delivered on its own
   * (the rule is applied to the page), so listing it as "masked" claimed the
   * user could not see it when in fact its effect is what they were editing.
   */
  masked: TierOwner[];
}

export interface ResolveFieldChainInput {
  sync: SyncState;
  local: LocalState;
  tabId: number;
  tabUrl: string;
}

// ─── "Is this tier set?" (A1-bis) ────────────────────────────────────────────
//
// `undefined`, `null` and `''` (empty after trim) ALL mean "not set" — none of
// them pins an empty value. The READ side keeps all three tolerances: cloud
// sync / older local data may still carry the legacy empty-string shape, and
// tightening the read side would silently change the priority chain for those
// users. Only the WRITE side unifies on `null` (DT11).

function asSet(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return raw.trim() === '' ? null : raw;
}

/** A favicon value must clear the protocol allowlist to be usable (§B9). */
function asSetFavicon(raw: string | null | undefined): string | null {
  const set = asSet(raw);
  if (set === null) return null;
  return isSafeFaviconProtocol(set) ? set : null;
}

// ─── Slot tier (strictly tabId-scoped) ───────────────────────────────────────

interface SlotTierResolution {
  slotId: number;
  title: string | null;
  favicon: string | null;
}

/**
 * Resolve EVERY slot bound to this tab.
 *
 * The slot tier applies ONLY to a tab that has a `SlotBinding` whose `tabId`
 * equals the given tabId. Tabs that merely match the same URL but are not bound
 * fall straight through to the rule / site tiers.
 *
 * There can be MORE THAN ONE: `bindings` is keyed by `slotId`, so nothing stops
 * slot 1 and slot 3 from both being bound to tab 12 (the repository only ever
 * replaces the entry for the same slot). The highest-id slot keeps the priority
 * it had when a single binding was assumed, and the rest are listed as additional
 * nodes rather than hidden — they are real records describing this tab.
 *
 * Title: a user-modified `uiMarker.customTitle` wins over the stale
 * `titleSnapshot`. Favicon: `uiMarker.icon.value` when it clears the protocol
 * allowlist, else `faviconSnapshot` when it does.
 */
function resolveSlotTier(
  local: LocalState,
  sync: SyncState,
  tabId: number,
): SlotTierResolution[] {
  const boundSlotIds = local.bindings
    .filter((b) => b.tabId === tabId)
    .map((b) => b.slotId);
  if (boundSlotIds.length === 0) return [];

  const records: SlotTierResolution[] = [];
  for (const slotId of boundSlotIds) {
    const slot: SlotDefinition | undefined = sync.slots.find((s) => s.id === slotId);
    if (!slot) continue;

    const customTitle = slot.uiMarker.customTitle?.trim();
    const title = customTitle || slot.titleSnapshot.trim() || null;

    let favicon: string | null = null;
    const iconValue = slot.uiMarker.icon?.value.trim();
    if (iconValue && isSafeFaviconProtocol(iconValue)) {
      favicon = iconValue;
    } else {
      const snapshot = slot.faviconSnapshot.trim();
      if (snapshot && isSafeFaviconProtocol(snapshot)) favicon = snapshot;
    }

    records.push({ slotId: slot.id, title, favicon });
  }

  // Highest slot id first — the order the single-binding version effectively had.
  records.sort((a, b) => b.slotId - a.slotId);
  return records;
}

// ─── Rule tier (reuses the shared sorting primitives) ────────────────────────

/**
 * The winning rule for a URL.
 *
 * Every rule participates (Q11 — there is no `mode` opt-out any more); only
 * `enabled === false` removes a rule. Ordering is delegated to the shared
 * `selectWinningRule` / `sortRulesByPriority` primitives so this chain can never
 * disagree with the rest of the codebase about priority.
 */
function resolveWinningRule(sync: SyncState, tabUrl: string): PageRule | null {
  const matching = sync.rules.filter(
    (r) => r.enabled !== false && matchesUrl(tabUrl, r.urlMatch),
  );
  return selectWinningRule(matching);
}

// ─── Chain resolution ────────────────────────────────────────────────────────

/** Resolution order, highest priority first. */
const TIER_ORDER: readonly TierKey[] = ['override', 'slot', 'rule', 'site'];

/**
 * Resolve the effective value of `field` for one tab, together with every tier
 * that contributed to the decision.
 */
export function resolveFieldChain(field: FieldKind, input: ResolveFieldChainInput): ChainResult {
  const { sync, local, tabId, tabUrl } = input;

  const override = local.tabOverrides.find((o) => o.tabId === tabId) ?? null;
  const slotRecords = resolveSlotTier(local, sync, tabId);
  const primarySlot = slotRecords.length > 0 ? slotRecords[0] : null;
  const winningRule = resolveWinningRule(sync, tabUrl);
  const snapshot = (local.siteSnapshot ?? []).find((s) => s.tabId === tabId) ?? null;

  const siteValue = snapshot
    ? field === 'title'
      ? snapshot.title
      : snapshot.faviconHref
    : null;

  const tiers: ChainTiers = {
    site: {
      value: siteValue,
      owner: { kind: 'site' },
      known: snapshot !== null,
    },
  };

  if (override) {
    tiers.override = {
      value:
        field === 'title' ? asSet(override.title) : asSetFavicon(override.favicon?.value),
      owner: { kind: 'override', tabId },
      known: true,
    };
  }

  if (primarySlot) {
    tiers.slot = {
      value: field === 'title' ? primarySlot.title : primarySlot.favicon,
      owner: { kind: 'slot', slotId: primarySlot.slotId },
      known: true,
    };
  }

  if (winningRule) {
    tiers.rule = {
      value:
        field === 'title'
          ? asSet(winningRule.title)
          : asSetFavicon(winningRule.favicon?.value),
      owner: { kind: 'rule', ruleId: winningRule.id },
      known: true,
    };
  }

  // Winner = the first tier (in priority order) that actually carries a value.
  let winnerSource: TierKey = 'site';
  let winnerValue: string | null = null;
  const masked: TierOwner[] = [];
  const nodes: ChainNode[] = [];
  let settled = false;

  for (const key of TIER_ORDER) {
    const tier = tiers[key];
    if (!tier) continue;
    const owner = tier.owner;
    const isWinner = !settled && tier.value !== null;
    if (isWinner) {
      settled = true;
      winnerSource = key;
      winnerValue = tier.value;
    } else if (tier.value !== null && key !== 'rule') {
      masked.push(owner);
    }
    nodes.push({
      owner,
      // Every non-slot layer is single-record by construction; `slotRecords`
      // holds the additional slots bound to the SAME tab, resolved below.
      value: tier.value,
      winner: isWinner,
    });
  }

  for (const record of slotRecords) {
    const owner: TierOwner = { kind: 'slot', slotId: record.slotId };
    const node: ChainNode = {
      owner,
      value: field === 'title' ? record.title : record.favicon,
      winner: false,
    };
    const index = nodes.findIndex((n) => sameOwner(n.owner, owner));
    if (index >= 0) {
      // Already placed by the tier loop — replace the payload, keep the flag.
      // It was also already counted by that loop, so it is NOT re-added below.
      node.winner = nodes[index].winner;
      nodes[index] = node;
      continue;
    }
    nodes.push(node);
    if (node.value !== null && settled) masked.push(owner);
  }

  // Keep the layers in priority order even after the extra slots were appended.
  nodes.sort((a, b) => TIER_ORDER.indexOf(a.owner.kind) - TIER_ORDER.indexOf(b.owner.kind));

  return {
    winner: { value: winnerValue, source: winnerSource },
    tiers,
    nodes,
    masked,
  };
}

/** Identity of a record, so the extra slots can replace the primary one. */
function sameOwner(a: TierOwner, b: TierOwner): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'slot') return a.slotId === (b as { slotId: number }).slotId;
  return true;
}

// ─── Clear scope (which tiers to write) ──────────────────────────────────────

export type ClearEntry =
  | { kind: 'override'; tabId: number; slotId?: number; ruleId?: string }
  | { kind: 'slot'; slotId: number; ruleId?: string }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'site' };

/**
 * Return the ORDERED list of tiers that a "Clear" action must write back as
 * unset (Chain A1-bis). This is a read-side judgement only — the actual writes
 * are performed by the delivery coordinator, never here.
 *
 * - Dashboard override row → `[override, slot, rule]`
 * - Slot (position) row     → `[slot, rule]` — `override` is tabId-private and
 *   cannot be changed by editing the slot's own definition, so it does not
 *   participate.
 *
 * `_field` is part of the public contract for symmetry with `resolveFieldChain`
 * (the tier SET does not depend on the field today).
 */
export function clearChain(_field: FieldKind, entry: ClearEntry): TierOwner[] {
  const owners: TierOwner[] = [];

  switch (entry.kind) {
    case 'override':
      owners.push({ kind: 'override', tabId: entry.tabId });
      if (entry.slotId !== undefined) owners.push({ kind: 'slot', slotId: entry.slotId });
      if (entry.ruleId !== undefined) owners.push({ kind: 'rule', ruleId: entry.ruleId });
      break;
    case 'slot':
      owners.push({ kind: 'slot', slotId: entry.slotId });
      if (entry.ruleId !== undefined) owners.push({ kind: 'rule', ruleId: entry.ruleId });
      break;
    case 'rule':
      owners.push({ kind: 'rule', ruleId: entry.ruleId });
      break;
    case 'site':
      break;
  }

  return owners;
}