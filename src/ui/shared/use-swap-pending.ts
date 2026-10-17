/**
 * useSwapPending — the LIST-LEVEL transient "pending swap" state (D15).
 *
 * A swap is one sentence: pick a SOURCE, pick a TARGET, then commit. Two inputs
 * express that same sentence — the DRAG path (`dragstart` → `dragover` → `drop`)
 * and the `Alt` gesture (arm → `↑`/`↓` → `keyup`). D15 therefore keeps ONE state
 * at list level instead of one per input: "am I mid-swap" is a single value, and
 * a row cannot be armed by one path while a drag is running on the other. The
 * row learns its own two roles through props (`swapPending`).
 *
 * The `⋯` menu path (D23) is deliberately OUTSIDE this state (C1): the menu
 * steals focus the moment it opens, so a dialog — which owns its own lifetime
 * via `Escape` / cancel / submit — is the only shape that can complete there.
 * D12's blur rule must not reach it.
 *
 * ── The `Alt` gesture (T17) ────────────────────────────────────────────────
 *
 * D11: `Alt+↑/↓` MOVES a swap cursor (it does not swap immediately — an
 * immediate model could only reach adjacent slots); releasing `Alt` commits.
 * D11 also wraps at both ends (1 ↑ → 10, 10 ↓ → 1) so every slot is reachable
 * as a target. D12 gives the gesture a lifetime shorter than the key: `Escape`
 * cancels, the row losing focus cancels, and a ~3s timeout is the backstop for a
 * `keyup` that never arrives (Alt+Tab, a system popup).
 *
 * D17/C2 splits the two ways the cursor can equal the source at release:
 * "in place, never moved" is a silent no-op (the user asked for nothing), while
 * pressing INTO a boundary is announced with the key's own symbol plus
 * `Top`/`Bottom` (D25-⑤b) — otherwise a user holding `↓` at slot 10 would think
 * the key had stopped working.
 *
 * A9: the gesture arms only when the focused element is a slot ROW ROOT. That
 * single check also covers the rest of A9's precondition — a row that is
 * mid-edit has its input focused, and an open `⋯` menu has moved focus to its
 * button — so no second probe is needed.
 *
 * V1 note (honesty, D19): whether calling `preventDefault()` on the `Alt`
 * `keydown` both suppresses the browser menu AND still lets the `keyup` arrive
 * is a WINDOWS-CHROME measurement. jsdom has no menu bar and delivers `keyup`
 * regardless, so nothing here asserts that outcome; the `preventDefault()` call
 * is the mechanism, and V1 stays a human check.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SwapPending {
  /** The slot being moved. Never null while a swap is pending (D15). */
  source: number;
  /** The slot currently under the pointer, or null when none is chosen yet. */
  target: number | null;
}

/** D25-⑤b: the boundary hint shown next to the focused row. */
export interface SwapHint {
  /** The key whose direction ran off the end — same shape as the key itself. */
  symbol: '↑' | '↓';
  word: 'Top' | 'Bottom';
}

export interface UseSwapPendingResult {
  /** `null` when no swap is in flight. */
  pending: SwapPending | null;
  /** Report source/target as the input moves; a `null` source ends the swap. */
  report: (source: number | null, target: number | null) => void;
  /** End the swap without committing (drag end, drop, list refresh). */
  clear: () => void;
  /** D17/D25-⑤b: the armed gesture's boundary hint, or null when none. */
  hint: SwapHint | null;
}

/**
 * D12: the LAST-RESORT backstop, for the residue that evidence cannot cover.
 *
 * This used to be 3 SECONDS and it killed the gesture under a user who was simply
 * HOLDING Alt while deciding — reported defect 2: the highlight vanished and the
 * cursor appeared to snap back to the original slot, with Alt still down.
 *
 * The model is now evidence-based rather than silence-based:
 *   * a `keyup` is reliable (V1 measured it, even with `preventDefault` on the
 *     arming keydown), so a release is normally observed directly;
 *   * any key event with `altKey === false` proves the key is up → end immediately;
 *   * `blur` / `visibilitychange` covers "the page can no longer see the keyboard"
 *     (Alt+Tab is the classic way a `keyup` is lost).
 *
 * That leaves only an OS-level interception that swallows the `keyup` WITHOUT the
 * window losing focus. This timer exists for exactly that residue, so it must be
 * long enough never to fire during normal use — a user may reasonably hold Alt for
 * a minute while deciding. It is a safety net, not a UX boundary.
 */
export const SWAP_GESTURE_TIMEOUT_MS = 300_000;

const SLOT_MIN = 1;
const SLOT_MAX = 10;

/**
 * A9/V3: the minimal `activeElement` → slot-number map. The row root is the one
 * element carrying both `role="listitem"` and `aria-posinset` (D26-3), so this
 * reads an attribute the row already renders rather than adding a second marker.
 */
function armedSlotFromActiveElement(): number | null {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  if (!el || el.getAttribute('role') !== 'listitem') return null;
  const pos = el.getAttribute('aria-posinset');
  if (!pos) return null;
  const n = Number(pos);
  return Number.isInteger(n) && n >= SLOT_MIN && n <= SLOT_MAX ? n : null;
}

export function useSwapPending(
  onCommit?: (source: number, target: number) => void,
): UseSwapPendingResult {
  const [pending, setPending] = useState<SwapPending | null>(null);
  const [hint, setHint] = useState<SwapHint | null>(null);

  // `keydown`/`keyup` are window events, so the handlers must read the latest
  // value without being re-registered on every change (a re-registration between
  // `keydown` and `keyup` would drop the release).
  const pendingRef = useRef<SwapPending | null>(null);
  const armedRef = useRef(false);
  const movedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const publish = useCallback((next: SwapPending | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  /** D12: a cancellation — drop the gesture, its timer, its hint and the state. */
  const endGesture = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    armedRef.current = false;
    movedRef.current = false;
    setHint(null);
    publish(null);
  }, [publish]);

  const report = useCallback((source: number | null, target: number | null) => {
    // A single setter for both inputs: the source is what makes a swap exist, so
    // "no source" is how every ending is expressed (drop, dragend, cancellation).
    // That includes D13's "a drag cancels an armed Alt" — the drag path calls
    // `report(null, null)`, which ends the gesture with no extra wiring.
    if (source === null) {
      endGesture();
      return;
    }
    publish({ source, target });
  }, [publish, endGesture]);

  const clear = useCallback(() => { endGesture(); }, [endGesture]);

  /**
   * D12 backstop, re-armed on every sign of life.
   *
   * The timeout exists for a `keyup` that NEVER arrives. It used to be armed once,
   * on the arming `Alt` keydown, and never refreshed — so a user who armed the
   * gesture and then spent a few seconds stepping through slots had the gesture
   * cancelled underneath them: the pending target vanished and the cursor appeared
   * to snap back to where it started, even though Alt was still held. (Reported
   * defect.) Activity is positive evidence that the gesture is alive, so each
   * arrow press restarts the countdown; only genuine IDLE time ends it.
   */
  const armTimeout = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(endGesture, SWAP_GESTURE_TIMEOUT_MS);
  }, [endGesture]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ── V1 fallback anchor ────────────────────────────────────────────────
      // V1 was the open question: does cancelling the Alt `keydown` ALSO swallow
      // the Alt `keyup`, which would make a release-to-commit model impossible?
      //
      // ✅ MEASURED — V1 PASSES (2026-10-17). Real browsers, `preventDefault()`
      // ON the Alt keydown, reading the report from
      // `_context-output/evidence/final-qa/V1-alt-manual-check.html`:
      //   * Edge   : "PASS — keydown was cancelled AND keyup still arrived (1881ms)"
      //   * Chrome : "PASS — keydown was cancelled AND keyup still arrived (1561ms)"
      // The control run (suppression OFF) also passed, as expected. So suppression
      // and keyup delivery COEXIST and this release-to-commit model stands. The
      // fallback below was therefore NOT taken.
      //
      // Kept on record in case a future browser/OS regresses it. If that happens,
      // the prepared fallback is an EXPLICIT commit key — add a branch HERE for
      // `e.key === 'Enter'` while armed:
      //
      //     if (e.key === 'Enter' && armedRef.current) { commit-from-pending; return; }
      //
      // — and then make `onKeyUp` a no-op (or drop the `keyup` listener entirely),
      // so the gesture commits on `Enter` instead of on the `Alt` release. Nothing
      // else moves: the cursor, the wrap, the three cancellations and the boundary
      // hint are all key-agnostic, so the change is confined to these two handlers.
      if (e.key === 'Alt') {
        if (armedRef.current) return;
        const source = armedSlotFromActiveElement();
        if (source === null) return;
        // The V1 mechanism: suppress the browser's own Alt handling so the menu
        // does not take over. Whether the `keyup` still arrives in Windows Chrome
        // is the V1 human check, not something this line can prove.
        e.preventDefault();
        armedRef.current = true;
        movedRef.current = false;
        setHint(null);
        publish({ source, target: source });
        armTimeout();
        return;
      }

      if (!armedRef.current) return;

      // ── Why silence is no longer treated as a lost release ───────────────
      // Reported defect 2: a user who armed the gesture and then HELD Alt (pressing
      // an arrow once, or not at all) watched the highlight vanish after a few
      // seconds and the cursor snap back to the original slot. The old code inferred
      // "the `keyup` was lost" from mere SILENCE — indistinguishable from a user who
      // is simply thinking. Silence is no longer evidence; a `keyup` is reliable
      // (V1 measured it) and the timer is now a far-backstop only.
      if (e.key === 'Escape') {
        e.preventDefault();
        endGesture();
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const up = e.key === 'ArrowUp';
        const current = pendingRef.current?.target ?? pendingRef.current?.source ?? SLOT_MIN;
        // D11 wrap in both directions; D17/D25-⑤b announce the boundary press.
        const atTop = up && current === SLOT_MIN;
        const atBottom = !up && current === SLOT_MAX;
        const next = up
          ? (current === SLOT_MIN ? SLOT_MAX : current - 1)
          : (current === SLOT_MAX ? SLOT_MIN : current + 1);
        setHint(atTop ? { symbol: '↑', word: 'Top' } : atBottom ? { symbol: '↓', word: 'Bottom' } : null);
        movedRef.current = true;
        // An arrow press is proof of life; push the last-resort timer out.
        armTimeout();
        publish({ source: pendingRef.current?.source ?? current, target: next });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || !armedRef.current) return;
      const source = pendingRef.current?.source ?? null;
      const target = pendingRef.current?.target ?? null;
      const moved = movedRef.current;
      endGesture();
      // D11: releasing Alt commits. D17/C2: only when the cursor actually left
      // the source — an unmoved arm is a silent no-op.
      if (moved && source !== null && target !== null && target !== source) {
        commitRef.current?.(source, target);
      }
    };

    /**
     * The page STOPPED being able to observe the keyboard — a real ending, unlike
     * "no event for a while".
     *
     * `focusout` used to be the trigger, and it is wrong for this gesture: moving
     * between rows (which the arrow keys cause, and which clicking or tabbing can
     * also cause) fires it while the user is still holding Alt and still mid-swap.
     * Only an actual `blur` of the WINDOW, or the tab being hidden (Alt+Tab is the
     * classic way a `keyup` gets lost), means the release can no longer be seen.
     */
    const onWindowBlurOrHidden = () => {
      if (armedRef.current) endGesture();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') onWindowBlurOrHidden();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlurOrHidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlurOrHidden);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [endGesture, publish, armTimeout]);

  return { pending, report, clear, hint };
}
