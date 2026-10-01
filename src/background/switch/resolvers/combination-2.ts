/**
 * Cell 2 — tabIdMode `exists` + ruleCheckMode `no-match`.
 *
 * Binding only. If the bound tab is alive, switch to it (the match URL is
 * ignored). If it is dead, this is a recovery — the model NEVER falls back to a
 * URL/regex lookup here (design §3, cell 2 — a deliberate hard rule).
 */

import type { Resolution, ResolveSwitchInput } from '../resolve-switch';

export function resolveCombination2(input: ResolveSwitchInput): Resolution {
  if (input.bindingTab !== null) return { kind: 'switch', targetTabId: input.bindingTab.tabId };
  return { kind: 'recovery' };
}