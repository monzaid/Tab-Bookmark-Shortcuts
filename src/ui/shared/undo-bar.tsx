/**
 * UndoBar — the generalized undo surface (IMP-6 / DT9).
 *
 * A single implementation shared by the sidebar and the settings page, so there
 * is never a second undo UI (`Toast.action` stays unused by design — N11).
 *
 * DT9 requires the restore to be ATOMIC: one Undo replays every write in the
 * batch and then triggers a single redelivery, rather than restoring layer by
 * layer (which would expose half-restored state and fan out deliveries).
 */

import { useCallback, useEffect, useRef } from 'react';
import type { IconSource } from '@shared/types';
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
    };

export interface UndoSnapshot {
  writes: UndoLayerWrite[];
  affectedTabIds: number[];
}

export interface UndoState {
  message: string;
  snapshot: UndoSnapshot;
  expiresAt: number;
}

export interface UndoBarProps {
  state: UndoState;
  /** Replay the WHOLE batch atomically, then redeliver once. */
  onUndo: (snapshot: UndoSnapshot) => void;
  onExpire?: () => void;
  /** Return focus here when the bar disappears (CT3-g1). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  durationMs?: number;
}

export const UNDO_DEFAULT_MS = 5000;

export function UndoBar({ state, onUndo, onExpire, returnFocusRef, durationMs = UNDO_DEFAULT_MS }: UndoBarProps) {
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const shownAt = useRef<number>(Date.now());

  // CT3-g: the bar takes focus so a keyboard user can undo immediately.
  useEffect(() => {
    undoButtonRef.current?.focus();
  }, [state]);

  // CT3-g1: hand focus back when the bar goes away.
  useEffect(() => {
    const timer = setTimeout(() => {
      onExpire?.();
      returnFocusRef?.current?.focus();
    }, durationMs);
    return () => { clearTimeout(timer); };
  }, [durationMs, onExpire, returnFocusRef, state]);

  const handleUndo = useCallback(() => {
    onUndo(state.snapshot);
    returnFocusRef?.current?.focus();
  }, [onUndo, returnFocusRef, state.snapshot]);

  void shownAt;

  return (
    // CT3-g4: `role="alert"` + `aria-live="polite"` contradict each other; a
    // status role announces politely without the assertive alert semantics.
    <div className="tbs-undo-bar" role="status" aria-live="polite">
      <span className="tbs-undo-bar__message">{state.message}</span>
      <Button ref={undoButtonRef} variant="secondary" size="sm" onClick={handleUndo}>
        Undo
      </Button>
    </div>
  );
}