/**
 * Switch resolution entry point — the single source of truth for "which tab
 * should this switch land on?" (design §3 four-cell table).
 *
 * Discipline (design §6 / A7):
 * - Resolvers orchestrate the shared primitives; they must NOT re-implement
 *   URL matching, candidate sorting, priority or position logic.
 * - No I/O here. The caller (`slot-service`) performs activation / recovery.
 */

import type {
  MatchRuleSettings,
  SwitchDirection,
  TabCandidate,
  UrlMatchDefinition,
} from '@shared/types';
import { findMatchCandidates } from './primitives';
import { resolveCombination1 } from './resolvers/combination-1';
import { resolveCombination2 } from './resolvers/combination-2';
import { resolveCombination3 } from './resolvers/combination-3';
import { resolveCombination4 } from './resolvers/combination-4';

// ─── Contract ────────────────────────────────────────────────────────────────

export interface ResolveSwitchInput {
  settings: MatchRuleSettings;
  urlMatch: UrlMatchDefinition;
  /** Slot binding (local). `null` when the slot was never bound. */
  bindingTabId: number | null;
  /** Live tab for `bindingTabId`, or `null` when it is closed. */
  bindingTab: TabCandidate | null;
  /** URL/regex candidates; used by cells 1 and 3. */
  candidates: TabCandidate[];
  /** Positional ring (current window only); used by cell 4. */
  positionalRing?: TabCandidate[];
  activeTabId: number | null;
  direction: SwitchDirection;
}

export type Resolution =
  | { kind: 'switch'; targetTabId: number }
  | { kind: 'recovery' }
  | { kind: 'noop' };

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Select the resolver by (tabIdMode, ruleCheckMode). `priority` applies to cell 1 only. */
export function resolveSwitch(input: ResolveSwitchInput): Resolution {
  const { tabIdMode, ruleCheckMode } = input.settings;

  if (tabIdMode === 'exists' && ruleCheckMode === 'match') return resolveCombination1(input);
  if (tabIdMode === 'exists' && ruleCheckMode === 'no-match') return resolveCombination2(input);
  if (tabIdMode === 'no-exists' && ruleCheckMode === 'match') return resolveCombination3(input);
  return resolveCombination4(input);
}

/** Re-export for callers that only need candidate discovery from a raw tab list. */
export { findMatchCandidates };