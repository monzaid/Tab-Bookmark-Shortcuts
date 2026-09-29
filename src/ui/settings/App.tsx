/**
 * Settings App — Slots & Shortcuts, Rules, Global Strategy, Import/Export, Diagnostics.
 *
 * - Fixed left navigation with 5 sections
 * - "Slots & Shortcuts": shows 21 commands with Command/Shortcut/Status table
 * - "Page Rules": full CRUD with enable/disable, edit, batch operations
 * - "Global Strategy": edit global default and per-slot inherit/override
 * - "Import / Export": JSON file import with preview + commit flow
 * - "Diagnostics": view/clear/export diagnostic entries
 */

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Button, Toast, StatusBadge } from '@ui/shared/components';
import { IconEditor, renderIconToDataUri } from '@ui/components/IconEditor';
import type { IconConfig } from '@ui/components/IconEditor';
import type { MatchStrategy, SlotDefinition, PageRule, ImportPreview, ImportSlotConflict, IconSource, DashboardItem } from '@shared/types';
import { wildcardToRegex } from '@shared/url-utils';
import { getMessageClient } from '@ui/shared/message-client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommandInfo {
  name: string;
  description: string;
  shortcut: string | null;
}

type SettingsSection = 'slots' | 'rules' | 'strategy' | 'dashboard' | 'import-export' | 'diagnostics';

/** Sortable column keys for the Page Rules table. */
type SortKey = 'urlMatch' | 'title' | 'mode' | 'priority' | 'enabled';

/** Compare function types per column (string vs numeric) for stable sorting. */
function compareRules(a: PageRule, b: PageRule, key: SortKey): number {
  switch (key) {
    case 'urlMatch':
      return a.urlMatch.value.localeCompare(b.urlMatch.value);
    case 'title':
      return (a.title ?? '').localeCompare(b.title ?? '');
    case 'mode':
      return a.mode.localeCompare(b.mode);
    case 'priority':
      return a.priority - b.priority;
    case 'enabled':
      return Number(a.enabled !== false) - Number(b.enabled !== false);
  }
}

// ─── Message helper (B11: all cross-context messaging goes through here) ────

async function sendMessage(action: string, payload?: unknown, configVersion?: number): Promise<unknown> {
  return getMessageClient().sendRaw(action, payload, configVersion);
}

/** Extract result from response (supports both { result: {...} } and flat) */
function extractResult(res: unknown): Record<string, unknown> | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as Record<string, unknown>;
  return (r.result as Record<string, unknown>) ?? r;
}

// ─── Navigation ──────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: SettingsSection; label: string }[] = [
  { id: 'slots', label: 'Slots & Shortcuts' },
  { id: 'rules', label: 'Page Rules' },
  { id: 'strategy', label: 'Global Strategy' },
  { id: 'dashboard', label: 'Data Dashboard' },
  { id: 'import-export', label: 'Import / Export' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

// ─── Shortcuts Section (Problem 3) ──────────────────────────────────────────

function ShortcutsSection({ commands }: { commands: CommandInfo[] }) {
  const browserManagementHint = getBrowserShortcutHint();

  return (
    <section aria-label="Slots and shortcuts">
      <h2>Slots & Shortcuts</h2>
      <p className="tbs-settings__hint">{browserManagementHint}</p>

      <table className="tbs-settings__table" role="table" aria-label="Command shortcuts">
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">Shortcut</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {commands.map((cmd) => (
            <tr key={cmd.name}>
              <td>{cmd.description || cmd.name}</td>
              <td>{cmd.shortcut ?? '未设置'}</td>
              <td>
                <StatusBadge
                  status={cmd.shortcut ? 'active' : 'inactive'}
                  label={cmd.shortcut ? '✅ Active' : '⚠️ No shortcut'}
                />
              </td>
            </tr>
          ))}
          {commands.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>Loading commands...</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function getBrowserShortcutHint(): string {
  return 'To configure shortcuts, open your browser extension shortcuts page: Chrome → chrome://extensions/shortcuts, Edge → edge://extensions/shortcuts, Firefox → about:addons → gear icon → Manage Extension Shortcuts.';
}

// ─── Strategy Section (Problem 6) ───────────────────────────────────────────

interface StrategySectionProps {
  globalStrategy: MatchStrategy;
  slots: SlotDefinition[];
  configVersion: number;
  onGlobalChange: (strategy: MatchStrategy) => void;
  onSlotChange: (slotId: number, strategy: MatchStrategy | 'inherit') => void;
}

function StrategySection({ globalStrategy, slots, configVersion: _cv, onGlobalChange, onSlotChange }: StrategySectionProps) {
  return (
    <section aria-label="Global matching strategy">
      <h2>Global Matching Strategy</h2>

      <div className="tbs-settings__strategy-radios" role="radiogroup" aria-label="Global default strategy">
        <label className="tbs-settings__strategy-radio">
          <input
            type="radio"
            name="global-strategy"
            value="A"
            checked={globalStrategy === 'A'}
            onChange={() => onGlobalChange('A')}
          />
          <span><strong>A.</strong> 会话标签优先 — tabId 存在即切换</span>
        </label>
        <label className="tbs-settings__strategy-radio">
          <input
            type="radio"
            name="global-strategy"
            value="B"
            checked={globalStrategy === 'B'}
            onChange={() => onGlobalChange('B')}
          />
          <span><strong>B.</strong> 会话标签 + 规则校验（默认）— tabId 存在且 URL 仍匹配</span>
        </label>
        <label className="tbs-settings__strategy-radio">
          <input
            type="radio"
            name="global-strategy"
            value="C"
            checked={globalStrategy === 'C'}
            onChange={() => onGlobalChange('C')}
          />
          <span><strong>C.</strong> 严格规则匹配 — 忽略 tabId，仅 URL/正则查找</span>
        </label>
      </div>

      <h3>Per-Slot Override</h3>
      <table className="tbs-settings__table" role="table" aria-label="Slot strategy overrides">
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col">Strategy</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, i) => {
            const slotId = i + 1;
            const slot = slots.find((s) => s.id === slotId);
            const current = slot?.strategy ?? 'inherit';
            return (
              <tr key={slotId}>
                <td>Slot {slotId}</td>
                <td>
                  <select
                    value={current}
                    onChange={(e) => onSlotChange(slotId, e.target.value as MatchStrategy | 'inherit')}
                    aria-label={`Strategy for slot ${slotId}`}
                  >
                    <option value="inherit">继承全局 ({globalStrategy})</option>
                    <option value="A">A — 会话标签优先</option>
                    <option value="B">B — 会话 + 规则校验</option>
                    <option value="C">C — 严格规则匹配</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ─── Rules Section (Problem 4: edit, enable/disable, batch operations) ──────

interface RuleFormState {
  url: string;
  matchType: 'exact' | 'regex';
  title: string;
  iconUrl: string;
  priority: number;
  mode: 'auto' | 'manual';
  iconMode: 'url' | 'custom' | 'reset';
  iconConfig: IconConfig;
  /** Cached previous non-reset mode so switching back restores prior input. */
  prevIconMode: 'url' | 'custom' | null;
}

const EMPTY_RULE_FORM: RuleFormState = {
  url: '',
  matchType: 'exact',
  title: '',
  iconUrl: '',
  priority: 0,
  mode: 'auto',
  iconMode: 'url',
  iconConfig: { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' },
  prevIconMode: null,
};

// ─── Inline Rule Editor (Module 2: row-level expandable editor) ─────────────

interface InlineRuleEditorProps {
  rule: PageRule;
  onSave: (
    ruleId: string,
    updates: Partial<Pick<PageRule, 'urlMatch' | 'mode' | 'priority' | 'title' | 'favicon' | 'enabled'>>,
    expectedUpdatedAt: string,
  ) => Promise<{ success: boolean; errorCode?: string; message?: string }>;
  onCancel: () => void;
}

/**
 * Inline edit form rendered below a rule row. Maintains its own independent
 * form state (each expanded editor is isolated). Carries the rule's `updatedAt`
 * captured at open time as `expectedUpdatedAt` for lightweight version checking.
 */
function InlineRuleEditor({ rule, onSave, onCancel }: InlineRuleEditorProps) {
  const hasIcon = !!rule.favicon?.value;
  const isCustomIcon = hasIcon && rule.favicon!.value.startsWith('data:');

  const [url, setUrl] = useState(rule.urlMatch.value);
  const [matchType, setMatchType] = useState<'exact' | 'regex'>(rule.urlMatch.type);
  const [title, setTitle] = useState(rule.title ?? '');
  const [iconMode, setIconMode] = useState<'url' | 'custom' | 'reset'>(isCustomIcon ? 'custom' : 'url');
  // Cache the previous non-reset mode so switching away and back restores the
  // user's prior URL text / Custom config (mode-change never clears the cache).
  const [prevIconMode, setPrevIconMode] = useState<'url' | 'custom' | null>(null);
  const [iconUrl, setIconUrl] = useState(hasIcon && !isCustomIcon ? rule.favicon!.value : '');
  const [iconConfig, setIconConfig] = useState<IconConfig>(
    isCustomIcon ? { dataUri: rule.favicon!.value } : { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' },
  );
  const [priority, setPriority] = useState(rule.priority);
  const [mode, setMode] = useState<'auto' | 'manual'>(rule.mode);
  const [enabled, setEnabled] = useState(rule.enabled !== false);
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Version marker frozen at editor-open time (useState initializer runs once
  // on mount). It must NOT track rule.updatedAt across re-renders: if the list
  // refreshes while this editor is open (e.g. another channel saved), the stale
  // edit must still fail with VERSION_CONFLICT rather than silently inheriting
  // the newer marker and overwriting the other channel's change.
  const [expectedUpdatedAt] = useState(rule.updatedAt);

  const handleSave = useCallback(async () => {
    if (!url.trim()) { setError('URL is required'); return; }

    // Auto-convert wildcard patterns to regex, then validate
    let urlValue = url.trim();
    if (matchType === 'regex') {
      const conversion = wildcardToRegex(urlValue);
      if (conversion.converted) urlValue = conversion.pattern;
      try {
        new RegExp(urlValue);
      } catch (e) {
        setError(`Invalid regex: ${e instanceof Error ? e.message : 'syntax error'}`);
        return;
      }
    }

    // Compute favicon based on iconMode (mutually exclusive):
    // URL → text input; Custom → rendered data URI; Reset → clear the icon.
    let favicon: IconSource | undefined;
    if (iconMode === 'custom') {
      const dataUri = renderIconToDataUri(iconConfig, 64);
      if (dataUri) favicon = { type: 'upload', value: dataUri };
    } else if (iconMode === 'url' && iconUrl.trim()) {
      favicon = { type: 'url', value: iconUrl.trim() };
    }
    // Reset mode → favicon stays undefined → cleared (falls back to rule chain).

    setStatus('saving');
    setError(null);

    const result = await onSave(
      rule.id,
      {
        urlMatch: { type: matchType, value: urlValue },
        mode,
        priority: Math.max(-100, Math.min(100, priority)),
        title: title.trim() || undefined,
        favicon,
        enabled,
      },
      expectedUpdatedAt,
    );

    if (!result.success) {
      setStatus('idle');
      // Version conflict gets a user-friendly guidance message regardless of
      // the backend's raw text; other errors surface their concrete message.
      setError(
        result.errorCode === 'VERSION_CONFLICT'
          ? '规则已被其他操作修改，请刷新后重试'
          : (result.message ?? 'Failed to update rule'),
      );
      return;
    }
    // Auto-hide the Edit Rule interface after a successful update. The parent
    // (handleInlineSave) shows the "✓ Rule updated" notice below.
    setStatus('idle');
    setError(null);
    onCancel();
  }, [url, matchType, title, iconMode, iconUrl, iconConfig, priority, mode, enabled, rule.id, expectedUpdatedAt, onSave, onCancel]);

  return (
    <tr className="tbs-settings__inline-editor-row">
      <td colSpan={8}>
        <div className="tbs-settings__rule-form" role="form" aria-label={`Edit rule ${rule.id}`}>
          <h3>Edit Rule</h3>
          {error && <p className="tbs-settings__rule-form-error" role="alert">{error}</p>}
          <div className="tbs-settings__rule-form-grid">
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Match URL *</label>
              <div className="tbs-inline-field">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-label="Match URL"
                />
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onClick={() => setUrl(rule.urlMatch.value)}
                  aria-label="Reset Match URL"
                  title="Reset Match URL"
                >
                  ↺
                </button>
              </div>
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Match Type</label>
              <div className="tbs-settings__rule-form-radio" role="radiogroup" aria-label="Match type">
                <label><input type="radio" checked={matchType === 'exact'} onChange={() => setMatchType('exact')} /> Exact URL</label>
                <label><input type="radio" checked={matchType === 'regex'} onChange={() => setMatchType('regex')} /> Regex</label>
              </div>
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Custom Title (optional)</label>
              <div className="tbs-inline-field">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Custom Title"
                />
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onClick={() => setTitle(rule.title ?? '')}
                  aria-label="Reset Custom Title"
                  title="Reset Custom Title"
                >
                  ↺
                </button>
              </div>
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Icon (optional)</label>
              <div className="tbs-settings__rule-form-radio" role="radiogroup" aria-label="Icon mode">
                <label>
                  <input type="radio" checked={iconMode === 'url'} onChange={() => { setPrevIconMode(iconMode !== 'reset' ? iconMode : prevIconMode); setIconMode('url'); }} />
                  URL
                </label>
                <label>
                  <input type="radio" checked={iconMode === 'custom'} onChange={() => { setPrevIconMode(iconMode !== 'reset' ? iconMode : prevIconMode); setIconMode('custom'); }} />
                  Custom
                </label>
                <label>
                  <input type="radio" checked={iconMode === 'reset'} onChange={() => { setPrevIconMode(iconMode !== 'reset' ? iconMode : prevIconMode); setIconMode('reset'); }} />
                  Reset
                </label>
              </div>
              {iconMode === 'url' && (
                <input
                  type="text"
                  value={iconUrl}
                  onChange={(e) => setIconUrl(e.target.value)}
                  aria-label="Icon URL"
                />
              )}
              {iconMode === 'custom' && (
                <IconEditor value={iconConfig} onChange={setIconConfig} size={48} />
              )}
              {iconMode === 'reset' && (
                <p className="tbs-settings__hint">Icon will be cleared and shown as "—".</p>
              )}
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Priority (-100 to 100)</label>
              <input
                type="number"
                min={-100}
                max={100}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                aria-label="Priority"
              />
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">
                <input type="checkbox" checked={mode === 'auto'} onChange={(e) => setMode(e.target.checked ? 'auto' : 'manual')} />
                {' '}Auto-apply on match
              </label>
              <label className="tbs-form-field__label" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                {' '}Enabled
              </label>
            </div>
          </div>
          <div className="tbs-settings__rule-form-actions">
            <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel">Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void handleSave()}
              disabled={!url.trim() || status === 'saving'}
              aria-label="Update Rule"
            >
              {status === 'saving' ? 'Saving...' : 'Update Rule'}
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function RulesSection() {
  const [search, setSearch] = useState('');
  const [rules, setRules] = useState<PageRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  /** Rule IDs currently expanded in inline editors — multiple can be open at once */
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  /** Sort state for the rules table (key + direction). null = no sort (insertion order). */
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  // Load rules from background
  const loadRules = useCallback(async () => {
    try {
      const res = await sendMessage('GET_STATE');
      const result = extractResult(res);
      if (result?.success && (result.sync as Record<string, unknown>)?.rules) {
        setRules((result.sync as { rules: PageRule[] }).rules);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    void loadRules();
    const onStorageChanged = (_changes: unknown, areaName: string) => {
      if (areaName === 'sync') void loadRules();
    };
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    return () => { chrome.storage?.onChanged?.removeListener(onStorageChanged); };
  }, [loadRules]);

  const handleNewRule = () => {
    setForm(EMPTY_RULE_FORM);
    setError(null);
    setShowForm(true);
  };

  // Module 2: toggle inline editor expansion per rule (multiple can be open)
  const toggleExpand = useCallback((ruleId: string) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }, []);

  // Module 2: save from an inline editor with expectedUpdatedAt version check
  const handleInlineSave = useCallback(async (
    ruleId: string,
    updates: Partial<Pick<PageRule, 'urlMatch' | 'mode' | 'priority' | 'title' | 'favicon' | 'enabled'>>,
    expectedUpdatedAt: string,
  ): Promise<{ success: boolean; errorCode?: string; message?: string }> => {
    try {
      const res = await sendMessage('UPDATE_RULE', { ruleId, ...updates, expectedUpdatedAt });
      const result = extractResult(res);
      if (result?.success) {
        // Auto-hide the editor (handled in InlineRuleEditor) and show a floating
        // toast, matching the Data Dashboard Edit success style.
        setToast({ variant: 'success', message: 'Rule updated' });
        void loadRules();
        return { success: true };
      }
      return {
        success: false,
        errorCode: (result?.errorCode as string) ?? 'INTERNAL_ERROR',
        message: (result?.message as string) || 'Failed to update rule',
      };
    } catch {
      return { success: false, errorCode: 'INTERNAL_ERROR', message: 'Operation failed' };
    }
  }, [loadRules]);

  const handleSaveRule = async () => {
    if (!form.url.trim()) { setError('URL is required'); return; }

    // Problem 2: Auto-convert wildcard patterns to valid regex
    let urlValue = form.url.trim();
    if (form.matchType === 'regex') {
      const conversion = wildcardToRegex(urlValue);
      if (conversion.converted) {
        urlValue = conversion.pattern;
      }
      // Final validation
      try {
        new RegExp(urlValue);
      } catch (e) {
        setError(`Invalid regex: ${e instanceof Error ? e.message : 'syntax error'}`);
        return;
      }
    }

    setSaving(true);
    setError(null);

    // Problem 4: Compute favicon based on iconMode (mutually exclusive):
    // URL → text input; Custom → rendered data URI; Reset → clear the icon.
    let favicon: { type: string; value: string } | undefined;
    if (form.iconMode === 'custom') {
      const dataUri = renderIconToDataUri(form.iconConfig, 64);
      if (dataUri) favicon = { type: 'upload', value: dataUri };
    } else if (form.iconMode === 'url' && form.iconUrl.trim()) {
      favicon = { type: 'url', value: form.iconUrl.trim() };
    }
    // Reset mode → favicon stays undefined → cleared (falls back to rule chain).

    try {
      // Create new rule — conflict/duplicate detection happens in the background
      const res = await sendMessage('CREATE_RULE', {
        urlMatch: { type: form.matchType, value: urlValue },
        mode: form.mode,
        priority: Math.max(-100, Math.min(100, form.priority)),
        title: form.title.trim() || undefined,
        favicon,
      });
      const result = extractResult(res);
      if (result?.success) {
        // Auto-hide the form after a successful save and show a floating toast,
        // matching the Data Dashboard Edit success style.
        setShowForm(false);
        setForm(EMPTY_RULE_FORM);
        setToast({ variant: 'success', message: 'rule created' });
        void loadRules();
      } else {
        setError((result?.message as string) || 'Failed to create rule');
      }
    } catch {
      setError('Operation failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await sendMessage('DELETE_RULE', { ruleId });
      void loadRules();
    } catch {
      // silently fail
    }
  };

  const handleToggleEnabled = async (rule: PageRule) => {
    setTogglingId(rule.id);
    try {
      const res = await sendMessage('UPDATE_RULE', {
        ruleId: rule.id,
        enabled: rule.enabled === false,
      });
      const result = extractResult(res);
      if (result?.success) {
        void loadRules();
      } else {
        setToast({ variant: 'error', message: (result?.message as string) || 'Failed to toggle rule' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to toggle rule' });
    } finally {
      setTogglingId(null);
    }
  };

  // Batch operations
  const handleBatchDelete = async () => {
    setBatchProcessing(true);
    for (const id of selectedIds) {
      try {
        await sendMessage('DELETE_RULE', { ruleId: id });
      } catch { /* continue */ }
    }
    setSelectedIds(new Set());
    setBatchProcessing(false);
    void loadRules();
  };

  const handleBatchSetEnabled = async (enabled: boolean) => {
    setBatchProcessing(true);
    for (const id of selectedIds) {
      try {
        await sendMessage('UPDATE_RULE', { ruleId: id, enabled });
      } catch { /* continue */ }
    }
    setSelectedIds(new Set());
    setBatchProcessing(false);
    void loadRules();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRules.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRules.map((r) => r.id)));
    }
  };

  const filteredRules = (() => {
    const matching = rules.filter((r) =>
      r.urlMatch.value.toLowerCase().includes(search.toLowerCase()) ||
      (r.title ?? '').toLowerCase().includes(search.toLowerCase())
    );
    if (!sort) return matching;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...matching].sort((a, b) => dir * compareRules(a, b, sort.key));
  })();

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev && prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'asc' };
    });
  };

  return (
    <section aria-label="Page rewrite rules">
      <h2>Page Rewrite Rules</h2>

      <div className="tbs-settings__toolbar">
        <input
          type="text"
          className="tbs-settings__search"
          placeholder="Search rules..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search rules"
        />
        <Button size="sm" variant="primary" aria-label="Create new rule" onClick={handleNewRule}>+ New Rule</Button>
      </div>

      {/* Batch operations bar */}
      {selectedIds.size > 0 && (
        <div className="tbs-settings__batch-bar" role="toolbar" aria-label="Batch operations">
          <span>{selectedIds.size} selected</span>
          <Button size="sm" variant="secondary" onClick={() => void handleBatchSetEnabled(true)} disabled={batchProcessing}>Enable</Button>
          <Button size="sm" variant="secondary" onClick={() => void handleBatchSetEnabled(false)} disabled={batchProcessing}>Disable</Button>
          <Button size="sm" variant="danger" onClick={() => void handleBatchDelete()} disabled={batchProcessing}>
            {batchProcessing ? 'Processing...' : 'Delete'}
          </Button>
        </div>
      )}

      {/* Inline rule creation form (new rules). Editing happens inline per-row below. */}
      {showForm && (
        <div className="tbs-settings__rule-form" role="form" aria-label="Create new rule">
          <h3>New Rule</h3>
          {error && <p className="tbs-settings__rule-form-error" role="alert">{error}</p>}
          <div className="tbs-settings__rule-form-grid">
            <div className="tbs-form-field">
              <label htmlFor="rf-url" className="tbs-form-field__label">Match URL *</label>
              <div className="tbs-inline-field">
                <input
                  id="rf-url"
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://example.com/page"
                />
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onClick={() => setForm({ ...form, url: '' })}
                  aria-label="Reset Match URL"
                  title="Reset Match URL"
                >
                  ↺
                </button>
              </div>
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Match Type</label>
              <div className="tbs-settings__rule-form-radio">
                <label><input type="radio" name="rf-match" checked={form.matchType === 'exact'} onChange={() => setForm({ ...form, matchType: 'exact' })} /> Exact URL</label>
                <label><input type="radio" name="rf-match" checked={form.matchType === 'regex'} onChange={() => setForm({ ...form, matchType: 'regex' })} /> Regex</label>
              </div>
              {/* Problem 5: Real-time regex validation feedback */}
              {form.matchType === 'regex' && form.url.trim() && (() => {
                try {
                  new RegExp(form.url.trim());
                  return <span className="tbs-settings__regex-valid" role="status">✓ Valid regex</span>;
                } catch (e) {
                  return <span className="tbs-settings__regex-invalid" role="alert">✗ {e instanceof Error ? e.message : 'Invalid regex'}</span>;
                }
              })()}
            </div>
            <div className="tbs-form-field">
              <label htmlFor="rf-title" className="tbs-form-field__label">Custom Title (optional)</label>
              <div className="tbs-inline-field">
                <input
                  id="rf-title"
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Leave empty to keep original"
                />
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onClick={() => setForm({ ...form, title: '' })}
                  aria-label="Reset Custom Title"
                  title="Reset Custom Title"
                >
                  ↺
                </button>
              </div>
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Icon (optional)</label>
              <div className="tbs-settings__rule-form-radio" role="radiogroup" aria-label="Icon mode">
                <label>
                  <input type="radio" name="rf-icon-mode" checked={form.iconMode === 'url'} onChange={() => setForm((prev) => ({ ...prev, prevIconMode: prev.iconMode !== 'reset' ? prev.iconMode : prev.prevIconMode, iconMode: 'url' }))} />
                  URL
                </label>
                <label>
                  <input type="radio" name="rf-icon-mode" checked={form.iconMode === 'custom'} onChange={() => setForm((prev) => ({ ...prev, prevIconMode: prev.iconMode !== 'reset' ? prev.iconMode : prev.prevIconMode, iconMode: 'custom' }))} />
                  Custom
                </label>
                <label>
                  <input type="radio" name="rf-icon-mode" checked={form.iconMode === 'reset'} onChange={() => setForm((prev) => ({ ...prev, prevIconMode: prev.iconMode !== 'reset' ? prev.iconMode : prev.prevIconMode, iconMode: 'reset' }))} />
                  Reset
                </label>
              </div>
              {form.iconMode === 'url' && (
                <input
                  id="rf-icon"
                  type="text"
                  value={form.iconUrl}
                  onChange={(e) => setForm({ ...form, iconUrl: e.target.value })}
                  placeholder="https:// or data: URI"
                  aria-label="Icon URL"
                />
              )}
              {form.iconMode === 'custom' && (
                <IconEditor value={form.iconConfig} onChange={(cfg) => setForm({ ...form, iconConfig: cfg })} size={48} />
              )}
              {form.iconMode === 'reset' && (
                <p className="tbs-settings__hint">Icon will be cleared and shown as "—".</p>
              )}
            </div>
            <div className="tbs-form-field">
              <label htmlFor="rf-priority" className="tbs-form-field__label">Priority (-100 to 100)</label>
              <input
                id="rf-priority"
                type="number"
                min={-100}
                max={100}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">
                <input type="checkbox" checked={form.mode === 'auto'} onChange={(e) => setForm({ ...form, mode: e.target.checked ? 'auto' : 'manual' })} />
                {' '}Auto-apply on match
              </label>
            </div>
          </div>
          <div className="tbs-settings__rule-form-actions">
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => void handleSaveRule()} loading={saving} disabled={!form.url.trim()}>
              Save Rule
            </Button>
          </div>
        </div>
      )}

      <table className="tbs-settings__table" role="table" aria-label="Page rules">
        <thead>
          <tr>
            <th scope="col" style={{ width: '32px' }}>
              <input
                type="checkbox"
                checked={filteredRules.length > 0 && selectedIds.size === filteredRules.length}
                onChange={toggleSelectAll}
                aria-label="Select all rules"
              />
            </th>
            <th scope="col" style={{ width: '32px' }}>Icon</th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => toggleSort('urlMatch')}
                aria-label="Sort by URL Pattern"
              >
                URL Pattern {sort?.key === 'urlMatch' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => toggleSort('mode')}
                aria-label="Sort by Mode"
              >
                Mode {sort?.key === 'mode' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => toggleSort('priority')}
                aria-label="Sort by Priority"
              >
                Priority {sort?.key === 'priority' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => toggleSort('title')}
                aria-label="Sort by Title"
              >
                Title {sort?.key === 'title' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => toggleSort('enabled')}
                aria-label="Sort by Enabled"
              >
                Enabled {sort?.key === 'enabled' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <div className="tbs-settings__actions-head">
                Actions
                <button
                  type="button"
                  className="tbs-settings__sort-reset"
                  onClick={() => setSort(null)}
                  aria-label="Reset sorting"
                  title="Reset sorting"
                >
                  ↺
                </button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredRules.map((rule) => (
            <Fragment key={rule.id}>
              <tr className={rule.enabled === false ? 'tbs-settings__row--disabled' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(rule.id)}
                    onChange={() => toggleSelect(rule.id)}
                    aria-label={`Select rule ${rule.id}`}
                  />
                </td>
                <td>
                  {rule.favicon?.value ? (
                    <img src={rule.favicon.value} alt="" style={{ width: 16, height: 16, borderRadius: 2, verticalAlign: 'middle' }} />
                  ) : (
                    <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 2, background: '#9CA3AF', verticalAlign: 'middle', textAlign: 'center', fontSize: 10, lineHeight: '16px', color: '#fff' }}>🌐</span>
                  )}
                </td>
                <td title={rule.urlMatch.value}>
                  <code>{rule.urlMatch.type === 'regex' ? `/${rule.urlMatch.value}/` : rule.urlMatch.value}</code>
                </td>
                <td>
                  <StatusBadge status={rule.mode === 'auto' ? 'active' : 'pending'} label={rule.mode} />
                </td>
                <td>{rule.priority}</td>
                <td>{rule.title ?? '—'}</td>
                <td>
                  <label className="tbs-settings__toggle" title={rule.enabled !== false ? 'Enabled' : 'Disabled'}>
                    <input
                      type="checkbox"
                      checked={rule.enabled !== false}
                      disabled={togglingId === rule.id}
                      onChange={() => void handleToggleEnabled(rule)}
                      aria-label={`Toggle rule ${rule.id}`}
                    />
                  </label>
                </td>
                <td>
                  <div className="tbs-settings__row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleExpand(rule.id)}
                      aria-label={`Edit rule ${rule.id}`}
                      aria-expanded={expandedRuleIds.has(rule.id)}
                    >
                      ✏️
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void handleDeleteRule(rule.id)} aria-label={`Delete rule ${rule.id}`}>
                      🗑️
                    </Button>
                  </div>
                </td>
              </tr>
              {/* Module 2: inline editor expands directly below the row */}
              {expandedRuleIds.has(rule.id) && (
                <InlineRuleEditor
                  rule={rule}
                  onSave={handleInlineSave}
                  onCancel={() => toggleExpand(rule.id)}
                />
              )}
            </Fragment>
          ))}
          {filteredRules.length === 0 && (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                No rules configured. Create one here or use the sidebar &quot;+&quot; button.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </section>
  );
}

// ─── Data Dashboard Section ────────────────────────────────────────────────

interface DashboardEntry {
  id: string;
  kind: 'current-page' | 'slot';
  label: string;
  title: string | null;
  icon: string | null;
  url: string | null;
  tabId?: number;
  slotId?: number;
}

// Local edit-form buffer for a single dashboard entry (issue 3).
interface DashboardEditForm {
  entryId: string;
  title: string;
  icon: string;
  originalTitle: string | null;
  originalIcon: string | null;
  /** Icon mode: URL text input, Custom icon editor, or Reset (clear icon). */
  iconMode: 'url' | 'custom' | 'reset';
  iconConfig: IconConfig;
  /** Cached previous mode so switching back restores the user's prior input. */
  prevIconMode: 'url' | 'custom' | null;
}

type DashboardSortKey = 'label' | 'title';
type SortDir = 'asc' | 'desc';

function DashboardSection() {
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sortKey, setSortKey] = useState<DashboardSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editing, setEditing] = useState<DashboardEditForm | null>(null);
  const [showUrl, setShowUrl] = useState(false);

  const sortedEntries = useMemo(() => {
    if (!sortKey) return entries;
    const dir = sortDir === 'asc' ? 1 : -1;
    const sorted = [...entries].sort((a, b) => {
      return (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, { numeric: true }) * dir;
    });
    return sorted;
  }, [entries, sortKey, sortDir]);

  const toggleSort = (key: DashboardSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const resetSort = () => {
    setSortKey(null);
    setSortDir('asc');
  };

  const load = useCallback(async () => {
    try {
      const res = await sendMessage('GET_DASHBOARD');
      const result = extractResult(res);
      if (!result?.success) return;
      const rows: DashboardEntry[] = (result.items as DashboardItem[]).map((i) => ({
        id: i.id,
        kind: i.kind,
        label: i.label,
        title: i.title ?? null,
        icon: i.icon ?? null,
        url: i.url ?? null,
        tabId: i.tabId,
        slotId: i.slotId,
      }));
      setEntries(rows);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
    const onStorageChanged = (_changes: unknown, areaName: string) => {
      if (areaName === 'sync' || areaName === 'local') void load();
    };
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    return () => chrome.storage?.onChanged?.removeListener(onStorageChanged);
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetEntry = async (entry: DashboardEntry) => {
    setBusy(true);
    try {
      if (entry.kind === 'current-page' && entry.tabId != null) {
        await sendMessage('REMOVE_TAB_OVERRIDE', { tabId: entry.tabId });
      } else if (entry.kind === 'slot' && entry.slotId != null) {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: entry.slotId,
          uiMarker: { customTitle: '', icon: { type: 'url', value: '' } },
        });
      }
      setToast({ variant: 'success', message: `${entry.label} reset` });
      void load();
    } catch {
      setToast({ variant: 'error', message: `Failed to reset ${entry.label}` });
    } finally {
      setBusy(false);
    }
  };

  const resetAll = async () => {
    setBusy(true);
    try {
      for (const entry of entries) {
        if (entry.kind === 'current-page' && entry.tabId != null) {
          await sendMessage('REMOVE_TAB_OVERRIDE', { tabId: entry.tabId });
        } else if (entry.kind === 'slot' && entry.slotId != null) {
          await sendMessage('UPDATE_SLOT_UI_MARKER', {
            slotId: entry.slotId,
            uiMarker: { customTitle: '', icon: { type: 'url', value: '' } },
          });
        }
      }
      setToast({ variant: 'success', message: 'All items reset' });
      setSelected(new Set());
      void load();
    } catch {
      setToast({ variant: 'error', message: 'Failed to reset all items' });
    } finally {
      setBusy(false);
    }
  };

  const resetSelected = async () => {
    setBusy(true);
    try {
      for (const entry of entries) {
        if (!selected.has(entry.id)) continue;
        if (entry.kind === 'current-page' && entry.tabId != null) {
          await sendMessage('REMOVE_TAB_OVERRIDE', { tabId: entry.tabId });
        } else if (entry.kind === 'slot' && entry.slotId != null) {
          await sendMessage('UPDATE_SLOT_UI_MARKER', {
            slotId: entry.slotId,
            uiMarker: { customTitle: '', icon: { type: 'url', value: '' } },
          });
        }
      }
      setToast({ variant: 'success', message: 'Selected items reset' });
      setSelected(new Set());
      void load();
    } catch {
      setToast({ variant: 'error', message: 'Failed to reset selected items' });
    } finally {
      setBusy(false);
    }
  };

  // ─── Field-level operations (issue 1/2/3) ────────────────────────────────

  /** Clear the Title at the current level (falls through to slot → rule → original). */
  const resetEntryTitle = async (entry: DashboardEntry) => {
    setBusy(true);
    try {
      if (entry.kind === 'current-page' && entry.tabId != null) {
        await sendMessage('SET_TAB_OVERRIDE', { tabId: entry.tabId, title: '' });
      } else if (entry.kind === 'slot' && entry.slotId != null) {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: entry.slotId,
          uiMarker: { customTitle: '' },
        });
      }
      setToast({ variant: 'success', message: `${entry.label} title cleared` });
      void load();
    } catch {
      setToast({ variant: 'error', message: `Failed to clear ${entry.label} title` });
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (entry: DashboardEntry) => {
    const existingIcon = entry.icon ?? '';
    const isCustom = existingIcon.startsWith('data:');
    setEditing({
      entryId: entry.id,
      title: entry.title ?? '',
      icon: existingIcon,
      originalTitle: entry.title,
      originalIcon: entry.icon,
      // If the existing icon is a data URI it was a Custom icon; otherwise use URL mode.
      iconMode: isCustom ? 'custom' : 'url',
      iconConfig: isCustom
        ? { dataUri: existingIcon }
        : { bgColor: '#2563EB', text: '', textColor: '#FFFFFF' },
      prevIconMode: null,
    });
  };

  const applyEditTitle = async () => {
    if (!editing) return;
    const entry = entries.find((e) => e.id === editing.entryId);
    if (!entry) return;
    setBusy(true);
    try {
      const next = editing.title.trim();
      if (entry.kind === 'current-page' && entry.tabId != null) {
        // Empty or unchanged title = no change at this level.
        await sendMessage('SET_TAB_OVERRIDE', {
          tabId: entry.tabId,
          title: next === '' || next === (editing.originalTitle ?? '') ? '' : next,
        });
      } else if (entry.kind === 'slot' && entry.slotId != null) {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: entry.slotId,
          uiMarker: { customTitle: next },
        });
      }
      setToast({ variant: 'success', message: `${entry.label} title updated` });
      void load();
    } catch {
      setToast({ variant: 'error', message: `Failed to update ${entry.label} title` });
    } finally {
      setBusy(false);
    }
  };

  const applyEditIcon = async () => {
    if (!editing) return;
    const entry = entries.find((e) => e.id === editing.entryId);
    if (!entry) return;
    setBusy(true);
    try {
      // Compute the favicon value based on the selected mode:
      // URL → text input; Custom → rendered data URI; Reset → clear icon.
      let favicon: IconSource | null = null;
      if (editing.iconMode === 'custom') {
        const dataUri = renderIconToDataUri(editing.iconConfig, 64);
        if (dataUri) favicon = { type: 'upload', value: dataUri };
      } else if (editing.iconMode === 'url' && editing.icon.trim()) {
        favicon = { type: 'url', value: editing.icon.trim() };
      }
      // Reset mode → favicon stays null → field-level clear (falls back through
      // slot → rule → original; dashboard shows "—").

      if (entry.kind === 'current-page' && entry.tabId != null) {
        await sendMessage('SET_TAB_OVERRIDE', { tabId: entry.tabId, favicon });
      } else if (entry.kind === 'slot' && entry.slotId != null) {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: entry.slotId,
          uiMarker: { icon: favicon ?? { type: 'url', value: '' } },
        });
      }
      setToast({ variant: 'success', message: `${entry.label} icon updated` });
      void load();
    } catch {
      setToast({ variant: 'error', message: `Failed to update ${entry.label} icon` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Data dashboard">
      <h2>Data Dashboard</h2>
      <p className="tbs-settings__hint">
        All icons and titles you set via the sidebar current page and slot objects. Reset them to restore original values.
      </p>

      <div className="tbs-settings__toolbar">
        <Button size="sm" variant="secondary" onClick={() => void resetSelected()} disabled={selected.size === 0 || busy} aria-label="Reset selected items">
          Reset Selected ({selected.size})
        </Button>
        <Button size="sm" variant="danger" onClick={() => void resetAll()} disabled={entries.length === 0 || busy} aria-label="Reset all items">
          Reset All
        </Button>
      </div>

      <table className="tbs-settings__table" role="table" aria-label="Set icons and titles">
        <thead>
          <tr>
            <th scope="col" style={{ width: '32px' }}>
              <input
                type="checkbox"
                checked={entries.length > 0 && selected.size === entries.length}
                onChange={() => {
                  if (selected.size === entries.length) setSelected(new Set());
                  else setSelected(new Set(entries.map((e) => e.id)));
                }}
                aria-label="Select all dashboard items"
              />
            </th>
            <th scope="col">
              <div className="tbs-settings__actions-head">
                <button
                  type="button"
                  className="tbs-settings__sortable"
                  onClick={() => toggleSort('label')}
                  aria-label="Sort by Source"
                >
                  Source{sortKey === 'label' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
                {/* URL show/hide toggle (issue 4): inactive = URLs shown, active = hidden */}
                <button
                  type="button"
                  className={`tbs-inline-field__reset tbs-settings__url-toggle${showUrl ? ' is-active' : ''}`}
                  onClick={() => setShowUrl((v) => !v)}
                  aria-label={showUrl ? 'Hide URLs' : 'Show URLs'}
                  title={showUrl ? 'Hide URLs' : 'Show URLs'}
                >
                  ⊘
                </button>
              </div>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => toggleSort('title')}
                aria-label="Sort by Title"
              >
                Title{sortKey === 'title' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </button>
            </th>
            <th scope="col">Icon</th>
            <th scope="col">
              <div className="tbs-settings__actions-head">
                Actions
                <button
                  type="button"
                  className="tbs-inline-field__reset tbs-settings__sort-reset"
                  onClick={resetSort}
                  aria-label="Reset dashboard sort"
                  title="Reset sort"
                >
                  ↺
                </button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  onChange={() => toggleSelect(entry.id)}
                  aria-label={`Select ${entry.label}`}
                />
              </td>
              <td>
                {entry.label} ({entry.kind === 'slot' ? 'slot' : 'current page'})
                {/* URL shown after the source when the hide toggle is inactive (issue 4) */}
                {!showUrl && entry.url && (
                  <span className="tbs-settings__dashboard-url" title={entry.url}>{entry.url}</span>
                )}
              </td>
              <td>{entry.title ?? '—'}</td>
              <td>
                {entry.icon ? (
                  <img src={entry.icon} alt="" style={{ width: 16, height: 16, borderRadius: 2, verticalAlign: 'middle' }} />
                ) : (
                  '—'
                )}
              </td>
              <td>
                <div className="tbs-settings__row-actions">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(entry)} disabled={busy} aria-label={`Edit ${entry.label}`}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void resetEntry(entry)} disabled={busy} aria-label={`Reset ${entry.label}`}>
                    Reset
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                No custom icons or titles set yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Dashboard Edit interface (issue 3) — modeled after the Edit Rule form */}
      {editing && (
        <div className="tbs-settings__rule-form" role="form" aria-label={`Edit ${editing.entryId}`}>
          <h3>Edit {editing.entryId}</h3>
          <div className="tbs-settings__rule-form-grid">
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Title</label>
              <div className="tbs-inline-field">
                <input
                  type="text"
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  aria-label="Edit Title"
                />
                <button
                  type="button"
                  className="tbs-inline-field__reset"
                  onClick={() => {
                    const entry = entries.find((e) => e.id === editing.entryId);
                    if (entry) void resetEntryTitle(entry);
                  }}
                  aria-label="Reset Title"
                  title="Reset Title"
                >
                  ↺
                </button>
              </div>
            </div>
            <div className="tbs-form-field">
              <label className="tbs-form-field__label">Icon (optional)</label>
              <div className="tbs-settings__rule-form-radio" role="radiogroup" aria-label="Icon mode">
                <label>
                  <input
                    type="radio"
                    checked={editing.iconMode === 'url'}
                    onChange={() => setEditing((prev) => prev ? { ...prev, prevIconMode: prev.iconMode !== 'reset' ? prev.iconMode : prev.prevIconMode, iconMode: 'url' } : prev)}
                  />
                  URL
                </label>
                <label>
                  <input
                    type="radio"
                    checked={editing.iconMode === 'custom'}
                    onChange={() => setEditing((prev) => prev ? { ...prev, prevIconMode: prev.iconMode !== 'reset' ? prev.iconMode : prev.prevIconMode, iconMode: 'custom' } : prev)}
                  />
                  Custom
                </label>
                <label>
                  <input
                    type="radio"
                    checked={editing.iconMode === 'reset'}
                    onChange={() => setEditing((prev) => prev ? { ...prev, prevIconMode: prev.iconMode !== 'reset' ? prev.iconMode : prev.prevIconMode, iconMode: 'reset' } : prev)}
                  />
                  Reset
                </label>
              </div>
              {editing.iconMode === 'url' && (
                <div className="tbs-inline-field">
                  <input
                    type="text"
                    value={editing.icon}
                    onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                    aria-label="Edit Icon"
                  />
                </div>
              )}
              {editing.iconMode === 'custom' && (
                <IconEditor
                  value={editing.iconConfig}
                  onChange={(cfg) => setEditing({ ...editing, iconConfig: cfg })}
                  size={48}
                />
              )}
              {editing.iconMode === 'reset' && (
                <p className="tbs-settings__hint">Icon will be cleared and shown as "—".</p>
              )}
            </div>
          </div>
          <div className="tbs-settings__rule-form-actions">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" variant="secondary" onClick={() => void applyEditTitle()} disabled={busy} aria-label="Apply title changes">
              Apply Title
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void applyEditIcon()} disabled={busy} aria-label="Apply icon changes">
              Apply Icon
            </Button>
            <Button size="sm" variant="primary" onClick={() => setEditing(null)} disabled={busy} aria-label="Done editing">
              Done
            </Button>
          </div>
        </div>
      )}

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </section>
  );
}

// ─── Import/Export Section (Problem 7) ──────────────────────────────────────

function ImportExportSection() {
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);

  const handleExport = async () => {
    try {
      const res = await sendMessage('EXPORT_CONFIG');
      const result = extractResult(res);
      if (result?.success && result.json) {
        const blob = new Blob([result.json as string], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tab-bookmarks-config-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setToast({ variant: 'success', message: 'Configuration exported' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Export failed' });
    }
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setPreview(null);
      try {
        const text = await file.text();
        // Basic JSON validation
        JSON.parse(text);
        // Send to background for preview
        const res = await sendMessage('IMPORT_PREVIEW', { json: text });
        const result = extractResult(res);
        if (result?.success && result.preview) {
          setPreview(result.preview as ImportPreview);
        } else {
          setToast({ variant: 'error', message: (result?.message as string) || 'Invalid import file' });
        }
      } catch {
        setToast({ variant: 'error', message: 'Failed to parse JSON file' });
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const handleCommitImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      // Build slot decisions based on import mode
      const slotDecisions: ImportSlotConflict[] = preview.slotConflicts.map((conflict) => ({
        ...conflict,
        decision: importMode === 'replace' ? 'import' as const : 'existing' as const,
      }));

      const res = await sendMessage('IMPORT_COMMIT', {
        preview,
        slotDecisions,
      });
      const result = extractResult(res);
      if (result?.success) {
        setToast({ variant: 'success', message: 'Import successful' });
        setPreview(null);
      } else {
        setToast({ variant: 'error', message: (result?.message as string) || 'Import failed' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <section aria-label="Import and export">
      <h2>Import / Export</h2>

      <div className="tbs-settings__import-zone">
        <p>Import configuration from a JSON file</p>
        <Button size="md" variant="secondary" onClick={handleImportClick} loading={importing} aria-label="Import configuration">
          Choose File to Import
        </Button>
      </div>

      {/* Import preview */}
      {preview && (
        <div className="tbs-settings__import-preview" role="region" aria-label="Import preview">
          <h3>Import Preview</h3>
          <ul>
            <li>Slots: {preview.newSlots.length} new, {preview.slotConflicts.length} conflicts</li>
            <li>Rules: {preview.rules.length}</li>
            <li>Global Strategy: {preview.globalStrategy}</li>
          </ul>

          {preview.slotConflicts.length > 0 && (
            <div className="tbs-settings__import-mode">
              <p>Conflict resolution:</p>
              <label>
                <input type="radio" name="import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />
                Keep existing (merge)
              </label>
              <label>
                <input type="radio" name="import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
                Replace with imported
              </label>
            </div>
          )}

          <div className="tbs-settings__import-actions">
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => void handleCommitImport()} loading={importing}>
              Confirm Import
            </Button>
          </div>
        </div>
      )}

      <h3>Export</h3>
      <p className="tbs-settings__hint">
        Export all slots, rules, and settings as a JSON backup file.
      </p>
      <Button size="md" variant="primary" onClick={() => void handleExport()} aria-label="Export configuration">
        Export Configuration
      </Button>

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </section>
  );
}

// ─── Diagnostics Section ────────────────────────────────────────────────────

interface DiagEntry {
  timestamp: string;
  errorCode: string;
  browserType: string;
  operationType: string;
}

function DiagnosticsSection() {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await sendMessage('GET_DIAGNOSTICS');
        const result = extractResult(res);
        if (result?.success && result.entries) {
          setEntries(result.entries as DiagEntry[]);
        }
      } catch {
        // silently fail
      }
      setLoaded(true);
    };
    void load();
  }, []);

  const handleClear = async () => {
    try {
      await sendMessage('CLEAR_DIAGNOSTICS');
      setEntries([]);
    } catch {
      // silently fail
    }
  };

  const handleExport = async () => {
    try {
      const res = await sendMessage('EXPORT_DIAGNOSTICS');
      const result = extractResult(res);
      if (result?.success && result.json) {
        const blob = new Blob([result.json as string], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // silently fail
    }
  };

  return (
    <section aria-label="Diagnostics">
      <h2>Diagnostics</h2>
      <p className="tbs-settings__hint">
        Logs contain only timestamps, error codes, browser type, and operation type. No URLs, titles, or rule content.
      </p>

      <div className="tbs-settings__diag-actions">
        <Button size="sm" variant="secondary" onClick={() => void handleExport()} aria-label="Export diagnostics">Export</Button>
        <Button size="sm" variant="danger" onClick={() => void handleClear()} aria-label="Clear diagnostics">Clear All</Button>
      </div>

      <table className="tbs-settings__table" role="table" aria-label="Diagnostic entries">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Code</th>
            <th scope="col">Browser</th>
            <th scope="col">Operation</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={i}>
              <td>{entry.timestamp}</td>
              <td>
                <StatusBadge
                  status={entry.errorCode === 'SUCCESS' ? 'active' : 'error'}
                  label={entry.errorCode}
                />
              </td>
              <td>{entry.browserType}</td>
              <td>{entry.operationType}</td>
            </tr>
          ))}
          {loaded && entries.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>No diagnostic entries</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// ─── Main Settings App ───────────────────────────────────────────────────────

export function SettingsApp() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('slots');
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [globalStrategy, setGlobalStrategy] = useState<MatchStrategy>('B');
  const [slots, setSlots] = useState<SlotDefinition[]>([]);
  const [configVersion, setConfigVersion] = useState(0);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [conflictBanner, setConflictBanner] = useState(false);

  // Load state
  const loadState = useCallback(async () => {
    try {
      const [cmdRes, stateRes] = await Promise.all([
        sendMessage('GET_COMMANDS'),
        sendMessage('GET_STATE'),
      ]);
      const cmdResult = extractResult(cmdRes);
      const stateResult = extractResult(stateRes);
      if (cmdResult?.success && cmdResult.commands) {
        setCommands(cmdResult.commands as CommandInfo[]);
      }
      if (stateResult?.success && stateResult.sync) {
        const sync = stateResult.sync as { globalStrategy: MatchStrategy; slots: SlotDefinition[]; configVersion: number };
        setGlobalStrategy(sync.globalStrategy);
        setSlots(sync.slots);
        setConfigVersion(sync.configVersion);
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to load settings' });
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const handleGlobalChange = useCallback(async (strategy: MatchStrategy) => {
    try {
      const res = await sendMessage('SET_GLOBAL_STRATEGY', { strategy }, configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setGlobalStrategy(strategy);
        setConfigVersion((v) => v + 1);
        setToast({ variant: 'success', message: 'Strategy updated' });
      } else if (result?.errorCode === 'CONFIG_CONFLICT') {
        setConflictBanner(true);
        void loadState();
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to update strategy' });
    }
  }, [configVersion, loadState]);

  const handleSlotChange = useCallback(async (slotId: number, strategy: MatchStrategy | 'inherit') => {
    try {
      const res = await sendMessage('SET_SLOT_STRATEGY', { slotId, strategy }, configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setSlots((prev) => prev.map((s) => s.id === slotId ? { ...s, strategy } : s));
        setConfigVersion((v) => v + 1);
      } else if (result?.errorCode === 'CONFIG_CONFLICT') {
        setConflictBanner(true);
        void loadState();
      }
    } catch {
      setToast({ variant: 'error', message: `Failed to update slot ${slotId}` });
    }
  }, [configVersion, loadState]);

  return (
    <div role="application" aria-label="Tab Bookmarks Settings" className="tbs-settings">
      {/* Left navigation */}
      <nav className="tbs-settings__nav" aria-label="Settings navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`tbs-settings__nav-item ${activeSection === item.id ? 'tbs-settings__nav-item--active' : ''}`}
            onClick={() => setActiveSection(item.id)}
            aria-current={activeSection === item.id ? 'page' : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="tbs-settings__content">
        {conflictBanner && (
          <div role="alert" className="tbs-settings__conflict-banner">
            Configuration was changed externally. State has been refreshed.
            <Button size="sm" variant="ghost" onClick={() => setConflictBanner(false)}>Dismiss</Button>
          </div>
        )}

        {activeSection === 'slots' && <ShortcutsSection commands={commands} />}
        {activeSection === 'strategy' && (
          <StrategySection
            globalStrategy={globalStrategy}
            slots={slots}
            configVersion={configVersion}
            onGlobalChange={handleGlobalChange}
            onSlotChange={handleSlotChange}
          />
        )}
        {activeSection === 'rules' && (
          <RulesSection />
        )}
        {activeSection === 'dashboard' && <DashboardSection />}
        {activeSection === 'import-export' && <ImportExportSection />}
        {activeSection === 'diagnostics' && <DiagnosticsSection />}
      </main>

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
