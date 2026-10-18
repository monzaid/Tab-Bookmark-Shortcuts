/**
 * Sidebar App — Main entry point for the extension sidebar.
 *
 * Features:
 * - Follows current active tab (or locked tabId)
 * - Collapsible current page summary with favicon
 * - Fixed 10-row slot list (empty/bound states) with color bars
 * - Save to empty slot, Enter to switch bound slot
 * - More menu per slot
 * - Shortcut key binding display
 * - 5-second undo bar on overwrite
 * - Lock/unlock with auto-unlock on tab close
 * - Footer navigation (Settings / Import-Export / Diagnostics)
 * - storage.onChanged listener for real-time slot refresh
 * - DualCards: tab override + page rule quick edit
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SlotDefinition, SlotBinding, SyncState, LocalState, IconSource, TagDefinition } from '@shared/types';
import { Button, IconButton, Toast, Tooltip, StatusBadge, Confirm, Dialog } from '@ui/shared/components';
import { getMessageClient } from '@ui/shared/message-client';
import { openOrReusePage } from '@shared/open-page';
import type { PageOpenApi } from '@shared/open-page';

// Import styles
import '@ui/styles/base.css';
import '@ui/styles/sidebar.css';

// ─── Fallback tab API (B11b / T17) ───────────────────────────────────────────

/**
 * The ONLY place in this file that touches `chrome.tabs.*` for page opening.
 *
 * The footer fallback needs four raw tab operations, but keeping them inline in
 * `openPage` invited re-duplication of the reuse logic. Centralizing them here
 * makes `openOrReusePage` (the shared reuse source of truth) the single caller.
 *
 * Returns `null` when the `chrome.tabs` API is missing (restricted context or
 * test environment) so callers can skip the fallback instead of throwing.
 */
export function createChromePageOpenApi(): PageOpenApi | null {
  // Re-typed as optional so the availability check stays meaningful rather than
  // being reported as an always-truthy comparison on a non-optional global.
  const tabsApi = (globalThis as { chrome?: { tabs?: unknown } }).chrome?.tabs;
  if (!tabsApi) {
    return null;
  }
  const tabs = chrome.tabs;

  return {
    queryAllTabs: async () => {
      const all = await tabs.query({});
      return all.map((t) => ({ id: t.id ?? -1, url: t.url ?? '' }));
    },
    activateTab: async (tabId) => {
      await tabs.update(tabId, { active: true });
    },
    navigateTab: async (tabId, targetUrl) => {
      await tabs.update(tabId, { url: targetUrl });
    },
    createTab: async (targetUrl) => {
      await tabs.create({ url: targetUrl });
    },
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SidebarState {
  sync: SyncState | null;
  local: LocalState | null;
  currentTabId: number | null;
  currentTabUrl: string;
  currentTabTitle: string;
  currentTabFavicon: string;
  lockedTabId: number | null;
  loading: boolean;
  error: string | null;
}

interface CommandInfo {
  name: string;
  shortcut: string | null;
  description: string;
}

// ─── Message Client (B11: all cross-context messaging goes through here) ────

async function sendMessage(action: string, payload?: unknown): Promise<unknown> {
  return getMessageClient().sendRaw(action, payload);
}

// ─── Slot color palette ──────────────────────────────────────────────────────

const SLOT_COLORS = [
  'var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)', 'var(--slot-4)', 'var(--slot-5)',
  'var(--slot-6)', 'var(--slot-7)', 'var(--slot-8)', 'var(--slot-9)', 'var(--slot-10)',
];

// ─── Safe chrome.tabs access (may not exist in test environment) ─────────────

function hasTabsApi(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.tabs && !!chrome.tabs.query;
}

/**
 * The slice of `DataTransfer` this file uses, with `setDragImage` OPTIONAL.
 *
 * The DOM type declares it always present, but the hand-written stub the UI tests
 * drive (the same device `tag-chip-input.test.tsx` uses) has only `setData` /
 * `getData` / `effectAllowed` / `dropEffect`. Declaring the method optional here is
 * what makes D22's `setDragImage?.(...)` a true check rather than a lint-stripped
 * formality — and what keeps the production call from throwing under that stub.
 */
interface DragTransfer {
  setData: (format: string, data: string) => void;
  getData: (format: string) => string;
  effectAllowed: string;
  dropEffect: string;
  setDragImage?: (image: Element, x: number, y: number) => void;
}

/** Re-type the event's `dataTransfer`, which the test stub may under-provide. */
function dragTransferOf(event: React.DragEvent): DragTransfer | undefined {
  return (event as { dataTransfer?: DragTransfer }).dataTransfer;
}

// ─── Slot Row Component (Problem 7: more menu + double-click edit) ──────────

/**
 * Item 1 / review item 7: the winning record's source, as a HOVER POPOVER
 * attached to the value it describes.
 *
 * Three review findings shape this component:
 *
 * 1. The popover used to hang off a small dot NEXT TO the value. That dot was an
 *    invented target: it widened the row and asked the reader to hover something
 *    other than the thing they were looking at. The value itself is now the
 *    trigger.
 * 2. `Slot 8` alone does not say what it means — eight is the slot's own number,
 *    not a tab. The popover now carries a full sentence (`sourceDescription`)
 *    and the badge names the tab for a page-level record.
 * 3. When the winner IS the record this surface shows, the popover is noise
 *    ("Slot 8 · from slot 8"). It is dropped in that case.
 */
/**
 * Review item 4 (round 6): the popover is PORTALLED to `<body>` and positioned
 * from the trigger's rect.
 *
 * As an absolutely-positioned child it lived inside `.tbs-sidebar`, which is
 * `overflow: hidden` around a `overflow-y: auto` slot list, and under the sticky
 * Current Page header. It was therefore CUT OFF at the sidebar edge and painted
 * beneath the header and the first rows — the reported "the whole text is not
 * visible" defect.
 * A portal escapes both the clipping and that stacking context; clamping the
 * measured rect keeps it on screen when the value sits near an edge.
 */
function SourcePopover({
  anchor,
  placement,
  label,
  description,
}: {
  anchor: HTMLElement | null;
  placement: 'above' | 'below';
  label: string;
  description: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measured after paint so the clamp can use the REAL width/height; until then
  // the popover is laid out off-screen instead of flashing at a wrong position.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!anchor || !el) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const margin = 8;
      const maxLeft = window.innerWidth - margin - width;
      const left = Math.max(margin, Math.min(rect.left, maxLeft));
      let top = placement === 'above' ? rect.top - height - 6 : rect.bottom + 6;
      // Flip below when there is no room above (the first row under the header).
      if (top < margin) top = rect.bottom + 6;
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, placement, label, description]);

  return createPortal(
    <span
      ref={ref}
      className="tbs-source-popover"
      role="tooltip"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <strong className="tbs-source-popover__title">{label}</strong>
      <span className="tbs-source-popover__note">{description}</span>
    </span>,
    document.body,
  );
}

function SlotSourceBadge({
  chain,
  children,
  variant,
  field,
  self,
  tabId = null,
  triggerFocusable = true,
}: {
  chain: ChainResult;
  children: React.ReactNode;
  /** Which value this popover hangs off — drives the popover placement. */
  variant: 'icon' | 'title';
  /** Which dimension is described — drives the sentence. */
  field: FieldWord;
  /**
   * The record this surface itself represents. When the winner is THIS record the
   * popover is suppressed (review item 7).
   */
  self?: TierOwner | null;
  /** The tab this chain belongs to, so a Page record can name it. */
  tabId?: number | null;
  /**
   * Whether the wrapper is itself the keyboard focus stop. Set to false when the
   * wrapped value is ALREADY focusable (the Current Page favicon button): its own
   * `:focus-within` equivalent is the focus handler below, so no second stop.
   */
  triggerFocusable?: boolean;
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  const winnerOwner = chain.tiers[chain.winner.source]?.owner ?? null;
  const hasWinner = chain.winner.value !== null;
  // No winning value, or the value comes from the record being displayed → no
  // popover: there is nothing the user does not already see.
  const suppressed = !hasWinner || (winnerOwner != null && self != null && sameOwner(winnerOwner, self));
  // Suppressed entirely — no wrapper, no handlers, no popover (review item 7):
  // the value renders exactly as it would without this component.
  if (suppressed) return <>{children}</>;

  const label = winnerOwner ? sourceBadge(winnerOwner, tabId) : TIER_NAME[chain.winner.source];
  const description = winnerOwner
    ? sourceDescription(winnerOwner, tabId, field)
    : `${TIER_NAME[chain.winner.source]} value.`;

  return (
    <span
      ref={wrapperRef}
      className={`tbs-source-hover tbs-source-hover--${variant}`}
      data-source={chain.winner.source}
      {...(triggerFocusable ? { tabIndex: 0 } : {})}
      aria-label={`${field === 'title' ? 'Title' : 'Icon'} source: ${label}. ${description}`}
      // Hover drives the popover from JS now that it is portalled: CSS `:hover`
      // cannot reach a node that lives outside this subtree.
      onMouseEnter={() => { setOpen(true); }}
      onMouseLeave={() => { setOpen(false); }}
      onFocus={() => { setOpen(true); }}
      onBlur={() => { setOpen(false); }}
    >
      {children}
      {open && (
        <SourcePopover
          anchor={wrapperRef.current}
          placement={variant === 'icon' ? 'below' : 'above'}
          label={label}
          description={description}
        />
      )}
    </span>
  );
}

/**
 * Item 5.2 / review item 5: the record summary for a row's field while edited.
 *
 * Delegates to the shared `MaskedSummary` so the ALL-RECORDS list, the "…and N
 * more" collapse and the wording are identical on every surface — this used to
 * be a one-line "masked by X" string that diverged from the editors.
 *
 * Review item 2: no clear buttons here. Clearing is what the `Use chain` list
 * offers, next to the value it would remove.
 */
function SlotRowMasking({
  chain,
  label,
  selfOwner,
  tabId,
}: {
  chain?: ChainResult;
  label: string;
  selfOwner?: TierOwner | null;
  tabId?: number | null;
}) {
  if (!chain) return null;
  return (
    <MaskedSummary
      nodes={chain.nodes}
      field={label === 'title' ? 'title' : 'icon'}
      {...(selfOwner ? { selfOwner } : {})}
      tabId={tabId ?? null}
      fieldLabel={label === 'title' ? 'Title' : 'Icon'}
      idPrefix={`slot-${label}`}
    />
  );
}

interface SlotRowProps {
  slotNumber: number;
  slot: SlotDefinition | undefined;
  binding: SlotBinding | undefined;
  shortcut: string | null;
  /**
   * Item 5.2: the full chain for the BOUND tab, so the row can show the winning
   * source badge and list the masked tiers while editing.
   */
  titleChain?: ChainResult;
  iconChain?: ChainResult;
  /** Priority-chain resolved display title (tabOverride → uiMarker → rule → snapshot) */
  resolvedTitle?: string;
  /** Priority-chain resolved display icon */
  resolvedIcon?: string;
  onSwitch: (slotId: number) => void;
  onNextMatch: (slotId: number) => void;
  onPrevMatch: (slotId: number) => void;
  onSave: (slotId: number) => void;
  onUnbind: (slotId: number) => void;
  /** F4: `trigger` is the durable element to restore focus to on modal close. */
  onEditIcon: (slotId: number, trigger?: HTMLElement | null) => void;
  onAddToGlobal: (slotId: number) => void;
  /**
   * NOTE: the row no longer writes title/URL edits itself.
   *
   * The commit goes through `onEditCommit`, and the LIST performs the write — it is
   * the only party that knows which RECORD the open draft describes. A row-level
   * `onEditTitle(slotNumber, …)` would re-address the write by position, which is the
   * bug this design removes. The list calls its own writers instead.
   */
  /**
   * Clear the SLOT layer only, leaving the tab override / rule / site tiers
   * intact (item 5.2: clearing is per-layer, not per-field-value).
   */
  onClearLayer?: (field: 'title' | 'icon') => void;
  /**
   * D10/D16: move these two slots' CONTENTS to each other. Fired by the drag
   * path (D8) and by the `⋯` menu dialog (D23); the list owns the actual send.
   */
  onSwap: (sourceSlotId: number, targetSlotId: number) => void | Promise<void>;
  swapPending?: { source: number | null; target: number | null } | null;
  /** D21: the drag path reports its pending source/target as the pointer moves. */
  onSwapHover?: (source: number | null, target: number | null) => void;
  /**
   * D17/D25-⑤b/D22: the armed gesture's boundary hint, ANCHORED to the focused
   * row (never to the mouse — a keyboard user's pointer may be off the sidebar).
   * Only the row the gesture is anchored on renders it.
   */
  swapHint?: SwapHint | null;
  /** The slot the armed gesture is anchored on, so only that row shows the hint. */
  swapHintAnchor?: number | null;
  /**
   * D24: the reference line needs every slot's label, and the row only knows its
   * own. Handed down as a plain list so the dialog can name all ten.
   */
  slotLabels?: string[];
  /**
   * The in-progress inline edit for THIS slot, or `null`.
   *
   * LIFTED OUT OF THE ROW on purpose. A swap moves a slot's DATA between numbers,
   * and the user's expectation is that an open editor follows that data — so the
   * thing being edited has to be movable, which it cannot be while it lives in the
   * row's own `useState` (a swap re-renders both rows from the same slot numbers,
   * and each would keep editing whatever number it was already attached to).
   *
   * The row is therefore CONTROLLED for editing: it reads this and reports changes
   * through the callbacks below. Everything else about the row stays local.
   */
  edit?: SlotEdit | null;
  /**
   * Is the icon-editor MODAL open for this slot? Owned by the list, so the row has
   * to be told — see `isEditing` below for why this is the only edit that still
   * refuses a swap.
   */
  iconEditorOpen?: boolean;
  onEditStart: (slotId: number, kind: 'title' | 'url') => void;
  onEditDraft: (draft: string) => void;
  onEditMatchType: (matchType: 'exact' | 'regex') => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onEditReset: () => void;
  /**
   * A bump counter for `edit`: changing it re-triggers the row's "focus the field"
   * effect, which is needed when the SAME edit is re-delivered to a DIFFERENT row
   * (the migration after a swap) — the new owner must take focus even though the
   * edit object it received already existed.
   */
  editToken?: number;
}

/**
 * One in-progress inline edit, owned by the LIST rather than by a row.
 *
 * `slotId` is the whole point: it names which slot's DATA the draft belongs to, so
 * a swap can move the draft by changing this number. The draft describes a RECORD,
 * not a position — which is also why the commit path writes to `slotId`: the record
 * is at that number only for as long as nobody moves it.
 */
export type SlotEdit =
  | { slotId: number; kind: 'title'; draft: string; initial: string }
  | { slotId: number; kind: 'url'; draft: string; initial: string; matchType: 'exact' | 'regex' };

// ─── Swap target field (the `⋯` menu's inline picker) ────────────────────────

/**
 * How many candidate slots one page of the swap picker holds.
 *
 * FIVE, as specified for this control. The tag input's own paging constant is
 * eight; the two are deliberately not shared, because they are separate
 * judgements about separate surfaces rather than one number with two homes.
 */
const SWAP_PAGE_SIZE = 5;

/**
 * The `⋯` menu's swap target: a search field with a paged candidate list, replacing
 * the modal that used to ask for a bare slot number.
 *
 * ─── Why this is not the tag input ───────────────────────────────────────────
 *
 * The interaction is modelled on `TagExpressionInput`'s type-ahead (search field,
 * paged popup, `-`/`=` to page, ↑/↓ to walk, Enter to commit, combobox wiring), but
 * the DELTA is deliberate and load-bearing: that control composes a chip EXPRESSION
 * and commits chips, whereas this one resolves to exactly ONE slot and then acts.
 * Two such different commit semantics should not share a component that would have
 * to be configured back out of its guess.
 *
 * `=`/`+` page forward and `-`/`_` page back, matching the tag input — including
 * accepting the shifted pair, because on most layouts `+` and `_` are what those
 * keys produce.
 */
function SwapTargetField({
  sourceSlotNumber,
  slotLabels,
  onSubmit,
  submitRef,
}: {
  sourceSlotNumber: number;
  slotLabels?: string[];
  onSubmit: (target: number) => void;
  /** Shared with the parent so a second submission cannot reach the wire. */
  submitRef: React.MutableRefObject<boolean>;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  /**
   * Whether the field holds focus — and therefore whether the candidates show.
   *
   * The list is an accessory to the FIELD, not a permanent part of the menu: an
   * always-open list would cover the menu's own entries for a user who came for
   * something else. Focus is the honest signal for "this control is in use".
   */
  const [focused, setFocused] = useState(false);

  /**
   * The field is NOT focused when the menu opens.
   *
   * It used to take focus via a mount effect, so that `⋯` → type was one click. But
   * `⋯` is the menu for SEVEN actions, and the user has not said which one they
   * want yet: a caret blinking in a swap field answers a question they have not
   * asked, and reads as the menu having jumped to a decision. Focus arrives when
   * they click the field or Tab to it, which is the same moment the candidates
   * appear — so the disclosure and the intent stay in step.
   */

  /**
   * The candidate slots.
   *
   * Every OTHER slot in 1..10 is a legal leg (D17): an empty one is a legal operand
   * that degrades the swap to a move (D3), so filtering empties out would hide
   * exactly the entries the user needs to see. Only the source is excluded, because
   * swapping a slot with itself is a caller bug the worker rejects.
   *
   * A query matches the NUMBER or the recorded label, so "3" and "docs" both work.
   */
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = Array.from({ length: 10 }, (_, i) => i + 1)
      .filter((n) => n !== sourceSlotNumber)
      .map((n) => ({ number: n, label: slotLabels?.[n - 1] ?? 'Empty' }));
    if (needle === '') return all;
    return all.filter((c) => String(c.number).includes(needle) || c.label.toLowerCase().includes(needle));
  }, [query, sourceSlotNumber, slotLabels]);

  // ─── Paging ────────────────────────────────────────────────────────────────
  const pageCount = Math.max(1, Math.ceil(candidates.length / SWAP_PAGE_SIZE));
  // Clamped rather than corrected in an effect: a shrinking result set must not
  // leave the user on a page that no longer exists, and clamping is what the tag
  // input does for the same reason.
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = candidates.slice(safePage * SWAP_PAGE_SIZE, (safePage + 1) * SWAP_PAGE_SIZE);
  const active = activeIndex >= 0 && activeIndex < pageItems.length ? activeIndex : -1;

  const fieldId = `swap-target-${String(sourceSlotNumber)}`;

  /** Commit a slot. The FIRST guard is the one that survives a repeated key. */
  const commit = (slot: number): void => {
    if (submitRef.current) return;
    submitRef.current = true;
    onSubmit(slot);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Paging only while there is more than one page, so the keys stay available to
    // the text when there is nothing to page.
    if (pageCount > 1 && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      setPage((prev) => Math.min(prev + 1, pageCount - 1));
      // The highlight is a position within a PAGE, so turning the page clears it —
      // otherwise it would point at a row the user has not seen.
      setActiveIndex(-1);
      return;
    }
    if (pageCount > 1 && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      setPage((prev) => Math.max(prev - 1, 0));
      setActiveIndex(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Wrapping stays WITHIN the page: crossing a boundary on an arrow key would
      // scroll the list out from under the user without them asking to turn it.
      setActiveIndex((prev) => (prev + 1 >= pageItems.length ? 0 : prev + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 < 0 ? pageItems.length - 1 : prev - 1));
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Escape abandons the PICK, not the menu: clearing the buffer is the least
      // destructive reading, and the menu's own Escape (a second press) still closes
      // the whole thing. Swallowing it here would make one key do two jobs at once.
      setQuery('');
      setActiveIndex(-1);
      setPage(0);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // The stopPropagation matters: this field sits inside a slot row whose own
      // Enter handler ACTIVATES the slot, and the user asked to swap, not to switch.
      e.stopPropagation();
      // The highlighted row if there is one, otherwise the top candidate — so
      // "type a number, hit Enter" does the obvious thing without arrowing first.
      // Guarded on the LIST, not on the picked element: an empty page has nothing
      // to take, and an empty result set is a real state (a search matching none).
      if (pageItems.length === 0) return;
      const item = active >= 0 ? pageItems[active] : pageItems[0];
      commit(item.number);
      return;
    }
  };

  return (
    // THREE siblings, not one wrapper — deliberately.
    //
    // The control row and its floating list are separate children of the MENU, so
    // the list's containing block is the whole menu (which already carries
    // `position: relative`). Anchored to the row instead, the panel would hang over
    // the entries directly beneath it and hide them, which is exactly what it must
    // not do. As a sibling it floats clear of the menu's box entirely.
    <>
    <div className="tbs-slot-swap" role="group" aria-label={`Swap slot ${String(sourceSlotNumber)} with another slot`}>
      {/* TWO words, and the second is "data": the operation moves the slot's stored
          record, not the slot itself, and "swap with" alone reads like exchanging the
          BUTTONS. The field and button stay one word each so the row fits the menu. */}
      <span className="tbs-slot-swap__title">Swap data</span>
      {/* A raw input rather than `SearchField`, following the SAME precedent as
          `TagExpressionInput`'s primary field: that component deliberately carries
          no `onKeyDown` and no combobox wiring, because its one job is "a labelled
          text box with a clear button". This one owns the keyboard (paging,
          highlight, Enter) and is a real `combobox`, so it wears the shared search
          style directly — which the stylesheet already supports for toolbars that
          size the input themselves. */}
      <input
        type="text"
        className="tbs-shared-search tbs-slot-swap__search"
        data-testid={`swap-target-input-${String(sourceSlotNumber)}`}
        // Short on purpose: a target is a slot NUMBER (at most two digits), so the
        // field does not need room for a sentence — and the menu must keep its own
        // width for its own entries. Names are still searchable once the list is up.
        placeholder="Slot #"
        value={query}
        aria-label={`Search target slot for slot ${String(sourceSlotNumber)}`}
        // The placeholder had to shrink to "Slot #" to keep the menu narrow, so the
        // full intent lives here as well — a hint the user can always recover.
        title="Swap this slot's data with another slot (number, or a name)"
        // ─── Combobox wiring ──────────────────────────────────────────────────
        // The highlight rides on `aria-activedescendant` rather than moving focus:
        // focus has to stay in the field or the user could not keep typing, which
        // is the whole point of the control.
        role="combobox"
        aria-autocomplete="list"
        aria-expanded
        aria-controls={`${fieldId}-list`}
        {...(active >= 0 ? { 'aria-activedescendant': `${fieldId}-opt-${String(active)}` } : {})}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          // A fresh buffer is not a selection: leaving a highlight on the old one
          // would commit a row the user never chose.
          setActiveIndex(-1);
          // ...and a fresh buffer is a fresh LIST, so it starts on page one.
          setPage(0);
        }}
        onKeyDown={onKeyDown}
        // Focus IS the disclosure: the candidates belong to the field, so they come
        // and go with it. See the comment on `focused`.
        onFocus={() => { setFocused(true); }}
        onBlur={() => { setFocused(false); }}
        // The menu closes on an outside click. `stopPropagation` keeps a click on
        // the field itself from being read as "outside" and closing the very menu
        // the user is typing into.
        onMouseDown={(e) => { e.stopPropagation(); }}
      />
      <Button
        size="sm"
        variant="primary"
        disabled={pageItems.length === 0}
        // `onMouseDown`, NOT `onClick`: a click moves focus out of the field first,
        // and that blur closes the list before the click lands — the classic
        // combobox "the item vanished as I clicked it" bug. `preventDefault` keeps
        // focus where it is, so the interaction does not depend on remounting.
        // (Same fix, same reason, as `TagExpressionInput`'s candidate rows.)
        onMouseDown={(e) => {
          e.preventDefault();
          if (pageItems.length === 0) return;
          const item = active >= 0 ? pageItems[active] : pageItems[0];
          commit(item.number);
        }}
      >
        Swap
      </Button>
    </div>

    {/* FLOATING, and a SIBLING of the row above — see the fragment's note. Rendered
        only while the field has focus, so a user who came for `Clear Slot Data`
        still sees their menu. `listbox`/`option` keeps the announcement, and focus
        stays in the field, which the combobox wiring depends on. */}
    {focused && (
      <ul className="tbs-slot-swap__list" role="listbox" id={`${fieldId}-list`} aria-label="Target slots">
        {pageItems.map((item, index) => (
          <li key={item.number}>
            <button
              type="button"
              id={`${fieldId}-opt-${String(index)}`}
              role="option"
              aria-selected={index === active}
              className={`tbs-slot-swap__option${index === active ? ' tbs-slot-swap__option--active' : ''}`}
              // `onMouseDown` + `preventDefault`: see the Swap button above.
              onMouseDown={(e) => { e.preventDefault(); commit(item.number); }}
            >
              <span className="tbs-slot-swap__number">{item.number}</span>
              <span className="tbs-slot-swap__label">{item.label}</span>
            </button>
          </li>
        ))}
        {pageItems.length === 0 && (
          <li className="tbs-slot-swap__empty">No slot matches that search</li>
        )}
        {/* Paging is stated rather than implied: a user who cannot see that there is
            more has no reason to reach for `-` / `=`. It is the list's LAST row — in
            the floating panel, not in the menu — and it is not a control, hence
            `aria-hidden`. */}
        {pageCount > 1 && (
          <li className="tbs-slot-swap__page" aria-hidden="true">
            Page {safePage + 1} of {pageCount} · use - and =
          </li>
        )}
      </ul>
    )}
    </>
  );
}

function SlotRow({ slotNumber, slot, binding: _binding, shortcut, resolvedTitle, resolvedIcon, onSwitch, onNextMatch, onPrevMatch, onSave, onUnbind, onEditIcon, onAddToGlobal, titleChain, iconChain, onClearLayer, onSwap, swapPending, onSwapHover, swapHint, swapHintAnchor, slotLabels, edit, editToken, iconEditorOpen, onEditStart, onEditDraft, onEditMatchType, onEditCommit, onEditCancel, onEditReset }: SlotRowProps) {
  /**
   * Review item 7: the record THIS row represents. When the displayed value comes
   * from this slot itself, the popover is suppressed — "Slot 8 · from slot 8"
   * tells the user nothing.
   */
  const selfOwner: TierOwner = { kind: 'slot', slotId: slotNumber };
  const rowTabId = _binding?.tabId ?? null;
  const isBound = !!slot;
  const isEmpty = !slot;
  const colorVar = SLOT_COLORS[slotNumber - 1] ?? 'var(--slot-1)';
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * The editor is CONTROLLED — its state belongs to the list (see `SlotRowProps.edit`).
   *
   * These aliases keep the rest of the row readable: `editingTitle` still answers
   * "is this the title editor", but it now means "and the open edit belongs to THIS
   * slot's data". That is what makes a swap able to hand the editor to the other
   * number simply by moving `edit.slotId`.
   */
  const myEdit = edit !== null && edit !== undefined && edit.slotId === slotNumber ? edit : null;
  const editingTitle = myEdit?.kind === 'title';
  const editingUrl = myEdit?.kind === 'url';
  const titleDraft = myEdit?.kind === 'title' ? myEdit.draft : '';
  const titleInitial = myEdit?.kind === 'title' ? myEdit.initial : '';
  const urlDraft = myEdit?.kind === 'url' ? myEdit.draft : '';
  // Item 5.1: the value captured when the URL editor opened, so `↺` can restore it.
  const urlInitial = myEdit?.kind === 'url' ? myEdit.initial : '';
  const urlMatchType = myEdit?.kind === 'url' ? myEdit.matchType : 'exact';
  // P2: deletion is destructive, so it must pass through a confirmation first.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  /**
   * D23: the `⋯` menu's swap entry opens a MODAL input, not an inline edit. It is
   * deliberately NOT part of the D15 transient swap state — the modal owns its own
   * lifetime (`Escape` / cancel / submit), so D12's blur-and-timeout rules must not
   * reach it. The `⋯` menu steals focus the moment it opens, so applying D12 here
   * would cancel the swap before the user could type (C1 ruling).
   */
  /**
   * Guards against submitting the SAME swap twice.
   *
   * A held `Enter` repeats `keydown`, and a double-click on `Swap` runs the
   * button's handler twice; a state change cannot stop either, because it is only
   * SCHEDULED — both calls have already run by then. Two concurrent `SWAP_SLOTS`
   * requests then race: the FIRST applies (the data really does move) while the
   * SECOND fails its optimistic version check and reports `CONFIG_CONFLICT` —
   * i.e. the user is told "data changed elsewhere, try again" for a change that
   * their own first request just made.
   *
   * The flag is set SYNCHRONOUSLY before the send. It is CLEARED when the menu
   * closes, so re-opening gives a clean slate and a genuine retry stays possible.
   */
  const swapSubmitRef = useRef(false);
  /**
   * Review item 4: the slot title input commits on BLUR, and the `↺` / `⊘`
   * buttons used to blur it on their way in (`mousedown` moves focus before
   * `click`). `↺` therefore saved the text it was asked to discard, and `⊘`
   * cleared the layer only to have the blur handler re-write it from the draft.
   * Both buttons suppress the mousedown so the input keeps focus, and a commit
   * that still arrives is ignored once.
   */
  const suppressTitleCommit = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // F4: the `⋯` button is the durable trigger — the menu item that opens the
  // confirm dialog is unmounted, so focus must be restored here instead.
  const moreButtonRef = useRef<HTMLElement | null>(null);
  // N7: the row itself survives an unbind, so it is the durable focus fallback
  // when the `⋯` trigger (and the whole actions section) is removed.
  const rowRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isBound && !editingTitle && !editingUrl) {
      onSwitch(slotNumber);
    }
  };

  /**
   * The row's activation timer, for a click that may turn out to be a double-click.
   *
   * ─── Why activation cannot happen on `click` ─────────────────────────────────
   *
   * Reported: double-clicking a slot's icon / title / URL to EDIT it switched to
   * the bound tab first, pulling the user away from the sidebar at the moment they
   * asked to change something.
   *
   * The editable fields carry `onDoubleClick` with `e.stopPropagation()`, which
   * looked like it should prevent exactly this — but a real double-click
   * dispatches `click`, `click`, `dblclick` IN THAT ORDER, so the first `click`
   * has already bubbled to this row and activated the slot by the time `dblclick`
   * runs, and a `stopPropagation` on a LATER event of an EARLIER event's
   * consequence is simply too late. Every double-click also sent the switch TWICE
   * (once per `click`).
   *
   * So the decision cannot be made on `click`, where the answer is not yet known:
   * a lone click must activate, but the first click of a pair must not. Activation
   * is deferred by one double-click interval and cancelled if a second click
   * arrives — which is the only ordering that lets both gestures coexist.
   */
  const activationTimer = useRef<number | null>(null);

  /**
   * How long to wait before treating a click as a lone click.
   *
   * Not a tuned constant: it is the platform's OWN double-click interval, read
   * from `chrome.i18n` (`getDoubleClickTime`) so the row activates exactly as fast
   * as the environment considers "not a double-click". The fallback is the
   * documented Chromium default for that API, and it is only reached when the API
   * is unavailable (a partial mock in a test, or a non-extension host) — the app is
   * a Chrome extension, so the real value is present in every shipping context.
   */
  const doubleClickDelay = useRef<number>(
    (globalThis as { chrome?: { i18n?: { getDoubleClickTime?: () => number } } })
      .chrome?.i18n?.getDoubleClickTime?.() ?? 500,
  );

  const cancelPendingActivation = (): void => {
    if (activationTimer.current !== null) {
      window.clearTimeout(activationTimer.current);
      activationTimer.current = null;
    }
  };

  // A row that unmounts (unbind, list refresh) must not fire its pending
  // activation from a timer that outlived it.
  useEffect(() => cancelPendingActivation, []);

  const handleClick = (e: React.MouseEvent) => {
    // A click inside the `⋯` menu is a MENU interaction, never a row activation.
    //
    // Reported defect: clicking the swap field focused it and then, a double-click
    // interval later, the row switched to that slot's bound tab — the user was
    // yanked out of the sidebar mid-keystroke. The menu's own items (`Clear Slot
    // Data`, `Edit URL…`) stop propagation individually, but the swap field, its
    // `Swap` button and its floating candidate list are ordinary elements that do
    // not, so their clicks reached this handler.
    //
    // Checked HERE rather than by adding `stopPropagation` to each of those
    // elements: one authority covers the whole menu, including anything added to it
    // later, and it cannot be forgotten on a new control the way a per-element
    // guard can.
    //
    // Measured: only the FIELD actually reaches this handler in practice. The Swap
    // button and the candidate rows commit on `mousedown`, which closes the menu and
    // unmounts them before their `click` fires — the click then lands on a detached
    // node and never bubbles. That self-protection is an artefact of the ordering,
    // not a design, so it is deliberately NOT relied on: reorder that commit to
    // `click` and the row would start switching on every target choice.
    //
    // The `cancelPendingActivation` is not about THIS click — a click elsewhere on
    // the row before it may already have scheduled an activation, and the user's
    // attention has plainly moved to the menu, so that switch must not still land.
    if (menuRef.current?.contains(e.target as Node) === true) {
      cancelPendingActivation();
      return;
    }
    if (!isBound || editingTitle || editingUrl) return;
    // `detail` is the browser's own click counter for this position, which is more
    // reliable here than counting our own: it tells the truth even in a test that
    // dispatches only the second click of a pair.
    if (e.detail > 1) {
      cancelPendingActivation();
      return;
    }
    cancelPendingActivation();
    activationTimer.current = window.setTimeout(() => {
      activationTimer.current = null;
      onSwitch(slotNumber);
    }, doubleClickDelay.current);
  };

  // ─── Swap: drag path (D8/D9/D13/D22) ───────────────────────────────────

  /**
   * Is this row in a DATA-LAYER edit — one that cannot move with a swap?
   *
   * NARROWED, and the narrowing is the point. This used to be "either inline editor
   * is open", on the reasoning that an editor commits by slot NUMBER, so a swap would
   * land its draft in a record that had moved.
   *
   * The inline editors no longer work that way: their state belongs to the LIST and
   * is addressed by the RECORD it describes, so a swap hands the open editor to the
   * slot the data went to (the user's expectation: the edit follows the data). They
   * are therefore no longer a reason to refuse a swap.
   *
   * The icon editor still IS: it is a modal that captured its target slotId when it
   * opened, so a swap underneath it would apply the icon to the wrong number. The
   * guard must keep refusing THAT — a rule that cannot simply be deleted.
   */
  const isEditing = iconEditorOpen;
  /** D15: the list's transient state, read for this row's two roles. */
  const swapSource = swapPending?.source ?? null;
  const swapTarget = swapPending?.target ?? null;

  /**
   * D8/D13/A9: the row root is the drag surface, and starting a drag defuses every
   * other pending gesture on the row — the deferred activation timer (a click that
   * turned into a drag must not also activate) and the `⋯` menu.
   *
   * A9's guard applies symmetrically: a row that is mid-edit may be the source of
   * NO swap either. Its editor commits by slot NUMBER, so a swap it started would
   * land its draft in a record that has moved — the same data-integrity reason the
   * drop side refuses an editing target. Ending the pending state here (rather than
   * merely not starting one) keeps the transient state from coexisting with
   * `editingTitle` / `editingUrl` in an undefined way.
   *
   * D22: the payload names the slot in `text/plain` (the same channel the tag chip
   * input uses). `setDragImage` is called through an OPTIONAL CHAIN because jsdom's
   * `DataTransfer` stub has no such method.
   */
  const handleDragStart = (e: React.DragEvent) => {
    cancelPendingActivation();
    setMenuOpen(false);
    // D13: a drag defuses the OTHER pending gesture too — an armed `Alt` cursor
    // must not survive a drag the user has started instead, or a later `↑`/`↓`
    // would move an operation they believe they put down. `report(null, ...)` is
    // the hook's single "no source" ending, so this needs no second channel.
    onSwapHover?.(null, null);
    if (isEditing) return;
    const dataTransfer = dragTransferOf(e);
    if (!dataTransfer) return;
    dataTransfer.setData('text/plain', JSON.stringify({ slotId: slotNumber }));
    dataTransfer.effectAllowed = 'move';
    // D22: the drag image carries the number, so "which slot am I holding" stays
    // visible while the pointer is over another row.
    dataTransfer.setDragImage?.(rowRef.current ?? (e.target as Element), 0, 0);
    onSwapHover?.(slotNumber, null);
  };

  /**
   * D13: the target row highlights only while it is a LEGAL drop. A row that is
   * the source, or that is mid-edit, refuses the cursor — the edit-state refusal
   * is a data-integrity rule, not a preference: the editor's commit writes back to
   * its OWN number, so letting a swap land there would write the draft into a slot
   * that now holds a different record.
   */
  const handleDragOver = (e: React.DragEvent) => {
    const dataTransfer = dragTransferOf(e);
    // D13: the forbidden cursor (`none`) is the feedback for a refused drop, so it
    // is set on the way out even when nothing else happens.
    if (slotNumber === swapSource || isEditing) {
      e.preventDefault();
      if (dataTransfer) dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    if (dataTransfer) dataTransfer.dropEffect = 'move';
    if (swapTarget !== slotNumber) onSwapHover?.(swapSource, slotNumber);
  };

  const handleDragLeave = () => {
    if (swapTarget === slotNumber) onSwapHover?.(swapSource, null);
  };

  /** D13: drop only commits on a legal target; every refusal is silent. */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onSwapHover?.(null, null);
    const raw = dragTransferOf(e)?.getData('text/plain') ?? '';
    // R6: the payload is foreign input — a drag can originate in another page or
    // application, so it must never be trusted to be our own JSON. A parse failure
    // or a missing/non-numeric `slotId` means "not an internal drag", which is the
    // same situation as `dragstart` never having run: fall back to the tracked
    // source and let the guards below decide.
    let source: number | null = swapSource;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { slotId?: unknown };
        if (typeof parsed.slotId === 'number' && Number.isInteger(parsed.slotId)) {
          source = parsed.slotId;
        }
      } catch {
        // Not our payload — keep the tracked source.
      }
    }
    if (source === null || source === slotNumber || isEditing) return;
    void onSwap(source, slotNumber);
  };

  const handleDragEnd = () => {
    onSwapHover?.(null, null);
  };

  // ─── Swap: the `⋯` menu's inline picker (D23/D24, C1) ───────────────────

  /**
   * D17 (UI side): the target has already been constrained by construction — the
   * picker offers every slot in 1..10 EXCEPT this one, and the label is that
   * slot's own number. So there is no validation left to do here, and no error
   * state to show: the only reachable values are legal. The worker still re-checks,
   * because the UI is never the boundary.
   *
   * The menu closes with the pick, which is also what re-arms `swapSubmitRef` for
   * the next visit (see the `menuOpen` effect).
   */
  const submitSwapTarget = (target: number): void => {
    swapSubmitRef.current = true;
    setMenuOpen(false);
    void onSwap(slotNumber, target);
  };

  /**
   * A field's own double-click: the click(s) that preceded it are discarded and
   * the editor opens.
   *
   * `stopPropagation` is kept for the `dblclick` itself (so nothing above the row
   * reacts to it), but the pause is what actually prevents the switch: the two
   * `click`s have already run their handler by now, and cancelling their pending
   * activation is the only thing that can still stop them.
   */
  const beginFieldEdit = (edit: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelPendingActivation();
    edit();
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) {
      // Re-arm the swap submit guard for the next visit. The guard is armed when a
      // swap is submitted and the menu closes with it, so clearing it here (rather
      // than inside the submit handler) keeps the two in step: whoever closes the
      // menu leaves a clean slate behind.
      swapSubmitRef.current = false;
      return;
    }
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [menuOpen]);

  /**
 * P8: the `⋯` menu needs the SAME entry points as double-click. Extracted so
 * both paths share one implementation (the double-click handlers below just
 * stop propagation and delegate).
 */
const startTitleEdit = () => {
    if (!isBound) return;
    // Review item 4: clear any suppression left over from the previous session,
    // so a real commit is never swallowed.
    suppressTitleCommit.current = false;
    // The LIST builds the edit: only it can seed the draft from the record and know
    // which slot's data the draft belongs to.
    onEditStart(slotNumber, 'title');
  };

  const handleTitleDoubleClick = beginFieldEdit(startTitleEdit);

  /**
   * Focus the field when THIS row becomes the editor's owner.
   *
   * `editToken` is in the dependency list because the interesting case is the SAME
   * edit arriving at a DIFFERENT row (the migration after a swap): the edit object
   * is unchanged, so only the token can tell this effect to run again.
   */
  useEffect(() => {
    if (!editingTitle && !editingUrl) return;
    const id = window.setTimeout(() => {
      (editingTitle ? titleInputRef : urlInputRef).current?.focus();
    }, 0);
    return () => { window.clearTimeout(id); };
  }, [editingTitle, editingUrl, editToken]);

  const handleTitleSave = () => {
    // Review item 4: a commit arriving from a button-induced blur must not undo
    // what that button just did.
    if (suppressTitleCommit.current) {
      suppressTitleCommit.current = false;
      return;
    }
    // The commit carries no slot id: the LIST knows which record the open draft
    // belongs to, which is exactly what lets a swap move it. Reading the position
    // here would re-introduce the bug this change removes.
    onEditCommit();
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') handleTitleSave();
    if (e.key === 'Escape') onEditCancel();
  };

  /** Review item 4: `↺` restores the opened text and KEEPS the box open. */
  const handleResetTitleDraft = () => {
    suppressTitleCommit.current = true;
    onEditReset();
  };

  /** Review item 4: `⊘` clears the SLOT layer's title (same write as `Use chain`). */
  const handleClearTitleLayer = () => {
    suppressTitleCommit.current = true;
    onEditCancel();
    onClearLayer?.('title');
  };

  // Problem 8 / P8: double-click URL to edit — shared with the `⋯` menu entry.
  const startUrlEdit = () => {
    if (!isBound || !slot) return;
    onEditStart(slotNumber, 'url');
  };

  const handleUrlDoubleClick = beginFieldEdit(startUrlEdit);

  const handleUrlSave = () => {
    onEditCommit();
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') handleUrlSave();
    if (e.key === 'Escape') onEditCancel();
  };

  const displayTitle = resolvedTitle || slot?.uiMarker.customTitle || slot?.titleSnapshot || `Slot ${slotNumber}`;
  const displayIcon = resolvedIcon || slot?.uiMarker.icon?.value || slot?.faviconSnapshot;
  const displayUrl = slot?.urlMatch.value || '';
  const statusText = isEmpty ? 'Empty' : isBound ? 'Bound' : 'Unbound';

  // The two display values are built ONCE and then conditionally wrapped in the
  // source popover. The value itself is the hover/focus target in every case
  // (review), so it must not be duplicated per branch — that is how the two
  // copies drift apart.
  const iconEl = (
    <span
      className={`tbs-slot-row__icon${isEmpty ? ' tbs-slot-row__icon--empty' : ''}`}
      style={isBound ? { background: `${colorVar}22` } : undefined}
      aria-hidden="true"
      onDoubleClick={beginFieldEdit(() => { if (isBound) onEditIcon(slotNumber); })}
      title={isBound ? 'Double-click to change icon' : undefined}
    >
      {displayIcon ? <img src={displayIcon} alt="" /> : isEmpty ? '·' : '🔖'}
    </span>
  );

  const titleEl = (
    <span
      className={`tbs-slot-row__title${isEmpty ? ' tbs-slot-row__title--empty' : ''}`}
      onDoubleClick={handleTitleDoubleClick}
      title={isBound ? `${displayTitle} (double-click to rename)` : undefined}
      // D9/A8: `draggable={false}` alone does NOT keep text selectable — it only
      // says "this element is not itself a drag source", while a press-and-drag on
      // it still starts the ANCESTOR row's drag. Cancelling `dragstart` here is
      // what actually preserves selection. Both are needed.
      draggable={false}
      onDragStart={(e) => { e.preventDefault(); }}
    >
      {displayTitle}
    </span>
  );

  return (
    <div
      ref={rowRef}
      className={[
        'tbs-slot-row',
        isBound ? 'tbs-slot-row--bound' : '',
        // D21: the source is LOWERED (it is being carried away); the pending
        // target is OUTLINED. Neither touches `background`, which the row's own
        // `:hover` already owns.
        swapSource === slotNumber ? 'tbs-slot-row--swap-source' : '',
        swapTarget === slotNumber ? 'tbs-slot-row--swap-target' : '',
      ].filter(Boolean).join(' ')}
      role="listitem"
      tabIndex={0}
      // D26-3: the row is the 3rd of 10, not just "a listitem" — the number is
      // what this feature makes a first-class operand.
      aria-posinset={slotNumber}
      aria-setsize={10}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      aria-label={`Slot ${slotNumber}: ${displayTitle} (${statusText})`}
      // D8: the whole row is the drag surface; the TEXT stops it at its own
      // elements (D9), so selection keeps working where a user would expect it.
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      {/* Left color bar */}
      <span className="tbs-slot-row__color-bar" style={{ background: colorVar }} aria-hidden="true" />

      {/* Number — D20: this is the ONLY element allowed to say "grabbable". It is
          `aria-hidden` on purpose: the number is already in the row's label, so
          naming it here too would make a screen reader read it twice (D26-3). */}
      <span className="tbs-slot-row__number" aria-hidden="true">{slotNumber}</span>

      {/* D17/D25-⑤b: the armed gesture ran into an end — say so with the SAME
          symbol the user is pressing (`↑`/`↓`) plus `Top`/`Bottom`, or a held key
          at the boundary reads as a dead key. D22: this is anchored to the row the
          gesture is on, never to the pointer. D26-2: it is a purely visual cue —
          pressing `↑`/`↓` repeatedly must NOT flood a live region. */}
      {swapHint && swapHintAnchor === slotNumber && (
        <span className="tbs-slot-row__swap-hint">
          {swapHint.symbol} {swapHint.word}
        </span>
      )}

      {/* Icon — double-click to edit (Problem 7). Item 5.2: the display icon
          carries its own source badge, independently of the title's.
          Review: the source popover is attached to the icon ITSELF, so hovering
          the icon shows both its "Double-click to change icon" tooltip and where
          the icon came from. */}
      <span className="tbs-slot-row__icon-wrap">
        {isBound && iconChain
          ? <SlotSourceBadge chain={iconChain} variant="icon" field="icon" self={selfOwner} tabId={rowTabId}>{iconEl}</SlotSourceBadge>
          : iconEl}
      </span>

      {/* Content */}
      <div className="tbs-slot-row__content">
        {editingTitle ? (
          <>
            <div className="tbs-inline-field" onClick={(e) => { e.stopPropagation(); }}>
              <input
                ref={titleInputRef}
                className="tbs-slot-row__title-input"
                type="text"
                value={titleDraft}
                onChange={(e) => { onEditDraft(e.target.value); }}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                aria-label={`Rename slot ${slotNumber}`}
              />
              {/* Review item 4: `↺` restores the opened text and keeps the box open,
                  so the user can keep editing the restored title. */}
              <button
                type="button"
                className="tbs-inline-field__reset"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => { handleResetTitleDraft(); }}
                disabled={titleDraft === titleInitial}
                aria-label={`Reset slot ${slotNumber} title`}
                title="Reset title"
              >
                ↺
              </button>
              {/* Item 5.2: clear the SLOT layer, so the value falls through to the
                  next tier instead of being merely blanked.
                  Review item 4: the mousedown is suppressed so the input keeps
                  focus and the clear is not undone by the blur commit. */}
              {onClearLayer && (
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onClick={() => { handleClearTitleLayer(); }}
                  aria-label={`Clear the slot title for slot ${slotNumber}`}
                  title="Clear this layer"
                >
                  ⊘
                </button>
              )}
            </div>
            <SlotRowMasking
              chain={titleChain}
              label="title"
              selfOwner={{ kind: 'slot', slotId: slotNumber }}
              tabId={_binding?.tabId ?? null}
            />
          </>
        ) : (
          <>
            {/* Item 5.2 + review: the DISPLAY title carries its winning source,
                and the title itself is the hover target (no extra dot). */}
            {isBound && titleChain
              ? <SlotSourceBadge chain={titleChain} variant="title" field="title" self={selfOwner} tabId={rowTabId}>{titleEl}</SlotSourceBadge>
              : titleEl}
          </>
        )}

        {/* Problem 8: URL display + double-click edit */}
        {isBound && !editingUrl && displayUrl && (
          <span
            className="tbs-slot-row__url"
            onDoubleClick={handleUrlDoubleClick}
            title={`${displayUrl} (double-click to edit)`}
            // D9/A8: same pair as the title — the URL stays selectable (copying it
            // is the common intent), so its own `dragstart` is cancelled.
            draggable={false}
            onDragStart={(e) => { e.preventDefault(); }}
          >
            {displayUrl}
          </span>
        )}
        {isBound && editingUrl && (
          <div className="tbs-slot-row__url-edit" onClick={(e) => { e.stopPropagation(); }}>
            <div className="tbs-inline-field">
              <input
                ref={urlInputRef}
                className="tbs-slot-row__url-input"
                type="text"
                value={urlDraft}
                onChange={(e) => { onEditDraft(e.target.value); }}
                onKeyDown={handleUrlKeyDown}
                aria-label={`Edit URL for slot ${slotNumber}`}
              />
              {/* Item 5.1: reset the URL back to the value captured when the
                  editor opened — same control as the Match URL field. */}
              <button
                type="button"
                className="tbs-inline-field__reset"
                onClick={() => { onEditReset(); }}
                disabled={urlDraft === urlInitial}
                aria-label={`Reset URL for slot ${slotNumber}`}
                title="Reset URL"
              >
                ↺
              </button>
            </div>
            <div className="tbs-slot-row__url-match-type" role="radiogroup" aria-label="Match type">
              <label>
                <input type="radio" name={`url-match-${slotNumber}`} checked={urlMatchType === 'exact'} onChange={() => { onEditMatchType('exact'); }} />
                Exact
              </label>
              <label>
                <input type="radio" name={`url-match-${slotNumber}`} checked={urlMatchType === 'regex'} onChange={() => { onEditMatchType('regex'); }} />
                Regex
              </label>
            </div>
          </div>
        )}

        <span className="tbs-slot-row__meta">
          <StatusBadge
            status={isEmpty ? 'inactive' : isBound ? 'active' : 'pending'}
            label={statusText}
          />
          {isBound && shortcut && <span className="tbs-command-row__shortcut">{shortcut}</span>}
        </span>
      </div>

      {/* Actions — Corporate Clean (Problem 1 + Problem 8) */}
      <div className="tbs-slot-row__actions">
        {isEmpty ? (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onSave(slotNumber); }} aria-label={`Save to slot ${slotNumber}`}>
            Save
          </Button>
        ) : (
          <>
            {/* Bug 3: prev/next match buttons in a vertical stack (prev above next) */}
            <div className="tbs-slot-row__match-stack">
              <Tooltip content={`Switch to previous matching tab for slot ${slotNumber}`}>
                <Button size="sm" variant="primary" className="tbs-slot-row__match-btn" onClick={(e) => { e.stopPropagation(); onPrevMatch(slotNumber); }} aria-label={`Switch to previous matching tab for slot ${slotNumber}`}>
                  ⤺
                </Button>
              </Tooltip>
              <Tooltip content={`Switch to next matching tab for slot ${slotNumber}`}>
                <Button size="sm" variant="primary" className="tbs-slot-row__match-btn" onClick={(e) => { e.stopPropagation(); onNextMatch(slotNumber); }} aria-label={`Switch to next matching tab for slot ${slotNumber}`}>
                  ↻
                </Button>
              </Tooltip>
            </div>
            {/* Problem 3: Save button for bound slots — ghost style */}
            <Tooltip content={`Save current tab to slot ${slotNumber}`}>
              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onSave(slotNumber); }} aria-label={`Save current tab to slot ${slotNumber}`}>
                💾
              </Button>
            </Tooltip>
            {/* More menu (⋯) — Problem 7 */}
            <div className="tbs-slot-row__menu-wrapper" ref={menuRef}>
              <IconButton
                size="sm"
                aria-label={`More options for slot ${slotNumber}`}
                onClick={(e) => {
                  e.stopPropagation();
                  // F4: record the durable trigger so Dialog can restore focus
                  // here after closing the modal opened from this menu.
                  moreButtonRef.current = e.currentTarget;
                  setMenuOpen(!menuOpen);
                }}
              >
                ⋯
              </IconButton>
              {menuOpen && (
                <div className="tbs-slot-menu" role="menu" aria-label={`Slot ${slotNumber} actions`}>
                  {/* P8: explicit edit entries — double-click remains a shortcut. */}
                  <button
                    className="tbs-slot-menu__item"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); startTitleEdit(); }}
                  >
                    Rename Title…
                  </button>
                  <button
                    className="tbs-slot-menu__item"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEditIcon(slotNumber, moreButtonRef.current); }}
                  >
                    Change Icon…
                  </button>
                  <button
                    className="tbs-slot-menu__item"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); startUrlEdit(); }}
                  >
                    Edit URL…
                  </button>
                  {/* D10: the keyboard-equivalent entry for the drag feature. It
                      sits after the editing entries and before the destructive one,
                      matching the menu's progressive-severity order.

                      It is PRESENT AND USABLE IMMEDIATELY — one click on `⋯` and the
                      field already has focus. An earlier revision revealed the field
                      only after a further click on a "Swap with slot…" item, which
                      made the common case cost two clicks and a moment of "did that
                      do anything". Its candidate list floats (see `SwapTargetField`),
                      so it does not disturb the entries below it. */}
                  <SwapTargetField
                    sourceSlotNumber={slotNumber}
                    {...(slotLabels !== undefined ? { slotLabels } : {})}
                    submitRef={swapSubmitRef}
                    onSubmit={submitSwapTarget}
                  />
                  <button
                    className="tbs-slot-menu__item tbs-slot-menu__item--danger"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setDeleteConfirmOpen(true); }}
                  >
                    Clear Slot Data
                  </button>
                  <button
                    className="tbs-slot-menu__item"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onAddToGlobal(slotNumber); }}
                  >
                    Add to Global Rules
                  </button>
                </div>
              )}

              {/* P2: destructive action requires an explicit confirmation. */}
              <Confirm
                open={deleteConfirmOpen}
                title="Clear Slot Data"
                message={`Clear slot ${String(slotNumber)}? Its saved URL, title and icon will be removed, and the slot is released.`}
                confirmLabel="Clear"
                variant="danger"
                returnFocusRef={moreButtonRef}
                focusFallbackRef={rowRef}
                onConfirm={() => { setDeleteConfirmOpen(false); onUnbind(slotNumber); }}
                onCancel={() => { setDeleteConfirmOpen(false); }}
              />

            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Undo Bar (IMP-6: the SHARED generalized implementation) ────────────────
//
// The former local component carried the `role="alert" aria-live="polite"`
// contradiction (CT3-g4) and could not be reused by the settings page. The
// sidebar now renders the shared `UndoBar`, which owns `role="status"`, takes
// focus on open, and returns it on dismissal.
//
// U4/U6 (T8): the sidebar is a HOST of the shared stack, not a private holder.
// Its overwrite undo is a `replay:'background'` entry (the worker owns the
// snapshot), so the entry carries the backend `captureId` (A10) alongside the
// stack-local `id`. The private `UndoState` interface — same name, different
// shape from the shared `UndoState` — is gone; only the shared model remains.

// ─── Icon Editor Modal (uses reusable IconEditor component) ─────────────────

import type { IconConfig } from '@ui/components/IconEditor';
import { IconFieldEditor } from '@ui/shared/icon-field-editor';
import type { IconFieldValue } from '@ui/shared/icon-field-editor';
import { canonicalIconSource, iconDraftToIconSource, iconSourceForOwner, iconSourceToDraft, iconSourceToFieldSeed } from '@ui/shared/icon-source';
import { wildcardToRegex, isProtectedUrl } from '@shared/url-utils';
import { RuleFormFields } from '@ui/shared/rule-form-fields';
import type { FieldMode } from '@ui/shared/field-editor';
import { resolveFieldChain } from '@shared/field-chain';
import type { ChainResult, TierOwner } from '@shared/field-chain';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';
import { MaskedSummary } from '@ui/shared/masked-summary';
import { sameOwner, sourceBadge, sourceDescription, TIER_NAME } from '@ui/shared/source-description';
import type { FieldWord } from '@ui/shared/source-description';
import { normalizeRuleDraft, validateRuleDraft } from '@ui/shared/rule-form-submit';
import type { RuleDraftValue } from '@ui/shared/rule-form-submit';
import { UndoBar as SharedUndoBar, UNDO_DEFAULT_MS } from '@ui/shared/undo-bar';
import type { UndoLayerWrite } from '@ui/shared/undo-bar';
import { useUndoStack, createUndoReplay } from '@ui/shared/undo-stack';
import { useSwapPending } from '@ui/shared/use-swap-pending';
import type { SwapHint } from '@ui/shared/use-swap-pending';

interface IconEditorModalProps {
  open: boolean;
  /**
   * T7/C1: hand the WHOLE draft over so the caller persists a recipe
   * (`type:'template'`) rather than a rendered data URI. `iconDraftToIconSource`
   * is the single converter every write path shares.
   */
  onApply: (draft: IconFieldValue) => void;
  onCancel: () => void;
  onReset?: () => void;
  /**
   * FIX-C: prefer the actual `IconSource` so the seed is source-aware. A plain
   * string is still accepted for surfaces whose tier has no stored source (the
   * site tier) — it is then treated as url/upload by shape, which is all that is
   * knowable there.
   */
  initialIcon?: IconSource | string;
  /**
   * Items 1.1 / 1.2 / 1.3: the LIVE chain for the target, so the picker's
   * `Use chain` tab shows real tier data and the masking summary has something
   * to report. Without it the picker could only ever show empty tiers.
   */
  chain?: ChainResult;
  /** Clear the layer this picker writes to (item 1.3). */
  onClearLayer?: () => void;
  /** Items 2 / 6 / 8: clear ONE chain record's own value. */
  onClearTier?: (owner: TierOwner) => void;
  /** The record this modal edits — lets the summary label it (review item 5). */
  selfOwner?: TierOwner;
  /** The tab whose chain this is, so Page rows can name it (review item 5). */
  tabId?: number;
  /**
   * FIX-C (i): resolve a `Use chain` record's ORIGINAL `IconSource` from its
   * owner, so applying a record copies the recipe rather than its derived
   * render. Supplied by the caller, which holds the raw records; the modal has
   * only the chain's value strings.
   */
  resolveSourceForOwner?: (owner: TierOwner) => IconSource | null;
  /** F4: durable trigger element to focus on close (menu items are unmounted). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** N7: durable element to fall back to if the trigger is removed on close. */
  focusFallbackRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Seed the icon source editor from the currently displayed icon.
 *
 * The modal edits ONE value with FEW sources (the "Change Icon" action already
 * decided which layer to write), so it seeds `IconFieldEditor` with exactly that
 * layer's icon: a `data:` URI becomes the Custom Icon tab, anything else the
 * Icon URL tab, and the "none" case opens with both empty.
 */
function seedIconFieldSource(initialIcon?: IconSource | string): IconFieldValue {
  if (!initialIcon) return { mode: 'custom', value: '', iconConfig: undefined };
  // FIX-C: an actual source is authoritative — dispatch on its `type`, never on
  // the value's shape (a materialized recipe is a `data:` URI and would
  // otherwise be misread as an upload).
  if (typeof initialIcon !== 'string') return iconSourceToDraft(initialIcon);
  // No source available (the site tier carries none): it can only be a URL.
  return { mode: 'url', value: initialIcon };
}

function IconEditorModal({
  open,
  onApply,
  onCancel,
  onReset,
  initialIcon,
  chain: liveChain,
  onClearLayer,
  onClearTier,
  selfOwner,
  tabId,
  resolveSourceForOwner,
  returnFocusRef,
  focusFallbackRef,
}: IconEditorModalProps) {
  // The SHARED reusable icon-source editor (five tabs + chain fallback). It is
  // the same component every other icon surface renders, so tab labels, chain
  // list and preview behaviour cannot diverge.
  const [source, setSource] = useState<IconFieldValue>(() => seedIconFieldSource(initialIcon));

  /**
   * Review item 3: the value captured when the editor OPENED.
   *
   * Reset has to restore the tab, the sub-mode AND the value the user first saw
   * (Icon URL text, uploaded data URI, Custom Icon config, or `Use chain`),
   * which is exactly what `seedIconFieldSource` produced on open. Deriving it
   * once per open — rather than from whatever `initialIcon` currently is — keeps
   * Reset stable even when the surrounding page re-renders.
   */
  const [openedSource, setOpenedSource] = useState<IconFieldValue>(() => seedIconFieldSource(initialIcon));
  /** Which chain record the preview is showing (review item 1). */
  const [previewOwner, setPreviewOwner] = useState<TierOwner | null>(null);

  // The modal stays mounted so `Dialog` can restore focus to the trigger when
  // `open` flips back to false (the primitive captures the previously focused
  // element on open). Per-open state is therefore re-seeded here, mirroring the
  // established `Confirm` usage in DualCards.tsx.
  useEffect(() => {
    if (!open) return;
    const seeded = seedIconFieldSource(initialIcon);
    setSource(seeded);
    setOpenedSource(seeded);
    // A new editing session starts from the effective value, not from whichever
    // record was previewed last time.
    setPreviewOwner(null);
  }, [open, initialIcon]);

  // Falls back to an empty chain only when the caller has none (item 1.1: the
  // sidebar passes the REAL resolved chain, so `Use chain` shows actual tiers).
  const chain = liveChain ?? emptyChain('favicon');

  /**
   * Review item 3: for a Current Page / slot edit, "reset" means "give me back
   * my first entry". For the Current Page the reset ALSO clears the stored page
   * layer (`onReset`), because that layer is what the user came here to change;
   * the local draft is restored either way, and the dialog deliberately stays
   * OPEN so the restored value can be inspected before applying.
   */
  const handleResetToOpened = useCallback(() => {
    setSource(openedSource);
    setPreviewOwner(null);
    onReset?.();
  }, [openedSource, onReset]);

  const handleApply = useCallback(() => {
    // T7/C1: hand the WHOLE draft to the caller so a recipe persists as
    // `type:'template'` instead of being flattened to a rendered data URI. The
    // caller runs it through the single `iconDraftToIconSource` converter, which
    // also treats a blank URL / upload / `use-chain` as "clear this layer".
    onApply(source);
  }, [source, onApply]);

  // P4: reuse the shared Dialog primitive — it supplies Escape, a Tab focus trap
// and focus restoration (see shared/components.tsx), so none of that is
// re-implemented here. The container/CSS classes change, nothing else does.
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Change Icon"
      returnFocusRef={returnFocusRef}
      focusFallbackRef={focusFallbackRef}
      footer={
        <>
          {/* Item 1.3: clear the layer this picker writes to, so the icon falls
              back to the next tier instead of merely being replaced. */}
          {onClearLayer && (
            <Button size="sm" variant="danger" onClick={onClearLayer} aria-label="Clear the icon for this layer">
              Clear icon
            </Button>
          )}
          {onReset && (
            // Item 3: restore + stay open (`handleResetToOpened` never closes).
            <Button size="sm" variant="ghost" onClick={handleResetToOpened} aria-label="Reset icon">
              Reset
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={handleApply}>Apply</Button>
        </>
      }
    >
      <IconFieldEditor
        value={source}
        onChange={setSource}
        chain={chain}
        // Item 1.1: `Use chain` is offered because the caller passes the real
        // chain the Current Page / slot currently resolves to.
        allowUseChain
        idPrefix="change-icon"
        {...(onClearTier ? { onClearTier } : {})}
        // Item 1: selecting a record previews its icon in place.
        {...(previewOwner ? { previewOwner } : {})}
        onSelectPreview={setPreviewOwner}
        // Item 3: the modal owns the "opened with" value, so it drives Reset.
        onReset={onReset ? handleResetToOpened : undefined}
        selfOwner={selfOwner ?? null}
        tabId={tabId ?? null}
        // Items 2 / 6 / 8: applying a RECORD copies its value into THIS draft;
        // the user still presses Apply to write it.
        onApplyTier={(_kind, tierValue, owner) => {
          // FIX-C (i): prefer the record's ORIGINAL source so applying a recipe
          // copies the recipe instead of its derived render (which would re-save
          // as an upload and destroy it — C1).
          const source = owner ? resolveSourceForOwner?.(owner) ?? null : null;
          if (source) {
            setSource(iconSourceToDraft(canonicalIconSource(source)));
            return;
          }
          // LAST RESORT, not a first guess: this branch is only reached when the
          // owner RESOLVED TO NOTHING — either the record is the sourceless site
          // tier, or the owner resolved to a null source. With no source there
          // is no identity to carry, so the value's shape is the only thing
          // knowable. (It is deliberately NOT "guess identity from the value
          // whenever an owner exists" — the branch above runs first.)
          setSource(tierValue.startsWith('data:')
            ? { mode: 'upload', value: tierValue }
            : { mode: 'url', value: tierValue });
        }}
      />
    </Dialog>
  );
}

/** A chain for a surface with no live page context (see settings/App.tsx). */
function emptyChain(field: 'title' | 'favicon' = 'title'): ChainResult {
  return resolveFieldChain(field, {
    sync: { configVersion: 0, matchSettings: DEFAULT_MATCH_SETTINGS, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [], tags: [] },
    local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
    tabId: -1,
    tabUrl: '',
  });
}

// ─── Create Rule Modal (Problem 3: icon editor + priority) ──────────────────

interface CreateRuleModalProps {
  open: boolean;
  defaultUrl: string;
  defaultTitle?: string;
  defaultIcon?: string;
  defaultMatchType?: 'exact' | 'regex';
  /**
   * Item 2.2 / 2.3: the LIVE current-page chains. A new rule starts from what the
   * page shows now, so `Use chain` must list those real tiers rather than an
   * empty chain (which is what printed `—` on every row).
   */
  titleChain?: ChainResult;
  iconChain?: ChainResult;
  /** Items 2 / 6: clear ONE chain RECORD's own value. */
  onClearTier?: (owner: TierOwner, field: 'title' | 'icon') => void;
  /**
   * FIX-C (i): the SAME owner→source resolution the icon modal uses, so a
   * `Use chain` of a RECIPE record copies the recipe instead of its derived
   * render (which would re-save as an upload and destroy it — C1 / rev473).
   */
  resolveSourceForOwner?: (owner: TierOwner) => IconSource | null;
  /**
   * FIX-C (i) / rev473 family: the PREFILL's original source, when the caller
   * has one. `defaultIcon` is only the string the chain materialized (a recipe
   * arrives as its rendered PNG), so seeding from the string alone would reopen
   * a recipe as an upload and destroy it on save (C1).
   */
  defaultIconSource?: IconSource | null;
  /**
   * G3: `tagIds` is a SIBLING of the rule fields, not part of them. The caller
   * sends it as a separate `SET_RULE_TAGS` AFTER the rule exists (A1) — putting
   * it in the rule payload would route tags through the delivery path (R5).
   */
  onSave: (data: { url: string; matchType: 'exact' | 'regex'; title?: string; favicon?: IconSource; priority: number; tagIds?: string[] }) => Promise<{ success: boolean; message?: string }>;
  /** G3/D-b: the tag vocabulary (select one) and the create-in-place hook. */
  availableTags?: TagDefinition[];
  onCreateTag?: (appearance: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>;
  onCancel: () => void;
}

/**
 * FIX-C (i): the ONE icon seeder for every draft-restoring path. The SOURCE wins
 * when present — a recipe OR an upload must come back as itself — and only a
 * sourceless prefill falls back to the value's shape.
 *
 * Module-scope (not a component closure) so the consumers' hook deps stay small
 * and the helper is identically the same function for `CreateRuleModal` and its
 * `applyChainValueToDraft`.
 *
 * Uses `iconSourceToFieldSeed`, NOT `iconSourceToDraft`/`fromIconFieldValue`:
 * that pair maps an upload to a config-less `{kind:'set', value:<dataUri>}`,
 * which the mapper then classifies as `'url'` — the identity is lost and the
 * view (prefix-based) disagrees with what is saved. The config form is what
 * `resolveDraftFavicon` reads back as `upload`/`template`.
 *
 * `fallback` is what to use when no source exists, NOT the icon's truth: a
 * recipe's fallback IS its rendered `data:` URI, so testing the string before
 * the source is exactly the C1 bug.
 */
function seedIconFrom(src: IconSource | null, fallback: string): { mode: FieldMode; iconConfig?: IconConfig } {
  if (src) return iconSourceToFieldSeed(src);
  // No stored source: the value's shape is the LAST RESORT here — only ever
  // reached AFTER the source branch above, never instead of it (that inversion
  // is the C1 bug).
  if (!fallback) return { mode: { kind: 'use-chain' } };
  return fallback.startsWith('data:')
    ? { mode: { kind: 'set', value: '' }, iconConfig: { dataUri: fallback } }
    : { mode: { kind: 'set', value: fallback } };
}

function CreateRuleModal({ open, defaultUrl, defaultTitle = '', defaultIcon = '', defaultIconSource = null, defaultMatchType, titleChain: liveTitleChain, iconChain: liveIconChain, onClearTier, resolveSourceForOwner, onSave, availableTags, onCreateTag, onCancel }: CreateRuleModalProps) {
  // DT4: the four prefills are snapshotted ONCE on open, from the chain-derived
  // values the caller supplies (no per-keystroke re-seed, no implicit fallback).
  const [url, setUrl] = useState(defaultUrl);
  const [matchType, setMatchType] = useState<'exact' | 'regex'>(defaultMatchType ?? 'exact');
  const [titleMode, setTitleMode] = useState<FieldMode>(
    defaultTitle ? { kind: 'set', value: defaultTitle } : { kind: 'use-chain' },
  );
  // NOTE: this initializer is UNREACHABLE with a prefill — the modal is mounted
  // unconditionally while `rulePrefill` starts null, so `defaultIcon` is always
  // '' here. It stays source-aware for consistency, and because a non-empty
  // initial value would otherwise reintroduce the C1 bug. Do NOT hang a test on
  // this path: it is always empty at mount (such a test would be vacuously
  // green); the open-time effect below is the real seeding.
  const initialIconSeed = seedIconFrom(defaultIconSource, defaultIcon);
  const [iconMode, setIconMode] = useState<FieldMode>(initialIconSeed.mode);
  const [iconConfig, setIconConfig] = useState<IconConfig | undefined>(initialIconSeed.iconConfig);
  const [priority, setPriority] = useState(0);
  // G3: the tags this new rule will carry. Held as a draft (ids), sent as a
  // SEPARATE `SET_RULE_TAGS` after the rule is created — never inside the rule
  // payload (A1/R5).
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * The current page could not be used as the rule's URL (an internal page).
   *
   * Not a validation error the user caused — it is the surface explaining why it
   * did NOT fill the field in, so an empty Match URL reads as deliberate rather
   * than as a bug.
   */
  const [prefillRefused, setPrefillRefused] = useState(false);

  // P4: the modal stays mounted (so `Dialog` can restore focus to its trigger
  // on close), therefore the prefill has to be re-seeded on every open — ONCE.
  //
  // The props below are LIVE page state (`defaultUrl` falls back to
  // `state.currentTabUrl`, the icon to the current favicon), so a plain
  // deps-driven effect re-seeded on EVERY bg refresh, silently discarding edits
  // the user had already made in the open modal. Gating on "already seeded this
  // open" is what makes the intent above true: seed at open, then leave the
  // user's draft alone until the modal closes.
  const seededForOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededForOpenRef.current = false; // next open seeds again
      return;
    }
    if (seededForOpenRef.current) return; // mid-session prop churn must not reset
    seededForOpenRef.current = true;
    // An internal page cannot be a rule target (the worker refuses it and the form
    // validator now flags it), so prefilling it would open the form already red and
    // unusable — the user would have to work out that the page they are looking at
    // is the problem. It is NOT prefilled; the reason is stated instead.
    const usableUrl = isProtectedUrl(defaultUrl) ? '' : defaultUrl;
    setUrl(usableUrl);
    setPrefillRefused(defaultUrl.trim() !== '' && usableUrl === '');
    setMatchType(defaultMatchType ?? 'exact');
    setTitleMode(defaultTitle ? { kind: 'set', value: defaultTitle } : { kind: 'use-chain' });
    const seeded = seedIconFrom(defaultIconSource, defaultIcon);
    setIconMode(seeded.mode);
    setIconConfig(seeded.iconConfig);
    setPriority(0);
    setTagIds([]);
    setSaving(false);
    setSaveError(null);
    // `prefillRefused` is set above, from the URL that was actually seeded.
  }, [open, defaultUrl, defaultTitle, defaultIcon, defaultIconSource, defaultMatchType]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const draft: RuleDraftValue = { url, matchType, titleMode, iconMode, iconConfig, priority, tagIds };
    const validation = validateRuleDraft(draft);
    if (!validation.valid) {
      setSaveError(validation.errors[0]?.message ?? 'Invalid form');
      return;
    }

    // Shared normalisation (regex conversion / clamp / DT5 mode model). T7/C1:
    // the modal hands over the WHOLE IconSource (a recipe stays `type:'template'`)
    // so the caller persists it unchanged — no data-URI flattening here.
    // `tagIds` rides alongside as a SIBLING of the rule fields, never inside
    // them: the caller sends it as a separate `SET_RULE_TAGS` after the save.
    const fields = normalizeRuleDraft(draft);

    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave({
        url: fields.url,
        matchType,
        title: fields.title,
        favicon: fields.favicon,
        priority: fields.priority,
        ...(fields.tagIds !== undefined ? { tagIds: fields.tagIds } : {}),
      });
      if (!result.success) {
        setSaveError(result.message || 'Failed to create rule');
        setSaving(false);
      }
      // On success, parent closes the modal
    } catch {
      setSaveError('Failed to create rule');
      setSaving(false);
    }
  }, [url, matchType, titleMode, iconConfig, iconMode, priority, tagIds, onSave, saving]);

  // Item 2.2: the real chains the caller resolved for the Current Page. They let
  // `Use chain` show `override > slot > rule > site` with actual values (2.3).
  const chain = liveTitleChain ?? emptyChain();

  // Items 2 / 6: `Use chain` is meaningful HERE because the caller supplies the
  // live Current Page chain, so this surface opts in explicitly (the create
  // DEFAULT is still "no chain" for surfaces that genuinely have none).
  const canUseChain = liveTitleChain !== undefined || liveIconChain !== undefined;

  /**
   * Item 2.4: the value the `Custom Title` tab restores when it is re-selected.
   *
   * It is the last value the field held — the live edit if there is one, the
   * prefill otherwise — so switching away to `Use chain` and back no longer
   * presents an empty box.
   */
  const titleLastValue = titleMode.kind === 'set' ? titleMode.value : (defaultTitle || null);

  /**
   * Review item 8: copy one chain record's value into the rule being created.
   *
   * A `data:` URI is an icon the composite editor produced, so it seeds the
   * Custom Icon tab; anything else is treated as an Icon URL — the same
   * convention `IconFieldEditor` uses when it applies a record.
   */
  const applyChainValueToDraft = useCallback((field: 'title' | 'icon', value: string, owner?: TierOwner | null) => {
    if (field === 'title') {
      setTitleMode({ kind: 'set', value });
      return;
    }
    // FIX-C (i) / rev473: prefer the record's ORIGINAL source. A recipe's `value`
    // is the DERIVED render (R2 materializes it at read time), so dispatching on
    // the value's shape would reopen it as an upload and destroy the recipe (C1).
    const source = owner ? resolveSourceForOwner?.(owner) ?? null : null;
    // Same source-aware seeder as the prefill. The former `fromIconFieldValue(
    // iconSourceToDraft(...))` pair dropped the config, so a chain `Use` of an
    // UPLOAD record saved it as `type:'url'` (identity lost) — this uses the
    // config form, which `resolveDraftFavicon` reads back as `upload`.
    //
    // ⚠️ KNOWN VIEW QUIRK (not a defect of this path, and not asserted): when the
    // draft ALREADY carries this same source (the prefill now seeds it), applying
    // it changes nothing, and the picker's local tab can stay on `Use chain` even
    // though the draft's mode is `set`. `useIconFieldState` only re-derives the
    // picker when the parent VALUE changes — the tab is a local view, the mode is
    // the contract. Previously the lossy pair changed the config's identity, which
    // re-synced the tab BY ACCIDENT.
    const s = seedIconFrom(source, value);
    setIconMode(s.mode);
    setIconConfig(s.iconConfig);
  }, [resolveSourceForOwner]);

  return (
    // P4: same Dialog primitive as the icon modal (Escape / Tab trap / focus
    // restoration). IMP-1: this is the only modal kept in the product.
    <Dialog
      open={open}
      onClose={onCancel}
      title="New Global Page Rule"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => void handleSave()} disabled={!url.trim() || saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      {/* DT5: an unsaved creation is explicitly labelled as such. */}
      <p className="tbs-modal__hint">This rule is not saved yet.</p>

      {/* Why the Match URL is empty. Stated rather than left to be discovered: an
          internal page (an extension page, a new tab, a local file) cannot be a rule
          target, and an empty field with no reason reads as a broken form. */}
      {prefillRefused && (
        <p className="tbs-modal__hint tbs-modal__hint--notice" data-testid="rule-prefill-refused">
          This page is a browser-internal page, so it cannot be used for a rule. Enter the address of a
          normal website instead.
        </p>
      )}

      {/* SC8: the SAME field set the settings surfaces use. */}
      <RuleFormFields
        variant="create"
        value={{
          url,
          matchType,
          titleMode,
          iconMode,
          iconConfig,
          priority,
          tagIds,
        }}
        onChange={(patch) => {
          if (patch.url !== undefined) setUrl(patch.url);
          if (patch.matchType !== undefined) setMatchType(patch.matchType);
          if (patch.titleMode !== undefined) setTitleMode(patch.titleMode);
          if (patch.iconMode !== undefined) setIconMode(patch.iconMode);
          if (patch.iconConfig !== undefined) setIconConfig(patch.iconConfig);
          if (patch.priority !== undefined) setPriority(patch.priority);
          if (patch.tagIds !== undefined) setTagIds(patch.tagIds);
        }}
        prefill={{ url: defaultUrl }}
        chain={chain}
        titleChain={chain}
        iconChain={liveIconChain ?? chain}
        baselineTitle={{ mode: { kind: 'use-chain' } }}
        // The baseline IS the seeded value: `IconFieldEditor` snapshots its
        // picker from this pair, so leaving it `use-chain` made Reset discard
        // the prefill (a recipe's fields went blank). Mirrors `seedIconFrom`.
        baselineIcon={initialIconSeed}
        onResetTitleEdit={() => { setTitleMode(defaultTitle ? { kind: 'set', value: defaultTitle } : { kind: 'use-chain' }); }}
        // Same expression as `baselineIcon`, so Reset restores exactly the opened
        // draft. The editor's own ↺ also writes first (from its picker snapshot);
        // THIS second write is authoritative and equals the baseline. Both are
        // computed from the same seed, so they agree even though
        // `fromIconFieldValue(toIconFieldValue(x))` is NOT identity for
        // config-carrying values (it normalises `value` to the dataUri). Swapping
        // the two writes would only change the draft's DISPLAY cache — the
        // persisted favicon is identical for every seed shape, because the write
        // path reads `iconConfig` FIRST and only an EMPTY config (no `dataUri`,
        // no `bgColor`, no `text`) falls through to the normalised `value`.
        onResetIconEdit={() => { setIconMode(initialIconSeed.mode); setIconConfig(initialIconSeed.iconConfig); }}
        onClearTitle={() => { setTitleMode({ kind: 'use-chain' }); }}
        onClearIcon={() => { setIconMode({ kind: 'use-chain' }); setIconConfig(undefined); }}
        submitMode={{ kind: 'immediate' }}
        // G3: the tag selector — the SAME shared field set, so the sidebar's
        // create flow gets tagging by construction (R23) rather than by a
        // second, parallel control.
        availableTags={availableTags ?? []}
        {...(onCreateTag ? { onCreateTag } : {})}
        // The modal is a ~288px column, so the tag form's four fields STACK there
        // and go two-up on the wider settings page (see `TagSelector.layout`).
        tagLayout="stacked"
        idPrefix="modal-rule"
        // Item 2.4: re-selecting `Custom Title` restores the previous text.
        titleLastValue={titleLastValue}
        iconLastValue={defaultIcon || null}
        // Items 2 / 6: `Use chain` with the real records, plus apply/clear.
        allowUseChain={canUseChain}
        {...(onClearTier ? { onClearTier } : {})}
        // Review item 8: `Use` on a chain row fills the rule's OWN title/icon
        // from the record the user picked. Offered for EVERY layer that carries
        // a value — including `rule`, since "copy the matching rule's title into
        // this new rule" is a plain copy, not a write to another layer.
        //
        // The new-rule surface has no preview pane, so `<FieldMode>` is the only
        // place the value can land.
        onApplyTier={(_kind, value, owner, field) => { applyChainValueToDraft(field, value, owner); }}
      />

        {saveError && (
          <p className="tbs-modal__error" role="alert" style={{ color: '#DC2626', fontSize: '12px', margin: '4px 0' }}>{saveError}</p>
        )}
    </Dialog>
  );
}

// ─── Main Sidebar App ────────────────────────────────────────────────────────

export function SidebarApp() {
  const [state, setState] = useState<SidebarState>({
    sync: null,
    local: null,
    currentTabId: null,
    currentTabUrl: '',
    currentTabTitle: '',
    currentTabFavicon: '',
    lockedTabId: null,
    loading: true,
    error: null,
  });
  const [toast, setToast] = useState<{ variant: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const lockedTabRef = useRef<number | null>(null);

  // ─── Query current active tab ──────────────────────────────────────────

  const queryCurrentTab = useCallback(async () => {
    if (!hasTabsApi()) return;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        const tab = tabs[0];
        setState((prev) => ({
          ...prev,
          currentTabId: tab.id ?? null,
          currentTabUrl: tab.url ?? '',
          currentTabTitle: tab.title ?? '',
          currentTabFavicon: tab.favIconUrl ?? '',
        }));
      }
    } catch {
      // Silently fail — sidebar may not have tabs permission in some contexts
    }
  }, []);

  // ─── Load state from background ────────────────────────────────────────

  const loadState = useCallback(async () => {
    // P3: clear a previous failure and re-enter the loading state so a Retry
    // is observable (and so error and loading are never shown together).
    //
    // F2 fix: only a COLD load (nothing loaded yet → `sync === null`) may enter
    // the full-page loading state. Every later refresh (post-save, unbind,
    // icon/title/URL update, `storage.onChanged`) must keep the existing shell,
    // footer and any open modal mounted — otherwise the whole sidebar flashes
    // white and in-progress modal drafts are lost.
    setState((prev) => ({ ...prev, loading: prev.sync === null, error: null }));
    try {
      const response = await sendMessage('GET_STATE') as {
        result?: { success: boolean; sync?: SyncState; local?: LocalState };
        success?: boolean;
        sync?: SyncState;
        local?: LocalState;
      };
      // Support both { result: { success, sync, local } } and { success, sync, local }
      const result = response?.result ?? response;
      if (result?.success && result.sync && result.local) {
        // FIX-B: use the background's state VERBATIM. A former "read
        // chrome.storage.local directly for freshness" block replaced
        // `tabOverrides` with the PERSISTED records — whose recipe `value` is
        // `''` (the durable form) — undoing the read-time materialization the
        // repository just performed. The sidebar then showed a blank icon and
        // could not seed the recipe back into the editor.
        //
        // The repository already guarantees freshness: `writeLocal` updates the
        // cache and `storage.onChanged` invalidates it, so `getLocalState()`
        // re-reads when needed. The raw read was redundant AND destructive.
        setState((prev) => ({
          ...prev,
          sync: result.sync!,
          local: result.local!,
          loading: false,
          error: null,
        }));
      } else {
        // N5: the background reports TIMEOUT / INTERNAL_ERROR by *resolving*
        // `{ success: false }`, and message-client passes it through — so this
        // branch (not the catch below) is the common real-failure path. Writing
        // `error: null` here made the P3 defect (a failure rendered as ten
        // "Empty" slots) reappear on that path.
        setState((prev) => ({ ...prev, loading: false, error: 'Failed to load state' }));
      }
    } catch {
      setState((prev) => ({ ...prev, loading: false, error: 'Failed to load state' }));
    }
  }, []);

  // ─── Undo stack (U4/U6) ────────────────────────────────────────────────

  /**
   * The sidebar's entries are `background` ONLY: the worker owns the overwrite
   * snapshot, so replay sends ONE `UNDO_SAVE { slotId, captureId }` (the
   * canonical `createUndoReplay` mapping). The wrapper only ADDS this host's
   * own side effects — it must not silently accept a rejected undo (T26/N3):
   * a `success: false` response is turned into a throw so the caller's catch
   * reports it instead of claiming the slot was restored.
   */
  const undoReplay = createUndoReplay(async (action, payload) => {
    const result = (await sendMessage(action, payload)) as
      | { success?: boolean; result?: { success?: boolean } }
      | undefined;
    const ok = result?.result?.success ?? result?.success ?? false;
    if (!ok) throw new Error(`Undo replay rejected: ${action}`);
    return result;
  });

  const undoStack = useUndoStack({
    onReplay: async (entry) => {
      try {
        await undoReplay(entry);
        if (entry.replay === 'background') {
          setToast({ variant: 'info', message: `Undo: slot ${String(entry.slotId)} restored` });
        }
        void loadState();
      } catch {
        setToast({ variant: 'error', message: 'Undo failed' });
      }
    },
  });

  // ─── Undo helper for the value-clearing writes ──────────────────────────

  /**
   * Snapshot ONE chain winner so a clear/reset can be undone.
   *
   * `owner` decides both the tier AND the write the replay must send: a tab
   * override replays as `tab-override`, a slot marker as `slot-marker`.
   *
   * The icon is read through `iconSourceForOwner`, i.e. the RAW persisted
   * `IconSource`, never the chain's materialized value string. A string cannot
   * carry a recipe: replaying one forced `{type:'upload'}` and permanently
   * flattened the recipe to a bitmap (FIX-A, the same trap the Dashboard
   * documents). Titles have no such hazard.
   */
  const snapshotOfOwner = useCallback((owner: TierOwner, field: 'title' | 'icon'): UndoLayerWrite[] => {
    // The owner names the RECORD but carries no VALUE, so the previous value is read
    // from the store by that address. Reading it here (before the write) is the only
    // faithful source: the chain's own value is the WINNER's, which may be a lower
    // tier than the record being cleared.
    const source = iconSourceForOwner(owner, {
      slots: state.sync?.slots ?? [],
      rules: state.sync?.rules ?? [],
      tabOverrides: state.local?.tabOverrides ?? [],
    });
    if (owner.kind === 'override') {
      const record = (state.local?.tabOverrides ?? []).find((o) => o.tabId === owner.tabId);
      return [{
        kind: 'tab-override',
        tabId: owner.tabId,
        ...(field === 'title' ? { title: record?.title } : { favicon: source }),
      }];
    }
    if (owner.kind === 'slot') {
      const record = state.sync?.slots?.find((s) => s.id === owner.slotId);
      return [{
        kind: 'slot-marker',
        slotId: owner.slotId,
        ...(field === 'title' ? { customTitle: record?.uiMarker.customTitle } : { icon: source }),
      }];
    }
    // `rule` / `site` are not clearable per field from these surfaces (a rule holds
    // both dimensions in one record; a site value is a captured snapshot), so there
    // is nothing this helper could truthfully snapshot.
    return [];
  }, [state.sync, state.local]);

  /** Push a `client` undo entry for a just-made clear, if it has anything to restore. */
  const pushClearUndo = useCallback((message: string, writes: UndoLayerWrite[], affectedTabIds: number[] = []) => {
    if (writes.length === 0) return;
    undoStack.push({
      replay: 'client',
      message,
      snapshot: { writes, affectedTabIds },
      expiresAt: Date.now() + UNDO_DEFAULT_MS,
    });
  }, [undoStack]);

  // ─── Load commands ─────────────────────────────────────────────────────

  const loadCommands = useCallback(async () => {
    try {
      const response = await sendMessage('GET_COMMANDS') as {
        result?: { success: boolean; commands?: CommandInfo[] };
        success?: boolean;
        commands?: CommandInfo[];
      };
      const result = response?.result ?? response;
      if (result?.success && result.commands) {
        setCommands(result.commands);
      }
    } catch {
      // Commands not available
    }
  }, []);

  // ─── Initialize ────────────────────────────────────────────────────────

  useEffect(() => {
    void loadState();
    void loadCommands();
    void queryCurrentTab();

    // Listen for tab activation changes (only if tabs API available)
    if (!hasTabsApi()) return;

    const onActivated = () => {
      if (lockedTabRef.current === null) {
        void queryCurrentTab();
      }
    };

    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.title || changeInfo.favIconUrl || changeInfo.url) {
        if (lockedTabRef.current === null) {
          void queryCurrentTab();
        }
      }
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [loadState, loadCommands, queryCurrentTab]);

  // ─── Storage change listener (Problem 2: refresh on external save) ────

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      // Refresh slot list when sync or local storage changes
      if (areaName === 'local' || areaName === 'sync') {
        const relevantKeys = Object.keys(changes);
        const isSlotRelated = relevantKeys.some(
          (key) => key.includes('slot') || key.includes('sync') || key.includes('local') || key.includes('binding'),
        );
        if (isSlotRelated || relevantKeys.length > 0) {
          void loadState();
        }
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [loadState]);

  // ─── Handlers ──────────────────────────────────────────────────────────

  const handleSwitch = useCallback(async (slotId: number) => {
    try {
      const response = await sendMessage('SWITCH_SLOT', { slotId }) as {
        result?: { success: boolean; outcome?: { type: string } };
        success?: boolean;
        outcome?: { type: string };
      };
      const result = response?.result ?? response;
      if (!result?.success) {
        setToast({ variant: 'error', message: `Failed to switch to slot ${slotId}` });
      } else if (result.outcome?.type === 'incognito_blocked') {
        // Design §4 / DT8: `incognito_blocked` returns success:true, so the
        // plain `!success` branch above never fires — surface the toast here.
        setToast({ variant: 'error', message: 'Incognito access not authorized' });
      }
      // D2: the background owns the recovery window. The sidebar must NOT raise
      // its own recovery-opening toast (that was the misleading one).
    } catch {
      setToast({ variant: 'error', message: `Failed to switch to slot ${slotId}` });
    }
  }, []);

  /**
   * Position (↑/↓) start point (BLK-A / A1): the locked tab when locked, else the
   * current tab. The Lock stays in-memory — only the id rides in the payload, and
   * the background degrades to the active tab when the anchor is gone (DT7).
   */
  const handlePositionPrev = useCallback(async () => {
    const anchorTabId = state.lockedTabId ?? state.currentTabId;
    await sendMessage('POSITION_CURRENT_PREV', anchorTabId === null ? {} : { anchorTabId });
  }, [state.lockedTabId, state.currentTabId]);

  const handlePositionNext = useCallback(async () => {
    const anchorTabId = state.lockedTabId ?? state.currentTabId;
    await sendMessage('POSITION_CURRENT_NEXT', anchorTabId === null ? {} : { anchorTabId });
  }, [state.lockedTabId, state.currentTabId]);

  const handleNextMatch = useCallback(async (slotId: number) => {
    try {
      const response = await sendMessage('NEXT_MATCH_SLOT', { slotId }) as {
        result?: { success: boolean; outcome?: { type: string } };
        success?: boolean;
        outcome?: { type: string };
      };
      const result = response?.result ?? response;
      if (result?.success) {
        const outcome = result.outcome;
        if (outcome?.type === 'no_match') {
          setToast({ variant: 'info', message: `Slot ${slotId}: no matching tabs found` });
        }
      } else {
        setToast({ variant: 'error', message: `Failed to switch to next match for slot ${slotId}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to switch to next match for slot ${slotId}` });
    }
  }, []);

  const handlePrevMatch = useCallback(async (slotId: number) => {
    try {
      const response = await sendMessage('PREV_MATCH_SLOT', { slotId }) as {
        result?: { success: boolean; outcome?: { type: string } };
        success?: boolean;
        outcome?: { type: string };
      };
      const result = response?.result ?? response;
      if (result?.success) {
        const outcome = result.outcome;
        if (outcome?.type === 'no_match') {
          setToast({ variant: 'info', message: `Slot ${slotId}: no matching tabs found` });
        }
      } else {
        setToast({ variant: 'error', message: `Failed to switch to previous match for slot ${slotId}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to switch to previous match for slot ${slotId}` });
    }
  }, []);

  // Current-page prev/next match — cycle tabs matching the active tab's URL.
  const handleCurrentNextMatch = useCallback(async () => {
    if (!state.currentTabUrl) return;
    try {
      const response = await sendMessage('NEXT_MATCH_CURRENT', { url: state.currentTabUrl }) as {
        result?: { success: boolean; outcome?: { type: string } };
        success?: boolean;
        outcome?: { type: string };
      };
      const result = response?.result ?? response;
      if (result?.success && result?.outcome?.type === 'no_match') {
        setToast({ variant: 'info', message: 'No other tabs match the current page' });
      } else if (!result?.success) {
        setToast({ variant: 'error', message: 'Failed to go to next matching tab' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to go to next matching tab' });
    }
  }, [state.currentTabUrl]);

  const handleCurrentPrevMatch = useCallback(async () => {
    if (!state.currentTabUrl) return;
    try {
      const response = await sendMessage('PREV_MATCH_CURRENT', { url: state.currentTabUrl }) as {
        result?: { success: boolean; outcome?: { type: string } };
        success?: boolean;
        outcome?: { type: string };
      };
      const result = response?.result ?? response;
      if (result?.success && result?.outcome?.type === 'no_match') {
        setToast({ variant: 'info', message: 'No other tabs match the current page' });
      } else if (!result?.success) {
        setToast({ variant: 'error', message: 'Failed to go to previous matching tab' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to go to previous matching tab' });
    }
  }, [state.currentTabUrl]);

  // ─── Swap (D15 transient state + D16 send) ─────────────────────────────

  /**
   * D16/D25: send the swap and report the outcome.
   *
   * D25-④: a SUCCESSFUL swap gets NO toast — the swap changes the list itself, so
   * the user sees the two rows exchange on the spot. The existing `Saved to slot 3`
   * toast exists because a save changes the CURRENT TAB and is invisible in the
   * list. A failure, by contrast, is not visible anywhere, so it must be announced.
   *
   * Z1/U6/A10: undo reuses the SHARED stack, as a `replay:'background'` entry that
   * names the worker's `captureId` — the same channel `handleSave` uses. The worker
   * dispatches on that snapshot's `kind: 'swap'`, so no `UNDO_SWAP` exists.
   */
  /**
   * The swap-to-edit migration, reached through a ref.
   *
   * It is declared with the rest of the edit state, which sits AFTER this handler —
   * so a direct call would be a use-before-declaration. Assigned every render by
   * `migrateSlotEdit`'s own definition below.
   */
  const migrateSlotEditRef = useRef<(a: number, b: number) => void>(() => undefined);

  const handleSwap = useCallback(async (sourceSlotId: number, targetSlotId: number) => {
    // D17 (UI half): two EMPTY slots have nothing to exchange, so the UI does not
    // initiate at all. The list already knows both sides, so this costs no round
    // trip; the worker keeps its own `changed:false` short-circuit as the boundary
    // (UI is not the boundary). "Empty" is the absent record — a slot id in 1..10
    // with no definition (D3/A4) — never a missing/out-of-range number.
    const hasRecord = (id: number): boolean =>
      (state.sync?.slots ?? []).some((s) => s.id === id);
    if (!hasRecord(sourceSlotId) && !hasRecord(targetSlotId)) return;
    try {
      const response = await sendMessage('SWAP_SLOTS', { sourceSlotId, targetSlotId       }) as
        | {
            success?: boolean;
            changed?: boolean;
            captureId?: number;
            expiresAt?: number;
            errorCode?: string;
            message?: string;
            result?: {
              success?: boolean;
              changed?: boolean;
              captureId?: number;
              expiresAt?: number;
              errorCode?: string;
              message?: string;
            };
          }
        | undefined;
      const result = response?.result ?? response;
      if (!result?.success) {
        // TIMEOUT (reported defect 2): the worker's response budget elapsed, but
        // its comment is explicit that "a write that overruns is NOT cancelled" —
        // so the swap may well have APPLIED. Claiming failure here is what made a
        // successful swap report "Failed to swap slots x and y". Re-read the state
        // so the list shows the truth, and say the outcome is UNKNOWN rather than
        // asserting a failure we cannot see.
        if (result?.errorCode === 'TIMEOUT') {
          setToast({
            variant: 'error',
            message: 'The swap is taking longer than expected. The list has been refreshed — check whether it applied.',
          });
          void loadState();
          return;
        }
        // D25-②: a version conflict gets its OWN copy, reusing the sentence the
        // rule editor already shows (`settings/App.tsx`), so a user who has seen
        // that one does not have to learn a second way of saying it. Every other
        // failure keeps the generic line.
        setToast({
          variant: 'error',
          message:
            result?.errorCode === 'CONFIG_CONFLICT'
              ? 'Slot data changed elsewhere. Refresh and try again.'
              : `Failed to swap slots ${String(sourceSlotId)} and ${String(targetSlotId)}`,
        });
        return;
      }
      // A7/D17: empty↔empty succeeds with `changed:false` and captures NOTHING, so
      // there is no `captureId` and nothing to restore — no bar is pushed. The
      // `changed` guard is the UI half of that rule; the worker already short-
      // circuited before `writeSync`, so the version did not move either.
      const captureId = result.captureId;
      if (result.changed === true && captureId !== undefined) {
        undoStack.push({
          replay: 'background',
          // `UNDO_SAVE` addresses the capture by one slot; the SOURCE is the
          // conventional one. `slotIds` carries the FULL footprint so the
          // dependency rule sees both slots — without it a later `s2↔s3` swap would
          // look unrelated to this `s1↔s2` one and could be undone out of order.
          slotId: sourceSlotId,
          slotIds: [sourceSlotId, targetSlotId],
          captureId,
          message: `Slots ${String(sourceSlotId)} and ${String(targetSlotId)} swapped`,
          // Defect 1: give the bar a FULL 5s from when it APPEARS, capped by the
          // worker's deadline. Using the raw worker `expiresAt` charged the request
          // round trip against the user's viewing time, so a slow first swap showed
          // a bar that expired almost immediately (or none at all). The worker's
          // TTL is now longer than the bar, so the cap only bites in pathological
          // cases — and it still prevents a bar outliving its restorable capture.
          expiresAt: Math.min(
            Date.now() + UNDO_DEFAULT_MS,
            result.expiresAt ?? Number.POSITIVE_INFINITY,
          ),
        });
      }
      // The edit follows the DATA. Only when `changed` is true: an empty↔empty swap
      // writes nothing, so nothing moved and the editor must stay where it is.
      //
      // Done when the WRITE is known to have landed (and before the reload), so the
      // editor is never handed to a number whose data did not actually move — the
      // one way this feature could make a draft land on the wrong record.
      //
      // Through a ref: the migration lives with the other edit state (declared after
      // this handler), and threading it as a dependency would only move the ordering
      // problem around. The ref is re-pointed every render.
      if (result.changed === true) {
        migrateSlotEditRef.current(sourceSlotId, targetSlotId);
      }
      void loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to swap slots ${String(sourceSlotId)} and ${String(targetSlotId)}` });
    }
  }, [state.sync, loadState, undoStack]);

  /**
   * D15/D11/D12: ONE transient state for "which slot is being moved where", owned
   * at list level by the shared hook and read by each row. TWO inputs drive it —
   * the drag path (`dragstart`/`dragover`/`drop`) and the `Alt` gesture (arm →
   * `↑`/`↓` → release). The latter commits through the SAME `handleSwap`, so both
   * paths share one send, one toast rule and one undo entry (D16/D25/A10).
   *
   * Kept apart from `editingTitle` / `menuOpen` by construction: D13's rule that a
   * drag cancels the pending activation is enforced in the row, and a drag also
   * ends any armed gesture for free — the row's `handleDragStart` calls
   * `report(null, null)`, which is the same "no source" ending every cancellation
   * uses. The `⋯` menu path is not part of this state at all (C1).
   */
  const { pending: swapPending, report: handleSwapHover, hint: swapHint } = useSwapPending(
    (source, target) => { void handleSwap(source, target); },
  );

  /**
   * Slots with a save already in flight.
   *
   * Same class of defect R7 fixed for the swap dialog, but worse here: `SAVE_SLOT`
   * CAPTURES an undo snapshot, so two overlapping saves of one slot produce two
   * captures, two undo bars, and a second overwrite of the first — the user's
   * "save" is recorded as an overwrite of their own save.
   *
   * Keyed by slot so different slots may still be saved concurrently; only a
   * genuine double-fire on the SAME slot is suppressed.
   */
  const saveInFlightRef = useRef<Set<number>>(new Set());

  /** Slots with a delete already in flight (see `handleUnbind`). */
  const deleteInFlightRef = useRef<Set<number>>(new Set());

  // ─── Slot inline editing, owned by the LIST so it can MOVE ────────────────
  //
  // A swap exchanges two slots' data, and an open editor belongs to that DATA — so
  // when the data moves, the editor moves with it. That is only expressible here:
  // the row cannot hand its editor to another row.

  const [slotEdit, setSlotEdit] = useState<SlotEdit | null>(null);
  /** Bumped whenever the edit is handed to a different slot, to re-trigger focus. */
  const [slotEditToken, setSlotEditToken] = useState(0);
  /** Read by the commit path so it never closes over a stale edit. */
  const slotEditRef = useRef<SlotEdit | null>(null);
  slotEditRef.current = slotEdit;
  /**
   * The two write paths the commit needs, reached through a ref.
   *
   * They are declared further down (they depend on `state`), while the swap path that
   * must call this commit is declared above them — so a direct reference would be a
   * use-before-declaration. The ref is assigned on every render, so it is always the
   * live handler.
   */
  const writeSlotEditRef = useRef<{
    title: (slotId: number, title: string) => Promise<void> | void;
    url: (slotId: number, url: string, matchType: 'exact' | 'regex') => Promise<void> | void;
  }>({ title: () => undefined, url: () => undefined });

  const handleSlotEditStart = useCallback((slotId: number, kind: 'title' | 'url') => {
    const record = (state.sync?.slots ?? []).find((s) => s.id === slotId);
    if (!record) return;
    if (kind === 'title') {
      const current = record.uiMarker.customTitle || record.titleSnapshot || '';
      // `initial` is what `↺` restores and what makes an unchanged commit a no-op.
      setSlotEdit({ slotId, kind: 'title', draft: current, initial: current });
    } else {
      setSlotEdit({ slotId, kind: 'url', draft: record.urlMatch.value, initial: record.urlMatch.value, matchType: record.urlMatch.type });
    }
    setSlotEditToken((n) => n + 1);
  }, [state.sync]);

  const handleSlotEditDraft = useCallback((draft: string) => {
    setSlotEdit((prev) => (prev ? { ...prev, draft } : prev));
  }, []);

  const handleSlotEditReset = useCallback(() => {
    setSlotEdit((prev) => (prev ? { ...prev, draft: prev.initial } : prev));
  }, []);

  const handleSlotEditMatchType = useCallback((matchType: 'exact' | 'regex') => {
    setSlotEdit((prev) => (prev && prev.kind === 'url' ? { ...prev, matchType } : prev));
  }, []);

  const handleSlotEditCancel = useCallback(() => { setSlotEdit(null); }, []);

  /**
   * Commit the open draft to the slot it BELONGS to.
   *
   * `edit.slotId` rather than a position: the draft describes a record, and after a
   * swap that record is at a different number. Reading the number here instead is
   * exactly the bug this design removes.
   */
  const handleSlotEditCommit = useCallback(() => {
    const edit = slotEditRef.current;
    if (!edit) return;
    setSlotEdit(null);
    const next = edit.draft.trim();
    // Empty or unchanged = the user changed nothing, so nothing is written.
    if (!next || next === edit.initial) return;
    // Dispatched through a ref so this callback does not depend on handlers that are
    // declared LATER in the component (they close over `state`, which is declared
    // after the swap path that also calls this). Ordering here is not cosmetic: the
    // swap migration has to be in scope of `handleSwap`.
    const write = writeSlotEditRef.current;
    if (edit.kind === 'title') void write.title(edit.slotId, next);
    else void write.url(edit.slotId, next, edit.matchType);
  }, []);

  /**
   * Migration after a swap: the edit follows the data.
   *
   * Declared HERE, above the swap handler that calls it, so that call is in scope.
   *
   * The direction is the whole subtlety. `handleSwap(a, b)` puts b's record at a, so
   * an edit that belonged to `a` now describes the record sitting at `b`. The DRAFT is
   * untouched — it is the user's unsaved work and neither it nor its meaning changed;
   * only the number in front of it did.
   */
  const migrateSlotEdit = useCallback((a: number, b: number) => {
    setSlotEdit((prev) => {
      if (!prev) return prev;
      if (prev.slotId === a) return { ...prev, slotId: b };
      if (prev.slotId === b) return { ...prev, slotId: a };
      return prev;
    });
    setSlotEditToken((n) => n + 1);
  }, []);
  migrateSlotEditRef.current = migrateSlotEdit;

  /**
   * Migration after a swap: the edit follows the data.
   *
   * The direction is the whole subtlety. `handleSwap(a, b)` puts b's record at a,
   * so an edit that belonged to `a` now describes the record sitting at `b`. The
   * DRAFT is untouched — it is the user's unsaved work and neither it nor its meaning
   * changed; only the number in front of it did.
   */
  const handleSave = useCallback(async (slotId: number) => {
    if (saveInFlightRef.current.has(slotId)) return;
    saveInFlightRef.current.add(slotId);
    try {
      const sync = state.sync;
      const existingSlot = sync?.slots.find((s) => s.id === slotId);

      const response = await sendMessage('SAVE_SLOT', {
        slotId,
        urlMatch: { type: 'exact', value: state.currentTabUrl },
        titleSnapshot: state.currentTabTitle,
        faviconSnapshot: state.currentTabFavicon,
      }) as
        | { result?: { success: boolean; captureId?: number; expiresAt?: number }; success?: boolean; captureId?: number; expiresAt?: number }
        | undefined;

      const result = response?.result ?? response;
      if (result?.success) {
        const captureId = response?.result?.captureId ?? response?.captureId;
        const workerExpiresAt = response?.result?.expiresAt ?? response?.expiresAt;
        // U6: the sidebar stacks like every other surface. The gate is
        // unchanged — undo is offered ONLY when an OCCUPIED slot is overwritten
        // (`existingSlot`), and A10 makes that coincide with the worker having
        // captured a snapshot: an empty-slot save returns no `captureId`, so
        // there is nothing to undo and no entry is pushed.
        if (existingSlot && captureId !== undefined) {
          undoStack.push({
            replay: 'background',
            // A single-slot overwrite: `slotIds` defaults to `[slotId]` in the stack.
            slotId,
            captureId,
            message: `Slot ${String(slotId)} overwritten`,
            // Defect 1, same reasoning as the swap path: a full window from when
            // the bar appears, capped by the worker's (now longer) deadline.
            expiresAt: Math.min(
              Date.now() + UNDO_DEFAULT_MS,
              workerExpiresAt ?? Number.POSITIVE_INFINITY,
            ),
          });
        }
        setToast({ variant: 'success', message: `Saved to slot ${slotId}` });
        void loadState();
      } else {
        setToast({ variant: 'error', message: `Failed to save slot ${slotId}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to save slot ${slotId}` });
    } finally {
      // Released on EVERY path, so a failed save can be retried.
      saveInFlightRef.current.delete(slotId);
    }
  }, [state.sync, state.currentTabUrl, state.currentTabTitle, state.currentTabFavicon, loadState, undoStack]);

  const handleUnbind = useCallback(async (slotId: number) => {
    // Same in-flight guard as `handleSave`, and it matters MORE here: the
    // confirmation dialog closes asynchronously, so its `onConfirm` can fire twice
    // before the dialog unmounts, sending two `UNBIND_SLOT`s for one confirmed click.
    if (deleteInFlightRef.current.has(slotId)) return;
    deleteInFlightRef.current.add(slotId);
    try {
      // T26 (N3): a rejected write must not be reported as success.
      const result = (await sendMessage('UNBIND_SLOT', { slotId })) as
        | {
            success?: boolean;
            captureId?: number;
            expiresAt?: number;
            result?: { success?: boolean; captureId?: number; expiresAt?: number };
          }
        | undefined;
      const inner = result?.result ?? result;
      const ok = inner?.success ?? false;
      if (ok) {
        setToast({ variant: 'info', message: `Slot ${String(slotId)} deleted` });
        // The delete IS undoable now (the worker captured the slot before removing
        // it). Offered only when the worker actually captured — an EMPTY slot has
        // nothing to restore, and an undo bar for it would be a dead control.
        if (inner?.captureId !== undefined) {
          undoStack.push({
            replay: 'background',
            slotId,
            captureId: inner.captureId,
            message: `Slot ${String(slotId)} deleted`,
            expiresAt: Math.min(Date.now() + UNDO_DEFAULT_MS, inner.expiresAt ?? Number.POSITIVE_INFINITY),
          });
        }
        void loadState();
      } else {
        setToast({ variant: 'error', message: `Failed to delete slot ${String(slotId)}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to delete slot ${String(slotId)}` });
    } finally {
      deleteInFlightRef.current.delete(slotId);
    }
  }, [loadState, undoStack]);

  /**
   * U1: undo the bar the user CLICKED, not the newest one. `consume(id)` removes
   * that exact entry and replays it through `undoReplay` (the wrapper owns the
   * toast/reload side effects).
   */
  const handleUndo = useCallback((id: string) => {
    undoStack.consume(id);
  }, [undoStack]);

  const handleLockToggle = useCallback(() => {
    setState((prev) => {
      const newLocked = prev.lockedTabId ? null : prev.currentTabId;
      lockedTabRef.current = newLocked;
      return { ...prev, lockedTabId: newLocked };
    });
  }, []);

  // ─── Footer navigation (Problem 1 / B11b) ────────────────────────────

  const openPage = useCallback(async (path: string) => {
    const url = chrome.runtime.getURL(path);

    // A9: bounded retry FIRST. A cold/in-flight service worker is transient, so
    // retrying OPEN_PAGE avoids a second creator racing the background one.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await sendMessage('OPEN_PAGE', { url });
        return;
      } catch {
        // Retry below; only a genuinely dead extension context falls through.
      }
    }

    // Direct fallback ONLY when the extension context is actually gone. If
    // `chrome.runtime.id` still exists we must NOT open a second creator.
    //
    // Re-typed as optional (same pattern as `createChromePageOpenApi` above) so
    // the availability check stays meaningful instead of being reported as an
    // unnecessary condition on a non-optional global.
    const runtimeApi = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime;
    if (typeof runtimeApi?.id === 'string' && runtimeApi.id.length > 0) {
      return;
    }

    try {
      const api = createChromePageOpenApi();
      if (api) {
        await openOrReusePage(api, url);
      }
    } catch {
      // Silently fail
    }
  }, []);

  const handleOpenSettings = useCallback(() => {
    void openPage('src/ui/settings/index.html');
  }, [openPage]);

  const handleOpenImportExport = useCallback(() => {
    void openPage('src/ui/settings/index.html#import-export');
  }, [openPage]);

  const handleOpenDiagnostics = useCallback(() => {
    void openPage('src/ui/settings/index.html#diagnostics');
  }, [openPage]);

  // ─── Current page interaction handlers (Problem 3 redesign) ──────────

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [currentTitleInitial, setCurrentTitleInitial] = useState('');
  const [showIconEditor, setShowIconEditor] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  /**
   * Item 4: the Current Page gets the SAME `⋯` menu the slots have
   * (`Rename Title…` / `Change Icon…` / `Edit URL…`), plus an editable URL. The
   * URL edit writes to the ACTIVE TAB's address bar, not to a stored slot, so it
   * is a separate handler from the slot's `onUpdateUrl`.
   */
  const [currentMenuOpen, setCurrentMenuOpen] = useState(false);
  const [editingCurrentUrl, setEditingCurrentUrl] = useState(false);
  const [currentUrlDraft, setCurrentUrlDraft] = useState('');
  const [currentUrlInitial, setCurrentUrlInitial] = useState('');
  const currentMenuRef = useRef<HTMLDivElement>(null);
  const currentMoreButtonRef = useRef<HTMLElement | null>(null);
  const currentUrlInputRef = useRef<HTMLInputElement>(null);

  /**
   * Review item 4: the title input commits on BLUR, and both toolbar buttons
   * used to blur it on their way in (`mousedown` moves focus before `click`):
   *
   * - `↺` therefore SAVED the value it was asked to discard, so "reset" wrote
   *   the un-reset text to the tab;
   * - `⊘` cleared the page layer and then had the blur handler immediately
   *   re-write the override from the still-filled draft — which is why the
   *   button looked like it did nothing at all.
   *
   * The buttons now suppress the mousedown (so the input keeps focus and `↺`
   * leaves the user editing the restored text) and, defensively, a commit that
   * still arrives is ignored once.
   */
  const suppressTitleCommit = useRef(false);

  const handleTitleDoubleClick = useCallback(() => {
    const current = state.currentTabTitle;
    setTitleDraft(current);
    // Remember the pre-edit value so an unchanged save is treated as "no change".
    setCurrentTitleInitial(current);
    suppressTitleCommit.current = false;
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, [state.currentTabTitle]);

  // Close the Current Page menu on an outside click (same behaviour as a slot's).
  useEffect(() => {
    if (!currentMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (currentMenuRef.current && !currentMenuRef.current.contains(e.target as Node)) {
        setCurrentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [currentMenuOpen]);

  /**
   * Item 4: start editing the ACTIVE TAB's URL.
   *
   * Snapshots the current value so `↺` can restore it, mirroring the slot URL
   * editor (minus the Match Type control, which has no meaning for a live tab).
   */
  const startCurrentUrlEdit = useCallback(() => {
    setCurrentUrlDraft(state.currentTabUrl);
    setCurrentUrlInitial(state.currentTabUrl);
    setEditingCurrentUrl(true);
    setTimeout(() => currentUrlInputRef.current?.focus(), 0);
  }, [state.currentTabUrl]);

  const handleCurrentUrlSave = useCallback(async () => {
    setEditingCurrentUrl(false);
    const next = currentUrlDraft.trim();
    const tabId = state.currentTabId;
    // Unchanged or empty input is a genuine no-op (never navigate to "").
    if (!tabId || !next || next === currentUrlInitial) return;
    try {
      await chrome.tabs.update(tabId, { url: next });
      setToast({ variant: 'success', message: 'URL updated' });
      void loadState();
    } catch {
      setToast({ variant: 'error', message: 'Failed to update the URL' });
    }
  }, [currentUrlDraft, currentUrlInitial, state.currentTabId, loadState]);

  const handleCurrentUrlKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') void handleCurrentUrlSave();
    if (e.key === 'Escape') setEditingCurrentUrl(false);
  }, [handleCurrentUrlSave]);

  // Reset the current page's title: clears the tab's title override so it falls
  // back to the slot/rule/original tiers (bidirectional sync).
  const handleCurrentTitleReset = useCallback(async () => {
    if (!state.currentTabId) return;
    try {
      // Clear ONLY the title at the current-page level (override title → ''),
      // preserving any icon override. The field chain then falls through to
      // slot → rule → original (equivalent to the dashboard Title "—").
      await sendMessage('SET_TAB_OVERRIDE', { tabId: state.currentTabId, title: '' });
      setToast({ variant: 'success', message: 'Title reset' });
      // The value is captured BEFORE the write (above), so undo restores exactly
      // what this reset removed.
      pushClearUndo('Title reset', snapshotOfOwner({ kind: 'override', tabId: state.currentTabId }, 'title'), [state.currentTabId]);
      void loadState();
    } catch {
      setToast({ variant: 'error', message: 'Failed to reset title' });
    }
  }, [state.currentTabId, loadState, pushClearUndo, snapshotOfOwner]);

  const handleTitleSave = useCallback(async () => {
    // Item 4: a commit that arrives from the button-induced blur must not undo
    // what that button just did.
    if (suppressTitleCommit.current) {
      suppressTitleCommit.current = false;
      return;
    }
    setEditingTitle(false);
    if (!state.currentTabId) return;
    const next = titleDraft.trim();

    // CT1 impact #3 / CT4: an empty value is an EXPLICIT "use chain" decision
    // (clear this layer), not a silent short-circuit. An unchanged value is a
    // genuine no-op.
    if (!next) {
      if (currentTitleInitial.trim() === '') return; // already unset — nothing changed
      await handleCurrentTitleReset();
      return;
    }
    if (next === currentTitleInitial) return;

    try {
      await sendMessage('SET_TAB_OVERRIDE', { tabId: state.currentTabId, title: next });
      setToast({ variant: 'success', message: 'Title updated' });
      void loadState();
    } catch {
      setToast({ variant: 'error', message: 'Failed to update title' });
    }
  }, [state.currentTabId, titleDraft, currentTitleInitial, loadState, handleCurrentTitleReset]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { void handleTitleSave(); }
    if (e.key === 'Escape') { setEditingTitle(false); }
  }, [handleTitleSave]);

  /** Item 4: `↺` restores the opened text and LEAVES THE BOX OPEN to keep editing. */
  const handleCurrentTitleResetDraft = useCallback(() => {
    suppressTitleCommit.current = true;
    setTitleDraft(currentTitleInitial);
  }, [currentTitleInitial]);

  /**
   * Item 4: `⊘` clears the CURRENT layer's value (`SET_TAB_OVERRIDE title: ''`),
   * exactly like the `Clear` entry in the `Use chain` list. The drafting state is
   * ended and the pending commit suppressed so the cleared layer is not
   * immediately re-written from the draft.
   */
  const handleCurrentTitleClearLayer = useCallback(() => {
    suppressTitleCommit.current = true;
    setEditingTitle(false);
    void handleCurrentTitleReset();
  }, [handleCurrentTitleReset]);

  const handleIconDoubleClick = useCallback(() => {
    setShowIconEditor(true);
  }, []);

  const handleIconApply = useCallback(async (draft: IconFieldValue) => {
    if (!state.currentTabId) return;
    try {
      // T7/C1: persist through the shared converter — a recipe stays
      // `type:'template'`, a blank draft clears the layer (`null`).
      const favicon = iconDraftToIconSource(draft);
      await sendMessage('SET_TAB_OVERRIDE', { tabId: state.currentTabId, favicon });
      setToast({ variant: 'success', message: 'Icon updated' });
      // B3: an icon OVERWRITE is undoable too — "I picked the wrong icon" is the
      // same class of mistake as "I cleared the wrong icon".
      pushClearUndo('Icon updated', snapshotOfOwner({ kind: 'override', tabId: state.currentTabId }, 'icon'), [state.currentTabId]);
      await loadState();
      setShowIconEditor(false);
    } catch {
      setToast({ variant: 'error', message: 'Failed to update icon' });
      setShowIconEditor(false);
    }
  }, [state.currentTabId, loadState, pushClearUndo, snapshotOfOwner]);

  const handleCurrentIconReset = useCallback(async () => {
    if (!state.currentTabId) return;
    try {
      // Clear ONLY the icon at the current-page level (favicon → null), preserving
      // any title override. The field chain then falls through to slot → rule → original
      // (equivalent to the dashboard Icon "—").
      await sendMessage('SET_TAB_OVERRIDE', { tabId: state.currentTabId, favicon: null });
      setToast({ variant: 'success', message: 'Icon reset' });
      pushClearUndo('Icon reset', snapshotOfOwner({ kind: 'override', tabId: state.currentTabId }, 'icon'), [state.currentTabId]);
      await loadState();
    } catch {
      setToast({ variant: 'error', message: 'Failed to reset icon' });
    }
  }, [state.currentTabId, loadState, pushClearUndo, snapshotOfOwner]);

  /**
   * G3/D-f: create a tag from the sidebar, through the SAME `CREATE_TAG` message
   * the Tags page uses (one write path — the requirement is that a tag created
   * in place is indistinguishable from one created on the manage page). The tag
   * is persisted IMMEDIATELY, so cancelling the rule form leaves it behind (D-f),
   * which is accepted: it then shows up as an orphan on the Tags page.
   */
  const handleCreateTag = useCallback(async (appearance: { name: string; backgroundColor: string; textColor: string }): Promise<TagDefinition | null> => {
    try {
      const response = await sendMessage('CREATE_TAG', {
        name: appearance.name,
        backgroundColor: appearance.backgroundColor,
        textColor: appearance.textColor,
      }) as { result?: { success: boolean; tag?: TagDefinition }; success?: boolean; tag?: TagDefinition };
      const result = response?.result ?? response;
      if (result?.success && result.tag) {
        await loadState();
        return result.tag;
      }
      setToast({ variant: 'error', message: 'Could not create tag' });
      return null;
    } catch {
      setToast({ variant: 'error', message: 'Could not create tag' });
      return null;
    }
  }, [loadState]);

  const handleCreateGlobalRule = useCallback(async (ruleData: { url: string; matchType: 'exact' | 'regex'; title?: string; favicon?: IconSource; priority: number; tagIds?: string[] }): Promise<{ success: boolean; message?: string; conflictingRuleId?: string }> => {
    try {
      // The rule payload carries NO tag field (A1/R5): a tag written through
      // this request would travel the delivery path. The ORDER below is the
      // contract — the rule first (so a real ruleId exists), tags second.
      const response = await sendMessage('CREATE_RULE', {
        urlMatch: { type: ruleData.matchType, value: ruleData.url },
        priority: ruleData.priority,
        title: ruleData.title || undefined,
        favicon: ruleData.favicon,
      }) as { result?: { success: boolean; message?: string; conflict?: { conflictingRuleId?: string }; rule?: { id: string } }; success?: boolean; message?: string; rule?: { id: string } };
      const result = response?.result ?? response;
      if (result?.success) {
        const newRuleId = (result as { rule?: { id: string } })?.rule?.id;
        // A1: tags are a SECOND, independent write. A failure here must NOT roll
        // the rule back — tags are organisational and do not affect behaviour, so
        // losing them is a smaller harm than losing the rule the user just made.
        if (newRuleId && ruleData.tagIds && ruleData.tagIds.length > 0) {
          try {
            await sendMessage('SET_RULE_TAGS', { ruleId: newRuleId, tagIds: ruleData.tagIds });
          } catch {
            setToast({ variant: 'error', message: 'Rule saved, but tags could not be applied' });
          }
        }
        setShowRuleModal(false);
        setRulePrefill(null);
        setToast({ variant: 'success', message: 'Rule created' });
        await loadState();
        return { success: true };
      }
      // E3/E3b: a create failure is a FIELD/form-level error, reported inline by
      // the modal — NOT a second global error toast (that was defect N6).
      // E2-c: the message is the single shared conflict copy.
      const msg = (result as { message?: string })?.message || 'Failed to create rule';
      return { success: false, message: msg, conflictingRuleId: (result as { conflict?: { conflictingRuleId?: string } })?.conflict?.conflictingRuleId };
    } catch {
      return { success: false, message: 'Failed to create rule' };
    }
  }, [loadState]);

  const handleJumpToLocked = useCallback(async () => {
    if (!state.lockedTabId) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const tab = await chrome.tabs.get(state.lockedTabId);
        await chrome.tabs.update(state.lockedTabId, { active: true });
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to jump to locked tab' });
    }
  }, [state.lockedTabId]);

  // ─── Slot icon/title editing (Problem 7) ───────────────────────────────

  const [slotIconEditorId, setSlotIconEditorId] = useState<number | null>(null);

  // F4: durable element to focus after the slot icon modal closes. Captured
  // from the `⋯` button because the menu item that opens the modal unmounts.
  const slotIconTriggerRef = useRef<HTMLElement | null>(null);

  const handleSlotEditIcon = useCallback((slotId: number, trigger?: HTMLElement | null) => {
    slotIconTriggerRef.current = trigger ?? null;
    setSlotIconEditorId(slotId);
  }, []);

  const handleSlotIconApply = useCallback(async (draft: IconFieldValue) => {
    const slotId = slotIconEditorId;
    if (!slotId) return;
    try {
      // T7/C1: same shared converter — a recipe persists as `type:'template'`.
      await sendMessage('UPDATE_SLOT_UI_MARKER', {
        slotId,
        uiMarker: { icon: iconDraftToIconSource(draft) },
      });
      setToast({ variant: 'success', message: `Slot ${slotId} icon updated` });
      await loadState();
      setSlotIconEditorId(null);
    } catch {
      setToast({ variant: 'error', message: `Failed to update slot ${slotId} icon` });
      setSlotIconEditorId(null);
    }
  }, [slotIconEditorId, loadState]);

  const handleSlotIconReset = useCallback(async () => {
    const slotId = slotIconEditorId;
    if (!slotId) return;
    try {
      // DT11 unification: the slot icon clear writes `null`, never the legacy
      // `{type:'upload', value:''}` shape (the read side still tolerates both).
      await sendMessage('UPDATE_SLOT_UI_MARKER', {
        slotId,
        uiMarker: { icon: null },
      });
      setToast({ variant: 'success', message: `Slot ${slotId} icon cleared` });
      // B4: `slotIconEditorId` is the slot this modal is editing, so the snapshot
      // is taken against exactly the record the clear just wrote.
      pushClearUndo(`Slot ${String(slotId)} icon cleared`, snapshotOfOwner({ kind: 'slot', slotId }, 'icon'));
      await loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to reset slot ${slotId} icon` });
    }
  }, [slotIconEditorId, loadState, pushClearUndo, snapshotOfOwner]);

  /**
   * Items 2 / 6 / 8: "clear this layer" from a chain row — keyed by the RECORD.
   *
   * The address comes from the OWNER, never from the sidebar's current tab: a
   * slot row's chain belongs to the slot's BOUND tab, so resolving the tabId from
   * `state.currentTabId` cleared a different tab's override — which is exactly
   * why the button looked like it did nothing while the value was still there.
   *
   * `rule` and `site` cannot be cleared per field from here (a rule holds both
   * dimensions in one record and a site value is a captured snapshot), so they
   * are reported rather than silently succeeding.
   */
  const handleClearChainTier = useCallback(async (owner: TierOwner, field: 'title' | 'icon') => {
    try {
      if (owner.kind === 'override') {
        await sendMessage('SET_TAB_OVERRIDE', {
          tabId: owner.tabId,
          ...(field === 'title' ? { title: '' } : { favicon: null }),
        });
      } else if (owner.kind === 'slot') {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: owner.slotId,
          uiMarker: field === 'title' ? { customTitle: '' } : { icon: null },
        });
      } else {
        setToast({ variant: 'info', message: `The ${owner.kind} value is managed in Settings, not here.` });
        return;
      }
      setToast({ variant: 'success', message: `${field === 'title' ? 'Title' : 'Icon'} layer cleared` });
      // B6: the owner decides WHICH record and WHICH tier replays — the same
      // single authority this handler already uses to address the write.
      pushClearUndo(
        `${field === 'title' ? 'Title' : 'Icon'} layer cleared`,
        snapshotOfOwner(owner, field),
        owner.kind === 'override' ? [owner.tabId] : [],
      );
      await loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to clear the ${field} layer` });
    }
  }, [loadState, pushClearUndo, snapshotOfOwner]);

  const handleSlotEditTitle = useCallback(async (slotId: number, title: string) => {
    const next = title.trim();
    // Empty input => user did not modify the title => do not record.
    if (!next) return;
    try {
      await sendMessage('UPDATE_SLOT_UI_MARKER', {
        slotId,
        uiMarker: { customTitle: next },
      });
      setToast({ variant: 'success', message: `Slot ${slotId} renamed` });
      void loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to rename slot ${slotId}` });
    }
  }, [loadState]);

  /**
   * Item 5.2: clear ONE dimension of the SLOT layer.
   *
   * Writes the dimension's "unset" form (`customTitle: ''` / `icon: null`), so
   * the field falls through to the next tier rather than being blanked. The
   * background merges per dimension, so the OTHER dimension is untouched.
   */
  const handleSlotClearLayer = useCallback(async (slotId: number, field: 'title' | 'icon') => {
    try {
      await sendMessage('UPDATE_SLOT_UI_MARKER', {
        slotId,
        uiMarker: field === 'title' ? { customTitle: '' } : { icon: null },
      });
      setToast({
        variant: 'success',
        message: field === 'title' ? `Slot ${slotId} title cleared` : `Slot ${slotId} icon cleared`,
      });
      // B5: the ⊘ button on the slot's own layer.
      pushClearUndo(
        field === 'title' ? `Slot ${String(slotId)} title cleared` : `Slot ${String(slotId)} icon cleared`,
        snapshotOfOwner({ kind: 'slot', slotId }, field === 'title' ? 'title' : 'icon'),
      );
      void loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to clear the slot ${field}` });
    }
  }, [loadState, pushClearUndo, snapshotOfOwner]);

  const handleSlotAddToGlobal = useCallback((slotId: number) => {
    const slot = state.sync?.slots.find((s) => s.id === slotId);
    if (!slot) return;
    // Prefill the rule modal with the slot's own data (url value, title, icon, match type)
    setRulePrefill({
      url: slot.urlMatch.value,
      title: slot.uiMarker.customTitle || slot.titleSnapshot || '',
      icon: slot.uiMarker.icon?.value || slot.faviconSnapshot || '',
      // FIX-C (i): carry the slot's ORIGINAL source. The record being copied is
      // the SLOT's own icon — its row DISPLAYS the chain winner, but a "copy
      // this slot to a rule" action copies the slot's own value, so the slot is
      // the owner. Deriving it from the chain would copy the wrong one.
      iconSource: slot.uiMarker.icon ?? null,
      matchType: slot.urlMatch.type,
    });
    setShowRuleModal(true);
  }, [state.sync]);

  const [rulePrefill, setRulePrefill] = useState<{ url: string; title: string; icon: string; iconSource?: IconSource | null; matchType?: 'exact' | 'regex' } | null>(null);

  // ─── Slot URL update (Problem 8: double-click URL edit) ────────────────

  const handleUpdateSlotUrl = useCallback(async (slotId: number, url: string, matchType: 'exact' | 'regex') => {
    // Auto-convert wildcard patterns to a valid regex so slot matching stays consistent
    // with the worker's matchesUrl (Bug 3 fix).
    let urlValue = url.trim();
    if (matchType === 'regex') {
      const conversion = wildcardToRegex(urlValue);
      if (conversion.converted) urlValue = conversion.pattern;
    }
    try {
      const response = await sendMessage('UPDATE_SLOT_URL', { slotId, url: urlValue, matchType }) as { result?: { success: boolean }; success?: boolean };
      const result = response?.result ?? response;
      if (result?.success) {
        setToast({ variant: 'success', message: `Slot ${slotId} URL updated` });
        await loadState();
      } else {
        setToast({ variant: 'error', message: `Failed to update slot ${slotId} URL` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to update slot ${slotId} URL` });
    }
  }, [loadState]);

  // Hand the two writers to the commit path (see `writeSlotEditRef`). Assigned on
  // every render, so the ref always holds the live handler that closes over the
  // current `state` — the commit itself must not close over an old one.
  writeSlotEditRef.current = { title: handleSlotEditTitle, url: handleUpdateSlotUrl };

  // ─── Helper: get shortcut for a slot ───────────────────────────────────

  const getSlotShortcut = useCallback((slotNumber: number, type: 'save' | 'switch'): string | null => {
    const cmdName = `${type}-slot-${slotNumber}`;
    const cmd = commands.find((c) => c.name === cmdName);
    return cmd?.shortcut ?? null;
  }, [commands]);

  // N6: an error is only a BLOCKING condition when there is nothing to show
  // (`sync === null`, i.e. a cold load / Retry failed). A transient refresh
  // failure (`storage.onChanged`, post-save) must not swallow the slot list the
  // user is already looking at — it degrades to a dismissible notice instead.
  const hasLoadedState = state.sync !== null;

  // SC1/A1: the Current Page display is derived from the SINGLE shared chain
  // implementation — the hand-copied chain that used to live here was the defect
  // this iteration removes (it could silently disagree with delivery). These
  // hooks MUST stay above the early returns to preserve hook order.
  const currentChainInput = useMemo(() => {
    if (!state.sync || !state.local || state.currentTabId === null) return null;
    return { sync: state.sync, local: state.local, tabId: state.currentTabId, tabUrl: state.currentTabUrl };
  }, [state.sync, state.local, state.currentTabId, state.currentTabUrl]);

  const titleChain = useMemo(
    () => (currentChainInput ? resolveFieldChain('title', currentChainInput) : null),
    [currentChainInput],
  );
  const faviconChain = useMemo(
    () => (currentChainInput ? resolveFieldChain('favicon', currentChainInput) : null),
    [currentChainInput],
  );

  // Item 1.1: the slot icon editor needs the chain of the slot's BOUND tab (the
  // slot tier only applies to a bound tabId), resolved with the same single
  // implementation every other surface uses. Declared HERE, with the other
  // hooks, because the render below has an early return for the loading state.
  const slotIconChain = useMemo(() => {
    if (slotIconEditorId === null) return null;
    if (!state.sync || !state.local) return null;
    const slot = state.sync.slots.find((s) => s.id === slotIconEditorId);
    if (!slot) return null;
    const binding = state.local.bindings.find((b) => b.slotId === slotIconEditorId);
    return resolveFieldChain('favicon', {
      sync: state.sync,
      local: state.local,
      tabId: binding?.tabId ?? -1,
      tabUrl: slot.urlMatch.value,
    });
  }, [slotIconEditorId, state.sync, state.local]);

  // ─── Render ────────────────────────────────────────────────────────────

  if (state.loading) {
    return (
      <div className="tbs-sidebar" role="application" aria-label="Tab Bookmarks Sidebar" aria-busy="true">
        <p style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  const slots = state.sync?.slots ?? [];
  const bindings = state.local?.bindings ?? [];
  const isLocked = state.lockedTabId !== null;

  /**
   * D24: the ten labels the swap dialog lists above its input. Occupied slots show
   * their title; empty ones SAY they are empty, because "the target is empty" is
   * exactly the case where a swap MOVES rather than exchanges (D3).
   */
  const slotLabels = Array.from({ length: 10 }, (_, i) => {
    const record = slots.find((s) => s.id === i + 1);
    if (!record) return 'Empty';
    return record.uiMarker.customTitle || record.titleSnapshot || record.urlMatch.value || 'Empty';
  });

  // The chain's `site` tier is not captured from the sidebar, so the site value
  // falls back to the reported tab title/favicon (`—` when neither is known).
  const displayCurrentTitle = titleChain
    ? (titleChain.winner.value ?? titleChain.tiers.site.value ?? state.currentTabTitle)
    : state.currentTabTitle;
  const displayCurrentFavicon = faviconChain
    ? (faviconChain.winner.value ?? faviconChain.tiers.site.value ?? state.currentTabFavicon)
    : state.currentTabFavicon;
  // FIX-C: the winning tier's STORED source, so the icon picker seeds a recipe
  // as a recipe. Absent when the winner is the site tier (nothing stored).
  const currentPageIconSource = faviconChain
    ? iconSourceForOwner(faviconChain.nodes.find((n) => n.winner)?.owner, {
        slots: state.sync?.slots ?? [],
        rules: state.sync?.rules ?? [],
        tabOverrides: state.local?.tabOverrides ?? [],
      })
    : null;
  /**
   * FIX-C (i): the SAME owner→source resolution, exposed to the icon modal so a
   * `Use chain` of a recipe record copies the recipe (not its render).
   */
  const resolveSourceForOwner = (owner: TierOwner): IconSource | null =>
    iconSourceForOwner(owner, {
      slots: state.sync?.slots ?? [],
      rules: state.sync?.rules ?? [],
      tabOverrides: state.local?.tabOverrides ?? [],
    });

  // Built once, then conditionally wrapped in the source popover. The favicon is
  // already a focus stop (`role="button" tabIndex=0`), so its wrapper does not
  // add a second one — `:focus-within` still opens the popover.
  const faviconEl = (
    <span
      className="tbs-sidebar__current-favicon-wrapper"
      onDoubleClick={handleIconDoubleClick}
      title="Double-click to change icon"
      role="button"
      aria-label="Change tab icon (double-click)"
      tabIndex={0}
    >
      {displayCurrentFavicon ? (
        <img className="tbs-sidebar__current-favicon" src={displayCurrentFavicon} alt="" />
      ) : (
        <span className="tbs-sidebar__current-favicon tbs-sidebar__current-favicon--placeholder">🌐</span>
      )}
    </span>
  );

  const currentTitleEl = (
    <span
      className="tbs-sidebar__current-title"
      title={`${displayCurrentTitle} (double-click to rename)`}
      onDoubleClick={handleTitleDoubleClick}
    >
      {displayCurrentTitle || 'No active tab'}
    </span>
  );

  return (
    <div role="application" aria-label="Tab Bookmarks Sidebar" className="tbs-sidebar">
      {/* Header: current context */}
      <header className="tbs-sidebar__header">
        <button
          className="tbs-sidebar__collapse-toggle"
          onClick={() => { setCollapsed(!collapsed); }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand current page section' : 'Collapse current page section'}
        >
          {collapsed ? '▶' : '▼'} Current Page
        </button>

        <IconButton
          aria-label={isLocked ? 'Unlock tab tracking' : 'Lock to current tab'}
          onClick={handleLockToggle}
          size="sm"
        >
          {isLocked ? '🔒' : '🔓'}
        </IconButton>
      </header>

      {/* Current page summary (collapsible) — Problem 3 redesign */}
      {!collapsed && (
        <section className="tbs-sidebar__current" aria-label="Current page">
          <div className="tbs-sidebar__current-row">
            {/* Double-click favicon → icon editor. Item 4.1 + review: the source
                popover hangs off the favicon itself, so hovering the icon shows
                where the value came from (no separate trigger dot). The favicon
                is already a focus stop, so the wrapper is not one too. */}
            {faviconChain
              ? (
                <SlotSourceBadge
                  chain={faviconChain}
                  variant="icon"
                  field="icon"
                  self={state.currentTabId !== null ? { kind: 'override', tabId: state.currentTabId } : null}
                  tabId={state.currentTabId}
                  triggerFocusable={false}
                >
                  {faviconEl}
                </SlotSourceBadge>
              )
              : faviconEl}

            {/* Double-click title → inline rename */}
            {editingTitle ? (
              <>
                <div className="tbs-inline-field">
                  <input
                    ref={titleInputRef}
                    className="tbs-sidebar__title-input"
                    type="text"
                    value={titleDraft}
                    onChange={(e) => { setTitleDraft(e.target.value); }}
                    onBlur={handleTitleSave}
                    onKeyDown={handleTitleKeyDown}
                    aria-label="Rename current tab"
                  />
                  {/* Item 4: `onMouseDown` suppressed so the focus never leaves
                      the input — the box stays open on the restored text. */}
                  <button
                    type="button"
                    className="tbs-inline-field__reset"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); handleCurrentTitleResetDraft(); }}
                    disabled={titleDraft === currentTitleInitial}
                    aria-label="Reset current page title"
                    title="Reset title"
                  >
                    ↺
                  </button>
                  {/* Item 4: clear the OVERRIDE layer's value only, so the title
                      falls back to slot > rule > site — same write as the
                      `Clear` entry in the `Use chain` list. */}
                  <button
                    type="button"
                    className="tbs-inline-field__reset"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); handleCurrentTitleClearLayer(); }}
                    aria-label="Clear the page title override"
                    title="Clear this layer"
                  >
                    ⊘
                  </button>
                </div>
                {/* Item 5: every record that describes this tab, no clear buttons. */}
                <MaskedSummary
                  nodes={titleChain?.nodes ?? []}
                  field="title"
                  onJumpToOwner={() => undefined}
                  selfOwner={state.currentTabId !== null ? { kind: 'override', tabId: state.currentTabId } : null}
                  tabId={state.currentTabId}
                  fieldLabel="Title"
                  idPrefix="current-title"
                />
              </>
            ) : (
              <>
                {/* Item 4.1 + review: the DISPLAY title carries its winning
                    source, and the title text itself is the hover target. */}
                {titleChain
                  ? (
                    <SlotSourceBadge
                      chain={titleChain}
                      variant="title"
                      field="title"
                      self={state.currentTabId !== null ? { kind: 'override', tabId: state.currentTabId } : null}
                      tabId={state.currentTabId}
                    >
                      {currentTitleEl}
                    </SlotSourceBadge>
                  )
                  : currentTitleEl}
              </>
            )}
          </div>

          {/* Item 4: the URL is double-click editable, with a `↺` that restores the
              value captured when the editor opened (no Match Type — a live tab
              has no stored pattern). */}
          {state.currentTabUrl && !editingCurrentUrl && (
            <p
              className="tbs-sidebar__current-url"
              title={`${state.currentTabUrl} (double-click to edit)`}
              onDoubleClick={startCurrentUrlEdit}
            >
              {state.currentTabUrl}
            </p>
          )}
          {editingCurrentUrl && (
            <div className="tbs-sidebar__current-url-edit">
              <div className="tbs-inline-field">
                <input
                  ref={currentUrlInputRef}
                  type="text"
                  className="tbs-sidebar__current-url-input"
                  value={currentUrlDraft}
                  onChange={(e) => { setCurrentUrlDraft(e.target.value); }}
                  onKeyDown={handleCurrentUrlKeyDown}
                  aria-label="Edit current page URL"
                />
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onClick={() => { setCurrentUrlDraft(currentUrlInitial); }}
                  disabled={currentUrlDraft === currentUrlInitial}
                  aria-label="Reset current page URL"
                  title="Reset URL"
                >
                  ↺
                </button>
              </div>
            </div>
          )}

          {/* Action buttons row */}
          <div className="tbs-sidebar__current-actions">
            <Tooltip content="Save as global page rule">
              <IconButton size="sm" aria-label="Add to global rules" onClick={() => {
                // Problem 6: Prefill with current page data (including overrides)
                setRulePrefill({
                  url: state.currentTabUrl,
                  title: displayCurrentTitle || state.currentTabTitle,
                  icon: displayCurrentFavicon || state.currentTabFavicon,
                  // FIX-C (i): carry the chain winner's STORED source (already
                  // computed) so a winning recipe/upload reopens as itself.
                  iconSource: currentPageIconSource,
                });
                setShowRuleModal(true);
              }}>
                ＋
              </IconButton>
            </Tooltip>
            <span className="tbs-sidebar__current-status">
              {isLocked ? '🔒 Locked' : '👁 Following'}
              {/* Locked state: jump button always visible (Problem 4) */}
              {isLocked && (
                <Tooltip content="Jump to locked tab">
                  <Button size="sm" variant="ghost" onClick={handleJumpToLocked} aria-label="Jump to locked tab" className="tbs-sidebar__jump-btn">
                    ↗
                  </Button>
                </Tooltip>
              )}
              {/* Current-page prev/next match cycling (same as slot prev/next) */}
              <Button
                size="sm"
                variant="ghost"
                className="tbs-sidebar__match-btn"
                onClick={() => void handleCurrentPrevMatch()}
                aria-label="Switch to previous matching tab for current page"
                title="Switch to previous matching tab"
              >
                ⤺
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="tbs-sidebar__match-btn"
                onClick={() => void handleCurrentNextMatch()}
                aria-label="Switch to next matching tab for current page"
                title="Switch to next matching tab"
              >
                ↻
              </Button>
              {/* Position (↑/↓) — BY POSITION, not by match (D7 / BLK-A / A1).
                  The start point is the locked tab when locked, else the current
                  tab; a closed lock degrades in the background without error. */}
              <Button
                size="sm"
                variant="ghost"
                className="tbs-sidebar__position-btn"
                onClick={() => void handlePositionPrev()}
                aria-label="Switch to previous position tab"
                title="Switch to previous position tab"
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="tbs-sidebar__position-btn"
                onClick={() => void handlePositionNext()}
                aria-label="Switch to next position tab"
                title="Switch to next position tab"
              >
                ↓
              </Button>
              {/* Item 4: the SAME `⋯` menu the slots offer, to the right of `↓`. */}
              <span className="tbs-sidebar__current-menu" ref={currentMenuRef}>
                <IconButton
                  size="sm"
                  aria-label="More options for the current page"
                  onClick={(e) => {
                    e.stopPropagation();
                    currentMoreButtonRef.current = e.currentTarget;
                    setCurrentMenuOpen((prev) => !prev);
                  }}
                >
                  ⋯
                </IconButton>
                {currentMenuOpen && (
                  <div className="tbs-slot-menu" role="menu" aria-label="Current page actions">
                    <button
                      className="tbs-slot-menu__item"
                      role="menuitem"
                      onClick={(e) => { e.stopPropagation(); setCurrentMenuOpen(false); handleTitleDoubleClick(); }}
                    >
                      Rename Title…
                    </button>
                    <button
                      className="tbs-slot-menu__item"
                      role="menuitem"
                      onClick={(e) => { e.stopPropagation(); setCurrentMenuOpen(false); setShowIconEditor(true); }}
                    >
                      Change Icon…
                    </button>
                    <button
                      className="tbs-slot-menu__item"
                      role="menuitem"
                      onClick={(e) => { e.stopPropagation(); setCurrentMenuOpen(false); startCurrentUrlEdit(); }}
                    >
                      Edit URL…
                    </button>
                  </div>
                )}
              </span>
            </span>
          </div>
        </section>
      )}

      {/* Icon editor inline modal (Problem 3a) — P4: always mounted so Dialog
          can restore focus to the trigger on close. */}
      <IconEditorModal
        open={showIconEditor}
        onApply={handleIconApply}
        onCancel={() => { setShowIconEditor(false); }}
        onReset={handleCurrentIconReset}
        // FIX-C: the winning tier's SOURCE (so a recipe reopens as a recipe); falls
        // back to the display string when that tier stores no source (site).
        initialIcon={currentPageIconSource ?? (displayCurrentFavicon || undefined)}
        // Item 1.1: the LIVE current-page chain — `override > slot > rule > site`
        // resolved for this tab, so `Use chain` shows real data (item 2.3).
        {...(faviconChain ? { chain: faviconChain } : {})}
        // Item 1.3: clear the page layer this picker writes to.
        onClearLayer={() => { void handleCurrentIconReset(); }}
        onClearTier={(owner) => { void handleClearChainTier(owner, 'icon'); }}
        resolveSourceForOwner={resolveSourceForOwner}
        {...(state.currentTabId !== null ? { selfOwner: { kind: 'override', tabId: state.currentTabId } } : {})}
        {...(state.currentTabId !== null ? { tabId: state.currentTabId } : {})}
      />

      {/* Slot icon editor (Problem 7) */}
      <IconEditorModal
        open={slotIconEditorId !== null}
        onApply={handleSlotIconApply}
        onCancel={() => { setSlotIconEditorId(null); }}
        onReset={handleSlotIconReset}
        returnFocusRef={slotIconTriggerRef}
        // FIX-C: the slot's own stored source (source-aware).
        initialIcon={(() => {
          const s = state.sync?.slots.find((sl) => sl.id === slotIconEditorId);
          return s?.uiMarker.icon ?? (s?.faviconSnapshot || undefined);
        })()}
        // The slot's own chain: its binding's tab, so the tiers are the ones the
        // bound page actually resolves to.
        {...(slotIconChain ? { chain: slotIconChain } : {})}
        onClearLayer={() => { void handleSlotIconReset(); }}
        onClearTier={(owner) => { void handleClearChainTier(owner, 'icon'); }}
        resolveSourceForOwner={resolveSourceForOwner}
        {...(slotIconEditorId !== null ? { selfOwner: { kind: 'slot', slotId: slotIconEditorId } } : {})}
        {...(() => {
          // The slot's chain belongs to its BOUND tab, so Page rows must name
          // that tabId rather than the slot's own number.
          const bound = state.local?.bindings.find((b) => b.slotId === slotIconEditorId);
          return bound ? { tabId: bound.tabId } : {};
        })()}
      />

      {/* Global rule creation modal (Problem 3c / 5 / 7) */}
      <CreateRuleModal
        open={showRuleModal}
        // G3/D-f: the tag table to choose from, and the create-in-place hook —
        // both flow through the ONE `TagService` write path (`CREATE_TAG`), so a
        // tag made from the sidebar is indistinguishable from one made on the
        // Tags page.
        availableTags={state.sync?.tags ?? []}
        onCreateTag={handleCreateTag}
        defaultUrl={rulePrefill ? rulePrefill.url : state.currentTabUrl}
        defaultTitle={rulePrefill ? rulePrefill.title : ''}
        defaultIcon={rulePrefill ? rulePrefill.icon : ''}
        defaultIconSource={rulePrefill?.iconSource ?? null}
        defaultMatchType={rulePrefill ? rulePrefill.matchType : undefined}
        // Item 2.2 / 2.3: the live chains, so `Use chain` shows real tier data.
        {...(titleChain ? { titleChain } : {})}
        {...(faviconChain ? { iconChain: faviconChain } : {})}
        onClearTier={(owner, field) => { void handleClearChainTier(owner, field); }}
        resolveSourceForOwner={resolveSourceForOwner}
        onSave={handleCreateGlobalRule}
        onCancel={() => { setShowRuleModal(false); setRulePrefill(null); }}
      />

      {/* N6: non-blocking notice for a refresh failure that kept the list.
          `role="status"` (polite) — not `role="alert"` — so it never competes
          with the blocking P3 panel above. */}
      {state.error && hasLoadedState && (
        <div role="status" aria-live="polite" className="tbs-sidebar__stale-notice">
          <span>{state.error} — showing the last loaded slots.</span>
          <Button size="sm" variant="ghost" aria-label="Retry loading state" onClick={() => { void loadState(); }}>
            Retry
          </Button>
        </div>
      )}

      {/* 10-slot list — P3: a failed load replaces the LIST with an explicit
          error + Retry, instead of rendering 10 rows labelled "Empty". The
          error branch must precede the `slots` fallback so the empty rows are
          never produced; the surrounding shell (and its footer navigation)
          stays intact.
          N6: that substitution applies only when NOTHING was loaded yet. Once a
          list exists, a transient refresh failure keeps the list and surfaces a
          non-blocking notice instead (the alert/Retry panel would otherwise
          discard good data on a single flaky background write). */}
      <section className="tbs-sidebar__slots" aria-label="Bookmark slots">
        {state.error && !hasLoadedState ? (
          <div role="alert" className="tbs-sidebar__error">
            <p>{state.error}</p>
            <Button size="sm" variant="primary" onClick={() => { void loadState(); }}>Retry</Button>
          </div>
        ) : (
        <div role="list" aria-label="10 bookmark slots">
          {Array.from({ length: 10 }, (_, i) => {
            const slotNumber = i + 1;
            const slot = slots.find((s) => s.id === slotNumber);
            const binding = bindings.find((b) => b.slotId === slotNumber);
            const shortcut = getSlotShortcut(slotNumber, 'switch');

            // SC1/A1: the bound slot's resolved values come from the SAME shared chain as
// the Current Page and the dashboard. The slot tier only applies when a binding
// matches the tabId (strictly tabId-scoped), so a bound slot resolves
// override > slot > rule > site with one implementation.
            let resolvedTitle: string | undefined;
            let resolvedIcon: string | undefined;
            // Item 5.2: hand the row the SAME resolved chain the value came from,
            // so its source badge / masking note can never disagree with the text.
            let rowTitleChain: ChainResult | undefined;
            let rowIconChain: ChainResult | undefined;
            if (slot) {
              if (binding && state.sync && state.local) {
                const chainInput = {
                  sync: state.sync,
                  local: state.local,
                  tabId: binding.tabId,
                  tabUrl: slot.urlMatch.value,
                };
                rowTitleChain = resolveFieldChain('title', chainInput);
                rowIconChain = resolveFieldChain('favicon', chainInput);
                resolvedTitle = rowTitleChain.winner.value
                  ?? slot.uiMarker.customTitle
                  ?? slot.titleSnapshot
                  ?? undefined;
                resolvedIcon = rowIconChain.winner.value
                  ?? slot.uiMarker.icon?.value
                  ?? slot.faviconSnapshot
                  ?? undefined;
              } else {
                // Unbound slot: there is no page to chain for, so the slot's own
                // configured marker/snapshot is the value shown.
                resolvedTitle = slot.uiMarker.customTitle ?? slot.titleSnapshot ?? undefined;
                resolvedIcon = slot.uiMarker.icon?.value ?? slot.faviconSnapshot ?? undefined;
              }
            }

            return (
              <SlotRow
                key={slotNumber}
                slotNumber={slotNumber}
                slot={slot}
                binding={binding}
                shortcut={shortcut}
                resolvedTitle={resolvedTitle}
                resolvedIcon={resolvedIcon}
                onSwitch={handleSwitch}
                onNextMatch={handleNextMatch}
                onPrevMatch={handlePrevMatch}
                onSave={handleSave}
                onUnbind={handleUnbind}
                onEditIcon={handleSlotEditIcon}
                onAddToGlobal={handleSlotAddToGlobal}
                onSwap={handleSwap}
                swapPending={swapPending}
                onSwapHover={handleSwapHover}
                swapHint={swapHint}
                swapHintAnchor={swapPending?.source ?? null}
                slotLabels={slotLabels}
                // The inline editor is owned by the LIST, so a swap can hand it to
                // the slot the data moved to (see `SlotRowProps.edit`).
                edit={slotEdit}
                editToken={slotEditToken}
                iconEditorOpen={slotIconEditorId === slotNumber}
                onEditStart={handleSlotEditStart}
                onEditDraft={handleSlotEditDraft}
                onEditMatchType={handleSlotEditMatchType}
                onEditCommit={handleSlotEditCommit}
                onEditCancel={handleSlotEditCancel}
                onEditReset={handleSlotEditReset}
                // Item 5.2: per-layer clear for the slot tier.
                onClearLayer={(field) => { void handleSlotClearLayer(slotNumber, field); }}
                {...(rowTitleChain ? { titleChain: rowTitleChain } : {})}
                {...(rowIconChain ? { iconChain: rowIconChain } : {})}
              />
            );
          })}
        </div>
        )}
      </section>

      {/* U1/T8: the SHARED stack, rendered as several stacked bars — each with
          its own Undo button (`onUndo` carries the entry id) and its own
          countdown (`onExpire` carries the id, leaving the others untouched). */}
      <SharedUndoBar
        entries={undoStack.entries}
        blockedIds={undoStack.blocked}
        onUndo={(id) => { handleUndo(id); }}
        onExpire={(id) => { undoStack.expire(id); }}
      />

      {/* Toast */}
      {toast && (
        <Toast
          variant={toast.variant}
          message={toast.message}
          onDismiss={() => { setToast(null); }}
        />
      )}

      {/* Footer: navigation entries (Problem 1) */}
      <footer className="tbs-sidebar__footer">
        <Button size="sm" variant="ghost" aria-label="Open settings" onClick={handleOpenSettings}>⚙ Settings</Button>
        <Button size="sm" variant="ghost" aria-label="Import or export" onClick={handleOpenImportExport}>↕ Import/Export</Button>
        <Button size="sm" variant="ghost" aria-label="View diagnostics" onClick={handleOpenDiagnostics}>📊 Diagnostics</Button>
      </footer>
    </div>
  );
}
