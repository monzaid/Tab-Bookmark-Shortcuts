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
import type { SlotDefinition, SlotBinding, SyncState, LocalState, IconSource } from '@shared/types';
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

interface UndoState {
  slotId: number;
  previousSlot: SlotDefinition | null;
  expiresAt: number;
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
  onEditTitle: (slotId: number, title: string) => void;
  onAddToGlobal: (slotId: number) => void;
  onUpdateUrl: (slotId: number, url: string, matchType: 'exact' | 'regex') => void;
  /**
   * Clear the SLOT layer only, leaving the tab override / rule / site tiers
   * intact (item 5.2: clearing is per-layer, not per-field-value).
   */
  onClearLayer?: (field: 'title' | 'icon') => void;
}

function SlotRow({ slotNumber, slot, binding: _binding, shortcut, resolvedTitle, resolvedIcon, onSwitch, onNextMatch, onPrevMatch, onSave, onUnbind, onEditIcon, onEditTitle, onAddToGlobal, onUpdateUrl, titleChain, iconChain, onClearLayer }: SlotRowProps) {
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleInitial, setTitleInitial] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  // Item 5.1: the value captured when the URL editor opened, so `↺` can restore it.
  const [urlInitial, setUrlInitial] = useState('');
  const [urlMatchType, setUrlMatchType] = useState<'exact' | 'regex'>('exact');
  // P2: deletion is destructive, so it must pass through a confirmation first.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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

  const handleClick = () => {
    if (isBound && !editingTitle && !editingUrl) {
      onSwitch(slotNumber);
    }
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
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
    const current = slot?.uiMarker.customTitle || slot?.titleSnapshot || '';
    setTitleDraft(current);
    // Remember the pre-edit value so an unchanged save is treated as "no change".
    setTitleInitial(current);
    // Review item 4: clear any suppression left over from the previous session,
    // so a real commit is never swallowed.
    suppressTitleCommit.current = false;
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const handleTitleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTitleEdit();
  };

  const handleTitleSave = () => {
    // Review item 4: a commit arriving from a button-induced blur must not undo
    // what that button just did.
    if (suppressTitleCommit.current) {
      suppressTitleCommit.current = false;
      return;
    }
    setEditingTitle(false);
    const next = titleDraft.trim();
    // Empty or unchanged input = user did not modify the title → do not record.
    if (!next || next === titleInitial) return;
    onEditTitle(slotNumber, next);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') handleTitleSave();
    if (e.key === 'Escape') setEditingTitle(false);
  };

  /** Review item 4: `↺` restores the opened text and KEEPS the box open. */
  const handleResetTitleDraft = () => {
    suppressTitleCommit.current = true;
    setTitleDraft(titleInitial);
  };

  /** Review item 4: `⊘` clears the SLOT layer's title (same write as `Use chain`). */
  const handleClearTitleLayer = () => {
    suppressTitleCommit.current = true;
    setEditingTitle(false);
    onClearLayer?.('title');
  };

  // Problem 8 / P8: double-click URL to edit — shared with the `⋯` menu entry.
  const startUrlEdit = () => {
    if (!isBound || !slot) return;
    setUrlDraft(slot.urlMatch.value);
    setUrlInitial(slot.urlMatch.value);
    setUrlMatchType(slot.urlMatch.type);
    setEditingUrl(true);
    setTimeout(() => urlInputRef.current?.focus(), 0);
  };

  const handleUrlDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startUrlEdit();
  };

  const handleUrlSave = () => {
    setEditingUrl(false);
    if (urlDraft.trim()) {
      onUpdateUrl(slotNumber, urlDraft.trim(), urlMatchType);
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') handleUrlSave();
    if (e.key === 'Escape') setEditingUrl(false);
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
      onDoubleClick={(e) => { e.stopPropagation(); if (isBound) onEditIcon(slotNumber); }}
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
    >
      {displayTitle}
    </span>
  );

  return (
    <div
      ref={rowRef}
      className={`tbs-slot-row${isBound ? ' tbs-slot-row--bound' : ''}`}
      role="listitem"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      aria-label={`Slot ${slotNumber}: ${displayTitle} (${statusText})`}
    >
      {/* Left color bar */}
      <span className="tbs-slot-row__color-bar" style={{ background: colorVar }} aria-hidden="true" />

      {/* Number */}
      <span className="tbs-slot-row__number" aria-hidden="true">{slotNumber}</span>

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
                onChange={(e) => { setTitleDraft(e.target.value); }}
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
                onChange={(e) => { setUrlDraft(e.target.value); }}
                onKeyDown={handleUrlKeyDown}
                aria-label={`Edit URL for slot ${slotNumber}`}
              />
              {/* Item 5.1: reset the URL back to the value captured when the
                  editor opened — same control as the Match URL field. */}
              <button
                type="button"
                className="tbs-inline-field__reset"
                onClick={() => { setUrlDraft(urlInitial); }}
                disabled={urlDraft === urlInitial}
                aria-label={`Reset URL for slot ${slotNumber}`}
                title="Reset URL"
              >
                ↺
              </button>
            </div>
            <div className="tbs-slot-row__url-match-type" role="radiogroup" aria-label="Match type">
              <label>
                <input type="radio" name={`url-match-${slotNumber}`} checked={urlMatchType === 'exact'} onChange={() => { setUrlMatchType('exact'); }} />
                Exact
              </label>
              <label>
                <input type="radio" name={`url-match-${slotNumber}`} checked={urlMatchType === 'regex'} onChange={() => { setUrlMatchType('regex'); }} />
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

interface SidebarUndoAdapters {
  undo: UndoState;
  onUndo: () => void;
  onExpire: () => void;
}

function SidebarUndoBar({ undo, onUndo, onExpire }: SidebarUndoAdapters) {
  const sharedState = useMemo<SharedUndoState>(
    () => ({
      message: `Slot ${undo.slotId} overwritten`,
      // The sidebar's slot-overwrite undo is a batch of exactly one write; the
      // shared snapshot model keeps the atomic-replay contract identical.
      snapshot: { writes: [{ kind: 'slot-marker', slotId: undo.slotId }], affectedTabIds: [] },
      expiresAt: undo.expiresAt,
    }),
    [undo.slotId, undo.expiresAt],
  );

  return (
    <SharedUndoBar
      state={sharedState}
      onUndo={() => { onUndo(); }}
      onExpire={onExpire}
    />
  );
}

// ─── Icon Editor Modal (uses reusable IconEditor component) ─────────────────

import type { IconConfig } from '@ui/components/IconEditor';
import { IconFieldEditor } from '@ui/shared/icon-field-editor';
import type { IconFieldValue } from '@ui/shared/icon-field-editor';
import { canonicalIconSource, iconDraftToIconSource, iconSourceForOwner, iconSourceToDraft, iconSourceToIconConfig } from '@ui/shared/icon-source';
import { wildcardToRegex } from '@shared/url-utils';
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
import { UndoBar as SharedUndoBar } from '@ui/shared/undo-bar';
import type { UndoState as SharedUndoState } from '@ui/shared/undo-bar';

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
    sync: { configVersion: 0, matchSettings: DEFAULT_MATCH_SETTINGS, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
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
  onSave: (data: { url: string; matchType: 'exact' | 'regex'; title?: string; favicon?: IconSource; priority: number }) => Promise<{ success: boolean; message?: string }>;
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
 * Uses `iconSourceToIconConfig`, NOT `iconSourceToDraft`/`fromIconFieldValue`:
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
  if (src) {
    if (src.type === 'template' || src.type === 'upload') {
      return { mode: { kind: 'set', value: '' }, iconConfig: iconSourceToIconConfig(src) };
    }
    return { mode: { kind: 'set', value: src.value } };
  }
  // No stored source: the value's shape is the LAST RESORT here — only ever
  // reached AFTER the source branch above, never instead of it (that inversion
  // is the C1 bug).
  if (!fallback) return { mode: { kind: 'use-chain' } };
  return fallback.startsWith('data:')
    ? { mode: { kind: 'set', value: '' }, iconConfig: { dataUri: fallback } }
    : { mode: { kind: 'set', value: fallback } };
}

function CreateRuleModal({ open, defaultUrl, defaultTitle = '', defaultIcon = '', defaultIconSource = null, defaultMatchType, titleChain: liveTitleChain, iconChain: liveIconChain, onClearTier, resolveSourceForOwner, onSave, onCancel }: CreateRuleModalProps) {
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setUrl(defaultUrl);
    setMatchType(defaultMatchType ?? 'exact');
    setTitleMode(defaultTitle ? { kind: 'set', value: defaultTitle } : { kind: 'use-chain' });
    const seeded = seedIconFrom(defaultIconSource, defaultIcon);
    setIconMode(seeded.mode);
    setIconConfig(seeded.iconConfig);
    setPriority(0);
    setSaving(false);
    setSaveError(null);
  }, [open, defaultUrl, defaultTitle, defaultIcon, defaultIconSource, defaultMatchType]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const draft: RuleDraftValue = { url, matchType, titleMode, iconMode, iconConfig, priority };
    const validation = validateRuleDraft(draft);
    if (!validation.valid) {
      setSaveError(validation.errors[0]?.message ?? 'Invalid form');
      return;
    }

    // Shared normalisation (regex conversion / clamp / DT5 mode model). T7/C1:
    // the modal hands over the WHOLE IconSource (a recipe stays `type:'template'`)
    // so the caller persists it unchanged — no data-URI flattening here.
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
  }, [url, matchType, titleMode, iconConfig, iconMode, priority, onSave, saving]);

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
        }}
        onChange={(patch) => {
          if (patch.url !== undefined) setUrl(patch.url);
          if (patch.matchType !== undefined) setMatchType(patch.matchType);
          if (patch.titleMode !== undefined) setTitleMode(patch.titleMode);
          if (patch.iconMode !== undefined) setIconMode(patch.iconMode);
          if (patch.iconConfig !== undefined) setIconConfig(patch.iconConfig);
          if (patch.priority !== undefined) setPriority(patch.priority);
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
  const [undo, setUndo] = useState<UndoState | null>(null);
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

  const handleSave = useCallback(async (slotId: number) => {
    try {
      const sync = state.sync;
      const existingSlot = sync?.slots.find((s) => s.id === slotId);

      const response = await sendMessage('SAVE_SLOT', {
        slotId,
        urlMatch: { type: 'exact', value: state.currentTabUrl },
        titleSnapshot: state.currentTabTitle,
        faviconSnapshot: state.currentTabFavicon,
      }) as { result?: { success: boolean }; success?: boolean };

      const result = response?.result ?? response;
      if (result?.success) {
        if (existingSlot) {
          setUndo({
            slotId,
            previousSlot: existingSlot,
            expiresAt: Date.now() + 5000,
          });
        }
        setToast({ variant: 'success', message: `Saved to slot ${slotId}` });
        void loadState();
      } else {
        setToast({ variant: 'error', message: `Failed to save slot ${slotId}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to save slot ${slotId}` });
    }
  }, [state.sync, state.currentTabUrl, state.currentTabTitle, state.currentTabFavicon, loadState]);

  const handleUnbind = useCallback(async (slotId: number) => {
    try {
      // T26 (N3): a rejected write must not be reported as success.
      const result = (await sendMessage('UNBIND_SLOT', { slotId })) as
        | { success?: boolean; result?: { success?: boolean } }
        | undefined;
      const ok = result?.result?.success ?? result?.success ?? false;
      if (ok) {
        setToast({ variant: 'info', message: `Slot ${String(slotId)} deleted` });
        void loadState();
      } else {
        setToast({ variant: 'error', message: `Failed to delete slot ${String(slotId)}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to delete slot ${String(slotId)}` });
    }
  }, [loadState]);

  const handleUndo = useCallback(async () => {
    if (!undo?.previousSlot) return;
    try {
      // T26 (N3): same contract — only claim the undo succeeded if it did.
      const result = (await sendMessage('UNDO_SAVE', { slotId: undo.slotId })) as
        | { success?: boolean; result?: { success?: boolean } }
        | undefined;
      const ok = result?.result?.success ?? result?.success ?? false;
      if (ok) {
        setUndo(null);
        setToast({ variant: 'info', message: `Undo: slot ${String(undo.slotId)} restored` });
        void loadState();
      } else {
        setToast({ variant: 'error', message: 'Undo failed' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Undo failed' });
    }
  }, [undo, loadState]);

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
      void loadState();
    } catch {
      setToast({ variant: 'error', message: 'Failed to reset title' });
    }
  }, [state.currentTabId, loadState]);

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
      await loadState();
      setShowIconEditor(false);
    } catch {
      setToast({ variant: 'error', message: 'Failed to update icon' });
      setShowIconEditor(false);
    }
  }, [state.currentTabId, loadState]);

  const handleCurrentIconReset = useCallback(async () => {
    if (!state.currentTabId) return;
    try {
      // Clear ONLY the icon at the current-page level (favicon → null), preserving
      // any title override. The field chain then falls through to slot → rule → original
      // (equivalent to the dashboard Icon "—").
      await sendMessage('SET_TAB_OVERRIDE', { tabId: state.currentTabId, favicon: null });
      setToast({ variant: 'success', message: 'Icon reset' });
      await loadState();
    } catch {
      setToast({ variant: 'error', message: 'Failed to reset icon' });
    }
  }, [state.currentTabId, loadState]);

  const handleCreateGlobalRule = useCallback(async (ruleData: { url: string; matchType: 'exact' | 'regex'; title?: string; favicon?: IconSource; priority: number }): Promise<{ success: boolean; message?: string; conflictingRuleId?: string }> => {
    try {
      const response = await sendMessage('CREATE_RULE', {
        urlMatch: { type: ruleData.matchType, value: ruleData.url },
        priority: ruleData.priority,
        title: ruleData.title || undefined,
        favicon: ruleData.favicon,
      }) as { result?: { success: boolean; message?: string; conflict?: { conflictingRuleId?: string } }; success?: boolean; message?: string };
      const result = response?.result ?? response;
      if (result?.success) {
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
      await loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to reset slot ${slotId} icon` });
    }
  }, [slotIconEditorId, loadState]);

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
      await loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to clear the ${field} layer` });
    }
  }, [loadState]);

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
      void loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to clear the slot ${field}` });
    }
  }, [loadState]);

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
                onEditTitle={handleSlotEditTitle}
                onAddToGlobal={handleSlotAddToGlobal}
                onUpdateUrl={handleUpdateSlotUrl}
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

      {/* Undo bar */}
      {undo && (
        <SidebarUndoBar undo={undo} onUndo={handleUndo} onExpire={() => { setUndo(null); }} />
      )}

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
