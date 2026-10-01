/**
 * Cell 3 — tabIdMode `no-exists` + ruleCheckMode `match`.
 *
 * The binding is ignored entirely. Resolve purely from URL/regex candidates;
 * the first (sorted) candidate wins. No candidates → needs_recovery.
 */

import type { Resolution, ResolveSwitchInput } from '../resolve-switch';

export function resolveCombination3(input: ResolveSwitchInput): Resolution {
  if (input.candidates.length > 0) {
    return { kind: 'switch', targetTabId: input.candidates[0].tabId };
  }
  return { kind: 'recovery' };
}