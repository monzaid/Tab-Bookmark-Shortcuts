/**
 * useDraftState — "keep the draft in sync with the prop it was seeded from,
 * unless the user is mid-edit".
 *
 * Review item 3.1 exposed the general shape of this problem: the field editors
 * hold a draft (so Cancel/Escape can discard it) but the value they are editing
 * arrives asynchronously (a chain lookup, a refreshed row). A plain `useState`
 * seeds once and then goes stale; syncing on every prop change throws away
 * whatever the user is typing.
 *
 * The rule implemented here: adopt the incoming, PRISTINE value until the user
 * actually edits something; from then on the draft wins. `save` commits and
 * returns to adopting, `cancel` discards and returns to adopting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface DraftState<T> {
  /** The value being edited. */
  draft: T;
  setDraft: (next: T) => void;
  /** True once the user has edited and not yet saved/cancelled. */
  dirty: boolean;
  /** Commit the current draft (the caller performs the write). */
  save: () => void;
  /** Discard the draft and re-adopt the incoming value. */
  cancel: () => void;
}

export interface UseDraftStateOptions {
  /** Keep the draft when this identity changes (e.g. a different row opened). */
  resetKey?: string | number | null;
}

/**
 * @param initial  The pristine value to adopt.
 * @param isPristine Whether `initial` is usable at all — pass `false` while the
 *   source is still loading, so an empty placeholder is never adopted as "the"
 *   value and quietly overwritten by a save.
 * @param equals   Optional comparator; without it, reference equality is used
 *   (callers holding primitives get the right behaviour for free).
 */
export function useDraftState<T>(
  initial: T,
  isPristine: boolean,
  equals?: (a: T, b: T) => boolean,
  options: UseDraftStateOptions = {},
): DraftState<T> {
  const { resetKey = null } = options;
  const [draft, setDraftState] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);
  const lastKey = useRef<string | number | null | undefined>(undefined);
  /** The last pristine value we adopted, so we only re-adopt genuine changes. */
  const adopted = useRef<T>(initial);

  const same = useCallback(
    (a: T, b: T): boolean => (equals ? equals(a, b) : Object.is(a, b)),
    [equals],
  );

  // A different row / target opened: re-seed and drop any draft.
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    adopted.current = initial;
    setDraftState(initial);
    setDirty(false);
    // Intentionally keyed on `resetKey` alone: `initial` is read as of the switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    // Never adopt while the user is mid-edit, and never adopt a not-yet-loaded
    // source (it would look like "the value is empty").
    if (dirty || !isPristine) return;
    if (same(initial, adopted.current)) return;
    adopted.current = initial;
    setDraftState(initial);
  }, [initial, isPristine, dirty, same]);

  const setDraft = useCallback((next: T) => {
    setDraftState(next);
    setDirty(true);
  }, []);

  const save = useCallback(() => {
    adopted.current = draft;
    setDirty(false);
  }, [draft]);

  const cancel = useCallback(() => {
    setDirty(false);
    // The sync effect re-adopts `initial` on the next render.
  }, []);

  return { draft, setDraft, dirty, save, cancel };
}