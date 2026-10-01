/**
 * Cell 4 — tabIdMode `no-exists` + ruleCheckMode `no-match` (Position).
 *
 * The ring is the live tabs of the CURRENT window (built by the caller via
 * `buildPositionRing`). Starting point is the slot's `binding.tabId`:
 * - cursor missing from the ring → needs_recovery
 * - single-tab ring             → no-op
 * - cursor == active tab        → step in the configured direction
 * - cursor != active tab        → focus the cursor
 * (Delegated to the shared `focusOrStep` primitive — not re-implemented here.)
 */

import { focusOrStep } from '../primitives';
import type { Resolution, ResolveSwitchInput } from '../resolve-switch';

export function resolveCombination4(input: ResolveSwitchInput): Resolution {
  if (input.bindingTabId === null) return { kind: 'recovery' };

  const ring = input.positionalRing ?? [];
  const result = focusOrStep(ring, input.bindingTabId, input.activeTabId, input.direction);

  switch (result.kind) {
    case 'focus':
    case 'step':
      return { kind: 'switch', targetTabId: result.targetTabId };
    case 'noop':
      return { kind: 'noop' };
    case 'missing':
      return { kind: 'recovery' };
  }
}