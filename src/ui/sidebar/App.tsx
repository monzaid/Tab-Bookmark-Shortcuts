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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SlotDefinition, SlotBinding, SyncState, LocalState } from '@shared/types';
import { Button, IconButton, Toast, Tooltip, StatusBadge } from '@ui/shared/components';
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
  onEditIcon: (slotId: number) => void;
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
  const menuRef = useRef<HTMLDivElement>(null);
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
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleTitleDoubleClick = (e: React.MouseEvent) => {
    if (!isBound) return;
    e.stopPropagation();
    const current = slot?.uiMarker.customTitle || slot?.titleSnapshot || '';
    setTitleDraft(current);
    // Remember the pre-edit value so an unchanged save is treated as "no change".
    setTitleInitial(current);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
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

  // Problem 8: double-click URL to edit
  const handleUrlDoubleClick = (e: React.MouseEvent) => {
    if (!isBound || !slot) return;
    e.stopPropagation();
    setUrlDraft(slot.urlMatch.value);
    setUrlMatchType(slot.urlMatch.type);
    setEditingUrl(true);
    setTimeout(() => urlInputRef.current?.focus(), 0);
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
          <div className="tbs-inline-field" onClick={(e) => e.stopPropagation()}>
            <input
              ref={titleInputRef}
              className="tbs-slot-row__title-input"
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
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
          <div className="tbs-slot-row__url-edit" onClick={(e) => e.stopPropagation()}>
            <input
              ref={urlInputRef}
              className="tbs-slot-row__url-input"
              type="text"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={handleUrlKeyDown}
              aria-label={`Edit URL for slot ${slotNumber}`}
            />
            <div className="tbs-slot-row__url-match-type" role="radiogroup" aria-label="Match type">
              <label>
                <input type="radio" name={`url-match-${slotNumber}`} checked={urlMatchType === 'exact'} onChange={() => setUrlMatchType('exact')} />
                Exact
              </label>
              <label>
                <input type="radio" name={`url-match-${slotNumber}`} checked={urlMatchType === 'regex'} onChange={() => setUrlMatchType('regex')} />
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
                onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              >
                ⋯
              </IconButton>
              {menuOpen && (
                <div className="tbs-slot-menu" role="menu" aria-label={`Slot ${slotNumber} actions`}>
                  <button
                    className="tbs-slot-menu__item tbs-slot-menu__item--danger"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onUnbind(slotNumber); }}
                  >
                    Reset
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Undo Bar Component ──────────────────────────────────────────────────────

interface UndoBarProps {
  undo: UndoState;
  onUndo: () => void;
  onExpire: () => void;
}

function UndoBar({ undo, onUndo, onExpire }: UndoBarProps) {
  const [remaining, setRemaining] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((undo.expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(interval);
        onExpire();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [undo.expiresAt, onExpire]);

  return (
    <div className="tbs-undo-bar" role="alert" aria-live="polite">
      <span>Slot {undo.slotId} overwritten</span>
      <Button size="sm" variant="ghost" onClick={onUndo} aria-label={`Undo overwrite of slot ${undo.slotId}`}>
        Undo ({remaining}s)
      </Button>
    </div>
  );
}

// ─── Icon Editor Modal (uses reusable IconEditor component) ─────────────────

import { IconEditor, renderIconToDataUri } from '@ui/components/IconEditor';
import type { IconConfig } from '@ui/components/IconEditor';
import { wildcardToRegex, matchesUrl } from '@shared/url-utils';

interface IconEditorModalProps {
  onApply: (iconData: string) => void;
  onCancel: () => void;
  onReset?: () => void;
  initialIcon?: string;
}

function IconEditorModal({ onApply, onCancel, onReset, initialIcon }: IconEditorModalProps) {
  const [iconConfig, setIconConfig] = useState<IconConfig>(
    initialIcon ? { dataUri: initialIcon } : { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' }
  );

  const handleApply = useCallback(() => {
    const dataUri = renderIconToDataUri(iconConfig, 64);
    if (dataUri) onApply(dataUri);
  }, [iconConfig, onApply]);

  return (
    <div className="tbs-modal-overlay" role="dialog" aria-modal="true" aria-label="Change tab icon">
      <div className="tbs-modal">
        <h3 className="tbs-modal__title">Change Icon</h3>
        <IconEditor value={iconConfig} onChange={setIconConfig} size={64} />
        <div className="tbs-modal__footer">
          {onReset && (
            <Button size="sm" variant="ghost" onClick={() => { onReset(); onCancel(); }} aria-label="Reset icon">
              Reset
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={handleApply}>Apply</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Rule Modal (Problem 3: icon editor + priority) ──────────────────

interface CreateRuleModalProps {
  defaultUrl: string;
  defaultTitle?: string;
  defaultIcon?: string;
  defaultMatchType?: 'exact' | 'regex';
  onSave: (data: { url: string; matchType: 'exact' | 'regex'; title?: string; icon?: string; mode: 'auto' | 'manual'; priority: number }) => Promise<{ success: boolean; message?: string }>;
  onCancel: () => void;
}

function CreateRuleModal({ defaultUrl, defaultTitle = '', defaultIcon = '', defaultMatchType, onSave, onCancel }: CreateRuleModalProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [matchType, setMatchType] = useState<'exact' | 'regex'>(defaultMatchType ?? 'exact');
  const [title, setTitle] = useState(defaultTitle);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [priority, setPriority] = useState(0);
  const [iconConfig, setIconConfig] = useState<IconConfig>(
    defaultIcon ? { dataUri: defaultIcon } : { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' }
  );
  // Problem 4: Icon URL / Custom / Reset mutual exclusion
  const [iconMode, setIconMode] = useState<'url' | 'custom' | 'reset'>(defaultIcon ? 'custom' : 'url');
  // Cache the previous non-reset mode so switching back restores prior input.
  const [prevIconMode, setPrevIconMode] = useState<'url' | 'custom' | null>(null);
  const [iconUrl, setIconUrl] = useState(defaultIcon && !defaultIcon.startsWith('data:') ? defaultIcon : '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!url.trim() || saving) return;
    // Problem 2: Auto-convert wildcard patterns to valid regex
    let urlValue = url.trim();
    if (matchType === 'regex') {
      const conversion = wildcardToRegex(urlValue);
      if (conversion.converted) {
        urlValue = conversion.pattern;
      }
      // Final validation
      try {
        new RegExp(urlValue);
      } catch {
        return; // Invalid regex — don't save
      }
    }
    // Problem 4: Compute icon based on iconMode (mutually exclusive):
    // URL → text input; Custom → rendered data URI; Reset → clear the icon.
    let icon: string | undefined;
    if (iconMode === 'custom') {
      icon = renderIconToDataUri(iconConfig, 64) || undefined;
    } else if (iconMode === 'url' && iconUrl.trim()) {
      icon = iconUrl.trim();
    }
    // Reset mode → icon stays undefined → cleared (falls back to rule chain).
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave({ url: urlValue, matchType, title: title.trim() || undefined, icon, mode, priority: Math.max(-100, Math.min(100, priority)) });
      if (!result.success) {
        setSaveError(result.message || 'Failed to create rule');
        setSaving(false);
      }
      // On success, parent closes the modal
    } catch {
      setSaveError('Failed to create rule');
      setSaving(false);
    }
  }, [url, matchType, title, iconConfig, iconMode, iconUrl, mode, priority, onSave, saving]);

  return (
    <div className="tbs-modal-overlay" role="dialog" aria-modal="true" aria-label="Create global page rule">
      <div className="tbs-modal tbs-modal--wide">
        <h3 className="tbs-modal__title">New Global Page Rule</h3>

        <div className="tbs-modal__section">
          <label className="tbs-modal__label" htmlFor="rule-url">Match URL</label>
          <div className="tbs-inline-field">
            <input
              id="rule-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="tbs-modal__input"
              aria-label="Match URL"
            />
            <button
              type="button"
              className="tbs-inline-field__reset"
              onClick={() => setUrl(defaultUrl)}
              aria-label="Reset Match URL"
              title="Reset Match URL"
            >
              ↺
            </button>
          </div>
        </div>

        <div className="tbs-modal__section">
          <p className="tbs-modal__label">Match Type</p>
          <div className="tbs-modal__radio-group" role="radiogroup" aria-label="Match type">
            <label>
              <input type="radio" name="matchType" checked={matchType === 'exact'} onChange={() => setMatchType('exact')} />
              Exact URL
            </label>
            <label>
              <input type="radio" name="matchType" checked={matchType === 'regex'} onChange={() => setMatchType('regex')} />
              Regex
            </label>
          </div>
          {/* Problem 2: Real-time regex validation + auto-conversion hint */}
          {matchType === 'regex' && url.trim() && (() => {
            const conversion = wildcardToRegex(url.trim());
            if (conversion.converted) {
              return <span className="tbs-modal__regex-valid" role="status">✓ 已自动转换为正则表达式: {conversion.pattern}</span>;
            }
            try {
              new RegExp(url.trim());
              return <span className="tbs-modal__regex-valid" role="status">✓ Valid regex</span>;
            } catch (e) {
              return <span className="tbs-modal__regex-invalid" role="alert">✗ {e instanceof Error ? e.message : 'Invalid regex'}</span>;
            }
          })()}
        </div>

        <div className="tbs-modal__section">
          <label className="tbs-modal__label" htmlFor="rule-title">Custom Title (optional)</label>
          <div className="tbs-inline-field">
            <input
              id="rule-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="tbs-modal__input"
              placeholder="Leave empty to keep original"
              aria-label="Custom title"
            />
            <button
              type="button"
              className="tbs-inline-field__reset"
              onClick={() => setTitle(defaultTitle)}
              aria-label="Reset Custom Title"
              title="Reset Custom Title"
            >
              ↺
            </button>
          </div>
        </div>

        {/* Problem 4: Icon URL / Custom / Reset mutual exclusion */}
        <div className="tbs-modal__section">
          <p className="tbs-modal__label">Icon (optional)</p>
          <div className="tbs-modal__radio-group" role="radiogroup" aria-label="Icon mode">
            <label>
              <input type="radio" name="iconMode" checked={iconMode === 'url'} onChange={() => { setPrevIconMode(iconMode !== 'reset' ? iconMode : prevIconMode); setIconMode('url'); }} />
              Icon URL
            </label>
            <label>
              <input type="radio" name="iconMode" checked={iconMode === 'custom'} onChange={() => { setPrevIconMode(iconMode !== 'reset' ? iconMode : prevIconMode); setIconMode('custom'); }} />
              Custom Icon
            </label>
            <label>
              <input type="radio" name="iconMode" checked={iconMode === 'reset'} onChange={() => { setPrevIconMode(iconMode !== 'reset' ? iconMode : prevIconMode); setIconMode('reset'); }} />
              Reset
            </label>
          </div>
          {iconMode === 'url' && (
            <input
              type="text"
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              className="tbs-modal__input"
              placeholder="https:// or data: URI"
              aria-label="Icon URL"
            />
          )}
          {iconMode === 'custom' && (
            <IconEditor value={iconConfig} onChange={setIconConfig} size={48} />
          )}
          {iconMode === 'reset' && (
            <p className="tbs-modal__hint">Icon will be cleared and shown as "—".</p>
          )}
        </div>

        {/* Priority (Problem 3) */}
        <div className="tbs-modal__section">
          <label className="tbs-modal__label" htmlFor="rule-priority">Priority (-100 to 100)</label>
          <input
            id="rule-priority"
            type="number"
            min={-100}
            max={100}
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            className="tbs-modal__input"
            aria-label="Rule priority"
          />
        </div>

        <div className="tbs-modal__section">
          <label className="tbs-modal__checkbox">
            <input type="checkbox" checked={mode === 'auto'} onChange={(e) => setMode(e.target.checked ? 'auto' : 'manual')} />
            Auto-apply on match
          </label>
        </div>

        {saveError && (
          <p className="tbs-modal__error" role="alert" style={{ color: '#DC2626', fontSize: '12px', margin: '4px 0' }}>{saveError}</p>
        )}

        <div className="tbs-modal__footer">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => void handleSave()} disabled={!url.trim() || saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
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
        let local = result.local!;
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
        }));
      } else {
        setState((prev) => ({ ...prev, loading: false }));
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
      if (result?.success) {
        const outcome = result.outcome;
        if (outcome?.type === 'needs_recovery') {
          setToast({ variant: 'info', message: `Slot ${slotId}: opening recovery window` });
        }
      } else {
        setToast({ variant: 'error', message: `Failed to switch to slot ${slotId}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to switch to slot ${slotId}` });
    }
  }, []);

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
        setToast({ variant: 'info', message: `Slot ${String(slotId)} unbound` });
        void loadState();
      } else {
        setToast({ variant: 'error', message: `Failed to unbind slot ${String(slotId)}` });
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to unbind slot ${String(slotId)}` });
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
    try {
      // Main path (B11b): let the background open the page so it can reuse an
      // already-open tab. No chrome.tabs access happens here.
      await sendMessage('OPEN_PAGE', { url });
    } catch {
      // Fallback (B11b): the background is unavailable (SW not yet woken /
      // extension reloading / restricted context). This is REQUIRED behaviour —
      // without it the footer buttons would silently do nothing. It reuses the
      // shared open-or-reuse logic and obtains its chrome.tabs operations from
      // the single helper below, so the fallback cannot be re-duplicated.
      try {
        const api = createChromePageOpenApi();
        if (api) {
          await openOrReusePage(api, url);
        }
      } catch {
        // Silently fail
      }
    }
  }, []);

  const handleOpenSettings = useCallback(() => {
    void openPage('src/ui/settings/index.html');
  }, [openPage]);

  const handleOpenImportExport = useCallback(() => {
    void openPage('src/ui/import-preview/index.html');
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

  const handleTitleSave = useCallback(async () => {
    setEditingTitle(false);
    if (!state.currentTabId) return;
    const next = titleDraft.trim();
    // Empty, or unchanged from the pre-edit value => user made no modification
    // => do not record into the Data Dashboard.
    if (!next || next === currentTitleInitial) return;
    try {
      await sendMessage('SET_TAB_OVERRIDE', { tabId: state.currentTabId, title: next });
      // Problem 5: Don't modify original title — refresh state to pick up override from storage
      setToast({ variant: 'success', message: 'Title updated' });
      void loadState();
    } catch {
      setToast({ variant: 'error', message: 'Failed to update title' });
    }
  }, [state.currentTabId, titleDraft, currentTitleInitial, loadState]);

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

  const handleCreateGlobalRule = useCallback(async (ruleData: { url: string; matchType: 'exact' | 'regex'; title?: string; icon?: string; mode: 'auto' | 'manual'; priority: number }): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await sendMessage('CREATE_RULE', {
        urlMatch: { type: ruleData.matchType, value: ruleData.url },
        mode: ruleData.mode,
        priority: ruleData.priority,
        title: ruleData.title || undefined,
        favicon: ruleData.icon ? { type: 'upload', value: ruleData.icon } : undefined,
      }) as { result?: { success: boolean; message?: string }; success?: boolean; message?: string };
      const result = response?.result ?? response;
      if (result?.success) {
        setShowRuleModal(false);
        setRulePrefill(null);
        setToast({ variant: 'success', message: 'Global rule created' });
        await loadState();
        return { success: true };
      } else {
        const msg = (result as { message?: string })?.message || 'Failed to create rule';
        setToast({ variant: 'error', message: msg });
        return { success: false, message: msg };
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to create rule' });
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

  const handleSlotEditIcon = useCallback((slotId: number) => {
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
      await sendMessage('UPDATE_SLOT_UI_MARKER', {
        slotId,
        uiMarker: { icon: { type: 'upload', value: '' } },
      });
      setToast({ variant: 'success', message: `Slot ${slotId} icon reset` });
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

  // Problem 4 & 7: Priority chain for current page display — aligned with the
  // worker's computeFields/resolveSlotField chain (Bug 2 fix):
  //   slot (bound to this tabId) → tabId override → matching page rule → site value
  // The slot tier is tabId-scoped: it only applies when a SlotBinding's tabId
  // equals the current tabId, so it never bleeds onto other matching tabs.
  const tabOverride = state.currentTabId
    ? state.local?.tabOverrides.find((o) => o.tabId === state.currentTabId)
    : undefined;

  // Slot tier (highest): resolve the slot bound to this exact tabId, mirroring
  // RuleService.resolveSlotField (slot.titleSnapshot/uiMarker.icon → favicon).
  const boundSlot = state.currentTabId
    ? state.local?.bindings.find((b) => b.tabId === state.currentTabId)
    : undefined;
  const boundSlotDef = boundSlot
    ? state.sync?.slots.find((s) => s.id === boundSlot.slotId)
    : undefined;
  // User-modified uiMarker wins over the stale snapshot (mirrors RuleService.resolveSlotField).
  const slotTitle = boundSlotDef?.uiMarker.customTitle?.trim()
    ? boundSlotDef.uiMarker.customTitle
    : (boundSlotDef?.titleSnapshot.trim() ? boundSlotDef.titleSnapshot : null);
  const slotFavicon = boundSlotDef?.uiMarker.icon?.value.trim()
    ? boundSlotDef.uiMarker.icon.value
    : (boundSlotDef?.faviconSnapshot.trim() ? boundSlotDef.faviconSnapshot : null);

  // Find matching auto rule for current page URL (highest priority wins)
  const matchingRule = state.currentTabUrl && state.sync?.rules
    ? state.sync.rules
        .filter((r) => r.mode === 'auto' && r.enabled !== false && state.currentTabUrl && matchesUrl(state.currentTabUrl, r.urlMatch))
        .sort((a, b) => b.priority - a.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : undefined;

  // Priority chain: current page (tab override) > slot > rule > original.
  // The active tab's own override (what the user directly edited) is the highest
  // tier; the slot-bound snapshot next; then the matching page rule; else site.
  const displayCurrentTitle = tabOverride?.title || slotTitle || matchingRule?.title || state.currentTabTitle;
  const displayCurrentFavicon = tabOverride?.favicon?.value || slotFavicon || matchingRule?.favicon?.value || state.currentTabFavicon;

  return (
    <div role="application" aria-label="Tab Bookmarks Sidebar" className="tbs-sidebar">
      {/* Header: current context */}
      <header className="tbs-sidebar__header">
        <button
          className="tbs-sidebar__collapse-toggle"
          onClick={() => setCollapsed(!collapsed)}
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
                  onChange={(e) => setTitleDraft(e.target.value)}
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
            </span>
          </div>
        </section>
      )}

      {/* Icon editor inline modal (Problem 3a) */}
      {showIconEditor && (
        <IconEditorModal
          onApply={handleIconApply}
          onCancel={() => setShowIconEditor(false)}
          onReset={handleCurrentIconReset}
          initialIcon={displayCurrentFavicon || undefined}
        />
      )}

      {/* Slot icon editor (Problem 7) */}
      {slotIconEditorId !== null && (
        <IconEditorModal
          onApply={handleSlotIconApply}
          onCancel={() => setSlotIconEditorId(null)}
          onReset={handleSlotIconReset}
          initialIcon={(() => {
            const s = state.sync?.slots.find((sl) => sl.id === slotIconEditorId);
            return s?.uiMarker.icon?.value || s?.faviconSnapshot || undefined;
          })()}
        />
      )}

      {/* Global rule creation modal (Problem 3c / 5 / 7) */}
      {showRuleModal && (
        <CreateRuleModal
          defaultUrl={rulePrefill ? rulePrefill.url : state.currentTabUrl}
          defaultTitle={rulePrefill ? rulePrefill.title : ''}
          defaultIcon={rulePrefill ? rulePrefill.icon : ''}
          defaultMatchType={rulePrefill ? rulePrefill.matchType : undefined}
          onSave={handleCreateGlobalRule}
          onCancel={() => { setShowRuleModal(false); setRulePrefill(null); }}
        />
      )}

      {/* 10-slot list */}
      <section className="tbs-sidebar__slots" aria-label="Bookmark slots">
        <div role="list" aria-label="10 bookmark slots">
          {Array.from({ length: 10 }, (_, i) => {
            const slotNumber = i + 1;
            const slot = slots.find((s) => s.id === slotNumber);
            const binding = bindings.find((b) => b.slotId === slotNumber);
            const shortcut = getSlotShortcut(slotNumber, 'switch');

            // Priority chain for bound slots: tabOverride → uiMarker → matching rule → snapshot
            let resolvedTitle: string | undefined;
            let resolvedIcon: string | undefined;
            if (slot) {
              // 1. tabOverride (if slot's bound tab has an override)
              const slotTabOverride = binding
                ? state.local?.tabOverrides.find((o) => o.tabId === binding.tabId)
                : undefined;
              // 2. Find matching page rule for the slot's URL
              const slotMatchingRule = slot.urlMatch.value && state.sync?.rules
                ? state.sync.rules
                    .filter((r) => r.mode === 'auto' && r.enabled !== false && slot.urlMatch.value && matchesUrl(slot.urlMatch.value, r.urlMatch))
                    .sort((a, b) => b.priority - a.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
                : undefined;

              resolvedTitle = slotTabOverride?.title
                || slot.uiMarker.customTitle
                || slotMatchingRule?.title
                || slot.titleSnapshot
                || undefined;
              resolvedIcon = slotTabOverride?.favicon?.value
                || slot.uiMarker.icon?.value
                || slotMatchingRule?.favicon?.value
                || slot.faviconSnapshot
                || undefined;
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
      </section>

      {/* Undo bar */}
      {undo && (
        <UndoBar undo={undo} onUndo={handleUndo} onExpire={() => setUndo(null)} />
      )}

      {/* Toast */}
      {toast && (
        <Toast
          variant={toast.variant}
          message={toast.message}
          onDismiss={() => setToast(null)}
          duration={3000}
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
