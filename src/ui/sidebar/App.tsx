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

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { SlotDefinition, SlotBinding, SyncState, LocalState } from '@shared/types';
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

interface SlotRowProps {
  slotNumber: number;
  slot: SlotDefinition | undefined;
  binding: SlotBinding | undefined;
  shortcut: string | null;
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
  onResetTitle: (slotId: number) => void;
  onAddToGlobal: (slotId: number) => void;
  onUpdateUrl: (slotId: number, url: string, matchType: 'exact' | 'regex') => void;
}

function SlotRow({ slotNumber, slot, binding: _binding, shortcut, resolvedTitle, resolvedIcon, onSwitch, onNextMatch, onPrevMatch, onSave, onUnbind, onEditIcon, onEditTitle, onResetTitle, onAddToGlobal, onUpdateUrl }: SlotRowProps) {
  const isBound = !!slot;
  const isEmpty = !slot;
  const colorVar = SLOT_COLORS[slotNumber - 1] ?? 'var(--slot-1)';
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleInitial, setTitleInitial] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlMatchType, setUrlMatchType] = useState<'exact' | 'regex'>('exact');
  // P2: deletion is destructive, so it must pass through a confirmation first.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const handleTitleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTitleEdit();
  };

  const handleTitleSave = () => {
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

  // Problem 8 / P8: double-click URL to edit — shared with the `⋯` menu entry.
  const startUrlEdit = () => {
    if (!isBound || !slot) return;
    setUrlDraft(slot.urlMatch.value);
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

      {/* Icon — double-click to edit (Problem 7) */}
      <span
        className={`tbs-slot-row__icon${isEmpty ? ' tbs-slot-row__icon--empty' : ''}`}
        style={isBound ? { background: `${colorVar}22` } : undefined}
        aria-hidden="true"
        onDoubleClick={(e) => { e.stopPropagation(); if (isBound) onEditIcon(slotNumber); }}
        title={isBound ? 'Double-click to change icon' : undefined}
      >
        {displayIcon ? (
          <img src={displayIcon} alt="" />
        ) : isEmpty ? (
          '·'
        ) : (
          '🔖'
        )}
      </span>

      {/* Content */}
      <div className="tbs-slot-row__content">
        {editingTitle ? (
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
            <button
              type="button"
              className="tbs-inline-field__reset"
              onClick={() => { setEditingTitle(false); onResetTitle(slotNumber); }}
              aria-label={`Reset slot ${slotNumber} title`}
              title="Reset title"
            >
              ↺
            </button>
          </div>
        ) : (
          <span
            className={`tbs-slot-row__title${isEmpty ? ' tbs-slot-row__title--empty' : ''}`}
            onDoubleClick={handleTitleDoubleClick}
            title={isBound ? `${displayTitle} (double-click to rename)` : undefined}
          >
            {displayTitle}
          </span>
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
            <input
              ref={urlInputRef}
              className="tbs-slot-row__url-input"
              type="text"
              value={urlDraft}
              onChange={(e) => { setUrlDraft(e.target.value); }}
              onKeyDown={handleUrlKeyDown}
              aria-label={`Edit URL for slot ${slotNumber}`}
            />
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
                    Rename Slot…
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
                    Delete Slot
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
                title="Delete Slot"
                message={`Delete slot ${String(slotNumber)}? Its saved URL, title and icon will be removed.`}
                confirmLabel="Delete"
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

import { IconEditor, renderIconToDataUri } from '@ui/components/IconEditor';
import type { IconConfig } from '@ui/components/IconEditor';
import { wildcardToRegex } from '@shared/url-utils';
import { RuleFormFields } from '@ui/shared/rule-form-fields';
import type { FieldMode } from '@ui/shared/field-editor';
import { resolveFieldChain } from '@shared/field-chain';
import type { ChainResult } from '@shared/field-chain';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';
import { normalizedRegexPattern, validateRuleForm } from '@shared/form-validation';
import { UndoBar as SharedUndoBar } from '@ui/shared/undo-bar';
import type { UndoState as SharedUndoState } from '@ui/shared/undo-bar';

interface IconEditorModalProps {
  open: boolean;
  onApply: (iconData: string) => void;
  onCancel: () => void;
  onReset?: () => void;
  initialIcon?: string;
  /** F4: durable trigger element to focus on close (menu items are unmounted). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** N7: durable element to fall back to if the trigger is removed on close. */
  focusFallbackRef?: React.RefObject<HTMLElement | null>;
}

function IconEditorModal({ open, onApply, onCancel, onReset, initialIcon, returnFocusRef, focusFallbackRef }: IconEditorModalProps) {
  const [iconConfig, setIconConfig] = useState<IconConfig>(
    initialIcon ? { dataUri: initialIcon } : { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' }
  );

  // The modal stays mounted so `Dialog` can restore focus to the trigger when
  // `open` flips back to false (the primitive captures the previously focused
  // element on open). Per-open state is therefore re-seeded here, mirroring the
  // established `Confirm` usage in DualCards.tsx.
  useEffect(() => {
    if (open) {
      setIconConfig(initialIcon ? { dataUri: initialIcon } : { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' });
    }
  }, [open, initialIcon]);

  const handleApply = useCallback(() => {
    const dataUri = renderIconToDataUri(iconConfig, 64);
    if (dataUri) onApply(dataUri);
  }, [iconConfig, onApply]);

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
          {onReset && (
            <Button size="sm" variant="ghost" onClick={() => { onReset(); onCancel(); }} aria-label="Reset icon">
              Reset
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={handleApply}>Apply</Button>
        </>
      }
    >
      <IconEditor value={iconConfig} onChange={setIconConfig} size={64} />
    </Dialog>
  );
}

/** A chain for a surface with no live page context (see settings/App.tsx). */
function emptyChain(): ChainResult {
  return resolveFieldChain('title', {
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
  onSave: (data: { url: string; matchType: 'exact' | 'regex'; title?: string; icon?: string; priority: number }) => Promise<{ success: boolean; message?: string }>;
  onCancel: () => void;
}

function CreateRuleModal({ open, defaultUrl, defaultTitle = '', defaultIcon = '', defaultMatchType, onSave, onCancel }: CreateRuleModalProps) {
  // DT4: the four prefills are snapshotted ONCE on open, from the chain-derived
  // values the caller supplies (no per-keystroke re-seed, no implicit fallback).
  const [url, setUrl] = useState(defaultUrl);
  const [matchType, setMatchType] = useState<'exact' | 'regex'>(defaultMatchType ?? 'exact');
  const [titleMode, setTitleMode] = useState<FieldMode>(
    defaultTitle ? { kind: 'set', value: defaultTitle } : { kind: 'use-chain' },
  );
  const [iconMode, setIconMode] = useState<FieldMode>(
    defaultIcon ? { kind: 'set', value: defaultIcon.startsWith('data:') ? '' : defaultIcon } : { kind: 'use-chain' },
  );
  const [iconConfig, setIconConfig] = useState<IconConfig | undefined>(
    defaultIcon.startsWith('data:') ? { dataUri: defaultIcon } : undefined,
  );
  const [priority, setPriority] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // P4: the modal stays mounted (so `Dialog` can restore focus to its trigger
  // on close), therefore the prefill has to be re-seeded on every open.
  useEffect(() => {
    if (!open) return;
    setUrl(defaultUrl);
    setMatchType(defaultMatchType ?? 'exact');
    setTitleMode(defaultTitle ? { kind: 'set', value: defaultTitle } : { kind: 'use-chain' });
    setIconMode(defaultIcon ? { kind: 'set', value: defaultIcon.startsWith('data:') ? '' : defaultIcon } : { kind: 'use-chain' });
    setIconConfig(defaultIcon.startsWith('data:') ? { dataUri: defaultIcon } : undefined);
    setPriority(0);
    setSaving(false);
    setSaveError(null);
  }, [open, defaultUrl, defaultTitle, defaultIcon, defaultMatchType]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const validation = validateRuleForm({
      matchType,
      url,
      titleMode: titleMode.kind === 'set' ? 'set' : 'use-chain',
      titleValue: titleMode.kind === 'set' ? titleMode.value : '',
      iconMode: iconMode.kind === 'set' ? 'url' : 'use-chain',
      iconValue: iconMode.kind === 'set' ? iconMode.value : '',
      iconConfig: iconConfig ? { dataUri: iconConfig.dataUri ?? '' } : undefined,
    });
    if (!validation.valid) {
      setSaveError(validation.errors[0]?.message ?? 'Invalid form');
      return;
    }

    const urlValue = matchType === 'regex' ? normalizedRegexPattern(url) : url.trim();

    let icon: string | undefined;
    if (iconMode.kind === 'set') {
      const dataUri = iconConfig?.dataUri ?? (iconConfig ? renderIconToDataUri(iconConfig, 64) : '');
      if (dataUri) icon = dataUri;
      else if (iconMode.value.trim()) icon = iconMode.value.trim();
    }

    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave({
        url: urlValue,
        matchType,
        title: titleMode.kind === 'set' ? (titleMode.value.trim() || undefined) : undefined,
        icon,
        priority: Math.max(-100, Math.min(100, priority)),
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

  const chain = useMemo(() => emptyChain(), []);

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
        iconChain={chain}
        baselineTitle={{ mode: { kind: 'use-chain' } }}
        baselineIcon={{ mode: { kind: 'use-chain' } }}
        onResetTitleEdit={() => { setTitleMode(defaultTitle ? { kind: 'set', value: defaultTitle } : { kind: 'use-chain' }); }}
        onResetIconEdit={() => { setIconMode(defaultIcon ? { kind: 'set', value: defaultIcon.startsWith('data:') ? '' : defaultIcon } : { kind: 'use-chain' }); }}
        onClearTitle={() => { setTitleMode({ kind: 'use-chain' }); }}
        onClearIcon={() => { setIconMode({ kind: 'use-chain' }); setIconConfig(undefined); }}
        submitMode={{ kind: 'immediate' }}
        idPrefix="modal-rule"
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
        let local = result.local;
        // Problem 1: Also read tabOverride directly from storage.local for freshness
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          try {
            const stored = await chrome.storage.local.get('localState');
            const storedLocal = stored?.localState as LocalState | undefined;
            if (storedLocal?.tabOverrides) {
              local = { ...local, tabOverrides: storedLocal.tabOverrides };
            }
          } catch {
            // Fallback to background-provided state
          }
        }
        setState((prev) => ({
          ...prev,
          sync: result.sync!,
          local,
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

  const handleTitleDoubleClick = useCallback(() => {
    const current = state.currentTabTitle;
    setTitleDraft(current);
    // Remember the pre-edit value so an unchanged save is treated as "no change".
    setCurrentTitleInitial(current);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, [state.currentTabTitle]);

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

  const handleIconDoubleClick = useCallback(() => {
    setShowIconEditor(true);
  }, []);

  const handleIconApply = useCallback(async (iconData: string) => {
    if (!state.currentTabId) return;
    try {
      await sendMessage('SET_TAB_OVERRIDE', { tabId: state.currentTabId, favicon: { type: 'upload', value: iconData } });
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

  const handleCreateGlobalRule = useCallback(async (ruleData: { url: string; matchType: 'exact' | 'regex'; title?: string; icon?: string; priority: number }): Promise<{ success: boolean; message?: string; conflictingRuleId?: string }> => {
    try {
      const response = await sendMessage('CREATE_RULE', {
        urlMatch: { type: ruleData.matchType, value: ruleData.url },
        priority: ruleData.priority,
        title: ruleData.title || undefined,
        favicon: ruleData.icon ? { type: 'upload', value: ruleData.icon } : undefined,
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

  const handleSlotIconApply = useCallback(async (iconData: string) => {
    const slotId = slotIconEditorId;
    if (!slotId) return;
    try {
      await sendMessage('UPDATE_SLOT_UI_MARKER', {
        slotId,
        uiMarker: { icon: { type: 'upload', value: iconData } },
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

  // Reset the slot's custom title (clears uiMarker.customTitle), which cascades
  // back to the slot's own display and the bound tab (bidirectional sync).
  const handleSlotResetTitle = useCallback(async (slotId: number) => {
    try {
      await sendMessage('UPDATE_SLOT_UI_MARKER', {
        slotId,
        uiMarker: { customTitle: '' },
      });
      setToast({ variant: 'success', message: `Slot ${slotId} title reset` });
      void loadState();
    } catch {
      setToast({ variant: 'error', message: `Failed to reset slot ${slotId} title` });
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
      matchType: slot.urlMatch.type,
    });
    setShowRuleModal(true);
  }, [state.sync]);

  const [rulePrefill, setRulePrefill] = useState<{ url: string; title: string; icon: string; matchType?: 'exact' | 'regex' } | null>(null);

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
            {/* Double-click favicon → icon editor */}
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

            {/* Double-click title → inline rename */}
            {editingTitle ? (
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
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onClick={(e) => { e.stopPropagation(); setEditingTitle(false); void handleCurrentTitleReset(); }}
                  aria-label="Reset current page title"
                  title="Reset title"
                >
                  ↺
                </button>
              </div>
            ) : (
              <span
                className="tbs-sidebar__current-title"
                title={`${displayCurrentTitle} (double-click to rename)`}
                onDoubleClick={handleTitleDoubleClick}
              >
                {displayCurrentTitle || 'No active tab'}
              </span>
            )}
          </div>

          {state.currentTabUrl && (
            <p className="tbs-sidebar__current-url" title={state.currentTabUrl}>
              {state.currentTabUrl}
            </p>
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
        initialIcon={displayCurrentFavicon || undefined}
      />

      {/* Slot icon editor (Problem 7) */}
      <IconEditorModal
        open={slotIconEditorId !== null}
        onApply={handleSlotIconApply}
        onCancel={() => { setSlotIconEditorId(null); }}
        onReset={handleSlotIconReset}
        returnFocusRef={slotIconTriggerRef}
        initialIcon={(() => {
          const s = state.sync?.slots.find((sl) => sl.id === slotIconEditorId);
          return s?.uiMarker.icon?.value || s?.faviconSnapshot || undefined;
        })()}
      />

      {/* Global rule creation modal (Problem 3c / 5 / 7) */}
      <CreateRuleModal
        open={showRuleModal}
        defaultUrl={rulePrefill ? rulePrefill.url : state.currentTabUrl}
        defaultTitle={rulePrefill ? rulePrefill.title : ''}
        defaultIcon={rulePrefill ? rulePrefill.icon : ''}
        defaultMatchType={rulePrefill ? rulePrefill.matchType : undefined}
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
            if (slot) {
              if (binding && state.sync && state.local) {
                const chainInput = {
                  sync: state.sync,
                  local: state.local,
                  tabId: binding.tabId,
                  tabUrl: slot.urlMatch.value,
                };
                resolvedTitle = resolveFieldChain('title', chainInput).winner.value
                  ?? slot.uiMarker.customTitle
                  ?? slot.titleSnapshot
                  ?? undefined;
                resolvedIcon = resolveFieldChain('favicon', chainInput).winner.value
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
                onResetTitle={handleSlotResetTitle}
                onAddToGlobal={handleSlotAddToGlobal}
                onUpdateUrl={handleUpdateSlotUrl}
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
