/**
 * useJumpToRow — jump to a row from a source badge (F1 / F1b / F2).
 *
 * Behaviour contract:
 * - F1: scroll to the target row and highlight it. Never auto-expands the row
 *   and never touches the user's filter/sort.
 * - F1b fallback chain: visible target → scroll + highlight; target filtered
 *   out but other rows exist → scroll to the FIRST row (and NEVER highlight it);
 *   no rows at all → focus the search box.
 * - F1b-b: the fallback is announced honestly on `role="status"`.
 * - F2: highlight is temporary (~2s) with a transition; under reduced motion the
 *   transition is dropped but the HIGHLIGHT REMAINS (otherwise there is no
 *   feedback at all); a non-visual `Jumped to the rule` announcement is issued
 *   without stealing focus; repeated jumps RESET the timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TierOwner } from '@shared/field-chain';

export const JUMP_HIGHLIGHT_CLASS = 'tbs-settings__row--jump';
export const JUMP_HIGHLIGHT_MS = 2000;

export interface Announcement {
  id: number;
  message: string;
}

export interface UseJumpToRowOptions {
  /** Resolve a row element for an anchor (null when the row is not rendered). */
  resolveRow: (anchor: TierOwner) => HTMLElement | null;
  /** The first table row (the F1b fallback target). */
  firstRow: () => HTMLElement | null;
  /** The search input (the "no rows" fallback target). */
  searchRef: React.RefObject<HTMLElement | null>;
  highlightMs?: number;
}

export interface UseJumpToRowResult {
  jumpTo: (anchor: TierOwner | null) => void;
  /** Current non-visual announcement (render inside a `role="status"` node). */
  announcement: Announcement | null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function useJumpToRow({
  resolveRow,
  firstRow,
  searchRef,
  highlightMs = JUMP_HIGHLIGHT_MS,
}: UseJumpToRowOptions): UseJumpToRowResult {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightedEl = useRef<HTMLElement | null>(null);
  const announcementSeq = useRef(0);

  const clearHighlight = useCallback(() => {
    if (highlightTimer.current !== null) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    if (highlightedEl.current) {
      highlightedEl.current.classList.remove(JUMP_HIGHLIGHT_CLASS);
      highlightedEl.current = null;
    }
  }, []);

  const announce = useCallback((message: string) => {
    announcementSeq.current += 1;
    setAnnouncement({ id: announcementSeq.current, message });
  }, []);

  const jumpTo = useCallback(
    (anchor: TierOwner | null) => {
      if (!anchor) return;

      // F2-d: a repeated jump must not be cut short by the previous timer.
      clearHighlight();

      const target = resolveRow(anchor);

      if (target) {
        target.scrollIntoView({ block: 'center' });
        // F2-e / F1b-a: highlight is only for a genuine target.
        target.classList.add(JUMP_HIGHLIGHT_CLASS);
        highlightedEl.current = target;
        highlightedEl.current.dataset.jumpReducedMotion = prefersReducedMotion() ? 'true' : 'false';
        highlightTimer.current = setTimeout(() => {
          target.classList.remove(JUMP_HIGHLIGHT_CLASS);
          highlightedEl.current = null;
          highlightTimer.current = null;
        }, highlightMs);
        // F2-c: announce without moving focus.
        announce('Jumped to the rule');
        return;
      }

      const fallbackRow = firstRow();
      if (fallbackRow) {
        // F1b / F1b-a: scroll to the first row but do NOT highlight it.
        fallbackRow.scrollIntoView({ block: 'start' });
        announce('The target rule is hidden by the current search — showing all matches instead.');
        return;
      }

      // No rows at all → focus the search box.
      searchRef.current?.focus();
      announce('No rules to show — try clearing the search.');
    },
    [announce, clearHighlight, firstRow, highlightMs, resolveRow, searchRef],
  );

  useEffect(() => clearHighlight, [clearHighlight]);

  return { jumpTo, announcement };
}