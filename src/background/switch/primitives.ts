/**
 * Shared pure primitives for the four-cell switch resolution model.
 *
 * Contract (design §2.3 / A7):
 * - Pure functions only: no adapter, no I/O, no mutation of inputs.
 * - URL matching and candidate ordering MUST reuse `src/shared/url-utils.ts`
 *   (`matchesUrl` / `sortCandidates`) rather than re-implementing them.
 * - Resolvers orchestrate these primitives; they must not rewrite them.
 */

import type {
  Priority,
  SwitchDirection,
  TabCandidate,
  UrlMatchDefinition,
} from '@shared/types';
import { matchesUrl, sortCandidates } from '@shared/url-utils';

// ─── ruleCheckTabMatch ───────────────────────────────────────────────────────

/**
 * Does a tab's URL still satisfy the slot's match definition?
 * Thin, dependency-free reuse of the canonical URL matcher.
 */
export function ruleCheckTabMatch(tab: TabCandidate, definition: UrlMatchDefinition): boolean {
  return matchesUrl(tab.url, definition);
}

// ─── findMatchCandidates ─────────────────────────────────────────────────────

/**
 * Filter a tab list to URL matches, excluding incognito tabs when unauthorized,
 * then order with the canonical candidate sorter (current window first, then
 * left-to-right by tab index, then other windows).
 */
export function findMatchCandidates(
  tabs: readonly TabCandidate[],
  definition: UrlMatchDefinition,
  incognitoAllowed: boolean,
): TabCandidate[] {
  const matched = tabs.filter((tab) => {
    if (tab.isIncognito && !incognitoAllowed) return false;
    return matchesUrl(tab.url, definition);
  });
  return sortCandidates([...matched]);
}

// ─── buildPositionRing ───────────────────────────────────────────────────────

/**
 * The position ring is the set of live tabs in the CURRENT window, ordered by
 * tab index (design §6: "环范围 = 仅当前窗口").
 */
export function buildPositionRing(tabs: readonly TabCandidate[], windowId: number): TabCandidate[] {
  return tabs
    .filter((tab) => tab.windowId === windowId)
    .slice()
    .sort((a, b) => a.index - b.index);
}

// ─── applyPriority ───────────────────────────────────────────────────────────

export interface PriorityContext {
  /** Is the slot's bound tab still open? */
  bindingAlive: boolean;
  /** If alive, does its URL still satisfy the slot's match definition? */
  bindingUrlMatches: boolean;
  /** Are there any URL/regex candidates? */
  hasCandidates: boolean;
}

export type PriorityDecision = 'use-binding' | 'use-candidates' | 'unresolved';

/**
 * Combination 1 (exists + match) only. Resolves which source wins per `priority`:
 * - `none`      : STRICTEST tier (user rulings C-A2 + Q1-B) — the bound tab MUST
 *   exist AND its URL must still match. Either half failing is terminal:
 *   `unresolved` → recovery (Tab Not Found). It NEVER falls back to URL
 *   candidates, because the stored binding is the only acceptable target.
 * - `tabId`     : binding if alive (URL NOT re-validated); else candidates.
 * - `rule-check`: candidates first; binding only as fallback.
 */
export function applyPriority(priority: Priority, ctx: PriorityContext): PriorityDecision {
  const { bindingAlive, bindingUrlMatches, hasCandidates } = ctx;

  switch (priority) {
    case 'tabId':
      if (bindingAlive) return 'use-binding';
      return hasCandidates ? 'use-candidates' : 'unresolved';

    case 'none':
      // C-A2 + Q1-B: strictest tier. The binding must BOTH exist AND match; any
      // failure is terminal (recovery). `hasCandidates` is deliberately unused
      // here — this tier never delegates to a URL lookup.
      return bindingAlive && bindingUrlMatches ? 'use-binding' : 'unresolved';

    case 'rule-check':
      if (hasCandidates) return 'use-candidates';
      if (bindingAlive) return 'use-binding';
      return 'unresolved';
  }
}

// ─── focusOrStep (combination 4) ─────────────────────────────────────────────

export type FocusOrStepResult =
  | { kind: 'focus'; targetTabId: number }
  | { kind: 'step'; targetTabId: number }
  | { kind: 'noop' }
  | { kind: 'missing' };

/**
 * Combination 4 decision (design §3, cell 4):
 * - cursor missing from ring            → `missing`  (→ needs_recovery)
 * - single-tab ring                     → `noop`     (never step onto itself)
 * - cursor == active tab                → `step` in `direction`
 * - cursor != active (or no active)     → `focus` the cursor
 */
export function focusOrStep(
  ring: readonly TabCandidate[],
  cursorTabId: number,
  activeTabId: number | null,
  direction: SwitchDirection,
): FocusOrStepResult {
  const index = ring.findIndex((tab) => tab.tabId === cursorTabId);
  if (index < 0) return { kind: 'missing' };
  if (ring.length <= 1) return { kind: 'noop' };

  if (activeTabId === null || activeTabId !== cursorTabId) {
    return { kind: 'focus', targetTabId: cursorTabId };
  }

  const delta = direction === 'next' ? 1 : -1;
  const nextIndex = (index + delta + ring.length) % ring.length;
  return { kind: 'step', targetTabId: ring[nextIndex].tabId };
}