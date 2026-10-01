/**
 * Cell 1 — tabIdMode `exists` + ruleCheckMode `match`.
 *
 * The bound tab and URL/regex candidates can both exist; `priority` arbitrates:
 * - `none`      : STRICTEST (user rulings C-A2 + Q1-B) — binding wins only if it
 *   is alive AND its URL still matches. EITHER half failing → recovery (Tab Not
 *   Found), with NO candidate fallback: the stored binding is the only target.
 * - `tabId`     : binding wins if alive (URL is NOT re-validated); else candidates.
 * - `rule-check`: candidates first; binding only as a fallback.
 * Both unavailable → needs_recovery.
 */

import { applyPriority, ruleCheckTabMatch } from '../primitives';
import type { Resolution, ResolveSwitchInput } from '../resolve-switch';

export function resolveCombination1(input: ResolveSwitchInput): Resolution {
  const { settings, urlMatch, bindingTab, candidates } = input;

  const decision = applyPriority(settings.priority, {
    bindingAlive: bindingTab !== null,
    bindingUrlMatches: bindingTab !== null && ruleCheckTabMatch(bindingTab, urlMatch),
    hasCandidates: candidates.length > 0,
  });

  if (decision === 'use-binding' && bindingTab !== null) {
    return { kind: 'switch', targetTabId: bindingTab.tabId };
  }
  if (decision === 'use-candidates') {
    return { kind: 'switch', targetTabId: candidates[0].tabId };
  }
  return { kind: 'recovery' };
}