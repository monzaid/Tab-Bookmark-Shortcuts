/**
 * TagExpressionInput — the chip BUILDING surface for a tag expression (G5/D-b).
 *
 * The UI's whole job is "chip sequence <-> user intent". It does NOT parse (that
 * is `tag-expression.ts`) and it does NOT write tags (that is `TagService`, via
 * the parent's `onCreateTag`): the text box is only a CANDIDATE FILTER, never a
 * place to type an expression. That is what makes an invalid expression a
 * near-unreachable state rather than something to validate after the fact — the
 * user picks from a finite set of chips that keep the sequence well-formed.
 *
 * ─── The caret model ─────────────────────────────────────────────────────────
 *
 * The chips and the text field are ONE flow, and `caret` is an insertion index in
 * `0..chips.length`:
 *
 *   caret = 0  [ field ] ( Tag: work ) AND ( Tag: urgent )
 *   caret = 1  ( Tag: work ) [ field ] AND ( Tag: urgent )
 *
 * The field's POSITION in that flow is the insertion point, and the caret rule is
 * drawn immediately before it. Keeping the two in the same element is what makes
 * "the caret is where the next chip lands" true in the DOM rather than only in a
 * variable.
 *
 * ─── Where the keyboard is handled (and why that changed) ────────────────────
 *
 * The keys are handled on the CONTAINER, not on the `<input>`, because the input
 * is not what has focus most of the time: clicking a candidate moves focus to
 * that button, clicking a chip moves it to the chip, and a fresh render can take
 * it off the field entirely. Binding the arrow keys to the input therefore made
 * them do nothing in exactly the situations a caret is for.
 *
 * The container receives every keydown from its descendants (React events bubble),
 * so one handler covers "the field has focus", "a chip has focus" and "something
 * inside was just clicked" with one rule rather than three that can disagree. The
 * only thing it must check is that the event came from a text field rather than
 * the user editing a colour input.
 *
 * ─── Selection: click / Ctrl-click / Shift-click ─────────────────────────────
 *
 * `selected` is a set of chip indices, because an operation like "wrap these two
 * in a group" needs the SET, not a range. The three gestures follow the file
 * manager idiom every user already has:
 *
 *   click       select this chip, and nothing else (the caret does NOT move: a
 *               chip is a THING, not a position, and relocating the insertion
 *               point as a side effect of selection is what every other
 *               selection surface — including the rules table — does not do)
 *   Ctrl-click  toggle this chip in the selection, without moving the caret
 *   Shift-click extend from the anchor (the last plain/ctrl click) to this one
 *   click a gap put the caret at that gap and clear the selection
 *
 * ─── Drag to reorder ─────────────────────────────────────────────────────────
 *
 * Native HTML5 drag/drop (`draggable` + `dataTransfer`), not pointer events: the
 * browser supplies the drag image, the drop cursor and the auto-scroll, and the
 * alternative is a hundred lines of pointer bookkeeping to reinvent them worse.
 * A drop is an ARRAY MOVE, so reordering cannot lose or duplicate a token.
 *
 * ─── Marquee ─────────────────────────────────────────────────────────────────
 *
 * Press on empty space and sweep: chips whose rectangles intersect the marquee
 * become the selection. This is the one gesture with no keyboard equivalent that
 * the other gestures do not already cover, which is why it is worth the pointer
 * bookkeeping — and why it is additive (shift/ctrl held) rather than replacing
 * the existing selection.
 *
 * ─── Accessibility (R6) ──────────────────────────────────────────────────────
 *
 * Every chip is a real element with an accessible name, is focusable, and can be
 * removed from the keyboard. A chip is therefore a control the user can operate
 * without a mouse, not a decorated `<span>`.
 *
 * Layout (D-d): the box WRAPS and grows. It never truncates, never scrolls
 * internally and has no line limit — 8 tags (C3's per-rule ceiling) would
 * otherwise push the toolbar out of the viewport, and a truncated expression is
 * one the user cannot read back.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChipToken } from '@shared/tag-expression';
import { resolveChipDisplayName } from '@shared/tag-expression';
import type { TagDefinition } from '@shared/types';
import { TAG_LIST_DISPLAY_LIMIT } from '@shared/tags';
import { autoTextColor } from '@ui/components/IconEditor';
import { SearchField } from '@ui/shared/search-field';

export interface TagExpressionInputProps {
  chips: ChipToken[];
  onChange: (chips: ChipToken[]) => void;
  /** The live tag table — drives candidate names and the rename-follow display. */
  availableTags: TagDefinition[];
  /**
   * Create a tag by name, returning it (or null on failure). The PARENT sends
   * the message: the writer is one path (`TagService`), so this component holds
   * no message-sending of its own (A1/D-f).
   */
  onCreateTag: (name: string) => Promise<TagDefinition | null>;
  /** Placeholder for the candidate filter. */
  placeholder?: string;
  /**
   * The control's visible name.
   *
   * Required in spirit rather than by the type: a placeholder is not a label
   * (the field is empty the moment a chip is added, so "Add tag…" disappears
   * exactly when the user may have forgotten what the box is for), and every
   * other field on these pages has a visible one.
   */
  label?: string;
}

/** The operators, offered as chips so the sequence stays well-formed (G5). */
const OPERATORS: Array<'AND' | 'OR' | 'NOT'> = ['AND', 'OR', 'NOT'];

type OperatorName = 'AND' | 'OR' | 'NOT';

/**
 * One row of the composition popup — what the typed buffer could become.
 *
 * Modelled on an input method's candidate list, because that is the interaction
 * the user asked for and it maps exactly: the field holds an in-progress
 * COMPOSITION, this list offers what it resolves to, and picking one commits it
 * as a chip. The four kinds are the four things a tag expression is made of, so
 * the popup is complete rather than a partial shortcut.
 */
type ImeItem =
  | { kind: 'tag'; tag: TagDefinition }
  | { kind: 'operator'; op: OperatorName }
  | { kind: 'paren'; p: '(' | ')' }
  | { kind: 'create'; name: string };

/** A stable key for a popup row, shared by the renderer and the tests. */
function imeItemKey(item: ImeItem): string {
  switch (item.kind) {
    case 'tag': return `tag:${item.tag.id}`;
    case 'operator': return `op:${item.op}`;
    case 'paren': return `paren:${item.p}`;
    case 'create': return `create:${item.name}`;
  }
}

/**
 * What the typed buffer could become, in the order an input method would rank it:
 * exact-ish matches first, then the grammar, then the offer to create.
 *
 * An EMPTY buffer produces NO popup — the standard autocomplete behaviour, and
 * the right one here: opening on focus would drop a list over the rows below
 * before the user has asked for anything, and the operators are already on screen
 * permanently in the tray. The popup is for TYPING; the tray is for browsing.
 *
 * Creation is offered whenever no tag EQUALS the buffer — the same condition the
 * tray's create row uses, and the same reason (offering "create work" beside a
 * live `work` invites a duplicate the service then rejects).
 */
function buildImeItems(query: string, tags: TagDefinition[]): ImeItem[] {
  const q = query.trim();
  const lower = q.toLowerCase();
  const items: ImeItem[] = [];

  if (q === '') return items;

  for (const tag of tags) {
    if (tag.name.toLowerCase().includes(lower)) items.push({ kind: 'tag', tag });
  }
  for (const op of OPERATORS) {
    if (op.toLowerCase().startsWith(lower)) items.push({ kind: 'operator', op });
  }
  if (q === '(' || q === ')') items.push({ kind: 'paren', p: q });
  if (!tags.some((t) => t.name === q)) items.push({ kind: 'create', name: q });
  return items;
}

/**
 * How many tag candidates are offered before the rest go behind a disclosure.
 *
 * The table has no cap (C3), so an install with fifty tags used to render fifty
 * buttons and bury the operators and the create row under them. The number itself
 * is SHARED with `TagSelector` (`TAG_LIST_DISPLAY_LIMIT`), which shows the same
 * table: two private constants with a copied argument would have been two numbers
 * claiming to be the same judgement.
 */
const CANDIDATE_LIMIT = TAG_LIST_DISPLAY_LIMIT;

/**
 * How many popup rows one page holds.
 *
 * Eight fits under a caret without covering the rows below, and keeps `-` / `=`
 * worth having: a page you can read at a glance is a page you can navigate to.
 */
const IME_PAGE_SIZE = 8;

/**
 * A module-level counter for the label/tray id prefix.
 *
 * A counter rather than `useId` because the project's React version is what it
 * is and this needs no more than uniqueness within a document; a random value
 * would make the two renders of a test disagree.
 */
let fieldIdCounter = 0;
function nextFieldId(): number {
  fieldIdCounter += 1;
  return fieldIdCounter;
}

/** A stable identity for a token, so React keys and drag payloads agree. */
function tokenKey(token: ChipToken, index: number): string {
  return `${String(index)}:${token.kind === 'tag' ? token.tagId : token.kind === 'op' ? token.op : token.p}`;
}

export function TagExpressionInput({
  chips,
  onChange,
  availableTags,
  onCreateTag,
  placeholder = 'Type to find a tag…',
  label = 'Filter by tags',
}: TagExpressionInputProps): ReactNode {
  /**
   * The in-progress COMPOSITION — what the user has typed but not committed.
   *
   * Named for what it is rather than `query`, because it is no longer only a
   * filter: it is the buffer the popup resolves, and committing it is what turns
   * typing into an expression.
   */
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  /**
   * The candidate TRAY's own open state.
   *
   * Collapsible now that the keyboard can build the whole expression: the tray
   * was the only way in, so it had to be permanently on screen; with the type-
   * ahead popup it is a convenience for browsing, and a user who does not need it
   * should not have to keep the height. DEFAULT OPEN, because hiding a control's
   * primary affordance behind a click is the same trade this component already
   * rejected once.
   */
  const [trayOpen, setTrayOpen] = useState(true);
  /** Which popup row is highlighted. -1 = nothing, so Enter commits the buffer. */
  const [imeIndex, setImeIndex] = useState(-1);

  /**
   * Give the field focus after a caret move has COMMITTED.
   *
   * A no-dependency effect, so it runs after every render: cheap (one flag check),
   * and it is the only hook that runs on a render caused by a caret change — the
   * caret's own `setState` commits and then React either reuses the node or mounts
   * a new one, and this focuses whichever survived. Covers the mount case as well,
   * where the first `focus()` had no node to land on at all.
   */
  useEffect(() => {
    if (!wantFocusRef.current) return;
    wantFocusRef.current = false;
    fieldRef.current?.focus();
  });

  const imeItems = useMemo(() => buildImeItems(query, availableTags), [query, availableTags]);
  /** The popup is up while there is something to resolve. */
  const imeOpen = imeItems.length > 0;

  // ─── Paging the popup ──────────────────────────────────────────────────────
  //
  // A tag table can be long, and an unpaged popup would either trail off the
  // screen or be capped at some arbitrary number the user cannot see past. Paging
  // shows that there IS more and gives the keys to reach it (`-` / `=`), with the
  // count stated so the user knows how much.
  const imePageCount = Math.max(1, Math.ceil(imeItems.length / IME_PAGE_SIZE));
  const [imePage, setImePage] = useState(0);
  const safePage = Math.min(imePage, imePageCount - 1);
  const imePageItems = useMemo(
    () => imeItems.slice(safePage * IME_PAGE_SIZE, (safePage + 1) * IME_PAGE_SIZE),
    [imeItems, safePage],
  );
  const activeIndex = imeIndex >= 0 && imeIndex < imePageItems.length ? imeIndex : -1;

  

  /**
   * A stable id prefix for the label/tray wiring.
   *
   * Seeded rather than random so a server render and the client agree, and
   * `useRef` rather than state because changing it would invalidate the
   * `aria-labelledby` reference it exists to provide.
   */
  const fieldIdRef = useRef<string | null>(null);
  if (fieldIdRef.current === null) {
    fieldIdRef.current = `tag-expr-${String(nextFieldId())}`;
  }
  const fieldId = fieldIdRef.current;
  /** Insertion index in `0..chips.length`. */
  const [caret, setCaret] = useState(chips.length);
  /**
   * The caret CLAMPED to the chips that actually exist.
   *
   * `insertAt` advances the caret in the same tick as it asks the parent to add
   * the chip, so there is a window where the caret points one past the end — and
   * a parent that ignores `onChange`, or a rejected write, leaves it there. The
   * field is rendered at the caret's gap, so reading the RAW index would render
   * no field at all in that window: focus and typing silently dead, no error.
   * Every consumer of the caret uses this value for that reason.
   */
  const caretIndex = Math.min(caret, chips.length);
  /**
   * Where the popup is PHYSICALLY attached.
   *
   * The caret's own gap, not the control — that is what makes it an input-method
   * window rather than a dropdown: when the caret sits in the middle of a wrapped
   * expression, the popup appears at the caret rather than at the box's top-left.
   *
   * The gap element is addressed by INDEX because the caret already is a gap
   * index, so this needs no measurement — and jsdom has no layout engine to
   * measure with, which is also why the anchor is a data attribute rather than a
   * computed `top`/`left`: a number computed from zeroed rectangles would be a
   * position the tests could only assert against itself.
   */
  const caretAnchorTestId = `chip-gap-${String(caretIndex)}`;
  /** The chosen chips, by index. See the module note on the three gestures. */
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  /** The anchor Shift-click extends from. */
  const [anchor, setAnchor] = useState<number | null>(null);
  /**
   * The GAP a drag is currently over, for the drop indicator.
   *
   * A gap rather than a chip, because the gap IS the insertion point — including
   * the two that have no chip on one side of them (the start and the end of the
   * expression), which is what made "drag to the beginning/end" impossible: the
   * only droppable elements were the chips, and both edges of every chip meant
   * "before this chip".
   */
  const [dropGap, setDropGap] = useState<number | null>(null);
  /** The marquee rectangle in container-local coordinates, while sweeping. */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  /**
   * "Focus the field once the current render has committed."
   *
   * Set by `focusField` and consumed by the effect below. It exists because the
   * field is a DIFFERENT DOM node after a caret move (see `focusField`), so the
   * only moment focus can be given to the surviving node is after commit.
   */
  const wantFocusRef = useRef(false);
  /** Where the marquee started, whether it is additive, and whether it ever moved. */
  const sweepRef = useRef<{
    left: number;
    top: number;
    additive: boolean;
    startedAt: { x: number; y: number };
    /** Set once the pointer travels far enough to mean "a range", not "a place". */
    moved: boolean;
  } | null>(null);

  const trimmed = query.trim();
  /**
   * The candidate section's OWN search.
   *
   * Separate from `query` (the expression composition) because the two are
   * different acts: one is typing an expression, the other is browsing the tag
   * vocabulary. Sharing a single buffer meant a browse narrowed the expression
   * being typed, and clicking a candidate looked like it "ate" the search.
   */
  const [candidateQuery, setCandidateQuery] = useState('');
  const candidateNeedle = candidateQuery.trim().toLowerCase();
  const matches = useMemo(
    () => availableTags.filter((t) =>
      candidateNeedle === '' ? true : t.name.toLowerCase().includes(candidateNeedle),
    ),
    [availableTags, candidateNeedle],
  );
  // A create row appears only when the typed text matches no EXISTING tag by
  // name — offering "create work" next to a live `work` would invite a duplicate
  // the service would then reject (C2).
  const exactExists = availableTags.some((t) => t.name === trimmed);
  const canCreate = trimmed.length > 0 && !exactExists;

  const hiddenCount = Math.max(0, matches.length - CANDIDATE_LIMIT);
  const shownTags = showAll ? matches : matches.slice(0, CANDIDATE_LIMIT);

  /**
   * The colours a chip is drawn with.
   *
   * `backgroundColorAtInsert` is stored on the token; the TEXT colour is resolved
   * from the live tag, so a chip shows the appearance the user chose on the Tags
   * page. Two fallbacks, both load-bearing:
   *
   *   - a DELETED tag has no live colours, so `autoTextColor` picks a readable
   *     one from the remembered background. The old rule hard-coded white, which
   *     made a light-background tag's name invisible.
   *   - an OPERATOR / PAREN chip has no background at all, and white-on-white is
   *     exactly why the operators used to render as a blank gap in the box.
   */
  const chipStyle = (token: ChipToken): { backgroundColor?: string; color?: string } => {
    if (token.kind !== 'tag') return {};
    const live = availableTags.find((t) => t.id === token.tagId);
    return {
      backgroundColor: token.backgroundColorAtInsert,
      color: live ? live.textColor : autoTextColor(token.backgroundColorAtInsert),
    };
  };

  /** Focus the field — the caret's home, and where typing should always go. */
  const focusField = (): void => {
    // Marked for the post-commit pass below, and attempted now: the field MOVES in
    // the DOM when the caret moves (it is rendered inside the slot for the gap), so
    // React unmounts the old `<input>` and mounts a NEW one. Focusing synchronously
    // here therefore lands on a node that is about to be removed, and the caret
    // silently loses focus — which is why moving twice needed a second click.
    wantFocusRef.current = true;
    fieldRef.current?.focus();
  };

  /** Put the insertion point at a gap, clearing any chip selection. */
  const placeCaret = (index: number): void => {
    setCaret(index);
    setSelected(new Set());
    setAnchor(null);
    focusField();
  };

  /** Insert at the caret and advance past what was inserted. */
  const insertAt = (token: ChipToken): void => {
    onChange([...chips.slice(0, caret), token, ...chips.slice(caret)]);
    setCaret(caret + 1);
    setQuery('');
    setSelected(new Set());
    setAnchor(null);
    focusField();
  };

  const removeAt = (index: number): void => {
    onChange(chips.filter((_, i) => i !== index));
    // Keep the caret pointing at the same GAP: removing the chip before it shifts
    // the gap left by one, and leaving the index alone would silently move the
    // insertion point past an unrelated chip.
    setCaret((prev) => (index < prev ? prev - 1 : Math.min(prev, chips.length - 1)));
    // Indices above the removal shift down; the set has to follow or a selected
    // chip would silently become a different one.
    setSelected((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
    focusField();
  };

  /** The selected chips, in order — the input to every batch operation. */
  const selectedIndices = useMemo(
    () => [...selected].sort((a, b) => a - b),
    [selected],
  );

  /**
   * Move chips to a gap — the ONE move primitive, used by single and multi drag.
   *
   * Removing the sources first and then inserting them at the gap is what makes
   * the operation safe for a SET: every moved chip is spliced out before anything
   * is spliced in, so the indices cannot collide, and each chip is inserted
   * exactly once because it was removed exactly once. A one-at-a-time loop is the
   * version that drops or duplicates chips when the range being moved overlaps
   * the destination.
   *
   * `sources` are ORIGINAL indices, sorted ascending by the caller; `to` is a gap
   * in the ORIGINAL array. Removal shifts every later gap down by the number of
   * sources that lay before it, which is the correction applied to `to` below.
   */
  const moveChips = (sources: number[], to: number): void => {
    const moving = new Set(sources);
    // Nothing to do when the gap is already adjacent to the run: dropping a block
    // back where it came from is not a change.
    if (sources.length === 0) return;
    const survivors = chips.filter((_, i) => !moving.has(i));
    const carried = chips.filter((_, i) => moving.has(i));
    const before = sources.filter((i) => i < to).length;
    const at = Math.max(0, Math.min(survivors.length, to - before));
    onChange([...survivors.slice(0, at), ...carried, ...survivors.slice(at)]);
    // The moved block is still the selection — moving something must not throw
    // away the fact that the user had chosen it.
    setSelected(new Set(sources.map((_, k) => at + k)));
    setCaret(at + carried.length);
    focusField();
  };

  const removeSelected = (): void => {
    if (selectedIndices.length === 0) return;
    const drop = new Set(selectedIndices);
    const next = chips.filter((_, i) => !drop.has(i));
    onChange(next);
    setSelected(new Set());
    setAnchor(null);
    // The caret keeps counting the same number of surviving chips ahead of it.
    const ahead = selectedIndices.filter((i) => i < caret).length;
    setCaret(Math.min(caret - ahead, next.length));
    focusField();
  };

  const create = async (): Promise<void> => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const created = await onCreateTag(trimmed);
      if (created) {
        insertAt({
          kind: 'tag',
          tagId: created.id,
          nameAtInsert: created.name,
          backgroundColorAtInsert: created.backgroundColor,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  /** Turn one popup row into a chip. The ONE commit path, shared by click and Enter. */
  const commitItem = (item: ImeItem): void => {
    switch (item.kind) {
      case 'tag':
        insertAt({
          kind: 'tag',
          tagId: item.tag.id,
          nameAtInsert: item.tag.name,
          backgroundColorAtInsert: item.tag.backgroundColor,
        });
        return;
      case 'operator':
        insertAt({ kind: 'op', op: item.op });
        return;
      case 'paren':
        insertAt({ kind: 'paren', p: item.p });
        return;
      case 'create':
        // The create row's name is the buffer; `create` already reads `trimmed`.
        void create();
        return;
    }
  };

  /**
   * ONE keyboard handler for the whole control.
   *
   * It is on the container rather than the input because the input rarely holds
   * focus (see the module note). The guard is narrow and explicit: the keys act
   * only when the event came from a TEXT field, so a colour picker inside the
   * candidate row keeps its own behaviour.
   */
  const onKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement | null;
    const isTextField = target?.tagName === 'INPUT'
      && (target as HTMLInputElement).type === 'text';
    if (!isTextField) return;

    const empty = query.length === 0;

    // ─── The composition popup owns the keys while it is up ───────────────────
    //
    // This is the input-method contract: while a composition is open, ↑/↓ walk the
    // candidates, Escape abandons it, and Enter commits. Handling it HERE (before
    // the caret keys) is what makes the popup real rather than decorative — the
    // previous version had no keyboard path at all, so the control was
    // point-and-click only.
    if (imeOpen) {
      // Paging: `-` back, `=` forward. Only while there is more than one page, so
      // the keys stay available to the text when there is nothing to page.
      if (imePageCount > 1 && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setImePage((prev) => Math.min(prev + 1, imePageCount - 1));
        // The highlight is a position within a PAGE, so turning the page must
        // clear it — otherwise it would point at a row the user has not seen.
        setImeIndex(-1);
        return;
      }
      if (imePageCount > 1 && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        setImePage((prev) => Math.max(prev - 1, 0));
        setImeIndex(-1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // From -1 (nothing highlighted) down goes to the FIRST row of the page,
        // which is the top of the list read naturally. Wrapping is within the
        // page: crossing a page boundary on an arrow key would scroll the list
        // out from under the user without them asking to turn it.
        setImeIndex((prev) => (prev + 1 >= imePageItems.length ? 0 : prev + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setImeIndex((prev) => (prev - 1 < 0 ? imePageItems.length - 1 : prev - 1));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Escape abandons the COMPOSITION, not the expression: the text goes and
        // the popup closes, which is what a user pressing it mid-word expects.
        setQuery('');
        setImeIndex(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        // The highlighted row if there is one, otherwise the top candidate — so
        // "type a name, hit Enter" does the obvious thing without the user having
        // to arrow down first.
        const item = activeIndex >= 0 ? imePageItems[activeIndex] : imePageItems[0];
        if (item) commitItem(item);
        return;
      }
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      // A selection is removed WHOLE, whichever delete key was pressed — that is
      // what the user pointed at.
      if (selected.size > 0) {
        e.preventDefault();
        removeSelected();
        return;
      }
      // With text in the box the keys belong to the TEXT: a chip vanishing while
      // the user edits a word is the classic token-input bug.
      if (!empty) return;
      if (e.key === 'Backspace' && caret > 0) { e.preventDefault(); removeAt(caret - 1); return; }
      if (e.key === 'Delete' && caret < chips.length) { e.preventDefault(); removeAt(caret); return; }
      return;
    }

    // The caret keys only act when there is no text to move within, so a caret
    // still behaves like a text caret inside a word the user is typing.
    if (!empty) return;
    // The caret moves AND the field takes focus. The focus half is not incidental:
    // the container owns the keys (see the module note), so a keypress works from
    // a chip as well — but the user's NEXT gesture is usually another arrow press
    // or more typing, and both read as "I am at the insertion point". Leaving
    // focus on the chip made the second press of `←` land nowhere, which is the
    // "I have to click again to keep moving" complaint.
    const moveCaret = (next: number): void => {
      setCaret(next);
      setSelected(new Set());
      focusField();
    };
    if (e.key === 'ArrowLeft') { e.preventDefault(); moveCaret(Math.max(0, caret - 1)); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveCaret(Math.min(chips.length, caret + 1)); return; }
    if (e.key === 'Home') { e.preventDefault(); placeCaret(0); return; }
    if (e.key === 'End') { e.preventDefault(); placeCaret(chips.length); return; }
  };

  /**
   * Click a chip: SELECT it. The caret does not move.
   *
   * The three gestures are the file-manager idiom (see the module note). The
   * caret used to follow a plain click, on the reasoning that a click points at a
   * place in the sequence — but a chip is a THING, and moving the insertion point
   * as a side effect of selecting it made the user ask where their cursor went.
   * Selecting and positioning are the two separate gestures the gaps are for:
   * `click a chip` selects, `click a gap` positions.
   *
   * Focus still moves to the field, so the keyboard keeps working after the click
   * (the container owns the keys, but a focused chip then swallows the next
   * press — see `moveCaret`).
   */
  const onChipClick = (e: React.MouseEvent, index: number): void => {
    if (e.shiftKey && anchor !== null) {
      const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
      const range = new Set<number>();
      for (let i = from; i <= to; i += 1) range.add(i);
      setSelected(range);
      focusField();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      setAnchor(index);
      focusField();
      return;
    }
    setSelected(new Set([index]));
    setAnchor(index);
    focusField();
  };

  /**
   * Sweep-select: chips whose rectangles intersect the marquee.
   *
   * Additive when a modifier is held, so a sweep can EXTEND a selection rather
   * than being the only way to build one. The base is captured at press time, so
   * the result does not depend on how many intermediate frames ran.
   */
  const onChipsMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Only a press on the FLOW's own background starts a sweep: pressing a chip
    // is a chip click, and pressing the field is a text caret.
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    const host = containerRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    sweepRef.current = {
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      // Remembered so the release handler can tell a CLICK on empty space from a
      // sweep across it (see `endSweep`).
      startedAt: { x: e.clientX, y: e.clientY },
      moved: false,
    };
    setMarquee({ x: sweepRef.current.left, y: sweepRef.current.top, w: 0, h: 0 });
    // Swallow the default so the sweep does not also start a text selection of
    // the chip labels.
    e.preventDefault();
  };

  const onChipsMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const start = sweepRef.current;
    const host = containerRef.current;
    if (!start || !host) return;
    // A few pixels of slack before this counts as a sweep: without it a normal
    // click wobbles by a pixel and would be treated as a (zero-size) selection.
    if (Math.abs(e.clientX - start.startedAt.x) > 3 || Math.abs(e.clientY - start.startedAt.y) > 3) {
      start.moved = true;
    }
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const box = {
      x: Math.min(start.left, x),
      y: Math.min(start.top, y),
      w: Math.abs(x - start.left),
      h: Math.abs(y - start.top),
    };
    setMarquee(box);

    // jsdom returns zeroed rectangles, so in a test nothing ever "intersects" and
    // the selection stays empty — which is correct rather than a failure: the
    // geometry is the browser's, and the STATE transitions are what a test can
    // own. The hit test is written against `getBoundingClientRect` for the same
    // reason, so production and test read the same code path.
    const hits = new Set<number>();
    const nodes = host.querySelectorAll<HTMLElement>('[data-chip-index]');
    nodes.forEach((node) => {
      const r = node.getBoundingClientRect();
      const intersects = r.left - rect.left < box.x + box.w
        && r.right - rect.left > box.x
        && r.top - rect.top < box.y + box.h
        && r.bottom - rect.top > box.y;
      if (intersects) hits.add(Number(node.dataset.chipIndex));
    });
    setSelected((prev) => {
      const next = start.additive ? new Set(prev) : new Set<number>();
      for (const i of hits) next.add(i);
      return next;
    });
  };

  /**
   * Which gap a pointer position means.
   *
   * The nearest chip MIDPOINT decides: to the left of a chip's middle is the gap
   * before it, to the right is the gap after it. That is the answer a text caret
   * gives, and it is what makes the two edges of the expression reachable — a
   * position past the last chip's midpoint resolves to `chips.length`, the end.
   *
   * Resolved from the pointer rather than from `e.target` because the chips are
   * only ~24px wide: requiring the pointer to hit the exact 6px slot would make
   * dropping at the start or the end a matter of aim.
   *
   * jsdom reports every rectangle as zero, so the loop finds no midpoint and the
   * result is `chips.length` — deterministic, which is why the tests drive the
   * slot elements directly (the same handler, no coordinate maths).
   */
  const gapFromPoint = (clientX: number): number => {
    const host = containerRef.current;
    if (!host) return chips.length;
    const rect = host.getBoundingClientRect();
    const nodes = [...host.querySelectorAll<HTMLElement>('[data-chip-index]')];
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (clientX - rect.left < (r.left + r.right) / 2 - rect.left) {
        return Number(node.dataset.chipIndex);
      }
    }
    return chips.length;
  };

  /**
   * The ONE drop handler: a gap index in, a move out.
   *
   * Both entry points call it — the pointer-resolved one on the flow and the
   * explicit one on each gap element — so a drop can never behave differently
   * depending on which surface received it.
   */
  const dropAtGap = (gap: number, transfer: DataTransfer): void => {
    const raw = transfer.getData('text/plain');
    // `JSON.parse` THROWS on anything that is not a drag payload from this
    // control (an external drag, a stray text selection), so the move is guarded
    // rather than trusted.
    let sources: number[] = [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
        sources = parsed as number[];
      }
    } catch {
      sources = [];
    }
    if (sources.length > 0) moveChips([...sources].sort((a, b) => a - b), gap);
    setDropGap(null);
  };

  /**
   * End a sweep — or, if it never swept, place the caret.
   *
   * A press on the flow's own background used to do NOTHING unless it turned into
   * a marquee: the press started a sweep, the release ended it, and the caret
   * never moved. So clicking the empty space before the first chip or after the
   * last one — the obvious mouse gesture for "put the cursor at the start/end" —
   * had no effect at all.
   *
   * The `moved` flag is what separates the two intents: no movement means the user
   * was pointing at a POSITION, movement means they were selecting a RANGE.
   */
  const endSweep = (e?: React.MouseEvent<HTMLDivElement>): void => {
    const start = sweepRef.current;
    sweepRef.current = null;
    setMarquee(null);
    if (!start || start.moved) return;

    // Which gap did they point at? Read from the chips' own geometry, so this is
    // "the insertion point nearest where they clicked" rather than a guess from
    // the DOM order — on a wrapped box the two differ.
    const host = containerRef.current;
    let index = chips.length;
    if (host && e) {
      const rect = host.getBoundingClientRect();
      const nodes = [...host.querySelectorAll<HTMLElement>('[data-chip-index]')];
      const after = nodes.find((node) => {
        const r = node.getBoundingClientRect();
        // jsdom reports every rectangle as zero, so this finds nothing and the
        // caret lands at the END — deterministic, and the state change (a caret
        // moved by a click) is what the test asserts.
        return e.clientX - rect.left < (r.left + r.right) / 2 - rect.left;
      });
      index = after ? Number(after.dataset.chipIndex) : chips.length;
    }
    placeCaret(index);
  };

  /**
   * The text field.
   *
   * Hoisted out of the flow so it can be rendered AT the caret's gap: the field's
   * position among the chips IS the insertion point, so a field rendered once, at
   * the end, made "type in the middle of the expression" unreachable — the text
   * caret could only ever sit after the last chip. It is the same element in the
   * same handler, placed differently, so nothing else about typing changes.
   */
  const renderField = (): ReactNode => (
    <input
      ref={fieldRef}
      className="tbs-tag-chip-input__field"
      type="text"
      value={query}
      placeholder={chips.length === 0 ? placeholder : 'Add…'}
      onChange={(e) => {
        setQuery(e.target.value);
        // A new search starts collapsed: the disclosure is about "show me the
        // rest of THIS list", so it must not carry over to a narrower one.
        setShowAll(false);
        // A fresh buffer is not a selection: leaving a highlight on the old
        // one would commit a row the user never chose.
        setImeIndex(-1);
        // ...and a fresh buffer is also a fresh LIST, so it starts on page one
        // (page 3 of the previous result set does not exist here, and clamping
        // it silently would leave the user on an unexplained page).
        setImePage(0);
      }}
      // ─── The combobox wiring ──────────────────────────────────────────
      // The field is a combobox whose popup is the candidate list. The
      // highlight is tracked with `aria-activedescendant` rather than by
      // moving focus: focus has to stay in the field or the user could not
      // keep typing, which is the whole point of the control.
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={imeOpen}
      aria-controls={`${fieldId}-ime`}
      {...(activeIndex >= 0
        ? { 'aria-activedescendant': `${fieldId}-ime-${String(activeIndex)}` }
        : {})}
    />
  );

  /**
   * The composition popup.
   *
   * Hoisted for the same reason as the field: it is rendered AT the caret, inside
   * the slot for that gap. That placement is what makes its containing block the
   * caret's own box on the line, so the menu can be a sensible fixed width next
   * to the insertion point instead of a bar spanning the whole control.
   */
  const imePopup = (): ReactNode => (
    <div
      className="tbs-tag-chip-input__ime"
      id={`${fieldId}-ime`}
      role="listbox"
      aria-label="Candidates"
      data-testid="tag-ime-popup"
      // The anchor, stated rather than inferred: the popup is now rendered inside
      // the gap it belongs to, and this attribute is how that is assertable.
      data-anchor-testid={caretAnchorTestId}
    >
      {imePageItems.map((item, index) => (
        <button
          key={imeItemKey(item)}
          type="button"
          id={`${fieldId}-ime-${String(index)}`}
          role="option"
          aria-selected={index === activeIndex}
          data-testid={`tag-ime-item-${String(index)}`}
          className={`tbs-tag-chip-input__ime-item${index === activeIndex ? ' is-active' : ''}${
            item.kind === 'create' ? ' tbs-tag-chip-input__ime-item--create' : ''
          }`}
          // `onMouseDown` + `preventDefault`, not `onClick`: a click moves
          // focus out of the field first, which closes the popup (blur) before
          // the click lands — the classic combobox "the item is gone by the
          // time I click it" bug.
          onMouseDown={(e) => { e.preventDefault(); commitItem(item); }}
        >
          {item.kind === 'tag' && (
            <>
              <span
                className="tbs-tag-chip-input__candidate-swatch"
                style={{ backgroundColor: item.tag.backgroundColor }}
                aria-hidden="true"
              />
              <span className="tbs-tag-chip-input__ime-label">{item.tag.name}</span>
              <span className="tbs-tag-chip-input__ime-kind">tag</span>
            </>
          )}
          {item.kind === 'operator' && (
            <>
              <span className="tbs-tag-chip-input__ime-label">{item.op}</span>
              <span className="tbs-tag-chip-input__ime-kind">operator</span>
            </>
          )}
          {item.kind === 'paren' && (
            <>
              <span className="tbs-tag-chip-input__ime-label">{item.p}</span>
              <span className="tbs-tag-chip-input__ime-kind">bracket</span>
            </>
          )}
          {item.kind === 'create' && (
            <>
              <span className="tbs-tag-chip-input__ime-label">{`Create tag “${item.name}”`}</span>
              <span className="tbs-tag-chip-input__ime-kind">new</span>
            </>
          )}
        </button>
      ))}
      {/* The pager, shown only when there IS more than one page. It states
          the page and the TOTAL, because "2 of 5" answers "how much is left"
          while a bare "2" does not — and the keys are named, since a shortcut
          nobody is told about is a shortcut nobody has. */}
      {imePageCount > 1 && (
        <div className="tbs-tag-chip-input__ime-pager" data-testid="tag-ime-pager">
          <button
            type="button"
            className="tbs-tag-chip-input__ime-page"
            aria-label="Previous page of candidates"
            disabled={safePage === 0}
            onMouseDown={(e) => { e.preventDefault(); setImePage(Math.max(safePage - 1, 0)); setImeIndex(-1); }}
          >
            ‹
          </button>
          <span className="tbs-tag-chip-input__ime-page-label">
            {`${String(safePage + 1)} / ${String(imePageCount)}`}
            <span className="tbs-tag-chip-input__ime-page-keys">(- =)</span>
          </span>
          <button
            type="button"
            className="tbs-tag-chip-input__ime-page"
            aria-label="Next page of candidates"
            disabled={safePage >= imePageCount - 1}
            onMouseDown={(e) => { e.preventDefault(); setImePage(Math.min(safePage + 1, imePageCount - 1)); setImeIndex(-1); }}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="tbs-tag-chip-input"
      ref={containerRef}
      onKeyDownCapture={onKeyDownCapture}
      // The sweep ends wherever the pointer is released, including outside the
      // control, so the handler is on the window rather than the box.
      onMouseUp={endSweep}
      onMouseLeave={endSweep}
    >
      {/* A visible NAME for the control, always present.
          The placeholder used to be the only label — and it vanishes the moment
          the first chip is added, i.e. exactly when someone returning to the box
          may have forgotten what it filters. */}
      <div className="tbs-tag-chip-input__label-row">
        <span className="tbs-tag-chip-input__label" id={`${fieldId}-label`}>{label}</span>
      </div>

      <div
        className={`tbs-tag-chip-input__field-row${marquee ? ' is-sweeping' : ''}`}
        // The chips AND the field, in one wrapping flow, because the field's
        // position among them IS the insertion point.
        //
        // `group`, NOT `textbox`: the `<input>` inside is already the textbox, so
        // a second textbox role on the container describes ONE control twice —
        // and a screen reader then has two editable regions where the user sees
        // one. The group name is what ties the chips and the field together.
        role="group"
        aria-labelledby={`${fieldId}-label`}
      >
      <div
        className="tbs-tag-chip-input__chips"
        onMouseDown={onChipsMouseDown}
        onMouseMove={onChipsMouseMove}
        // The flow itself is the drop surface, so a drop anywhere over the
        // expression resolves to the nearest gap — including the two that have no
        // chip beside them. The gap elements below stop propagation and resolve
        // their own index, which keeps both paths on ONE handler.
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropGap(gapFromPoint(e.clientX));
        }}
        onDragLeave={(e) => {
          // Only when the pointer actually LEFT the flow: `dragleave` fires for
          // every child boundary crossing too, and clearing on those would make
          // the indicator flicker.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDropGap(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dropAtGap(gapFromPoint(e.clientX), e.dataTransfer);
        }}
      >
        {chips.map((token, index) => {
          const label = resolveChipDisplayName(token, availableTags);
          // The accessible name is ROLE-PREFIXED (`Tag: work`) so it names the
          // chip AS A CHIP: the same word also appears in the candidate list and
          // as the chip's visible text, and an ambiguous name is not a name a
          // screen-reader user can act on.
          const ariaLabel = token.kind === 'tag' ? `Tag: ${label}` : `Operator: ${label}`;
          const isOperator = token.kind !== 'tag';
          const isSelected = selected.has(index);
          /**
           * Is the insertion point at the gap BEFORE this chip?
           *
           * The field and the popup are rendered HERE when it is, which is what
           * makes "type at this point" and "the popup under the caret" the same
           * mechanism rather than two. Rendered inside the slot, the popup is also
           * positioned against a box only as wide as the caret's own place in the
           * line — so it can be a sensible width instead of spanning the control.
           */
          const fieldHere = caretIndex === index;
          return (
            <span key={tokenKey(token, index)} className="tbs-tag-chip-input__slot">
              {/* The gap BEFORE this chip, as its own click target. Without it the
                  only way to reach a gap between two chips is the arrow keys, so
                  "put the cursor here" — the mouse gesture a caret implies — had
                  no answer. Thin rather than invisible: it shows a line on hover,
                  which is how the user learns the gap is a place. */}
              <button
                type="button"
                className={`tbs-tag-chip-input__slot-gap${dropGap === index ? ' tbs-tag-chip-input__slot-gap--drop' : ''}`}
                data-testid={`chip-gap-${String(index)}`}
                aria-label={`Move the cursor before ${label}`}
                onClick={() => { placeCaret(index); }}
                // Also a DROP target, and the precise one: the element already
                // sits exactly at its gap, so a drop here needs no hit maths —
                // which is what lets a test drive the same `dropAtGap`.
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  setDropGap(index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dropAtGap(index, e.dataTransfer);
                }}
              />
              {/* The caret rule, immediately before the field when it is the
                  field's turn (see the flow below), and before a chip otherwise.
                  It is `aria-hidden` because it carries no information a screen
                  reader needs: the field's own position says where the next chip
                  lands. */}
              {/* Suppressed while a drag is hovering THIS gap: the gap element
                  already turns into a wider blue bar, and two marks in the same
                  place read as one thick smudge rather than as a caret plus a
                  drop target. */}
              {fieldHere && dropGap !== index && (
                <span className="tbs-tag-chip-input__caret" aria-hidden="true" />
              )}
              {/* The field goes INLINE, at the caret's gap — between the chips
                  when the caret is mid-expression, not only at the end. */}
              {fieldHere && renderField()}
              {/* The popup is SCOPED TO THE CARET (see `fieldHere`): rendered
                  inside the slot, its containing block is the caret's own box in
                  the line, so it is a readable menu under the insertion point
                  rather than a bar spanning the whole control. */}
              {fieldHere && imeOpen && imePopup()}
              <span
                // The gap BEFORE this chip is a click target too (below), so the
                // chip sits in a slot that owns both.
                data-chip-index={index}
                className={[
                  'tbs-tag-chip',
                  isOperator ? 'tbs-tag-chip--operator' : '',
                  isSelected ? 'tbs-tag-chip--selected' : '',
                ].filter(Boolean).join(' ')}
                role="button"
                tabIndex={0}
                aria-label={ariaLabel}
                aria-pressed={isSelected}
                style={chipStyle(token)}
                // Native drag/drop: the browser supplies the drag image, the drop
                // cursor and the auto-scroll, so this stays a few lines instead of
                // a re-implementation of all three.
                draggable
                onDragStart={(e) => {
                  // Dragging a chip that is PART of the selection drags the whole
                  // selection; dragging an unselected chip drags just it. That is
                  // the file-manager rule, and it is why the selection has to be
                  // known at drag time rather than only at drop time.
                  const sources = isSelected ? selectedIndices : [index];
                  // The payload is a JSON list, not a single index: the drop needs
                  // to know the whole set, and `text/plain` is what a DataTransfer
                  // can carry without a custom MIME type the browser would strip.
                  e.dataTransfer.setData('text/plain', JSON.stringify(sources));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                // The chip is NOT a drop surface of its own: a drop on it bubbles to the
                // flow, where the pointer position resolves to the nearest GAP —
                // including the two that sit beside no chip. Resolving per chip
                // could only ever mean "before this chip", which is why the ends
                // of the expression were unreachable.
                onClick={(e) => { onChipClick(e, index); }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' || e.key === 'Delete') {
                    e.preventDefault();
                    removeAt(index);
                  }
                }}
              >
                <span className="tbs-tag-chip__label">{label}</span>
                <button
                  type="button"
                  className="tbs-tag-chip__remove"
                  aria-label={`Remove ${label}`}
                  tabIndex={-1}
                  onClick={(e) => { e.stopPropagation(); removeAt(index); }}
                >
                  ×
                </button>
              </span>
            </span>
          );
        })}

        {/* The field sits at the caret's gap: between two chips when the caret is
            before the last one, at the end when it follows all of them. That is
            the SAME rule the slots above apply — the end of the flow is just the
            one gap that has no chip after it, so it is spelled here rather than
            left without a field. */}
        {caretIndex === chips.length && (
          // The end of the flow gets a SLOT of its own, for the same reason the
          // gaps between chips do: the popup is positioned against its containing
          // block, and a bare field here made that block the whole chip FLOW —
          // so the popup rendered below the entire sub-component instead of under
          // the caret.
          <span className="tbs-tag-chip-input__slot" data-testid={`chip-slot-${String(chips.length)}`}>
            {dropGap !== chips.length && <span className="tbs-tag-chip-input__caret" aria-hidden="true" />}
            {renderField()}
            {imeOpen && imePopup()}
          </span>
        )}
        {/* A trailing gap: the space AFTER the last chip is a valid insertion
            point, and without this it would be the one place a click could not
            reach. */}
        <button
          type="button"
          className={`tbs-tag-chip-input__slot-gap${dropGap === chips.length ? ' tbs-tag-chip-input__slot-gap--drop' : ''}`}
          data-testid={`chip-gap-${String(chips.length)}`}
          aria-label="Move the cursor to the end"
          onClick={() => { placeCaret(chips.length); }}
          // The trailing gap needs this most: it is the ONLY droppable surface
          // that means "the end", because the chips beside it both mean "before
          // me" — which is why dragging something to the end of the expression
          // had nowhere to land.
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            setDropGap(chips.length);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dropAtGap(chips.length, e.dataTransfer);
          }}
        />
      </div>
      </div>

      {/* ─── The tray ───────────────────────────────────────────────────────
          TWO LABELLED SECTIONS, both on screen.
          
          They used to be one pile of identical white pills, so "Add work" and
          "Add AND" looked like the same kind of choice. The first fix was to hide
          them behind a group switch — which was wrong for the same reason a
          collapsed panel usually is: it added a click to the PRIMARY action to
          save height on a control the user is, by definition, using. Two headed
          sections get the clarity (a tag is not grammar) at no cost. */}
      <button
        type="button"
        className="tbs-tag-chip-input__tray-toggle"
        aria-expanded={trayOpen}
        aria-controls={`${fieldId}-tray`}
        onClick={() => { setTrayOpen((v) => !v); }}
      >
        {trayOpen ? '▾ Hide candidates' : '▸ Show candidates'}
      </button>

      <div className="tbs-tag-chip-input__tray" id={`${fieldId}-tray`} hidden={!trayOpen}>
        <section className="tbs-tag-chip-input__tray-section" aria-label="Tag candidates">
            <span className="tbs-tag-chip-input__tray-title">
              {candidateNeedle === '' ? 'Tags' : `Matching “${candidateQuery.trim()}”`}
            </span>
            {/* The tag SEARCH belongs to this section, not to the expression.
                It sits under the section heading and above the candidates it
                narrows — the same placement every other list in the app uses.
                Above the heading it was ambiguous: a search box directly under
                `Filter by tags` reads as filtering the EXPRESSION, and typing in
                it silently emptied the candidate list instead. */}
            <SearchField
              testId="tag-candidate-search"
              className="tbs-tag-chip-input__candidate-search"
              placeholder="Search tags..."
              value={candidateQuery}
              ariaLabel="Search tag candidates"
              onChange={(next) => {
                setCandidateQuery(next);
                // A new search starts collapsed, for the same reason the
                // expression's did: the disclosure means "the rest of THIS list".
                setShowAll(false);
              }}
            />
            <div className="tbs-tag-chip-input__candidates">
              {shownTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="tbs-tag-chip-input__candidate tbs-tag-chip-input__candidate--tag"
                  aria-label={`Add ${tag.name}`}
                  onClick={() => { insertAt({
                    kind: 'tag',
                    tagId: tag.id,
                    nameAtInsert: tag.name,
                    backgroundColorAtInsert: tag.backgroundColor,
                  }); }}
                >
                  {/* Each candidate shows the tag's OWN colour, so the user sees
                      what they are about to add rather than a name they have to
                      picture. A plain swatch, not a monogram: the name is right
                      beside it, and a letter inside the square both duplicates
                      that word in the row's text and competes with the colour it
                      is there to show. */}
                  <span
                    className="tbs-tag-chip-input__candidate-swatch"
                    style={{ backgroundColor: tag.backgroundColor }}
                    aria-hidden="true"
                  />
                  {tag.name}
                </button>
              ))}
              {/* The rest of the table, behind one control. The label states how
                  many are hidden, so the button answers "is what I want in there"
                  without being clicked — a bare "..." does not. */}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="tbs-tag-chip-input__candidate tbs-tag-chip-input__more"
                  aria-label={showAll ? 'Show fewer tags' : `Show all ${String(matches.length)} tags`}
                  aria-expanded={showAll}
                  onClick={() => { setShowAll((v) => !v); }}
                >
                  {showAll ? 'Show less' : `… +${String(hiddenCount)} more`}
                </button>
              )}
              {canCreate && (
                <button
                  type="button"
                  className="tbs-tag-chip-input__candidate tbs-tag-chip-input__create"
                  onClick={() => { void create(); }}
                >
                  {`Create tag "${trimmed}"`}
                </button>
              )}
              </div>
            {/* A search that finds nothing says so, AND the create row above is
                the way out — a blank list leaves the user unsure whether the
                table is empty or the filter is wrong.

                Its condition is just `matches.length === 0`. An earlier version
                also required `!canCreate`, which is UNREACHABLE: a query no tag
                CONTAINS is also a query no tag EQUALS, so the create row is
                offered in exactly this case. Making the two mutually exclusive
                meant the explanation could never render at all. */}
            {matches.length === 0 && (
              <p className="tbs-tag-chip-input__tray-empty">
                No tags match “{trimmed}”.
              </p>
            )}
        </section>

        <section className="tbs-tag-chip-input__tray-section" aria-label="Operators">
            <span className="tbs-tag-chip-input__tray-title">Join with</span>
            <div className="tbs-tag-chip-input__candidates">
              {OPERATORS.map((op) => (
                <button
                  key={op}
                  type="button"
                  className="tbs-tag-chip-input__candidate tbs-tag-chip-input__operator"
                  aria-label={`Add ${op}`}
                  onClick={() => { insertAt({ kind: 'op', op }); }}
                >
                  {op}
                </button>
              ))}
              <button
                type="button"
                className="tbs-tag-chip-input__candidate tbs-tag-chip-input__operator"
                aria-label="Add ("
                onClick={() => { insertAt({ kind: 'paren', p: '(' }); }}
              >
                (
              </button>
              <button
                type="button"
                className="tbs-tag-chip-input__candidate tbs-tag-chip-input__operator"
                aria-label="Add )"
                onClick={() => { insertAt({ kind: 'paren', p: ')' }); }}
              >
                )
              </button>
            </div>
            <p className="tbs-tag-chip-input__tray-hint">
              Inserted at the cursor. `NOT` applies to the tag that follows it.
            </p>
        </section>
      </div>

      {/* The GESTURE HINTS. Multi-select, reordering and the delete keys were all
          undiscoverable — a control whose features exist only for users who
          already know them is a control that has them for nobody. One line, and
          it is the only place these are stated. */}
      {chips.length > 0 && (
        <p className="tbs-tag-chip-input__hint">
          Click a chip to place the cursor · Ctrl-click or Shift-click for several ·
          drag to reorder · Backspace removes the chip at the cursor
        </p>
      )}

      {/* The batch affordance. Its ROW IS ALWAYS PRESENT (see `field-row` and the
          stylesheet): a bar that appears and disappears pushes the rows below it
          up and down on every selection, which is exactly the layout jump the
          guidelines name. */}
      {/* The row is always in the DOM (see the note above) but only becomes a
          NAMED GROUP when it has something in it: an empty labelled group is
          noise in the accessibility tree and an ambiguous match for a query. */}
      <div
        className="tbs-tag-chip-input__selection"
        {...(selected.size > 0 ? { role: 'group', 'aria-label': 'Selected chips' } : {})}
      >
        {selected.size > 0 && (
          <>
            <span className="tbs-tag-chip-input__selection-count">
              {`${String(selected.size)} selected`}
            </span>
            <button type="button" onClick={removeSelected}>
              {`Remove ${String(selected.size)}`}
            </button>
            <button type="button" onClick={() => { setSelected(new Set()); setAnchor(null); }}>
              Clear
            </button>
          </>
        )}
      </div>

      {/* The sweep rectangle. Rendered as an element (not a pseudo-element) so its
          existence and geometry are DOM facts a test can read. */}
      {marquee && (
        <span
          className="tbs-tag-chip-input__marquee"
          aria-hidden="true"
          data-testid="chip-marquee"
          style={{
            left: `${String(marquee.x)}px`,
            top: `${String(marquee.y)}px`,
            width: `${String(marquee.w)}px`,
            height: `${String(marquee.h)}px`,
          }}
        />
      )}
    </div>
  );
}