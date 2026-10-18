/**
 * UndoBar — the generalized undo surface (IMP-6 / DT9), now a STACK (U1/U2).
 *
 * A single implementation shared by the sidebar and the settings page, so there
 * is never a second undo UI (`Toast.action` stays unused by design — N11).
 *
 * DT9 requires each restore to be ATOMIC: one Undo replays every write in that
 * action's batch and then triggers a single redelivery, rather than restoring
 * layer by layer (which would expose half-restored state and fan out deliveries).
 *
 * U1: several bars stack SIMULTANEOUSLY, each with its own Undo button — so the
 * button must name the entry it belongs to, and `onUndo` carries that identity
 * (never "the newest one").
 * U2: each bar counts down its OWN `expiresAt`; one expiring leaves the others
 * untouched. (The previous single-timer version ignored `expiresAt` entirely.)
 */

import { useCallback, useEffect, useRef } from 'react';
import type { IconSource, PageRule, TagDefinition } from '@shared/types';
import { Button } from './components';

// ─── Snapshot model ──────────────────────────────────────────────────────────

export type UndoLayerWrite =
  | {
      kind: 'tab-override';
      tabId: number;
      title?: string | null;
      /**
       * FIX-A: the ORIGINAL icon source, so the replay re-persists it VERBATIM.
       *
       * A string cannot carry a recipe: a recipe's value is a derived render
       * (R2/FIX-B), so replaying it as `{type:'upload', value}` permanently
       * flattened the recipe to a bitmap (C1/A6). `null` = "this layer had no
       * icon" and is applied as an explicit clear.
       */
      favicon?: IconSource | null;
    }
  | {
      kind: 'slot-marker';
      slotId: number;
      customTitle?: string | null;
      /** FIX-A: see `tab-override.favicon`. */
      icon?: IconSource | null;
    }
  /**
   * P3 (Rule Tags): undoing a tag deletion.
   *
   * Deliberately a THIRD kind on this existing union rather than a new undo
   * mechanism — C5 requires the `UndoBar` be reused, and the discriminated union
   * means adding a kind is a compile error everywhere a `kind` is switched on, so
   * a consumer that forgets the new case cannot compile.
   *
   * The write carries the ENTITY and every rule reference that was stripped, so
   * one Undo restores both: undoing only the entity would leave rules pointing at
   * nothing (the dangling state I2 forbids).
   */
  | {
      kind: 'tag-delete';
      tag: TagDefinition;
      refs: Array<{ ruleId: string; tagIds: string[] }>;
    }
  /**
   * Undoing a rule's tag-set change — the mirror of a tag deletion.
   *
   * `DELETE_TAG` was the only tag write with an undo, so removing ONE tag from ONE
   * rule ("stop using it here", the association panel's action) was the only
   * irreversible tag operation in the app — a protection LADDER with a missing
   * rung: deleting a tag is confirmed AND undoable, deleting its last reference
   * from a rule was neither.
   *
   * The write carries the rule's tag list as it was BEFORE the change, which is all
   * a restore needs: `SET_RULE_TAGS` writes the whole set, so replaying the previous
   * set is the exact inverse. Storing the previous set rather than a diff also means
   * the undo cannot depend on what the intervening write did.
   */
  | {
      kind: 'rule-tags';
      ruleId: string;
      /** The rule's `tagIds` before the change, i.e. what the undo restores. */
      previousTagIds: string[];
    }
  /**
   * Undoing an enable/disable toggle.
   *
   * `enabled` is the value the undo WRITES BACK, i.e. the state before the toggle.
   * Carrying the target value (rather than a "toggle" instruction) is deliberate:
   * a toggle-based replay would invert whatever the rule says at UNDO time, so an
   * edit made in between would be silently overwritten the wrong way. Writing an
   * absolute value restores the state the user actually asked for.
   */
  | {
      kind: 'rule-enabled';
      ruleId: string;
      enabled: boolean;
    }
  /**
   * Undoing a rule deletion: the whole record, id included.
   *
   * The `id` is the point. `tagIds` live on the rule record, so restoring under a
   * NEW id would orphan every tag association the rule had — the record would come
   * back looking right and being unreferenced. `repo.addRule` persists whatever
   * object it is given without rewriting the id, which is what makes that possible.
   */
  | {
      kind: 'rule-delete';
      rule: PageRule;
    };

export interface UndoSnapshot {
  writes: UndoLayerWrite[];
  affectedTabIds: number[];
}

/** One bar's data: identity + copy + its OWN expiry (U2). */
export interface UndoBarEntry {
  id: string;
  message: string;
  expiresAt: number;
  /**
   * Slots this undo would write.
   *
   * Undo is only sound in LIFO order: each entry's snapshot was captured from the
   * state its predecessors left behind, so applying an OLDER one first makes the
   * newer entry's snapshot stale. Concretely, with `s1↔s2` then `s2↔s3`:
   * undoing `s1↔s2` first and then `s2↔s3` writes the pre-`s1↔s2` content of s2
   * into s2 AGAIN, duplicating s1's original data.
   *
   * Two entries are therefore RELATED when they write a common slot, and a related
   * entry that is NOT the newest must not be actionable (see `blockedIds`).
   *
   * `undefined` means "writes nothing meaningful to a slot" (tag/rule entries,
   * which carry no slot identity) — such entries are never blocked, because they
   * cannot go stale against a slot write.
   */
  slotIds?: number[];
}

export interface UndoBarProps {
  /** Stacked bars, oldest first (U1). Empty → renders nothing. */
  entries: UndoBarEntry[];
  /** Undo the entry with this `id` (U1: never "the newest"). */
  onUndo: (id: string) => void;
  /** This entry's countdown elapsed (U2: carries WHICH entry). */
  onExpire: (id: string) => void;
  /**
   * Entries whose Undo must be DISABLED — an earlier entry that a newer, RELATED
   * entry depends on. Explained to the user rather than silently ignored, because
   * a greyed-out button with no reason reads as a bug.
   */
  blockedIds?: ReadonlySet<string>;
  /** Return focus here when the bars disappear (CT3-g1). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Default undo lifetime, in milliseconds (CT3/R15) — the UI's own countdown.
 *
 * NOT equal to the worker's `PENDING_UNDO_TTL_MS`, and that inequality is
 * LOAD-BEARING: the worker must retain a snapshot for LONGER than the bar is
 * shown, because it stamps its deadline when it CAPTURES while the user only sees
 * the bar once the response has travelled back. When the two were both 5s, that
 * round trip was charged against the user's viewing time, so a slow first action
 * (cold service worker) showed a bar with almost none of its life left — the
 * reported "first swap shows no undo bar" defect.
 *
 * The two are separate definitions on purpose beyond the value: the worker must not
 * import UI code (nor the reverse), and the UI's is a render countdown while the
 * worker's is a lazy read-time validity check. Their ORDER is asserted by a test
 * (`sidebar.test.tsx`) so a future edit cannot silently re-invert it.
 */
export const UNDO_DEFAULT_MS = 5000;

/** No entries blocked — a stable identity so the default does not re-create a Set. */
const EMPTY_BLOCKED: ReadonlySet<string> = new Set<string>();

export function UndoBar({ entries, onUndo, onExpire, blockedIds, returnFocusRef }: UndoBarProps) {
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const blocked = blockedIds ?? EMPTY_BLOCKED;
  // Focus the NEWEST ACTIONABLE bar so a keyboard user can undo immediately
  // (CT3-g). Focusing a disabled button would be a dead end — the browser cannot
  // focus a `disabled` element, so `firstButtonRef` would silently stay unfocused.
  // Track by id so a re-render (an entry expiring) does not re-grab focus.
  const focusedForRef = useRef<string | null>(null);
  const newestActionableId = [...entries].reverse().find((e) => !blocked.has(e.id))?.id ?? null;

  useEffect(() => {
    if (newestActionableId === null || focusedForRef.current === newestActionableId) return;
    focusedForRef.current = newestActionableId;
    firstButtonRef.current?.focus();
  }, [newestActionableId]);

  // U2: one timer PER entry, each keyed on the entry's own `expiresAt`. An entry
  // expiring only removes itself; the others keep their own deadlines.
  const entryIds = entries.map((e) => e.id).join('\u0000');
  useEffect(() => {
    const timers = entries.map((entry) => {
      const delay = Math.max(0, entry.expiresAt - Date.now());
      return setTimeout(() => {
        onExpire(entry.id);
      }, delay);
    });
    return () => { timers.forEach((t) => { clearTimeout(t); }); };
    // Re-arm on identity/expiry changes; `entries` identity changes each render,
    // so key the effect on the stable `entryIds` projection instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryIds, onExpire]);

  // CT3-g1: hand focus back once the LAST bar disappears.
  const wasNonEmpty = useRef(false);
  useEffect(() => {
    if (entries.length > 0) {
      wasNonEmpty.current = true;
      return;
    }
    if (wasNonEmpty.current) {
      wasNonEmpty.current = false;
      returnFocusRef?.current?.focus();
    }
  }, [entries.length, returnFocusRef]);

  const handleUndo = useCallback((id: string) => {
    onUndo(id);
    returnFocusRef?.current?.focus();
  }, [onUndo, returnFocusRef]);

  if (entries.length === 0) return null;

  // U1: one `.tbs-undo-bar` per entry, each its own `role="status"` region, so
  // the existing bar styling (and its message) is reused as-is rather than
  // introducing a new wrapper class with no stylesheet entry.
  // CT3-g4: `role="alert"` + `aria-live="polite"` contradict each other; a status
  // role announces politely without the assertive alert semantics.
  return (
    <>
      {entries.map((entry) => {
        const isBlocked = blocked.has(entry.id);
        return (
          <div key={entry.id} className="tbs-undo-bar" role="status" aria-live="polite">
            <span className="tbs-undo-bar__message">{entry.message}</span>
            {isBlocked && (
              // Say WHY, not just grey it out: the button still reads "Undo", and a
              // disabled control with no explanation is indistinguishable from a bug.
              <span className="tbs-undo-bar__blocked-hint">
                Undo a later swap first
              </span>
            )}
            <Button
              ref={entry.id === newestActionableId ? firstButtonRef : undefined}
              variant="secondary"
              size="sm"
              disabled={isBlocked}
              onClick={() => { handleUndo(entry.id); }}
            >
              Undo
            </Button>
          </div>
        );
      })}
    </>
  );
}
