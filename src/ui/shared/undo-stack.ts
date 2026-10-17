/**
 * Shared undo stack (U4/U6) — the single model every undo surface feeds.
 *
 * The app previously held THREE independent single-value undo holders (the
 * sidebar's private `UndoState`, settings Tags, settings Dashboard), so a new
 * undoable action overwrote the previous one (A7). This hook is the one stack
 * they all push onto (U4: "unified, three holders one model").
 *
 * Two replay mechanisms coexist in that stack, so an entry carries a `replay`
 * discriminant (U6 / revision §1.1):
 * - `background` — the worker holds the snapshot; replay sends ONE `UNDO_SAVE`
 *   `{ slotId, captureId }` and the worker restores itself.
 * - `client`     — the UI holds the snapshot; replay sends the writes one by one.
 *
 * `id` is the stack-local identity used for "undo the bar I clicked" and for
 * per-entry countdown. It is deliberately NOT the backend `captureId`: a
 * `background` entry carries BOTH (revision §3).
 *
 * TTL note — two separate definitions, on purpose:
 * - `PENDING_UNDO_TTL_MS` in `background/storage-repository.ts` is the WORKER-side
 *   snapshot lifetime, validated lazily there. It is deliberately LONGER than the
 *   bar's life, because the worker stamps it at CAPTURE time while the user only
 *   sees the bar after the response returns; equal values charged the round trip
 *   against the user's window (the "first swap shows no undo bar" defect).
 * - `UNDO_DEFAULT_MS` in `ui/shared/undo-bar.tsx` is the UI countdown.
 * They live apart because the worker must never import UI code (and vice versa).
 */

import { useCallback, useRef, useState } from 'react';
import type { UndoSnapshot } from './undo-bar';

// ─── Entry model ─────────────────────────────────────────────────────────────

export type UndoEntry =
  | {
      id: string;
      replay: 'background';
      /**
       * The slot whose undo request addresses this capture (`UNDO_SAVE` needs one).
       * For a SWAP this is the SOURCE slot — see `slotIds` for the full footprint.
       */
      slotId: number;
      /**
       * EVERY slot this entry's undo would write.
       *
       * A swap writes TWO slots, so keying "related" on `slotId` alone would mark a
       * `s2↔s3` swap as unrelated to an `s1↔s2` one and let the user undo them out
       * of order — the exact duplication reported. Defaults to `[slotId]` when the
       * caller omits it, which is right for a single-slot overwrite.
       */
      slotIds?: number[];
      captureId: number;
      message: string;
      expiresAt: number;
    }
  | {
      id: string;
      replay: 'client';
      snapshot: UndoSnapshot;
      message: string;
      expiresAt: number;
    };

/** `Omit` does not distribute over a union; this variant does. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a caller hands to `push` — the stack assigns `id` when none is given. */
export type UndoEntryInput = DistributiveOmit<UndoEntry, 'id'> & { id?: string };

// ─── Stack-local identity ────────────────────────────────────────────────────

/**
 * Module-level counter, mirroring the worker's `captureId` counter: unique for
 * the lifetime of the page, which is all a 5s undo window needs.
 */
let undoEntryCounter = 0;
export function nextUndoEntryId(): string {
  undoEntryCounter += 1;
  return `undo-${String(undoEntryCounter)}`;
}

// ─── Canonical replay dispatch (U6) ──────────────────────────────────────────

export type UndoReplay = (entry: UndoEntry) => void | Promise<void>;

/**
 * The canonical U6 dispatch, expressed as a function of the message sender.
 *
 * `background` → exactly ONE `UNDO_SAVE`. `client` → one message per write,
 * reusing the SAME mapping the settings page already had (tag/unlink in
 * `TagsSection`, override/marker in the Dashboard) — the semantics are moved,
 * not rewritten. Hosts keep their surrounding side effects (toast, reload) and
 * wrap this.
 */
export function createUndoReplay(
  send: (action: string, payload?: unknown) => Promise<unknown>,
): UndoReplay {
  return async (entry) => {
    if (entry.replay === 'background') {
      await send('UNDO_SAVE', { slotId: entry.slotId, captureId: entry.captureId });
      return;
    }
    for (const write of entry.snapshot.writes) {
      switch (write.kind) {
        case 'tab-override':
          // FIX-A: replay the ORIGINAL source verbatim — never re-derive it.
          await send('SET_TAB_OVERRIDE', {
            tabId: write.tabId,
            ...(write.title !== undefined ? { title: write.title ?? '' } : {}),
            ...(write.favicon !== undefined ? { favicon: write.favicon } : {}),
          });
          break;
        case 'slot-marker':
          await send('UPDATE_SLOT_UI_MARKER', {
            slotId: write.slotId,
            uiMarker: {
              ...(write.customTitle !== undefined ? { customTitle: write.customTitle ?? '' } : {}),
              ...(write.icon !== undefined ? { icon: write.icon } : {}),
            },
          });
          break;
        case 'tag-delete':
          await send('RESTORE_TAG', { tag: write.tag, refs: write.refs });
          break;
        case 'rule-tags':
          await send('SET_RULE_TAGS', { ruleId: write.ruleId, tagIds: write.previousTagIds });
          break;
      }
    }
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseUndoStackOptions {
  /** Perform the undo for a consumed entry (see `createUndoReplay`). */
  onReplay: UndoReplay;
  /** Identity generator; injectable so tests are deterministic. */
  makeId?: () => string;
}

export interface UndoStack {
  entries: UndoEntry[];
  /** Append an entry; returns its stack id. UNBOUNDED (U7). */
  push: (entry: UndoEntryInput) => string;
  /** Remove the entry by `id` and replay IT (not the newest) — "undo what I clicked". */
  consume: (id: string) => void;
  /** Remove one expired entry by `id`, leaving the rest untouched (U2). */
  expire: (id: string) => void;
  /** Drop the whole stack (section change / reload). */
  clear: () => void;
  /**
   * Entries the UI must NOT allow undoing out of order (see `UndoBarEntry.slotIds`).
   *
   * Undo is only sound in LIFO order, so an entry is blocked when a NEWER entry
   * writes a slot it also writes: that newer snapshot was captured from the state
   * this one left behind, so applying this one first makes the newer one stale.
   *
   * The rule is TRANSITIVE through dependency, not merely "any older entry that
   * shares a slot": A(s1,s2) · B(s2,s3) · C(s3,s4) must leave only C actionable, so
   * blocking is computed over the graph whose edges are shared slots. Blocking A
   * alone would still let B run, and undoing B before C duplicates s3's content.
   */
  blocked: ReadonlySet<string>;
}

/**
 * The slots an entry MOVES BETWEEN — empty for everything except a swap.
 *
 * Only a swap needs this. A swap's snapshot spans TWO slots, so a later swap that
 * touches either of them reads state this one established; undo them out of order
 * and the later snapshot writes stale content back into the shared slot.
 *
 * A plain overwrite (`slotIds` absent, or a single id) does NOT qualify, and that
 * distinction is deliberate rather than an optimisation. Two successive overwrites
 * of the SAME slot are self-contained whole-slot replacements: keeping the older
 * one on the stack and undoing it first restores a coherent earlier state. Treating
 * them as related blocked a legitimate, existing interaction (the stack's own
 * "undo the older of two writes" case), which is how this rule was caught being
 * too broad.
 */
function swapSlotIds(entry: UndoEntry): number[] {
  if (entry.replay !== 'background') return [];
  const ids = entry.slotIds ?? [entry.slotId];
  return ids.length > 1 ? ids : [];
}

/**
 * SCOPE, stated explicitly so a later reader does not assume more than it does.
 *
 * This rule guards the case that was REPORTED: swaps, which move content BETWEEN
 * slots and therefore make a later swap's snapshot depend on an earlier one.
 *
 * It deliberately does NOT try to order `client` entries (Tags / Dashboard). Those
 * restore whole field or whole entity values, so undoing an older one first leaves
 * a coherent state rather than a duplicated one; they also carry no slot identity
 * to relate on. Blocking them would invent dependencies the data does not have —
 * and would disable legitimate interactions, which is exactly how the first,
 * broader version of this rule was caught.
 *
 * Entries that must be blocked because a NEWER SWAP depends on them.
 *
 * Walks from the newest to the oldest, keeping the slots already claimed by a
 * not-yet-blocked swap. An older entry that shares ANY of those slots is blocked
 * and contributes its own slots — which is what makes the dependency transitive
 * (A(s1,s2) · B(s2,s3) · C(s3,s4) blocks both A and B, not just A).
 */
export function computeBlockedIds(entries: UndoEntry[]): ReadonlySet<string> {
  const claimed = new Set<number>();
  const blocked = new Set<string>();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const slotIds = swapSlotIds(entries[i]);
    // Not a swap (tag / rule / single-slot write): cannot go stale against a swap
    // of the slot it addresses, and never blocks one.
    if (slotIds.length === 0) continue;
    if (slotIds.some((id) => claimed.has(id))) blocked.add(entries[i].id);
    // Claim regardless: an even older swap touching these slots is blocked too.
    for (const id of slotIds) claimed.add(id);
  }
  return blocked;
}

export function useUndoStack({ onReplay, makeId = nextUndoEntryId }: UseUndoStackOptions): UndoStack {
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  // Replay is read through a ref so `consume` keeps a stable identity while
  // always calling the LATEST handler (it closes over live component state).
  const replayRef = useRef<UndoReplay>(onReplay);
  replayRef.current = onReplay;
  const entriesRef = useRef<UndoEntry[]>(entries);
  entriesRef.current = entries;

  const push = useCallback((input: UndoEntryInput): string => {
    const id = input.id ?? makeId();
    // U7: no cap. Entries are reclaimed one by one as each expires (U2).
    setEntries((prev) => [...prev, { ...input, id }]);
    return id;
  }, [makeId]);

  const consume = useCallback((id: string): void => {
    // Look the entry up OUTSIDE the state updater: replaying is a side effect and
    // an updater may run more than once (StrictMode), which would double-send.
    const current = entriesRef.current;
    const entry = current.find((e) => e.id === id);
    if (!entry) return;
    // The disabled button is only the VISIBLE half of the rule. A keyboard
    // activation, a stale closure or a direct call must not be able to undo out of
    // order either — the data corruption does not care how the request arrived.
    if (computeBlockedIds(current).has(id)) return;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    void replayRef.current(entry);
  }, []);

  const expire = useCallback((id: string): void => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clear = useCallback((): void => {
    setEntries([]);
  }, []);

  return { entries, push, consume, expire, clear, blocked: computeBlockedIds(entries) };
}
