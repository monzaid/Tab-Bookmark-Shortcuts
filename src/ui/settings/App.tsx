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

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { Button, Toast, StatusBadge, Confirm, Dialog } from '@ui/shared/components';
import { EmptyState } from '@ui/shared/empty-state';
import type { IconConfig } from '@ui/components/IconEditor';
import type { MatchRuleSettings, SwitchDirection, Priority, TabIdMode, RuleCheckMode, SlotDefinition, PageRule, IconSource, TabOverride, DashboardRow, ImportInspection, ImportIntent, DimensionPresence, DimensionMode, ExportScope, SyncState } from '@shared/types';
import { DEFAULT_MATCH_SETTINGS, defaultImportIntent } from '@shared/types';
import { applyIntent, quantifyDeletions } from '@shared/import-diff';
import { isExportPackage } from '@shared/export-package';
import type { ExportPackage } from '@shared/export-package';

import { RuleFormFields } from '@ui/shared/rule-form-fields';
import { FieldEditor } from '@ui/shared/field-editor';
import type { FieldMode } from '@ui/shared/field-editor';
import { InlineEditorShell } from '@ui/shared/inline-editor-shell';
import { normalizeRuleDraft, resolveDraftFavicon, validateRuleDraft } from '@ui/shared/rule-form-submit';
import type { RuleDraftValue } from '@ui/shared/rule-form-submit';
import { resolveFieldChain } from '@shared/field-chain';
import type { ChainResult, TierKey, TierOwner } from '@shared/field-chain';
import { useJumpToRow, JUMP_HIGHLIGHT_CLASS, JUMP_HIGHLIGHT_MS } from '@ui/shared/use-jump-to-row';
import { canonicalIconSource, iconSourceForOwner, iconSourceToDraft } from '@ui/shared/icon-source';
import { fromIconFieldValue } from '@ui/shared/icon-mode-adapter';
import { UndoBar } from '@ui/shared/undo-bar';
import type { UndoState, UndoSnapshot } from '@ui/shared/undo-bar';
import { iconSourceToIconConfig } from '@ui/shared/icon-source';
import { getMessageClient } from '@ui/shared/message-client';
import { MatchSettingsHelp } from './MatchSettingsHelp';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommandInfo {
  name: string;
  description: string;
  shortcut: string | null;
}

type SettingsSection = 'slots' | 'rules' | 'strategy' | 'dashboard' | 'import-export' | 'diagnostics';

/** Sortable column keys for the Page Rules table (Q11: no `mode` column). */
type SortKey = 'urlMatch' | 'title' | 'priority' | 'enabled';

/** Compare function types per column (string vs numeric) for stable sorting. */
function compareRules(a: PageRule, b: PageRule, key: SortKey): number {
  switch (key) {
    case 'urlMatch':
      return a.urlMatch.value.localeCompare(b.urlMatch.value);
    case 'title':
      return (a.title ?? '').localeCompare(b.title ?? '');
    case 'priority':
      return a.priority - b.priority;
    case 'enabled':
      return Number(a.enabled !== false) - Number(b.enabled !== false);
  }
}

/**
 * A chain result for a surface that has no page context (the settings rule
 * editors edit the rule DEFINITION, not a live page). Every tier is unset and
 * the site value is unknown, so the FieldEditor renders `—` badges without
 * inventing page state.
 */
function emptyChain(): ChainResult {
  return resolveFieldChain('title', {
    sync: { configVersion: 0, matchSettings: DEFAULT_MATCH_SETTINGS, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
    local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
    tabId: -1,
    tabUrl: '',
  });
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

/**
 * Parse the import file's package. The background has already validated it
 * structurally (`IMPORT_INSPECT` succeeded), so this only needs the ids the
 * D7 deletion count asks about; malformed JSON yields `null` and the count
 * simply stays at zero (the background remains the authority on apply).
 */
function parseExportPackage(text: string): ExportPackage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isExportPackage(parsed)) return null;
  return parsed;
}

// ─── Per-slot strategy drafts (ACC#5) ────────────────────────────────────────
//
// The per-slot editor must be OPTIMISTIC: the user's choice is shown immediately
// and is NOT silently discarded when the write is slow, fails, or is rejected by
// a version conflict. Otherwise `isCustom` (derived from the server `slots`)
// collapses back to "Inherit global" the instant the write does not land.

type SlotStrategyValue = 'inherit' | MatchRuleSettings;

/** A typed placeholder for a slot the server has not created yet. */
function synthesizeDraftSlot(id: number, strategy: SlotStrategyValue): SlotDefinition {
  return {
    id,
    urlMatch: { type: 'exact', value: '' },
    strategy,
    uiMarker: {},
    titleSnapshot: '',
    faviconSnapshot: '',
    createdAt: '',
    updatedAt: '',
  };
}

/** Server slots overlaid with the user's un-committed strategy choices. */
function mergeSlotDrafts(
  slots: SlotDefinition[],
  drafts: Record<number, SlotStrategyValue>,
): SlotDefinition[] {
  const draftIds = Object.keys(drafts).map(Number);
  if (draftIds.length === 0) return slots;

  const byId = new Map(slots.map((s) => [s.id, s] as const));
  for (const id of draftIds) {
    const existing = byId.get(id);
    const strategy = drafts[id];
    byId.set(id, existing ? { ...existing, strategy } : synthesizeDraftSlot(id, strategy));
  }
  return Array.from(byId.values());
}

/** Remove a slot's pending draft without a dynamic `delete` (key is numeric). */
function removeSlotDraft(
  drafts: Record<number, SlotStrategyValue>,
  slotId: number,
): Record<number, SlotStrategyValue> {
  const next: Record<number, SlotStrategyValue> = {};
  for (const key of Object.keys(drafts)) {
    const id = Number(key);
    if (id !== slotId) next[id] = drafts[id];
  }
  return next;
}

/** Commit a strategy into the server-truth list, creating an entry if needed. */
function upsertSlotStrategy(
  slots: SlotDefinition[],
  slotId: number,
  strategy: SlotStrategyValue,
): SlotDefinition[] {
  if (slots.some((s) => s.id === slotId)) {
    return slots.map((s) => (s.id === slotId ? { ...s, strategy } : s));
  }
  return [...slots, synthesizeDraftSlot(slotId, strategy)];
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

/**
 * P1: map `location.hash` onto a section. Kept pure so it is directly unit
 * testable. Unknown or absent hashes fall back to the default section.
 *
 * A `hashchange` listener is REQUIRED, not optional: `openPage`
 * (`src/shared/open-page.ts`) navigates an already-open settings tab with a
 * hash-only `tabs.update`, which does not reload the document — only the
 * listener makes a second click on the footer entry take effect.
 */
export function resolveSectionFromHash(hash: string): SettingsSection {
  const id = hash.replace(/^#/, '');
  const match = NAV_ITEMS.find((item) => item.id === id);
  return match ? match.id : 'slots';
}

// ─── Shortcuts Section (Problem 3) ──────────────────────────────────────────

function ShortcutsSection({ commands, loading }: { commands: CommandInfo[]; loading: boolean }) {
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
              <td>{cmd.shortcut ?? 'Not set'}</td>
              <td>
                <StatusBadge
                  status={cmd.shortcut ? 'active' : 'inactive'}
                  label={cmd.shortcut ? '✅ Active' : '⚠️ No shortcut'}
                />
              </td>
            </tr>
          ))}
          {commands.length === 0 && loading && (
            <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>Loading commands...</td></tr>
          )}
          {commands.length === 0 && !loading && (
            <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>No commands available</td></tr>
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
  matchSettings: MatchRuleSettings;
  switchDirection: SwitchDirection;
  autoBindGlobal: boolean;
  slots: SlotDefinition[];
  configVersion: number;
  onGlobalChange: (settings: MatchRuleSettings) => void;
  onDirectionChange: (direction: SwitchDirection) => void;
  onAutoBindGlobalChange: (enabled: boolean) => void;
  onSlotChange: (slotId: number, strategy: 'inherit' | MatchRuleSettings) => void;
  onSlotAutoBindChange: (slotId: number, override: boolean | null) => void;
}

/**
 * Tri-knob editor shared by the global section and per-slot "Custom" expansion.
 *
 * ACC#6a: `priority` is meaningful ONLY for combination 1 (tabIdMode `exists`).
 * When Tab ID = "No tab ID" the Priority control is hidden — its stored value is
 * PRESERVED (never cleared), so switching back to `exists` restores it.
 */
function MatchKnobs({
  idPrefix,
  settings,
  onChange,
}: {
  idPrefix: string;
  settings: MatchRuleSettings;
  onChange: (settings: MatchRuleSettings) => void;
}) {
  const showPriority = settings.tabIdMode !== 'no-exists';
  return (
    <div className="tbs-settings__knobs">
      <label>
        <span>Tab ID</span>
        <select
          aria-label={`${idPrefix} Tab ID`}
          value={settings.tabIdMode}
          onChange={(e) => { onChange({ ...settings, tabIdMode: e.target.value as TabIdMode }); }}
        >
          <option value="exists">Exists</option>
          <option value="no-exists">No tab ID</option>
        </select>
      </label>
      <label>
        <span>Rule Check</span>
        <select
          aria-label={`${idPrefix} Rule Check`}
          value={settings.ruleCheckMode}
          onChange={(e) => { onChange({ ...settings, ruleCheckMode: e.target.value as RuleCheckMode }); }}
        >
          <option value="match">Match</option>
          <option value="no-match">No match</option>
        </select>
      </label>
      {showPriority && (
        <label>
          <span>Priority</span>
          <select
            aria-label={`${idPrefix} Priority`}
            value={settings.priority}
            onChange={(e) => { onChange({ ...settings, priority: e.target.value as Priority }); }}
          >
            <option value="tabId">Tab ID</option>
            <option value="rule-check">Rule Check</option>
            <option value="none">None</option>
          </select>
        </label>
      )}
    </div>
  );
}

function StrategySection({
  matchSettings,
  switchDirection,
  autoBindGlobal,
  slots,
  configVersion: _cv,
  onGlobalChange,
  onDirectionChange,
  onAutoBindGlobalChange,
  onSlotChange,
  onSlotAutoBindChange,
}: StrategySectionProps) {
  return (
    <section aria-label="Global matching settings">
      <h2>Global Matching Settings</h2>

      <MatchSettingsHelp />

      <MatchKnobs idPrefix="Global" settings={matchSettings} onChange={onGlobalChange} />

      <label className="tbs-settings__row">
        <span>Switch Direction</span>
        <select
          aria-label="Switch Direction"
          value={switchDirection}
          onChange={(e) => { onDirectionChange(e.target.value as SwitchDirection); }}
        >
          <option value="previous">Previous Match</option>
          <option value="next">Next Match</option>
        </select>
      </label>

      <label className="tbs-settings__row">
        <input
          type="checkbox"
          checked={autoBindGlobal}
          onChange={(e) => { onAutoBindGlobalChange(e.target.checked); }}
        />
        <span>Auto-bind switched tabs to their slot</span>
      </label>

      <h3>Per-Slot Override</h3>
      <table className="tbs-settings__table" role="table" aria-label="Slot settings overrides">
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col">Strategy</th>
            <th scope="col">Auto-bind</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, i) => {
            const slotId = i + 1;
            const slot = slots.find((s) => s.id === slotId);
            const raw = slot?.strategy ?? 'inherit';
            const isCustom = raw !== 'inherit';
            // Explicit narrowing keeps the type checker satisfied without an assertion.
            const customSettings: MatchRuleSettings = isCustom ? raw : matchSettings;
            const override = slot?.autoBindOverride;
            const autoBindValue = override === undefined ? 'follow' : override ? 'on' : 'off';
            return (
              <tr key={slotId}>
                <td>Slot {slotId}</td>
                <td>
                  <select
                    value={isCustom ? 'custom' : 'inherit'}
                    onChange={(e) => {
                      onSlotChange(
                        slotId,
                        e.target.value === 'inherit' ? 'inherit' : { ...matchSettings },
                      );
                    }}
                    aria-label={`Strategy for slot ${slotId}`}
                  >
                    <option value="inherit">Inherit global</option>
                    <option value="custom">Custom</option>
                  </select>
                  {isCustom && (
                    <MatchKnobs
                      idPrefix={'Slot ' + String(slotId)}
                      settings={customSettings}
                      onChange={(next) => { onSlotChange(slotId, next); }}
                    />
                  )}
                </td>
                <td>
                  <select
                    value={autoBindValue}
                    onChange={(e) => {
                      onSlotAutoBindChange(
                        slotId,
                        e.target.value === 'follow' ? null : e.target.value === 'on',
                      );
                    }}
                    aria-label={'Auto-bind for slot ' + String(slotId)}
                  >
                    <option value="follow">Follow global</option>
                    <option value="on">Always on</option>
                    <option value="off">Always off</option>
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
  titleMode: FieldMode;
  iconMode: FieldMode;
  iconConfig?: IconConfig;
  priority: number;
}

const EMPTY_RULE_FORM: RuleFormState = {
  url: '',
  matchType: 'exact',
  titleMode: { kind: 'use-chain' },
  iconMode: { kind: 'use-chain' },
  iconConfig: undefined,
  priority: 0,
};

// ─── Inline Rule Editor (Module 2: row-level expandable editor) ─────────────

interface InlineRuleEditorProps {
  rule: PageRule;
  onSave: (
    ruleId: string,
    updates: Partial<Pick<PageRule, 'urlMatch' | 'priority' | 'title' | 'favicon' | 'enabled'>>,
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
  // FIX-C: derive from the SOURCE TYPE, never from the value's shape. A recipe
  // whose value was materialized to a PNG would otherwise be classified as an
  // upload, and saving this editor would destroy the recipe (C1).
  const seed = rule.favicon ? iconSourceToIconConfig(rule.favicon) : undefined;
  const isTemplateIcon = rule.favicon?.type === 'template';
  const isUploadIcon = hasIcon && rule.favicon?.type === 'upload';
  const seedValue = isTemplateIcon
    ? ''
    : isUploadIcon
      ? rule.favicon!.value
      : rule.favicon?.type === 'url'
        ? rule.favicon.value
        : '';

  // The editor drives the SHARED field set (SC8); it only owns the values.
  const [url, setUrl] = useState(rule.urlMatch.value);
  const [matchType, setMatchType] = useState<'exact' | 'regex'>(rule.urlMatch.type);
  const [titleMode, setTitleMode] = useState<FieldMode>(
    rule.title ? { kind: 'set', value: rule.title } : { kind: 'use-chain' },
  );
  const [iconMode, setIconMode] = useState<FieldMode>(
    hasIcon ? { kind: 'set', value: seedValue } : { kind: 'use-chain' },
  );
  const [iconConfig, setIconConfig] = useState<IconConfig | undefined>(
    isTemplateIcon ? { bgColor: seed?.bgColor, text: seed?.text, textColor: seed?.textColor } : undefined,
  );
  const [priority, setPriority] = useState(rule.priority);
  const [enabled, setEnabled] = useState(rule.enabled !== false);
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Version marker frozen at editor-open time (useState initializer runs once
  // on mount). It must NOT track rule.updatedAt across re-renders: if the list
  // refreshes while this editor is open (e.g. another channel saved), the stale
  // edit must still fail with VERSION_CONFLICT rather than silently inheriting
  // the newer marker and overwriting the other channel's change.
  const [expectedUpdatedAt] = useState(rule.updatedAt);

  // An inline editor always edits an EXISTING rule → no `mode` opt-out, but the
  // Clear capability applies.
  const titleChain = useMemo(() => emptyChain(), []);
  const iconChain = useMemo(() => emptyChain(), []);

  const handleSave = useCallback(async () => {
    const draft: RuleDraftValue = { url, matchType, titleMode, iconMode, iconConfig, priority, enabled };
    // The SHARED validator converts the wildcard BEFORE validating, so the
    // validated string is exactly the stored string (E1-a).
    const validation = validateRuleDraft(draft);
    if (!validation.valid) {
      setError(validation.errors[0]?.message ?? 'Invalid form');
      return;
    }

    const fields = normalizeRuleDraft(draft);

    setStatus('saving');
    setError(null);

    const result = await onSave(
      rule.id,
      {
        urlMatch: { type: matchType, value: fields.url },
        priority: fields.priority,
        title: fields.title,
        favicon: fields.favicon,
        enabled: fields.enabled,
      },
      expectedUpdatedAt,
    );

    if (!result.success) {
      setStatus('idle');
      // Version conflict gets a user-friendly guidance message regardless of
      // the backend's raw text; other errors surface their concrete message.
      setError(
        result.errorCode === 'VERSION_CONFLICT'
          ? 'This rule was modified elsewhere. Refresh and try again.'
          : (result.message ?? 'Failed to update rule'),
      );
      return;
    }
    setStatus('idle');
    setError(null);
    onCancel();
  }, [url, matchType, titleMode, iconMode, iconConfig, priority, enabled, rule.id, expectedUpdatedAt, onSave, onCancel]);

  return (
    <InlineEditorShell
      colSpan={7}
      title="Edit Rule"
      ariaLabel={`Edit rule ${rule.id}`}
      // D-16 / IMP-15: Escape collapses the row.
      onEscape={onCancel}
      error={error}
      actions={
        <>
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
        </>
      }
    >
      <RuleFormFields
        variant="edit"
        value={{
          url,
          matchType,
          titleMode,
          iconMode,
          iconConfig,
          priority,
          enabled,
        }}
        onChange={(patch) => {
          if (patch.url !== undefined) setUrl(patch.url);
          if (patch.matchType !== undefined) setMatchType(patch.matchType);
          if (patch.titleMode !== undefined) setTitleMode(patch.titleMode);
          if (patch.iconMode !== undefined) setIconMode(patch.iconMode);
          if (patch.iconConfig !== undefined) setIconConfig(patch.iconConfig);
          if (patch.priority !== undefined) setPriority(patch.priority);
          if (patch.enabled !== undefined) setEnabled(patch.enabled);
        }}
        prefill={{ url: rule.urlMatch.value }}
        chain={titleChain}
        titleChain={titleChain}
        iconChain={iconChain}
        baselineTitle={{ mode: rule.title ? { kind: 'set', value: rule.title } : { kind: 'use-chain' } }}
        baselineIcon={{
          mode: hasIcon ? { kind: 'set', value: seedValue } : { kind: 'use-chain' },
          iconConfig: isTemplateIcon
            ? { bgColor: seed?.bgColor, text: seed?.text, textColor: seed?.textColor }
            : undefined,
        }}
        onResetTitleEdit={() => { setTitleMode(rule.title ? { kind: 'set', value: rule.title } : { kind: 'use-chain' }); }}
        onResetIconEdit={() => { setIconMode(hasIcon ? { kind: 'set', value: seedValue } : { kind: 'use-chain' }); }}
        onClearTitle={() => { setTitleMode({ kind: 'use-chain' }); }}
        onClearIcon={() => { setIconMode({ kind: 'use-chain' }); setIconConfig(undefined); }}
        submitMode={{ kind: 'immediate' }}
        showEnabled
        idPrefix={`rf-${rule.id}`}
        // Item 7: a rule DEFINITION is not a page — it has no chain of its own, so
        // `Use chain` has nothing to fall back to and switching to it stored NO
        // title/icon while the row still looked edited ("the rule has a title but
        // the tab never updates"). The create AND edit rule surfaces therefore
        // drop the tab; the value is always an explicit `set` on this form.
        allowUseChain={false}
        // Items 6.2 / 6.3: the impact of this rule over the open tabs, visible on
        // open and re-checked as the pattern changes. `impactExcludeRuleId` keeps
        // the rule from counting itself as the winner while it is being edited.
        showImpactPreview
        impactDefaultExpanded
        impactExcludeRuleId={rule.id}
      />
    </InlineEditorShell>
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
  /** D-12: destructive actions are confirmed (N1: `Confirm` imported here). */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  /** D-11/D-15: load failure state driving the three-way empty/error panel. */
  const [loadError, setLoadError] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  /** Sort state for the rules table (key + direction). null = no sort (insertion order). */
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  // Load rules from background (D-15: a failure becomes a non-blocking error state).
  const loadRules = useCallback(async () => {
    try {
      const res = await sendMessage('GET_STATE');
      const result = extractResult(res);
      if (result?.success && (result.sync as Record<string, unknown>)?.rules) {
        setRules((result.sync as { rules: PageRule[] }).rules);
        setLoadError(false);
      } else if (result && result.success === false) {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setHasLoadedOnce(true);
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
    updates: Partial<Pick<PageRule, 'urlMatch' | 'priority' | 'title' | 'favicon' | 'enabled'>>,
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

  /**
   * Item 6.1: fill the title / icon from the value the Match URL resolves to.
   *
   * The background resolves it through the same field chain the sidebar uses, so
   * what lands in the form is exactly what a tab at that URL currently shows.
   * A no-match result is reported rather than silently doing nothing.
   */
  const resolveMatchUrlInto = async (field: 'title' | 'icon') => {
    if (!form.url.trim()) {
      setError('Enter a URL pattern first.');
      return;
    }
    try {
      const res = await sendMessage('RESOLVE_MATCH_URL', {
        urlMatch: { type: form.matchType, value: form.url.trim() },
      });
      const result = extractResult(res) as { resolved?: { matchedTabs: number; title: string | null; icon: string | null } } | null;
      const resolved = result?.resolved;
      if (!resolved || resolved.matchedTabs === 0) {
        setError('No open tab matches this pattern, so there is nothing to copy.');
        return;
      }
      const value = field === 'title' ? resolved.title : resolved.icon;
      if (!value) {
        setError(field === 'title' ? 'The matched tabs have no title to copy.' : 'The matched tabs have no icon to copy.');
        return;
      }
      setError(null);
      setForm((prev) => (field === 'title'
        ? { ...prev, titleMode: { kind: 'set', value } }
        : { ...prev, iconMode: { kind: 'set', value }, iconConfig: undefined }));
    } catch {
      setError('Could not read the matched tabs.');
    }
  };

  const handleSaveRule = async () => {
    const draft: RuleDraftValue = {
      url: form.url,
      matchType: form.matchType,
      titleMode: form.titleMode,
      iconMode: form.iconMode,
      iconConfig: form.iconConfig,
      priority: form.priority,
    };
    // E1-a: the SHARED validator converts the wildcard BEFORE validating, so the
    // validated string is exactly the stored string (no bare `new RegExp` here).
    const validation = validateRuleDraft(draft);
    if (!validation.valid) {
      setError(validation.errors[0]?.message ?? 'Invalid form');
      return;
    }

    setSaving(true);
    setError(null);

    // Shared normalisation: regex conversion, priority clamp and the DT5 mode
    // model (`set` → URL text or the rendered custom data URI) live in ONE place.
    const fields = normalizeRuleDraft(draft);

    try {
      // Create new rule — conflict/duplicate detection happens in the background
      const res = await sendMessage('CREATE_RULE', {
        urlMatch: { type: form.matchType, value: fields.url },
        priority: fields.priority,
        title: fields.title,
        favicon: fields.favicon,
      });
      const result = extractResult(res);
      if (result?.success) {
        setShowForm(false);
        setForm(EMPTY_RULE_FORM);
        setToast({ variant: 'success', message: 'Rule created' });
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
      const res = await sendMessage('DELETE_RULE', { ruleId });
      const result = extractResult(res);
      if (result?.success) {
        setToast({ variant: 'success', message: 'Rule deleted' });
      } else {
        setToast({ variant: 'error', message: (result?.message as string) || 'Failed to delete rule' });
      }
      void loadRules();
    } catch {
      setToast({ variant: 'error', message: 'Failed to delete rule' });
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
    // D-12: report partial failures honestly instead of swallowing them.
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      try {
        const res = await sendMessage('DELETE_RULE', { ruleId: id });
        const result = extractResult(res);
        if (!result?.success) failed += 1;
      } catch {
        failed += 1;
      }
    }
    setSelectedIds(new Set());
    setBatchProcessing(false);
    const deleted = ids.length - failed;
    setToast(
      failed === 0
        ? { variant: 'success', message: `Deleted ${String(deleted)} ${deleted === 1 ? 'rule' : 'rules'}` }
        : { variant: 'error', message: `Deleted ${String(deleted)} of ${String(ids.length)} · ${String(failed)} failed` },
    );
    setConfirmBatchDelete(false);
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

  // D-13 (default (a) AUTO-PRUNE): a selection must never outlive visibility.
  // "What you see is what you operate on" — a hidden id is removed from the
  // selection whenever the visible set changes.
  useEffect(() => {
    const visible = new Set(filteredRules.map((r) => r.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, rules]);

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
          onChange={(e) => { setSearch(e.target.value); }}
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
          <Button size="sm" variant="danger" onClick={() => { setConfirmBatchDelete(true); }} disabled={batchProcessing}>
            {batchProcessing ? 'Processing...' : 'Delete'}
          </Button>
        </div>
      )}

      {/* IMP-3: "New Rule" stays a TOP-INLINE form (position is intentionally
          different from the per-row InlineRuleEditor); its field set comes from the
          shared RuleFormFields so both surfaces are identical by construction. */}
      {showForm && (
        <div className="tbs-settings__rule-form" role="form" aria-label="Create new rule">
          <h3>New Rule</h3>
          {error && <p className="tbs-settings__rule-form-error" role="alert">{error}</p>}
          <RuleFormFields
            variant="create"
            idPrefix="new-rule"
            value={{
              url: form.url,
              matchType: form.matchType,
              titleMode: form.titleMode,
              iconMode: form.iconMode,
              iconConfig: form.iconConfig,
              priority: form.priority,
            }}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            prefill={{ url: '' }}
            chain={emptyChain()}
            titleChain={emptyChain()}
            iconChain={emptyChain()}
            baselineTitle={{ mode: { kind: 'use-chain' } }}
            baselineIcon={{ mode: { kind: 'use-chain' } }}
            // Item 6.1: a new rule has no chain, so `Use chain` is dropped and the
            // matched value is offered instead.
            allowUseChain={false}
            onFetchTitleFromMatchUrl={() => void resolveMatchUrlInto('title')}
            onFetchIconFromMatchUrl={() => void resolveMatchUrlInto('icon')}
            // Items 6.2 / 6.3: live impact of the pattern over the open tabs.
            showImpactPreview
            impactDefaultExpanded
            onResetTitleEdit={() => setForm((prev) => ({ ...prev, titleMode: { kind: 'use-chain' } }))}
            onResetIconEdit={() => setForm((prev) => ({ ...prev, iconMode: { kind: 'use-chain' }, iconConfig: undefined }))}
            onClearTitle={() => setForm((prev) => ({ ...prev, titleMode: { kind: 'use-chain' } }))}
            onClearIcon={() => setForm((prev) => ({ ...prev, iconMode: { kind: 'use-chain' }, iconConfig: undefined }))}
            submitMode={{ kind: 'immediate' }}
          />
          <div className="tbs-settings__rule-form-actions">
            <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); }}>Cancel</Button>
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
            {/* IMP-9: column order is ☑ / Icon / Title / URL Pattern / Priority / Enabled / Actions. */}
            <th scope="col" style={{ width: '32px' }}>Icon</th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => { toggleSort('title'); }}
                aria-label="Sort by Title"
              >
                Title {sort?.key === 'title' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => { toggleSort('urlMatch'); }}
                aria-label="Sort by URL Pattern"
              >
                URL Pattern {sort?.key === 'urlMatch' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => { toggleSort('priority'); }}
                aria-label="Sort by Priority"
              >
                Priority {sort?.key === 'priority' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={() => { toggleSort('enabled'); }}
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
                  onClick={() => { setSort(null); }}
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
                    onChange={() => { toggleSelect(rule.id); }}
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
                {/* IMP-9: Title precedes URL Pattern (cells are NOT merged). */}
                <td>{rule.title ?? '—'}</td>
                <td title={rule.urlMatch.value}>
                  <code>{rule.urlMatch.type === 'regex' ? `/${rule.urlMatch.value}/` : rule.urlMatch.value}</code>
                </td>
                <td>{rule.priority}</td>
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
                      onClick={() => { toggleExpand(rule.id); }}
                      aria-label={`Edit rule ${rule.id}`}
                      aria-expanded={expandedRuleIds.has(rule.id)}
                    >
                      ✏️
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => { setConfirmDeleteId(rule.id); }} aria-label={`Delete rule ${rule.title ?? rule.urlMatch.value}`}>
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
                  onCancel={() => { toggleExpand(rule.id); }}
                />
              )}
            </Fragment>
          ))}
          {filteredRules.length === 0 && (
            <tr>
              <td colSpan={7}>
                {loadError && !hasLoadedOnce ? (
                  <EmptyState variant="error-first" action={{ label: 'Retry', onClick: () => void loadRules() }} />
                ) : loadError ? (
                  <EmptyState variant="error-stale" action={{ label: 'Retry', onClick: () => void loadRules() }} />
                ) : search.trim() ? (
                  <EmptyState variant="no-match" action={{ label: 'Clear search', onClick: () => { setSearch(''); } }} />
                ) : (
                  <EmptyState
                    variant="empty"
                    message="No rules configured. Create one here or use the sidebar &quot;+&quot; button."
                  />
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* D-12 / N1: destructive actions are confirmed (single + batch). */}
      <Confirm
        open={confirmDeleteId !== null}
        title="Delete rule?"
        message="This rule will be removed. Pages it matched fall back to the next layer in the chain."
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => { setConfirmDeleteId(null); }}
        onConfirm={() => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          if (id) void handleDeleteRule(id);
        }}
      />
      <Confirm
        open={confirmBatchDelete}
        title="Delete selected rules?"
        message={`${String(selectedIds.size)} selected ${selectedIds.size === 1 ? 'rule' : 'rules'} will be removed.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => { setConfirmBatchDelete(false); }}
        onConfirm={() => void handleBatchDelete()}
      />

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => { setToast(null); }} />
      )}
    </section>
  );
}

// ─── Data Dashboard Section ────────────────────────────────────────────────

/**
 * A10 / T16: the dashboard renders the background-computed `DashboardRow`
 * directly. The `chain` is NOT recomputed here — the UI would otherwise be a
 * second implementation of the field chain (the defect this iteration removes).
 */
interface DashboardEntry {
  id: string;
  kind: 'override' | 'slot' | 'rule-hit';
  label: string;
  url: string | null;
  anchor: TierOwner | null;
  tabId?: number;
  slotId?: number;
  ruleId?: string;
  chain: { title: ChainResult; favicon: ChainResult };
  delivery: 'ok' | 'degraded' | 'protected' | 'unknown';
}

/**
 * IMP-4: inline edit draft. One draft per row, held in a Map so several rows
 * can be edited at once with independent dirty state.
 */
interface DashboardEditForm {
  titleMode: FieldMode;
  iconMode: FieldMode;
  iconConfig?: IconConfig;
}

type DashboardSortKey = 'label' | 'title';
type SortDir = 'asc' | 'desc';

/** IMP-5 / G1: the delivery copy, and whether a row can be applied here at all. */
function deliveryLabel(delivery: DashboardEntry['delivery']): string | null {
  switch (delivery) {
    case 'ok':
      return null; // a healthy row shows nothing
    case 'protected':
      return "Can't rewrite this page";
    case 'degraded':
      return "Limited: can't restore the site value";
    case 'unknown':
      return '—';
  }
}

function isNotApplicable(delivery: DashboardEntry['delivery']): boolean {
  // G1-a: `unknown` is NOT "not applicable" — otherwise the sentence is always true.
  return delivery === 'protected' || delivery === 'degraded';
}

/**
 * IMP-19 / RK-4: a row's Save is enabled ONLY when that row's draft actually
 * differs from its committed value. The comparison is the honest definition of
 * "dirty" — it does not light up merely because the mode is `set`.
 */
function isDraftDirty(entry: DashboardEntry, draft: DashboardEditForm): boolean {
  const currentTitle = entry.chain.title.winner.value;
  const currentIcon = entry.chain.favicon.winner.value;

  const draftTitle = draft.titleMode.kind === 'set' ? draft.titleMode.value.trim() : null;
  const draftIcon = draft.iconMode.kind === 'set'
    ? (draft.iconConfig?.dataUri || draft.iconMode.value.trim() || null)
    : null;

  return draftTitle !== (currentTitle ?? null) || draftIcon !== (currentIcon ?? null);
}

function DashboardSection() {
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sortKey, setSortKey] = useState<DashboardSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  /** IMP-4: per-row drafts so several rows can be edited simultaneously. */
  const [drafts, setDrafts] = useState<Map<string, DashboardEditForm>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showUrl, setShowUrl] = useState(false);
  /** D-20: destructive reset is confirmed. */
  const [confirmReset, setConfirmReset] = useState<{ kind: 'entry'; id: string } | { kind: 'all' } | { kind: 'selected' } | null>(null);
  /** IMP-6/DT9: the generalized atomic undo for an immediate Clear. */
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  /**
   * FIX-A: the RAW records, so a Clear can snapshot the original `IconSource`.
   * Held in a ref (not state): it is a lookup table for event handlers, never
   * rendered, so it must not trigger re-renders.
   */
  const sourceCtxRef = useRef<{ slots: SlotDefinition[]; rules: PageRule[]; tabOverrides: TabOverride[] }>({
    slots: [], rules: [], tabOverrides: [],
  });

  /**
   * FIX-A: the ORIGINAL stored icon for a dashboard row.
   *
   * The chain's winner is reached through its OWNER (`winner` itself only names
   * a tier), then the record is read from `sourceCtxRef` — the same
   * owner→source resolution the source-aware seeding paths use.
   */
  const thisEntryIconSource = (entry: DashboardEntry): IconSource | null => {
    const owner = entry.chain.favicon.nodes.find((n) => n.winner)?.owner;
    const source = owner
      ? iconSourceForOwner(owner, sourceCtxRef.current)
      : entry.tabId != null
        ? iconSourceForOwner({ kind: 'override', tabId: entry.tabId }, sourceCtxRef.current)
        : entry.slotId != null
          ? iconSourceForOwner({ kind: 'slot', slotId: entry.slotId }, sourceCtxRef.current)
          : entry.ruleId != null
            ? iconSourceForOwner({ kind: 'rule', ruleId: entry.ruleId }, sourceCtxRef.current)
            : null;
    return source ? canonicalIconSource(source) : null;
  };

  const sortedEntries = useMemo(() => {
    if (!sortKey) return entries;
    const dir = sortDir === 'asc' ? 1 : -1;
    const key = sortKey;
    const sorted = [...entries].sort((a, b) => {
      const av = key === 'label' ? a.label : (a.chain.title.winner.value ?? '');
      const bv = key === 'label' ? b.label : (b.chain.title.winner.value ?? '');
      return av.localeCompare(bv, undefined, { numeric: true }) * dir;
    });
    return sorted;
  }, [entries, sortKey, sortDir]);

  // IMP-4 / N8: the header select-all and the rows share ONE list.
  const visibleEntries = sortedEntries;

  // G1: "N items · none can be applied here" — `unknown` is excluded.
  const summary = useMemo(() => {
    if (visibleEntries.length === 0) return null;
    const applicable = visibleEntries.filter((e) => !isNotApplicable(e.delivery));
    if (applicable.length > 0) return null;
    const pulled = visibleEntries.filter((e) => isNotApplicable(e.delivery)).length;
    return `${String(pulled)} ${pulled === 1 ? 'item' : 'items'} · none can be applied here`;
  }, [visibleEntries]);

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
      // FIX-A: fetch the raw state too, so a Clear snapshot can capture the
      // ORIGINAL `IconSource` (the dashboard chain only carries strings).
      const [res, stateRes] = await Promise.all([
        sendMessage('GET_DASHBOARD'),
        sendMessage('GET_STATE'),
      ]);
      const result = extractResult(res);
      if (!result?.success) { setLoadError(true); return; }

      const stateResult = extractResult(stateRes);
      const rawSync = (stateResult?.sync ?? {}) as { slots?: SlotDefinition[]; rules?: PageRule[] };
      const rawLocal = (stateResult?.local ?? {}) as { tabOverrides?: TabOverride[] };
      sourceCtxRef.current = {
        slots: rawSync.slots ?? [],
        rules: rawSync.rules ?? [],
        tabOverrides: rawLocal.tabOverrides ?? [],
      };

      const rows: DashboardEntry[] = (result.rows as DashboardRow[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        url: r.url,
        anchor: r.anchor,
        tabId: r.tabId,
        slotId: r.slotId,
        ruleId: r.ruleId,
        chain: r.chain,
        delivery: r.delivery,
      }));
      setEntries(rows);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const onStorageChanged = (_changes: unknown, areaName: string) => {
      if (areaName === 'sync' || areaName === 'local') void load();
    };
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    return () => { chrome.storage?.onChanged?.removeListener(onStorageChanged); };
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // F1/F1b (T13): the source badge is the only cross-surface jump entry point.
  // The Dashboard's own rows are the targets for its anchors.
  const { jumpTo, announcement } = useJumpToRow({
    resolveRow: (anchor) => document.querySelector<HTMLElement>(`[data-dash-anchor="${anchor.kind}:${anchor.kind === 'rule' ? anchor.ruleId : anchor.kind === 'slot' ? String(anchor.slotId) : anchor.kind === 'override' ? String(anchor.tabId) : 'site'}"]`),
    firstRow: () => document.querySelector<HTMLElement>('tr[data-dash-row]'),
    searchRef: { current: null },
  });

  /**
   * Review: after a successful write the panel collapses and the row is
   * reloaded, so the user was left with no idea WHICH row they had just
   * changed — the new value simply appeared somewhere in the table. The row is
   * therefore pulled into view and highlighted with the same treatment a
   * `jumpTo` uses, which keeps ONE visual language for "this is the row".
   *
   * The target is addressed by the value the user just edited, and falls back
   * to the label when the reload changed the row's identity (a rule-hit row
   * becomes an override row once it is promoted, which is the expected outcome
   * of editing a managed tab).
   */
  const [focusTarget, setFocusTarget] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (!focusTarget) return;
    // Resolved against the LIVE DOM, never against the `entries` captured at
    // write time: the reload that decides the row's final shape happens after
    // the write, so a stale list would point at a row that no longer exists.
    const el = document.querySelector<HTMLElement>(`[data-dash-entry="${focusTarget.id}"]`)
      ?? Array.from(document.querySelectorAll<HTMLElement>('tr[data-dash-row]'))
        .find((tr) => tr.querySelector(`[aria-label="Edit ${focusTarget.label}"]`) !== null);
    // Not rendered yet; the reload's `entries` change re-runs this effect.
    if (!el) return;
    // `scrollIntoView` is not implemented in every host (jsdom in tests), and a
    // missing scroll must never cost the highlight — the cue is the point.
    el.scrollIntoView?.({ block: 'center' });
    el.classList.add(JUMP_HIGHLIGHT_CLASS);
    // The request is cleared only when the cue is over, so a reload that lands
    // mid-highlight re-applies the cue instead of cancelling it.
    const timer = setTimeout(() => {
      el.classList.remove(JUMP_HIGHLIGHT_CLASS);
      setFocusTarget(null);
    }, JUMP_HIGHLIGHT_MS);
    return () => { clearTimeout(timer); el.classList.remove(JUMP_HIGHLIGHT_CLASS); };
  }, [focusTarget, entries]);

  /**
   * Point the cue at the row the write produced. `expectedId` is the backend's
   * id for the layer just written — a promoted rule-hit becomes an override row,
   * so it changes from `hit-N` to `cp-N` — and the label is the fallback for any
   * case where that assumption does not hold.
   */
  const focusAfterWrite = (entry: DashboardEntry, expectedId: string) => {
    setFocusTarget({ id: expectedId, label: entry.label });
  };

  /**
   * Clear (Q13/N10/DT11): the tier set to write is decided by `clearChain`, so
   * the dashboard does not invent its own notion of "reset". Writes unify on
   * `null` (no legacy empty-string paths).
   */
  const resetEntry = async (entry: DashboardEntry) => {
    setBusy(true);
    try {
      if (entry.kind === 'override' && entry.tabId != null) {
        // Q13/N10/DT11: clear via `null`, never the legacy `{type:'url',value:''}`.
        await sendMessage('REMOVE_TAB_OVERRIDE', { tabId: entry.tabId });
      } else if (entry.kind === 'slot' && entry.slotId != null) {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: entry.slotId,
          uiMarker: { customTitle: '', icon: null },
        });
      } else if (entry.kind === 'rule-hit' && entry.ruleId != null) {
        // Issue 3: a rule-hit row owns no stored override/marker — the only
        // thing this row can clear is the RULE that drives it, so Clear disables
        // the rule instead of pretending to blank a value that is not here.
        await sendMessage('UPDATE_RULE', { ruleId: entry.ruleId, enabled: false });
        setToast({ variant: 'success', message: `Rule disabled — ${entry.label} is no longer managed` });
        void load();
        setBusy(false);
        setConfirmReset(null);
        return;
      }
      setToast({ variant: 'success', message: `${entry.label} cleared` });
      void load();
    } catch {
      setToast({ variant: 'error', message: `Failed to clear ${entry.label}` });
    } finally {
      setBusy(false);
      setConfirmReset(null);
    }
  };

  const resetAll = async () => {
    setBusy(true);
    try {
      for (const entry of entries) {
        if (entry.kind === 'override' && entry.tabId != null) {
          await sendMessage('REMOVE_TAB_OVERRIDE', { tabId: entry.tabId });
        } else if (entry.kind === 'slot' && entry.slotId != null) {
          await sendMessage('UPDATE_SLOT_UI_MARKER', {
            slotId: entry.slotId,
            uiMarker: { customTitle: '', icon: null },
          });
        }
      }
      setToast({ variant: 'success', message: 'All items cleared' });
      setSelected(new Set());
      void load();
    } catch {
      setToast({ variant: 'error', message: 'Failed to clear all items' });
    } finally {
      setBusy(false);
      setConfirmReset(null);
    }
  };

  const resetSelected = async () => {
    setBusy(true);
    try {
      for (const entry of entries) {
        if (!selected.has(entry.id)) continue;
        if (entry.kind === 'override' && entry.tabId != null) {
          await sendMessage('REMOVE_TAB_OVERRIDE', { tabId: entry.tabId });
        } else if (entry.kind === 'slot' && entry.slotId != null) {
          await sendMessage('UPDATE_SLOT_UI_MARKER', {
            slotId: entry.slotId,
            uiMarker: { customTitle: '', icon: null },
          });
        }
      }
      setToast({ variant: 'success', message: 'Selected items cleared' });
      setSelected(new Set());
      void load();
    } catch {
      setToast({ variant: 'error', message: 'Failed to clear selected items' });
    } finally {
      setBusy(false);
      setConfirmReset(null);
    }
  };

  // ─── Field-level operations (DRIVEN BY THE SHARED FIELD MODEL) ───────────

  /**
   * Clear a single field at this level (falls back through the chain).
   *
   * DT9/RK-3: because Clear is immediate and CAN destroy a global config
   * (`slot.uiMarker` / `rule.title`), it raises the generalized `UndoBar` with
   * an ATOMIC batch snapshot of the value it just removed.
   */
  const clearEntryField = async (entry: DashboardEntry, field: 'title' | 'icon') => {
    setBusy(true);
    const previous = field === 'title'
      ? entry.chain.title.winner.value
      : entry.chain.favicon.winner.value;
    // FIX-A: snapshot the ORIGINAL `IconSource`, not the chain's (materialized)
    // value string. Replaying a string forced `{type:'upload'}` and destroyed
    // any recipe. `chain.nodes` carries the winner's owner; the raw source is
    // then resolved from the store.
    const previousIconSource = field === 'icon' ? thisEntryIconSource(entry) : null;
    try {
      // A `rule-hit` row can only express "unset this field at the Page level",
      // so it writes the same override shape as an `override` row (see
      // `applyDraft`): clearing the Page field lets the chain fall back to the
      // rule, which is what "clear this layer" means for a rule-managed tab.
      if ((entry.kind === 'override' || entry.kind === 'rule-hit') && entry.tabId != null) {
        if (field === 'title') await sendMessage('SET_TAB_OVERRIDE', { tabId: entry.tabId, title: '' });
        else await sendMessage('SET_TAB_OVERRIDE', { tabId: entry.tabId, favicon: null });
      } else if (entry.kind === 'slot' && entry.slotId != null) {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: entry.slotId,
          uiMarker: field === 'title' ? { customTitle: '' } : { icon: null },
        });
      }
      setToast({ variant: 'success', message: field === 'title' ? 'Title cleared' : 'Icon cleared' });
      // IMP-6 / DT9: offer the atomic undo for the removed value.
      setUndoState({
        message: field === 'title' ? `${entry.label} title cleared` : `${entry.label} icon cleared`,
        snapshot: {
          writes: (entry.kind === 'override' || entry.kind === 'rule-hit') && entry.tabId != null
            ? [{ kind: 'tab-override', tabId: entry.tabId, ...(field === 'title' ? { title: previous } : { favicon: previousIconSource }) }]
            : entry.slotId != null
              ? [{ kind: 'slot-marker', slotId: entry.slotId, ...(field === 'title' ? { customTitle: previous } : { icon: previousIconSource }) }]
              : [],
          affectedTabIds: entry.tabId != null ? [entry.tabId] : [],
        },
        expiresAt: Date.now() + 5000,
      });
      void load();
    } catch {
      setToast({ variant: 'error', message: 'Failed to clear' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Review item 1: which record each row's preview is showing.
   *
   * Keyed by `${entryId}:${field}` so the title and icon editors of one row
   * preview independently. Selecting a record only changes this preview — it
   * never writes; the user still presses Save.
   */
  const [preview, setPreview] = useState<Record<string, TierOwner>>({});

  const previewOwner = (entry: DashboardEntry, field: 'title' | 'icon'): TierOwner | null =>
    preview[`${entry.id}:${field}`] ?? null;

  /**
   * Review item 1: selecting a record previews BOTH dimensions of it.
   *
   * The two editors render one record list each, but a click on either one is a
   * statement about the record — so the icon preview follows a title-row click
   * and vice versa. Without this, the user clicks "Slot 3" in the title list and
   * the icon preview silently keeps showing a different record.
   */
  const selectPreview = (entry: DashboardEntry, owner: TierOwner) => {
    setPreview((prev) => ({ ...prev, [`${entry.id}:title`]: owner, [`${entry.id}:icon`]: owner }));
  };

  /**
   * Items 2 / 6 / 8: copy one RECORD's value into the layer this row edits
   * ("Use" on a chain row). The value becomes an explicit `set` on the row's own
   * layer, exactly as typing it would.
   */
  /**
   * FIX-C (i): seed the icon draft for a `Use` of a chain RECORD.
   *
   * The record's `value` is only a string; for a recipe it is the DERIVED render
   * (R2 materializes it at read time), so a prefix guess reopened the recipe as
   * an upload and saving it destroyed the recipe (C1). The record's `owner` is
   * supplied by `IconFieldEditor`, so the ORIGINAL source can be recovered.
   */
  const iconSeedForTier = (value: string, owner?: TierOwner | null) => {
    const source = owner ? iconSourceForOwner(owner, sourceCtxRef.current) : null;
    if (!source) {
      // No stored source (the site tier carries none): the value's shape is all
      // that is knowable.
      return {
        iconMode: { kind: 'set', value: value.startsWith('data:') ? '' : value } as FieldMode,
        iconConfig: value.startsWith('data:') ? { dataUri: value } : undefined,
      };
    }
    const seeded = fromIconFieldValue(iconSourceToDraft(canonicalIconSource(source)));
    return { iconMode: seeded.mode, iconConfig: seeded.iconConfig };
  };

  const applyTierValue = (entry: DashboardEntry, _kind: TierKey, value: string, field: 'title' | 'icon', owner?: TierOwner | null) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = next.get(entry.id);
      if (!current) return prev;
      if (field === 'title') {
        next.set(entry.id, { ...current, titleMode: { kind: 'set', value } });
      } else {
        next.set(entry.id, { ...current, ...iconSeedForTier(value, owner) });
      }
      return next;
    });
  };

  /**
   * Items 2 / 6 / 8: clear ONE RECORD's own value from a chain row.
   *
   * Keyed by the record, not the layer: a layer can hold several records (two
   * slots bound to the same tab, several matching rules), so a layer-keyed action
   * could not say which one the user meant.
   *
   * `override` / `slot` are writable per field here; `rule` / `site` are not the
   * dashboard's to blank for a single field, so they are reported instead of
   * pretending to succeed.
   */
  const clearChainTier = async (owner: TierOwner, field: 'title' | 'icon') => {
    setBusy(true);
    try {
      if (owner.kind === 'override') {
        if (field === 'title') await sendMessage('SET_TAB_OVERRIDE', { tabId: owner.tabId, title: '' });
        else await sendMessage('SET_TAB_OVERRIDE', { tabId: owner.tabId, favicon: null });
      } else if (owner.kind === 'slot') {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: owner.slotId,
          uiMarker: field === 'title' ? { customTitle: '' } : { icon: null },
        });
      } else {
        setToast({ variant: 'error', message: `The ${owner.kind} value is managed in the rule editor.` });
        return;
      }
      setToast({ variant: 'success', message: `${field === 'title' ? 'Title' : 'Icon'} layer cleared` });
      void load();
    } catch {
      setToast({ variant: 'error', message: `Failed to clear the ${field} layer` });
    } finally {
      setBusy(false);
    }
  };

  /** IMP-6 / DT9: replay the whole batch atomically, then redeliver once. */
  const handleUndo = async (snapshot: UndoSnapshot) => {
    setBusy(true);
    try {
      for (const write of snapshot.writes) {
        if (write.kind === 'tab-override') {
          // FIX-A: replay the ORIGINAL source verbatim — never re-derive it.
          await sendMessage('SET_TAB_OVERRIDE', {
            tabId: write.tabId,
            ...(write.title !== undefined ? { title: write.title ?? '' } : {}),
            ...(write.favicon !== undefined ? { favicon: write.favicon } : {}),
          });
        } else if (write.kind === 'slot-marker') {
          await sendMessage('UPDATE_SLOT_UI_MARKER', {
            slotId: write.slotId,
            uiMarker: {
              ...(write.customTitle !== undefined ? { customTitle: write.customTitle ?? '' } : {}),
              ...(write.icon !== undefined ? { icon: write.icon } : {}),
            },
          });
        }
      }
      setUndoState(null);
      setToast({ variant: 'success', message: 'Restored' });
      void load();
    } catch {
      setToast({ variant: 'error', message: 'Failed to restore' });
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (entry: DashboardEntry) => {
    const t = entry.chain.title.winner.value;
    // FIX-C: seed from the SOURCE TYPE, never from the value's shape. A recipe's
    // materialized value is a `data:` URI, so a prefix guess reopened it as an
    // upload — and saving flipped `type:'template'` to `type:'upload'`.
    const source = thisEntryIconSource(entry);
    const icon = source
      ? fromIconFieldValue(iconSourceToDraft(source))
      : { mode: { kind: 'use-chain' } as FieldMode, iconConfig: undefined };

    setExpanded((prev) => new Set(prev).add(entry.id));
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(entry.id, {
        titleMode: t !== null ? { kind: 'set', value: t } : { kind: 'use-chain' },
        iconMode: icon.mode,
        iconConfig: icon.iconConfig,
      });
      return next;
    });
  };

  /** The per-row Save handler: commits BOTH dimensions of that row's draft. */
  const applyDraft = async (entry: DashboardEntry) => {
    const draft = drafts.get(entry.id);
    if (!draft) return;
    setBusy(true);
    try {
      const titleValue = draft.titleMode.kind === 'set' ? draft.titleMode.value.trim() : null;
      // T7/C1: persist the IconSource directly — a recipe stays `type:'template'`
      // (never flattened to a rendered data URI). `null` clears the layer.
      const favicon = resolveDraftFavicon(draft) ?? null;

      if (entry.kind === 'override' && entry.tabId != null) {
        await sendMessage('SET_TAB_OVERRIDE', {
          tabId: entry.tabId,
          title: titleValue ?? '',
          favicon,
        });
        focusAfterWrite(entry, `cp-${String(entry.tabId)}`);
      } else if (entry.kind === 'rule-hit' && entry.tabId != null) {
        // A rule-hit row owns NO stored value of its own: `rule-hit` is the
        // "managed tab" view over a tab whose value comes from a rule. Editing
        // one therefore PROMOTES that tab to a Page-level override (the top of
        // the `override > slot > rule > site` chain) — which is exactly what the
        // user asked for when they edited a rule-driven tab.
        //
        // Writing nothing here (the former behaviour) reported `Tab x updated`
        // while the tab, its title/icon and the row all stayed unchanged.
        await sendMessage('SET_TAB_OVERRIDE', {
          tabId: entry.tabId,
          title: titleValue ?? '',
          favicon,
        });
        // Promotion is exactly what the cue must show: `hit-N` is no longer a
        // row after the reload, the tab is now an `override` row `cp-N`.
        focusAfterWrite(entry, `cp-${String(entry.tabId)}`);
      } else if (entry.kind === 'slot' && entry.slotId != null) {
        await sendMessage('UPDATE_SLOT_UI_MARKER', {
          slotId: entry.slotId,
          uiMarker: {
            customTitle: titleValue ?? '',
            icon: favicon,
          },
        });
        focusAfterWrite(entry, `slot-${String(entry.slotId)}`);
      }
      setToast({ variant: 'success', message: `${entry.label} updated` });
      setDrafts((prev) => { const next = new Map(prev); next.delete(entry.id); return next; });
      setExpanded((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
      void load();
    } catch {
      setToast({ variant: 'error', message: `Failed to update ${entry.label}` });
    } finally {
      setBusy(false);
    }
  };

  

  return (
    <section aria-label="Data dashboard">
      <h2>Data Dashboard</h2>
      <p className="tbs-settings__hint">
        All icons and titles you set via the sidebar current page and slot objects. Clear them to restore original values.
      </p>

      {/* D-20: destructive resets are confirmed. */}
      <Confirm
        open={confirmReset !== null}
        title="Clear selection?"
        message="The values this layer owns will be removed. Lower layers will decide again, and the page falls back to the site value."
        confirmLabel="Clear"
        variant="danger"
        onCancel={() => { setConfirmReset(null); }}
        onConfirm={() => {
          const which = confirmReset;
          setConfirmReset(null);
          if (which?.kind === 'all') void resetAll();
          else if (which?.kind === 'selected') void resetSelected();
          else if (which?.kind === 'entry') {
            const entry = entries.find((e) => e.id === which.id);
            if (entry) void resetEntry(entry);
          }
        }}
      />

      {/* G1: a summary sentence when rows exist but none can be applied here. */}
      {summary && (
        <p className="tbs-settings__summary" role="status">{summary}</p>
      )}

      <div className="tbs-settings__toolbar">
        <Button size="sm" variant="secondary" onClick={() => { setConfirmReset({ kind: 'selected' }); }} disabled={selected.size === 0 || busy} aria-label="Reset selected items">
          Reset Selected ({selected.size})
        </Button>
        <Button size="sm" variant="danger" onClick={() => { setConfirmReset({ kind: 'all' }); }} disabled={entries.length === 0 || busy} aria-label="Reset all items">
          Reset All
        </Button>
      </div>

      <table className="tbs-settings__table" role="table" aria-label="Set icons and titles">
        <thead>
          <tr>
            <th scope="col" style={{ width: '32px' }}>
              <input
                type="checkbox"
                // N8: the header select-all is derived from the SAME list the rows use.
                checked={visibleEntries.length > 0 && selected.size === visibleEntries.length}
                onChange={() => {
                  if (selected.size === visibleEntries.length) setSelected(new Set());
                  else setSelected(new Set(visibleEntries.map((e) => e.id)));
                }}
                aria-label="Select all dashboard items"
              />
            </th>
            <th scope="col">
              <div className="tbs-settings__actions-head">
                <button
                  type="button"
                  className="tbs-settings__sortable"
                  onClick={() => { toggleSort('label'); }}
                  aria-label="Sort by Source"
                >
                  Source{sortKey === 'label' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
                {/* URL show/hide toggle (issue 4): inactive = URLs shown, active = hidden */}
                <button
                  type="button"
                  className={`tbs-inline-field__reset tbs-settings__url-toggle${showUrl ? ' is-active' : ''}`}
                  onClick={() => { setShowUrl((v) => !v); }}
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
                onClick={() => { toggleSort('title'); }}
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
          {visibleEntries.map((entry) => {
            const titleWinner = entry.chain.title.winner;
            const faviconWinner = entry.chain.favicon.winner;
            const deliveryText = deliveryLabel(entry.delivery);
            const isOpen = expanded.has(entry.id);
            const draft = drafts.get(entry.id);
            return (
              <Fragment key={entry.id}>
                <tr
                  className={entry.delivery === 'protected' ? 'tbs-settings__row--disabled' : ''}
                  data-dash-row="true"
                  data-dash-entry={entry.id}
                  data-dash-anchor={entry.anchor
                    ? `${entry.anchor.kind}:${entry.anchor.kind === 'rule' ? entry.anchor.ruleId : entry.anchor.kind === 'slot' ? String(entry.anchor.slotId) : entry.anchor.kind === 'override' ? String(entry.anchor.tabId) : 'site'}`
                    : undefined}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={() => { toggleSelect(entry.id); }}
                      aria-label={`Select ${entry.label}`}
                    />
                  </td>
                  <td>
                    {/* IMP-5: the SOURCE badge is also the jump-to-row entry. */}
                    <button
                      type="button"
                      className="tbs-settings__anchor-badge"
                      onClick={() => { jumpTo(entry.anchor); }}
                      aria-label={`Jump to ${entry.label}`}
                    >
                      {entry.label}
                    </button>
                    {!showUrl && entry.url && (
                      <span className="tbs-settings__dashboard-url" title={entry.url}>{entry.url}</span>
                    )}
                    {deliveryText && (
                      <span className="tbs-settings__delivery" title={deliveryText}>{deliveryText}</span>
                    )}
                  </td>
                  <td>
                    {/* IMP-5: the CELL shows only the winning value + its source badge. */}
                    {titleWinner.value ?? '—'}
                    {/* CT3-e: a text/icon source marker, never colour alone. */}
                    <span className="tbs-settings__chain-badge">{titleWinner.source}</span>
                  </td>
                  <td>
                    {faviconWinner.value ? (
                      <img src={faviconWinner.value} alt="" style={{ width: 16, height: 16, borderRadius: 2, verticalAlign: 'middle' }} />
                    ) : (
                      '—'
                    )}
                    <span className="tbs-settings__chain-badge">{faviconWinner.source}</span>
                  </td>
                  <td>
                    <div className="tbs-settings__row-actions">
                      {/* D-9: the label is the readable name, not the internal id. */}
                      <Button size="sm" variant="secondary" onClick={() => { openEdit(entry); }} disabled={busy} aria-label={`Edit ${entry.label}`}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => { setConfirmReset({ kind: 'entry', id: entry.id }); }} disabled={busy} aria-label={`Clear ${entry.label}`}>
                        Clear
                      </Button>
                    </div>
                  </td>
                </tr>
                {/* IMP-4: the edit panel is INLINE in the row (no Dialog/drawer),
                    via the SAME shell `InlineRuleEditor` uses. */}
                {isOpen && draft && (
                  <InlineEditorShell
                    colSpan={5}
                    title={`Edit ${entry.label}`}
                    ariaLabel={`Edit ${entry.label}`}
                    // Review: the Dashboard pairs its two editors side by side,
                    // exactly like `New Rule` / `Edit Rule` do through
                    // `RuleFormFields`' own pair. Same responsive behaviour: the
                    // two tracks collapse to one below the shared 560px
                    // breakpoint, so the panel never squeezes a field in half.
                    grid
                    onEscape={() => { setDrafts((prev) => { const n = new Map(prev); n.delete(entry.id); return n; }); setExpanded((prev) => { const n = new Set(prev); n.delete(entry.id); return n; }); }}
                    actions={
                      <>
                        <Button size="sm" variant="ghost" onClick={() => { setDrafts((prev) => { const n = new Map(prev); n.delete(entry.id); return n; }); setExpanded((prev) => { const n = new Set(prev); n.delete(entry.id); return n; }); }}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void applyDraft(entry)}
                          // IMP-19/RK-4: the row's Save is enabled ONLY by that row's real dirty state.
                          disabled={busy || !isDraftDirty(entry, draft)}
                        >
                          Save
                        </Button>
                      </>
                    }
                  >
                    <FieldEditor
                      field="title"
                      idPrefix={`dash-${entry.id}`}
                      mode={draft.titleMode}
                      onChange={(mode) => { setDrafts((prev) => { const n = new Map(prev); n.set(entry.id, { ...draft, titleMode: mode }); return n; }); }}
                      chain={entry.chain.title}
                      baseline={{ mode: { kind: 'use-chain' } }}
                      onResetEdit={() => { setDrafts((prev) => { const n = new Map(prev); n.set(entry.id, { ...draft, titleMode: { kind: 'use-chain' } }); return n; }); }}
                      onClearChain={() => void clearEntryField(entry, 'title')}
                      clearing={busy}
                      canClearChain
                      submitMode={{ kind: 'draft', dirty: draft.titleMode.kind === 'set', onDraftChange: (next) => { setDrafts((prev) => { const n = new Map(prev); n.set(entry.id, { ...draft, titleMode: next.mode }); return n; }); } }}
                      onJumpToOwner={jumpTo}
                      // Items 2 / 3 / 4 / 6 / 8: per-RECORD apply/clear inside
                      // `Use chain`; selecting a record previews its title.
                      onApplyTier={(_kind, value) => { applyTierValue(entry, _kind, value, 'title'); }}
                      onClearTier={(owner) => { void clearChainTier(owner, 'title'); }}
                      previewOwner={previewOwner(entry, 'title')}
                      onSelectPreview={(owner) => { selectPreview(entry, owner); }}
                      selfOwner={entry.anchor}
                      tabId={entry.tabId ?? null}
                      disabled={busy}
                    />
                    <FieldEditor
                      field="icon"
                      idPrefix={`dash-${entry.id}`}
                      mode={draft.iconMode}
                      onChange={(mode) => { setDrafts((prev) => { const n = new Map(prev); n.set(entry.id, { ...draft, iconMode: mode }); return n; }); }}
                      iconConfig={draft.iconConfig}
                      onIconConfigChange={(cfg) => { setDrafts((prev) => { const n = new Map(prev); n.set(entry.id, { ...draft, iconConfig: cfg }); return n; }); }}
                      chain={entry.chain.favicon}
                      baseline={{ mode: { kind: 'use-chain' } }}
                      onResetEdit={() => { setDrafts((prev) => { const n = new Map(prev); n.set(entry.id, { ...draft, iconMode: { kind: 'use-chain' }, iconConfig: undefined }); return n; }); }}
                      onClearChain={() => void clearEntryField(entry, 'icon')}
                      clearing={busy}
                      canClearChain
                      submitMode={{ kind: 'draft', dirty: draft.iconMode.kind === 'set' || draft.iconConfig !== undefined, onDraftChange: (next) => { setDrafts((prev) => { const n = new Map(prev); n.set(entry.id, { ...draft, iconMode: next.mode, iconConfig: next.iconConfig }); return n; }); } }}
                      onJumpToOwner={jumpTo}
                      // Items 2 / 3 / 4 / 6 / 8: per-RECORD apply/clear inside
                      // `Use chain`; selecting a record previews its icon.
                      onApplyTier={(_kind, value, owner) => { applyTierValue(entry, _kind, value, 'icon', owner); }}
                      onClearTier={(owner) => { void clearChainTier(owner, 'icon'); }}
                      previewOwner={previewOwner(entry, 'icon')}
                      onSelectPreview={(owner) => { selectPreview(entry, owner); }}
                      selfOwner={entry.anchor}
                      tabId={entry.tabId ?? null}
                      disabled={busy}
                    />
                  </InlineEditorShell>
                )}
              </Fragment>
            );
          })}
          {visibleEntries.length === 0 && (
            <tr>
              <td colSpan={5}>
                {loadError && !hasLoaded ? (
                  <EmptyState variant="error-first" action={{ label: 'Retry', onClick: () => void load() }} />
                ) : loadError ? (
                  <EmptyState variant="error-stale" action={{ label: 'Retry', onClick: () => void load() }} />
                ) : (
                  <EmptyState
                    variant="empty"
                    message="Nothing customized yet. Set a title or icon from the sidebar to see it here."
                  />
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* F2-c: the non-visual jump announcement (role=status, focus untouched). */}
      {announcement && (
        <div className="tbs-sr-only" role="status">{announcement.message}</div>
      )}

      {/* IMP-6/DT9: the generalized undo bar for an immediate Clear. */}
      {undoState && (
        <UndoBar
          state={undoState}
          onUndo={(snapshot) => void handleUndo(snapshot)}
          onExpire={() => setUndoState(null)}
        />
      )}

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => { setToast(null); }} />
      )}
    </section>
  );
}

// ─── Import/Export Section (Problem 7) ──────────────────────────────────────

/**
 * D13: the shared download gesture. The filename convention is unchanged from
 * the previous export path, and the download still goes through Blob +
 * `URL.createObjectURL`.
 */
function downloadPackage(pkg: string): void {
  const blob = new Blob([pkg], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tab-bookmarks-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * T19 (Q2=B-2): the independent EXPORT section, inside the settings page next
 * to the import one — NOT a new HTML page and NOT a new build entry.
 *
 * D1: four dimension checkboxes; an empty selection is BLOCKED (exporting
 * nothing is not a legal export). D1/D13: export produces the package and shows
 * a per-dimension summary FIRST; the download is a separate, explicit step.
 *
 * T19-B (D4-permitted degradation): no shortcut producer exists yet
 * (`PortableShortcuts` is never populated — that lands in T22), so the
 * shortcuts checkbox is DISABLED with a visible reason instead of silently
 * exporting an empty dimension.
 *
 * T19-C: a selected record dimension can be expanded and its records
 * individually deselected (`scope.excludedSlotIds` / `excludedRuleIds`).
 */
function ExportSection() {
  const [checked, setChecked] = useState<Record<keyof DimensionPresence, boolean>>({
    slots: false, rules: false, settings: false, shortcuts: false,
  });
  /** T19-C: per-record deselection inside a selected dimension (D1). */
  const [excludedSlots, setExcludedSlots] = useState<number[]>([]);
  const [excludedRules, setExcludedRules] = useState<string[]>([]);
  /**
   * The records a package could carry, from the SAME GET_STATE snapshot the
   * import section uses (one source of truth, one fetch per surface). `null`
   * means the read failed — expansion is then simply not offered.
   */
  const [records, setRecords] = useState<{ slots: SlotDefinition[]; rules: PageRule[] } | null>(null);
  const [pkg, setPkg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await sendMessage('GET_STATE');
        const result = extractResult(res);
        const sync = result?.success
          ? (result.sync as { slots?: SlotDefinition[]; rules?: PageRule[] } | undefined)
          : undefined;
        setRecords({ slots: sync?.slots ?? [], rules: sync?.rules ?? [] });
      } catch {
        setRecords(null);
      }
    })();
  }, []);

  const anyChecked = (Object.keys(checked) as Array<keyof DimensionPresence>).some((d) => checked[d]);
  const scope: ExportScope = {
    slots: checked.slots, rules: checked.rules, settings: checked.settings, shortcuts: checked.shortcuts,
    excludedSlotIds: excludedSlots, excludedRuleIds: excludedRules,
  };

  const toggleExcluded = (kind: 'slot' | 'rule', id: number | string) => {
    if (kind === 'slot') {
      setExcludedSlots((prev) =>
        prev.includes(id as number) ? prev.filter((x) => x !== id) : [...prev, id as number]);
    } else {
      setExcludedRules((prev) =>
        prev.includes(id as string) ? prev.filter((x) => x !== id) : [...prev, id as string]);
    }
  };

  const summary = (() => {
    if (!pkg) return null;
    try {
      const parsed = JSON.parse(pkg) as { slots?: unknown[]; rules?: unknown[]; settings?: unknown; shortcuts?: unknown };
      return {
        slots: parsed.slots?.length ?? 0,
        rules: parsed.rules?.length ?? 0,
        settings: parsed.settings ? 1 : 0,
        shortcuts: parsed.shortcuts ? 1 : 0,
      };
    } catch {
      return null;
    }
  })();

  const handleExport = async () => {
    setExporting(true);
    setPkg(null);
    try {
      const res = await sendMessage('EXPORT_PACKAGE', { scope });
      const result = extractResult(res);
      if (result?.success && result.package) setPkg(result.package as string);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section data-testid="export-section" aria-label="Export">
      <h3>Export</h3>
      <p className="tbs-settings__hint">Choose what to include, then export a package.</p>
      <ul className="tbs-settings__export-dims">
        {DIMENSION_LABELS.map(({ dim, label }) => (
          <li key={dim}>
            <label>
              <input
                type="checkbox"
                data-testid={`export-dim-${dim}`}
                checked={checked[dim]}
                disabled={dim === 'shortcuts'}
                onChange={(e) => {
                  const next = e.currentTarget.checked;
                  setChecked((prev) => ({ ...prev, [dim]: next }));
                }}
              />
              {label}
            </label>
            {/* T19-B: no shortcut producer exists yet (T22); say so rather
                than exporting a dimension that would always be empty. */}
            {dim === 'shortcuts' && (
              <span className="tbs-settings__export-unavailable" data-testid="export-shortcuts-reason">
                Shortcuts are not supported for export yet.
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* T19-C: expand a selected record dimension and deselect individual
          records (D1 "expand to record level"). */}
      {checked.slots && records !== null && (
        <details className="tbs-settings__export-records" data-testid="export-records-slots">
          <summary>Slots ({records.slots.length})</summary>
          <ul>
            {records.slots.map((slot) => (
              <li key={slot.id}>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`export-record-slot-${String(slot.id)}`}
                    checked={!excludedSlots.includes(slot.id)}
                    onChange={() => { toggleExcluded('slot', slot.id); }}
                  />
                  {slot.titleSnapshot || `Slot ${String(slot.id)}`}
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
      {checked.rules && records !== null && (
        <details className="tbs-settings__export-records" data-testid="export-records-rules">
          <summary>Rules ({records.rules.length})</summary>
          <ul>
            {records.rules.map((rule) => (
              <li key={rule.id}>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`export-record-rule-${rule.id}`}
                    checked={!excludedRules.includes(rule.id)}
                    onChange={() => { toggleExcluded('rule', rule.id); }}
                  />
                  {rule.title || rule.urlMatch.value}
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!anyChecked && (
        <p className="tbs-settings__hint" data-testid="export-empty-reason">
          Select at least one dimension to export.
        </p>
      )}

      <Button
        size="md"
        variant="primary"
        data-testid="export-submit"
        disabled={!anyChecked}
        loading={exporting}
        onClick={() => { void handleExport(); }}
      >
        Export
      </Button>

      {pkg && summary && (
        <div
          className="tbs-settings__export-summary"
          data-testid="export-summary"
          role="region"
          aria-label="Export package summary"
        >
          <h4>Package summary</h4>
          <ul>
            <li>Slots: {summary.slots}</li>
            <li>Rules: {summary.rules}</li>
            <li>Settings: {summary.settings}</li>
            <li>Shortcuts: {summary.shortcuts}</li>
          </ul>
          <Button size="sm" variant="secondary" data-testid="export-download" onClick={() => { downloadPackage(pkg); }}>
            Download
          </Button>
        </div>
      )}
    </section>
  );
}

/** T18: the fixed four dimensions (D5), in the order the diff groups them. */
const DIMENSION_LABELS: ReadonlyArray<{ dim: keyof DimensionPresence; label: string }> = [
  { dim: 'slots', label: 'Slots' },
  { dim: 'rules', label: 'Rules' },
  { dim: 'settings', label: 'Settings' },
  { dim: 'shortcuts', label: 'Shortcuts' },
];

function ImportExportSection() {
  const [importing, setImporting] = useState(false);
  /**
   * The file string READ AT INSPECT. APPLY sends THIS exact string (D12:
   * constructive sameness — no re-read, no fingerprint), so it is held here.
   */
  const [file, setFile] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  /** The parsed package behind `file`; `null` when the file was unreadable. */
  const [pkg, setPkg] = useState<ExportPackage | null>(null);
  /**
   * The target machine's CURRENT state, fetched once per chosen file (D7). The
   * deletion count must be derived by actually applying the intent
   * (`applyIntent` + `quantifyDeletions`) rather than by re-reading a diff:
   * only that path stays constructively identical to what APPLY will do. The
   * SAME snapshot backs the export record list (T19-C) — never a second fetch.
   */
  const [current, setCurrent] = useState<SyncState | null>(null);
  const [intent, setIntent] = useState<ImportIntent>(() => defaultImportIntent());
  /** The quantized confirmation is CONSTANT (D7) — opened by Apply, always. */
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * D6/A11: choose a file → `IMPORT_INSPECT` (read-only). The INSPECTION is
   * intent-independent, so later mode/record changes only re-render — they never
   * re-inspect and never re-read the file.
   */
  const handleFileChosen = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    if (!chosen) return;
    setImporting(true);
    setInspection(null);
    setFile(null);
    setPkg(null);
    setCurrent(null);
    try {
      const text = typeof chosen.text === 'function' ? await chosen.text() : '';
      const res = await sendMessage('IMPORT_INSPECT', { file: text });
      const result = extractResult(res);
      if (result?.success && result.inspection) {
        setFile(text);
        setInspection(result.inspection as ImportInspection);
        setPkg(parseExportPackage(text));
        setIntent(defaultImportIntent());
        // D7: the quantification needs the CURRENT state. A failure here is
        // NON-fatal — `current` stays null and the copy reports "unknown"
        // rather than the false claim "no records".
        try {
          const stateRes = await sendMessage('GET_STATE');
          const stateResult = extractResult(stateRes);
          if (stateResult?.success && stateResult.sync) {
            setCurrent(stateResult.sync as SyncState);
          }
        } catch {
          // keep `null` — the confirm dialog still opens, with unknown copy
        }
      } else {
        setToast({ variant: 'error', message: (result?.message as string) || 'Invalid import file' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to read the import file' });
    } finally {
      setImporting(false);
      input.value = ''; // allow re-selecting the same file
    }
  };

  const setDimensionMode = (dim: keyof ImportIntent['dimensionModes'], mode: DimensionMode) => {
    setIntent((prev) => ({ ...prev, dimensionModes: { ...prev.dimensionModes, [dim]: mode } }));
  };

  /** A4: sparse per-record override; absent = inherit the dimension mode. */
  const setRecordAction = (kind: 'slot' | 'rule', id: number | string, action: 'keep' | 'take') => {
    setIntent((prev) => {
      const rest = (prev.recordOverrides ?? []).filter((o) => !(o.kind === kind && o.id === id));
      return { ...prev, recordOverrides: [...rest, { kind, id, action }] };
    });
  };

  const carried = (d: keyof DimensionPresence): boolean => inspection?.dimensions[d] ?? false;

  /**
   * Design D7: quantify only IRREVERSIBLE deletions, computed under the intent
   * the user has ACTUALLY chosen. The count is the product of the SAME
   * derivation APPLY performs (`applyIntent` then `quantifyDeletions`), so the
   * dialog cannot describe a different outcome than the write — no parallel
   * re-implementation of the "file-missing" rule, and no reliance on the
   * INSPECTION's default-intent `status` (which under-reports after a switch).
   *
   * `null` means the current state could not be read: the count is UNKNOWN, not
   * zero (assuming zero would assert "no records" while knowing nothing — the
   * exact misleading-copy defect D7 exists to prevent).
   */
  const deletionCounts = useMemo(() => {
    if (!pkg || !current) return null;
    return quantifyDeletions(applyIntent(pkg, current, intent), current);
  }, [pkg, current, intent]);

  /** D7/A9: the confirmation copy is CONSTANT (even at 0 deletions). */
  const quantizedMessage = (() => {
    if (deletionCounts === null) {
      // Unknown ≠ none: never claim "no records" without having computed it.
      return 'This import will delete an unknown number of records, and cannot be undone.';
    }
    const parts: string[] = [];
    if (deletionCounts.slots > 0) parts.push(`${String(deletionCounts.slots)} slots`);
    if (deletionCounts.rules > 0) parts.push(`${String(deletionCounts.rules)} rules`);
    const noun = parts.length > 0 ? parts.join(' and ') : 'no records';
    return `This import will delete ${noun}, and cannot be undone.`;
  })();

  const handleApply = () => {
    if (!file || !inspection) return;
    // D7: the dialog is constant — there is no "0 deletions" fast path.
    setConfirming(true);
  };

  const handleConfirmApply = async () => {
    if (!file || !inspection) return;
    setConfirming(false);
    setImporting(true);
    try {
      // D12: the SAME string read at INSPECT; C3/F4: bind to the INSPECT version.
      const res = await sendMessage('IMPORT_APPLY', { file, intent }, inspection.configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setToast({ variant: 'success', message: 'Import applied' });
        setInspection(null);
        setFile(null);
        setPkg(null);
        setCurrent(null);
      } else {
        setToast({ variant: 'error', message: (result?.message as string) || 'Import failed' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  /**
   * A9: a SIBLING of the confirm action, never a gate. Exporting the current
   * state is a backup the user MAY take; it must not become an implicit
   * prerequisite (that would re-create the forced-backup defect). It leaves the
   * dialog open and applies nothing.
   */
  const handleExportBackup = () => {
    // A backup IS "export the current state" (A11) — no separate action. It
    // downloads immediately; it does NOT touch the pending import.
    void (async () => {
      try {
        const res = await sendMessage('EXPORT_PACKAGE', {
          scope: { slots: true, rules: true, settings: true, shortcuts: true },
        });
        const result = extractResult(res);
        if (result?.success && result.package) {
          downloadPackage(result.package as string);
        } else {
          setToast({ variant: 'error', message: 'Backup failed' });
        }
      } catch {
        setToast({ variant: 'error', message: 'Backup failed' });
      }
    })();
  };

  return (
    <section aria-label="Import and export">
      <h2>Import / Export</h2>

      <div className="tbs-settings__import-zone">
        <p>Import configuration from a JSON file</p>
        <input
          ref={fileInputRef}
          data-testid="import-file-input"
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => { void handleFileChosen(e.currentTarget); }}
        />
        <Button size="md" variant="secondary" onClick={handleImportClick} loading={importing} aria-label="Import configuration">
          Choose File to Import
        </Button>
      </div>

      {/* D6: single page — dimension groups, diff and the confirm dialog are all
          reachable without stepping through a wizard. */}
      {inspection && (
        <div className="tbs-settings__import-diff" data-testid="import-diff" role="region" aria-label="Import diff">
          {DIMENSION_LABELS.map(({ dim, label }) => {
            const records = inspection.diff.records.filter((r) =>
              dim === 'slots' ? r.kind === 'slot' : dim === 'rules' ? r.kind === 'rule' : false,
            );
            const isRecordDimension = dim === 'slots' || dim === 'rules';
            return (
              <section key={dim} className="tbs-settings__import-dim" data-testid={`import-dim-${dim}`}>
                <h3>{label}</h3>
                {!carried(dim) ? (
                  // A2: a dimension the package did not carry cannot be chosen —
                  // offering a selector here would be a lie.
                  <p className="tbs-settings__hint" data-testid={`import-absent-${dim}`}>
                    This package does not include {label.toLowerCase()}.
                  </p>
                ) : (
                  <>
                    <label>
                      Mode for {label}
                      <select
                        data-testid={`import-mode-${dim}`}
                        value={intent.dimensionModes[dim]}
                        onChange={(e) => { setDimensionMode(dim, e.currentTarget.value as DimensionMode); }}
                      >
                        <option value="incremental">Incremental (add / replace)</option>
                        <option value="overwrite">Overwrite</option>
                      </select>
                    </label>
                    {isRecordDimension && records.length > 0 && (
                      <ul className="tbs-settings__import-records">
                        {records.map((r) => (
                          <li key={`${r.kind}-${String(r.id)}`}>
                            <span>{r.label}</span> <span>{r.status}</span>
                            <button
                              type="button"
                              aria-label={`Keep ${r.label}`}
                              onClick={() => { setRecordAction(r.kind, r.id, 'keep'); }}
                            >
                              Keep
                            </button>
                            <button
                              type="button"
                              aria-label={`Take ${r.label}`}
                              onClick={() => { setRecordAction(r.kind, r.id, 'take'); }}
                            >
                              Take
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            );
          })}

          <div className="tbs-settings__import-actions">
            <Button size="sm" variant="ghost" onClick={() => { setInspection(null); setFile(null); setPkg(null); setCurrent(null); }}>Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              data-testid="import-apply"
              onClick={handleApply}
              loading={importing}
            >
              Apply
            </Button>
          </div>
        </div>
      )}

      {/* D7: the quantized confirmation is CONSTANT — opened by Apply, even with
          zero deletions. A9: "Export backup" and the confirm action are SIBLINGS
          (backup is a choice, not a prerequisite), so applying is a separate,
          explicit click inside this dialog. */}
      <Dialog
        open={confirming}
        onClose={() => { setConfirming(false); }}
        title="Confirm import"
        footer={
          <>
            <Button
              size="sm"
              variant="danger"
              data-testid="import-confirm"
              onClick={() => { void handleConfirmApply(); }}
              loading={importing}
            >
              I understand the risk, confirm import
            </Button>
            <Button size="sm" variant="secondary" onClick={handleExportBackup}>
              Export backup
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfirming(false); }}>Cancel</Button>
          </>
        }
      >
        <p>{quantizedMessage}</p>
      </Dialog>

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => { setToast(null); }} />
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
  const [activeSection, setActiveSection] = useState<SettingsSection>(() =>
    resolveSectionFromHash(window.location.hash),
  );
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [matchSettings, setMatchSettings] = useState<MatchRuleSettings>(DEFAULT_MATCH_SETTINGS);
  const [switchDirection, setSwitchDirection] = useState<SwitchDirection>('next');
  const [autoBindGlobal, setAutoBindGlobal] = useState(true);
  const [slots, setSlots] = useState<SlotDefinition[]>([]);
  /**
   * ACC#5: un-committed per-slot strategy choices. Layered over `slots` when
   * rendered so a failed/slow write never collapses the editor back to
   * "Inherit global". An entry is dropped once the server confirms it.
   */
  const [slotStrategyDrafts, setSlotStrategyDrafts] = useState<Record<number, SlotStrategyValue>>({});
  const [configVersion, setConfigVersion] = useState(0);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [conflictBanner, setConflictBanner] = useState(false);
  // P11: top-level three-state — loading / failed / loaded
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load state
  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
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
        const sync = stateResult.sync as {
          matchSettings?: MatchRuleSettings;
          switchDirection?: SwitchDirection;
          autoBindGlobal?: boolean;
          slots: SlotDefinition[];
          configVersion: number;
        };
        // NIT-4 read-side defensive default (never reads the removed legacy
        // strategy field).
        setMatchSettings(sync.matchSettings ?? DEFAULT_MATCH_SETTINGS);
        setSwitchDirection(sync.switchDirection ?? 'next');
        setAutoBindGlobal(sync.autoBindGlobal ?? true);
        setSlots(sync.slots);
        setConfigVersion(sync.configVersion);
      }
      setLoading(false);
    } catch {
      setLoading(false);
      setError('Failed to load settings');
      setToast({ variant: 'error', message: 'Failed to load settings' });
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // P1: follow hash-only navigation on an already-open settings tab.
  useEffect(() => {
    const onHashChange = () => {
      setActiveSection(resolveSectionFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => { window.removeEventListener('hashchange', onHashChange); };
  }, []);

  const handleGlobalChange = useCallback(async (settings: MatchRuleSettings) => {
    try {
      const res = await sendMessage('SET_GLOBAL_STRATEGY', { matchSettings: settings }, configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setMatchSettings(settings);
        setConfigVersion((v) => v + 1);
        setToast({ variant: 'success', message: 'Settings updated' });
      } else if (result?.errorCode === 'CONFIG_CONFLICT') {
        setConflictBanner(true);
        void loadState();
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to update settings' });
    }
  }, [configVersion, loadState]);

  const handleDirectionChange = useCallback(async (direction: SwitchDirection) => {
    try {
      const res = await sendMessage('SET_SWITCH_DIRECTION', { direction }, configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setSwitchDirection(direction);
        setConfigVersion((v) => v + 1);
      } else if (result?.errorCode === 'CONFIG_CONFLICT') {
        setConflictBanner(true);
        void loadState();
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to update direction' });
    }
  }, [configVersion, loadState]);

  const handleAutoBindGlobalChange = useCallback(async (enabled: boolean) => {
    try {
      const res = await sendMessage('SET_AUTO_BIND_GLOBAL', { enabled }, configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setAutoBindGlobal(enabled);
        setConfigVersion((v) => v + 1);
      } else if (result?.errorCode === 'CONFIG_CONFLICT') {
        setConflictBanner(true);
        void loadState();
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to update auto-bind' });
    }
  }, [configVersion, loadState]);

  const handleSlotChange = useCallback(async (slotId: number, strategy: 'inherit' | MatchRuleSettings) => {
    // ACC#5: optimistic — reflect the choice immediately so the editor never
    // collapses to "Inherit global" while the write is in flight or if it fails.
    setSlotStrategyDrafts((prev) => ({ ...prev, [slotId]: strategy }));
    try {
      const res = await sendMessage('SET_SLOT_STRATEGY', { slotId, strategy }, configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setSlots((prev) => upsertSlotStrategy(prev, slotId, strategy));
        setSlotStrategyDrafts((prev) => removeSlotDraft(prev, slotId));
        setConfigVersion((v) => v + 1);
      } else if (result?.errorCode === 'CONFIG_CONFLICT') {
        // Keep the user's input visible; the conflict banner explains + refreshes.
        setConflictBanner(true);
        void loadState();
      } else {
        // Non-conflict failure: DO NOT silently revert — surface it and keep the
        // draft so the user's selection survives.
        setToast({ variant: 'error', message: (result?.message as string) || `Failed to update slot ${String(slotId)}` });
      }
    } catch {
      // Keep the draft on a thrown error too — never discard the user's input.
      setToast({ variant: 'error', message: `Failed to update slot ${String(slotId)}` });
    }
  }, [configVersion, loadState]);

  const handleSlotAutoBindChange = useCallback(async (slotId: number, override: boolean | null) => {
    try {
      const res = await sendMessage('SET_SLOT_AUTO_BIND', { slotId, override }, configVersion);
      const result = extractResult(res);
      if (result?.success) {
        setSlots((prev) => prev.map((s) => {
          if (s.id !== slotId) return s;
          const next = { ...s };
          if (override === null) {
            delete next.autoBindOverride;
          } else {
            next.autoBindOverride = override;
          }
          return next;
        }));
        setConfigVersion((v) => v + 1);
      } else if (result?.errorCode === 'CONFIG_CONFLICT') {
        setConflictBanner(true);
        void loadState();
      }
    } catch {
      setToast({ variant: 'error', message: 'Failed to update auto-bind for slot ' + String(slotId) });
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
            onClick={() => { setActiveSection(item.id); }}
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
            <Button size="sm" variant="ghost" onClick={() => { setConflictBanner(false); }}>Dismiss</Button>
          </div>
        )}

        {/* P11: three mutually exclusive states — loading / failed / content */}
        {loading && (
          <div role="status" aria-busy="true" className="tbs-settings__loading">
            Loading settings...
          </div>
        )}

        {!loading && error !== null && (
          <div role="alert" className="tbs-settings__error">
            <p>{error}</p>
            <Button size="sm" variant="primary" onClick={() => { void loadState(); }}>Retry</Button>
          </div>
        )}

        {!loading && error === null && (
          <>
            {activeSection === 'slots' && <ShortcutsSection commands={commands} loading={loading} />}
            {activeSection === 'strategy' && (
              <StrategySection
                matchSettings={matchSettings}
                switchDirection={switchDirection}
                autoBindGlobal={autoBindGlobal}
                slots={mergeSlotDrafts(slots, slotStrategyDrafts)}
                configVersion={configVersion}
                onGlobalChange={(next) => { void handleGlobalChange(next); }}
                onDirectionChange={(dir) => { void handleDirectionChange(dir); }}
                onAutoBindGlobalChange={(enabled) => { void handleAutoBindGlobalChange(enabled); }}
                onSlotChange={(id, next) => { void handleSlotChange(id, next); }}
                onSlotAutoBindChange={(id, override) => { void handleSlotAutoBindChange(id, override); }}
              />
            )}
            {activeSection === 'rules' && (
              <RulesSection />
            )}
            {activeSection === 'dashboard' && <DashboardSection />}
            {activeSection === 'import-export' && (
              <>
                <ImportExportSection />
                <ExportSection />
              </>
            )}
            {activeSection === 'diagnostics' && <DiagnosticsSection />}
          </>
        )}
      </main>

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => { setToast(null); }} />
      )}
    </div>
  );
}
