/**
 * useExpandRow — the single row-expansion implementation (IMP-15/16).
 *
 * Four constraints baked in:
 * - 15a: focus moves INTO the row AFTER it has mounted (a synchronous focus on
 *   `toggle` would target an element that does not exist yet);
 * - 15b: Escape collapses the current row;
 * - 15c: collapsing returns focus to the row's toggle button (otherwise focus
 *   silently decays to `<body>`);
 * - 15d: the expanded set is updated immutably (`new Set(prev)`).
 */

import React, { useCallback, useRef, useState } from 'react';

export interface UseExpandRowResult<Id extends string> {
  expanded: Set<Id>;
  isExpanded: (id: Id) => boolean;
  /** Expand/collapse a row; focus follows per 15a/15c. */
  toggle: (id: Id, rowEl?: HTMLElement | null) => void;
  collapseAll: () => void;
  /** Key handler to spread onto the row container (Escape → 15b/15c). */
  getRowHandlers: (id: Id) => { onKeyDown: (e: React.KeyboardEvent) => void };
  /** Ref setter for a row's toggle button (the focus-return target). */
  setToggleRef: (id: Id, el: HTMLButtonElement | null) => void;
}

/**
 * Focus the first FIELD control inside `row`, once it has mounted.
 *
 * Form controls are preferred over buttons: the row's own toggle lives inside
 * the row too, and focusing it would leave the user exactly where they were.
 */
function focusFirstField(row: HTMLElement | null): void {
  if (!row) return;
  // Defer one tick so React has committed the expanded subtree.
  setTimeout(() => {
    const target =
      row.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) ??
      row.querySelector<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    target?.focus();
  }, 0);
}

export function useExpandRow<Id extends string>(): UseExpandRowResult<Id> {
  const [expanded, setExpanded] = useState<Set<Id>>(() => new Set<Id>());
  const toggleRefs = useRef(new Map<Id, HTMLButtonElement>());
  const rowRefs = useRef(new Map<Id, HTMLElement>());

  const isExpanded = useCallback((id: Id) => expanded.has(id), [expanded]);

  const setToggleRef = useCallback((id: Id, el: HTMLButtonElement | null) => {
    if (el) toggleRefs.current.set(id, el);
    else toggleRefs.current.delete(id);
  }, []);

  const collapse = useCallback(
    (id: Id) => {
      setExpanded((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev); // 15d: immutable update
        next.delete(id);
        return next;
      });
      // 15c: return focus to the toggle (never leave it on <body>).
      const toggle = toggleRefs.current.get(id);
      if (toggle) setTimeout(() => { toggle.focus(); }, 0);
    },
    [],
  );

  const toggle = useCallback(
    (id: Id, rowEl?: HTMLElement | null) => {
      if (rowEl) rowRefs.current.set(id, rowEl);

      const willExpand = !expanded.has(id);
      setExpanded((prev) => {
        const next = new Set(prev); // 15d
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

      if (willExpand) {
        // 15a: focus AFTER the row has mounted.
        focusFirstField(rowEl ?? rowRefs.current.get(id) ?? null);
      } else {
        const el = toggleRefs.current.get(id);
        if (el) setTimeout(() => { el.focus(); }, 0); // 15c
      }
    },
    [expanded],
  );

  const collapseAll = useCallback(() => {
    setExpanded(new Set<Id>());
  }, []);

  const getRowHandlers = useCallback(
    (id: Id) => ({
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        collapse(id); // 15b + 15c
      },
    }),
    [collapse],
  );

  return { expanded, isExpanded, toggle, collapseAll, getRowHandlers, setToggleRef };
}