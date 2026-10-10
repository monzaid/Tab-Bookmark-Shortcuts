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
import { Tabs } from '@ui/shared/tabs';
import { EmptyState } from '@ui/shared/empty-state';
import type { IconConfig } from '@ui/components/IconEditor';
import type { MatchRuleSettings, SwitchDirection, Priority, TabIdMode, RuleCheckMode, SlotDefinition, PageRule, IconSource, TabOverride, DashboardRow, ImportInspection, ImportIntent, ImportRecordOverride, ImportApplyResult, ImportDiff, ImportRecordDiff, ImportRecordStatus, ImportPartDiff, DimensionPresence, DimensionMode, ExportScope, SyncState, UrlMatchType } from '@shared/types';
import { MATCH_TYPE_LABELS } from '@shared/match-type-labels';
import { RecordList, RecordFields } from '@ui/shared/record-list';
import { previewFromIconSource, previewFromFieldValue } from '@ui/shared/icon-preview';
import type { IconPreviewSource } from '@ui/shared/icon-preview';
import type { StatusBadgeProps } from '@ui/shared/components';
import { DEFAULT_MATCH_SETTINGS, defaultImportIntent } from '@shared/types';
import { applyIntent, computeDiff, quantifyDeletions } from '@shared/import-diff';
import { isExportPackage, summariseMatchSettings, summariseStrategy, slotStrategyPartId, slotAutoBindPartId } from '@shared/export-package';
import type { ExportPackage, SettingPartId } from '@shared/export-package';

import { RuleFormFields } from '@ui/shared/rule-form-fields';
import { FieldEditor } from '@ui/shared/field-editor';
import type { FieldMode } from '@ui/shared/field-editor';
import { InlineEditorShell } from '@ui/shared/inline-editor-shell';
import { normalizeRuleDraft, resolveDraftFavicon, validateRuleDraft } from '@ui/shared/rule-form-submit';
import type { RuleDraftValue } from '@ui/shared/rule-form-submit';
import { resolveFieldChain } from '@shared/field-chain';
import type { ChainResult, TierKey, TierOwner } from '@shared/field-chain';
import { useJumpToRow, JUMP_HIGHLIGHT_CLASS, JUMP_HIGHLIGHT_MS } from '@ui/shared/use-jump-to-row';
import { canonicalIconSource, iconSourceForOwner, iconSourceToFieldSeed } from '@ui/shared/icon-source';
import { UndoBar } from '@ui/shared/undo-bar';
import type { UndoState, UndoSnapshot } from '@ui/shared/undo-bar';
import { iconSourceToIconConfig } from '@ui/shared/icon-source';
import { getMessageClient } from '@ui/shared/message-client';
import { formatFieldValue } from '@ui/shared/import-field-format';
import { MatchSettingsHelp } from './MatchSettingsHelp';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommandInfo {
  name: string;
  description: string;
  shortcut: string | null;
}

type SettingsSection = 'slots' | 'rules' | 'strategy' | 'dashboard' | 'import-export' | 'diagnostics';

/**
 * The minimal `storage.onChanged` surface this page needs.
 *
 * Declared as a RUNTIME-PROBED local shape rather than read straight off the
 * ambient `chrome` types: outside an extension context the namespace can be
 * absent (`typeof chrome === 'undefined'`), which the ambient types do not
 * model, so a direct optional-chain would be flagged as an unnecessary check —
 * and dropping the probe would throw in exactly the case it guards.
 */
type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;
interface StorageOnChangedApi {
  addListener: (fn: StorageChangeListener) => void;
  removeListener: (fn: StorageChangeListener) => void;
}

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
 * T22: the APPLY result lands at `result.result` (the service returns
 * `{ success, configVersion, result: ImportApplyResult }`), so unwrap one more
 * level than `extractResult` does.
 */
function extractApplyResult(res: unknown): ImportApplyResult | null {
  const outer = extractResult(res);
  const inner = outer?.result;
  if (inner && typeof inner === 'object') return inner as ImportApplyResult;
  return null;
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
 *
 * `hints` adds a one-clause explanation under each knob. It exists because the
 * knob VALUES are opaque on their own: "Exists / No tab ID" and "Match / No
 * match" state implementation facts, not user intent, so a reader had to consult
 * the (collapsed) reference to learn what they were choosing. The hints are for
 * the GLOBAL block only — repeating three sentences down ten slot rows would be
 * noise, and by then the reader has already met them once.
 */
function MatchKnobs({
  idPrefix,
  settings,
  onChange,
  hints = false,
}: {
  idPrefix: string;
  settings: MatchRuleSettings;
  onChange: (settings: MatchRuleSettings) => void;
  hints?: boolean;
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
        {hints && (
          <span className="tbs-settings__knob-hint">
            Use the tab this slot was last bound to.
          </span>
        )}
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
        {hints && (
          <span className="tbs-settings__knob-hint">
            Use tabs that match the slot&apos;s Match URL.
          </span>
        )}
      </label>
      {/* ACC#6a: the control is REMOVED for combination 2, but the removal is
          now explained in place. A control that simply vanishes leaves the reader
          unsure whether they mis-clicked or lost data — and the value is in fact
          preserved, which the note does not need to say twice. */}
      {showPriority ? (
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
          {hints && (
            <span className="tbs-settings__knob-hint">
              Which of the two wins when both are available.
            </span>
          )}
        </label>
      ) : (
        <p className="tbs-settings__note">
          Priority applies only when Tab ID is used. Your setting is kept for when you switch back.
        </p>
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
    <section aria-label="Global matching settings" className="tbs-settings__panel">
      <h2>Global Matching Settings</h2>
      {/* One sentence saying what this screen decides, before any control. The
          previous version opened straight into an unlabelled row of selects, so
          the reader had to infer the section's job from its controls. */}
      <p className="tbs-settings__panel-sub">
        How a slot finds its tab when you switch to it. These values are the default for every
        slot; individual slots can override them below.
      </p>

      <MatchSettingsHelp />

      {/* Each block is a CARD with a heading, so the screen reads as three
          answerable questions — which tab, which direction, which slot differs —
          instead of one column of controls of equal weight. */}
      <div className="tbs-settings__card">
        <div className="tbs-settings__card-head">
          <h3 className="tbs-settings__card-title">Which tab to switch to</h3>
        </div>
        <p className="tbs-settings__card-note">
          Two sources can answer this, and the Priority setting breaks the tie when both can.
        </p>
        <MatchKnobs
          idPrefix="Global"
          settings={matchSettings}
          onChange={onGlobalChange}
          hints
        />
      </div>

      <div className="tbs-settings__card">
        <div className="tbs-settings__card-head">
          <h3 className="tbs-settings__card-title">How switching behaves</h3>
        </div>
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
      </div>

      <div className="tbs-settings__card">
        <div className="tbs-settings__card-head">
          <h3 className="tbs-settings__card-title">Per-slot overrides</h3>
          <span className="tbs-settings__card-meta">{overriddenCount(slots)} of 10 customised</span>
        </div>
        <p className="tbs-settings__card-note">
          Leave every slot on &ldquo;Inherit&rdquo; to use the settings above everywhere.
        </p>
        {/* Was a three-column table that stretched the full pane: the controls sat
            far apart, the Custom expansion spilled into a squeezed cell, and on a
            narrow window the columns collided. Rows carry the same information in
            a fixed reading width, and the expansion opens on its own line. */}
        <ul className="tbs-settings__slot-list">
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
              // T22/D9: the missing-icon repair entry reveals this exact row.
              <li
                // The SAME predicate the header tally uses — an auto-bind-only
                // override is an override, and the row must show that too.
                className={`tbs-settings__slot-row${isSlotOverridden(slot) ? ' tbs-settings__slot-row--custom' : ''}`}
                key={slotId}
                data-testid={`slot-row-${String(slotId)}`}
              >
                <div className="tbs-settings__slot-row__head">
                  {/* The NUMBER alone, never the page title. This list is the
                      SLOT dimension: a slot overrides how switching works for
                      whatever page it later holds, not for the tab it happens to
                      be bound to right now. Appending the current page title
                      ("Slot 3 — Docs") reads as "this row manages the Docs tab",
                      which is a different — and wrong — mental model. The title
                      belongs to the tab dimension, whose surfaces (the sidebar,
                      the export list) already show it. */}
                  <span className="tbs-settings__slot-row__name">{slotPlaceholder(slotId)}</span>
                  <label className="tbs-settings__slot-row__field">
                    <span>Strategy</span>
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
                  </label>
                  <label className="tbs-settings__slot-row__field">
                    <span>Auto-bind</span>
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
                  </label>
                </div>
                {isCustom && (
                  <div className="tbs-settings__slot-row__detail">
                    <MatchKnobs
                      idPrefix={'Slot ' + String(slotId)}
                      settings={customSettings}
                      onChange={(next) => { onSlotChange(slotId, next); }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
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
        // Reset must restore the CONFIG too, not just the mode: without it a recipe
// draft loses its fields (and the mode would claim a composite that has none).
        // Mirrors `baselineIcon` above; the type-aware seed itself is unchanged.
        onResetIconEdit={() => { setIconMode(hasIcon ? { kind: 'set', value: seedValue } : { kind: 'use-chain' }); setIconConfig(isTemplateIcon ? { bgColor: seed?.bgColor, text: seed?.text, textColor: seed?.textColor } : undefined); }}
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
              {/* T22/D9: the missing-icon repair entry reveals this exact row. */}
              <tr className={rule.enabled === false ? 'tbs-settings__row--disabled' : ''} data-testid={`rule-row-${rule.id}`}>
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
    const seeded = iconSourceToFieldSeed(source);
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
      ? iconSourceToFieldSeed(source)
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
          onUndo={(snapshot) => { void handleUndo(snapshot); }}
          onExpire={() => { setUndoState(null); }}
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
function ExportSection({
  refreshToken = 0,
  onRefreshed,
}: {
  /** Bumped by the floating refresh button to force a re-read. */
  refreshToken?: number;
  /** Called once a re-read (auto or manual) has landed. */
  onRefreshed?: () => void;
} = {}) {
  const [checked, setChecked] = useState<Record<keyof DimensionPresence, boolean>>({
    slots: false, rules: false, settings: false, shortcuts: false,
  });
  /** T19-C: per-record deselection inside a selected dimension (D1). */
  const [excludedSlots, setExcludedSlots] = useState<number[]>([]);
  const [excludedRules, setExcludedRules] = useState<string[]>([]);
  /** The settings PARTS the user left out (see `ExportScope`). */
  const [excludedSettings, setExcludedSettings] = useState<string[]>([]);
  /** Shortcut bindings (by command name) the user left out. */
  const [excludedShortcuts, setExcludedShortcuts] = useState<string[]>([]);
  /**
   * The records a package could carry, from the SAME GET_STATE snapshot the
   * import section uses (one source of truth, one fetch per surface). `null`
   * means the read failed — expansion is then simply not offered.
   *
   * `slots` / `rules` arrive with their icons ALREADY dereferenced and their
   * recipes materialised by the storage read path, so a row can render a
   * preview straight from `uiMarker.icon.value` / `favicon.value`.
   */
  const [records, setRecords] = useState<{
    slots: SlotDefinition[];
    rules: PageRule[];
    matchSettings: MatchRuleSettings;
    switchDirection: SwitchDirection;
    autoBindGlobal: boolean;
  } | null>(null);
  /**
   * The browser's own command bindings, read for the shortcut list.
   * `null` = not read yet or the read failed, in which case the dimension
   * carries nothing — the same outcome as a bound-less machine.
   */
  const [commands, setCommands] = useState<Array<{ name: string; shortcut: string | null }> | null>(null);
  const [pkg, setPkg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /**
   * Read the target machine's current state + command bindings.
   *
   * Extracted so it can run BOTH on mount and whenever the configuration changes
   * underneath this panel. Without the re-read the lists showed the snapshot
   * taken when the panel mounted, so a slot edited in the sidebar, a rule edited
   * on the Rules section or a global setting changed here all left the export
   * lists describing a state the machine no longer had.
   */
  const loadTargetState = useCallback(async () => {
    try {
      const res = await sendMessage('GET_STATE');
      const result = extractResult(res);
      const sync = result?.success
        ? (result.sync as {
            slots?: SlotDefinition[];
            rules?: PageRule[];
            matchSettings?: MatchRuleSettings;
            switchDirection?: SwitchDirection;
            autoBindGlobal?: boolean;
          } | undefined)
        : undefined;
      setRecords({
        slots: sync?.slots ?? [],
        rules: sync?.rules ?? [],
        matchSettings: sync?.matchSettings ?? DEFAULT_MATCH_SETTINGS,
        switchDirection: sync?.switchDirection ?? 'next',
        autoBindGlobal: sync?.autoBindGlobal ?? true,
      });
    } catch {
      setRecords(null);
    }
    // The shortcut list is the ONLY dimension whose data is browser-owned, so
    // it comes from its own action rather than the sync snapshot.
    try {
      const cmdRes = await sendMessage('GET_COMMANDS');
      const cmdResult = extractResult(cmdRes);
      if (cmdResult?.success && Array.isArray(cmdResult.commands)) {
        setCommands(cmdResult.commands as Array<{ name: string; shortcut: string | null }>);
      }
    } catch {
      // leaves `commands` null → the shortcut dimension carries nothing
    }
  }, []);

  useEffect(() => {
    void loadTargetState().then(() => { onRefreshed?.(); });
    // `refreshToken` is a dependency on purpose: the manual refresh re-runs this
    // read. `onRefreshed` is intentionally NOT one — it is a callback whose
    // identity may change on every render, which would turn this into an
    // infinite re-read loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTargetState, refreshToken]);

  /**
   * Follow configuration changes made ANYWHERE else.
   *
   * `storage.onChanged` is the one signal that covers every writer — the
   * sidebar's slot edits, the Rules section, this page's own Global Strategy
   * form and an import applied moments ago — because they all land in `sync`.
   * The same listener the sidebar uses, for the same reason; polling or trusting
   * a mount-time snapshot is what produced the stale values.
   */
  useEffect(() => {
    const onChangedApi = (globalThis as unknown as {
      chrome?: { storage?: { onChanged?: StorageOnChangedApi } };
    }).chrome?.storage?.onChanged;
    if (!onChangedApi) return;
    const onChanged: StorageChangeListener = (changes, areaName) => {
      if (areaName !== 'sync' && areaName !== 'local') return;
      if (Object.keys(changes).length === 0) return;
      void loadTargetState();
    };
    onChangedApi.addListener(onChanged);
    // A belt-and-braces refresh: `onChanged` is the precise signal, but it can
    // be missed while a Service Worker is asleep, and a stale list is exactly the
    // defect this guards. Re-reading when the page regains focus is cheap and
    // cannot drift — the read is the same one the change listener performs.
    const onFocus = () => { void loadTargetState(); };
    window.addEventListener('focus', onFocus);
    return () => {
      onChangedApi.removeListener(onChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadTargetState]);

  const anyChecked = (Object.keys(checked) as Array<keyof DimensionPresence>).some((d) => checked[d]);

  /**
   * The settings parts and shortcut bindings THAT EXIST on this machine.
   *
   * Only existing parts are offered: `slotAutoBinds` is sparse (a slot with no
   * explicit override has no such setting to share), and a command without a
   * binding is not a shortcut. Rendering the full cross-product instead would
   * fill the lists with rows that carry nothing.
   */
  const settingParts = useMemo(() => {
    if (!records) return [];
    const parts: Array<{ id: SettingPartId; label: string; value: string }> = [
      { id: 'matchSettings', label: 'Match settings', value: matchSettingsSummary(records.matchSettings) },
      { id: 'switchDirection', label: 'Switch direction', value: records.switchDirection },
      { id: 'autoBindGlobal', label: 'Auto-bind (global)', value: String(records.autoBindGlobal) },
    ];
    for (const slot of bySlotId(records.slots)) {
      parts.push({
        // The id constructors live in `shared` so the export panel, the diff and
        // the intent all address a part by the same string.
        id: slotStrategyPartId(slot.id),
        label: `Slot ${String(slot.id)} strategy`,
        value: strategyText(slot.strategy),
      });
      if (slot.autoBindOverride !== undefined) {
        parts.push({
          id: slotAutoBindPartId(slot.id),
          label: `Slot ${String(slot.id)} auto-bind`,
          value: String(slot.autoBindOverride),
        });
      }
    }
    return parts;
  }, [records]);

  const shortcutBindings = useMemo(
    () => (commands ?? []).filter((c): c is { name: string; shortcut: string } => c.shortcut !== null),
    [commands],
  );

  const scope: ExportScope = {
    slots: checked.slots, rules: checked.rules, settings: checked.settings, shortcuts: checked.shortcuts,
    excludedSlotIds: excludedSlots, excludedRuleIds: excludedRules,
    excludedSettingIds: excludedSettings, excludedShortcutNames: excludedShortcuts,
  };

  /**
   * Tick/untick one record, part or binding.
   *
   * The `allSelected` flag is passed IN rather than derived from the exclusion
   * array: the list filters rows, so "all" means "all currently visible". The
   * exclusion array must still be filled with the rows the user cannot see,
   * otherwised a filtered select-all would silently include them.
   */
  const toggleExcluded = (kind: 'slot' | 'rule' | 'setting' | 'shortcut', id: number | string) => {
    switch (kind) {
      case 'slot':
        setExcludedSlots((prev) =>
          prev.includes(id as number) ? prev.filter((x) => x !== id) : [...prev, id as number]);
        break;
      case 'rule':
        setExcludedRules((prev) =>
          prev.includes(id as string) ? prev.filter((x) => x !== id) : [...prev, id as string]);
        break;
      case 'setting':
        setExcludedSettings((prev) =>
          prev.includes(id as string) ? prev.filter((x) => x !== id) : [...prev, id as string]);
        break;
      case 'shortcut':
        setExcludedShortcuts((prev) =>
          prev.includes(id as string) ? prev.filter((x) => x !== id) : [...prev, id as string]);
        break;
    }
  };

  /** Exclude/include EVERY id of a dimension in one go (the select-all control). */
  const setExcludedAll = (kind: 'slot' | 'rule' | 'setting' | 'shortcut', allIds: string[], excludeAll: boolean) => {
    const asNumbers = allIds.map(Number);
    switch (kind) {
      case 'slot':
        setExcludedSlots(excludeAll ? asNumbers : []);
        break;
      case 'rule':
        setExcludedRules(excludeAll ? allIds : []);
        break;
      case 'setting':
        setExcludedSettings(excludeAll ? allIds : []);
        break;
      case 'shortcut':
        setExcludedShortcuts(excludeAll ? allIds : []);
        break;
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

  /**
   * How many RECORDS a dimension would carry — shown only where a count is a
   * real fact about the package.
   *
   * `settings` and `shortcuts` deliberately report `null` rather than a number:
   * the settings dimension carries a fixed bundle of values (not a countable
   * list), and the shortcut dimension has no producer at all. Printing "1" for
   * either would be a number that answers nothing, so the card shows no count
   * instead of a misleading one.
   */
  const dimensionCount = (dim: keyof DimensionPresence): number | null => {
    if (dim === 'slots') return records?.slots.length ?? 0;
    if (dim === 'rules') return records?.rules.length ?? 0;
    return null;
  };

  const selectedCount = (Object.keys(checked) as Array<keyof DimensionPresence>).filter(
    (d) => checked[d],
  ).length;

  return (
    <section data-testid="export-section" aria-label="Export" className="tbs-settings__panel">
      <header className="tbs-settings__panel-head">
        <h3 className="tbs-settings__panel-title">Build a package</h3>
        <p className="tbs-settings__panel-sub">
          Pick the parts to include, then create the file. Nothing is uploaded — the package is
          written on this machine.
        </p>
      </header>

      <fieldset className="tbs-settings__pick-grid">
        <legend className="tbs-settings__pick-legend">What to include</legend>
        {DIMENSION_LABELS.map(({ dim }) => {
          const meta = DIMENSION_META[dim];
          const count = dimensionCount(dim);
          return (
            <label
              key={dim}
              className={`tbs-settings__pick${checked[dim] ? ' tbs-settings__pick--on' : ''}`}
            >
              <input
                className="tbs-settings__pick-box"
                type="checkbox"
                data-testid={`export-dim-${dim}`}
                checked={checked[dim]}
                onChange={(e) => {
                  const next = e.currentTarget.checked;
                  setChecked((prev) => ({ ...prev, [dim]: next }));
                }}
              />
              <span className="tbs-settings__pick-body">
                <span className="tbs-settings__pick-title">{meta.title}</span>
                <span className="tbs-settings__pick-blurb">{meta.blurb}</span>
              </span>
              <span className="tbs-settings__pick-count">
                {count === null ? '' : String(count)}
              </span>
            </label>
          );
        })}
      </fieldset>

      {/* The record dimensions use the SAME list component the import panel
          uses, so "looks the same" is a construction guarantee rather than two
          hand-kept renderers. The icon previews read straight from the
          dereferenced GET_STATE values. */}
      {checked.slots && records !== null && (
        <section className="tbs-settings__pick-detail" data-testid="export-records-slots">
          <h4 className="tbs-settings__pick-detail-title">Slots to include</h4>
          <RecordList
            label="Export slots"
            testIdPrefix="export-slots"
            rows={bySlotId(records.slots).map((slot) => ({
              key: String(slot.id),
              icon: previewFromIconSource(slot.uiMarker.icon),
              // The title the user actually set (`uiMarker.customTitle`) wins over
              // the save-time `titleSnapshot`. Showing the snapshot meant a rename
              // made in the sidebar or the Data Dashboard was invisible here — the
              // list kept reporting the page title captured when the slot was
              // saved, which reads exactly like "the list never refreshed". The
              // ORDER mirrors the read-side chain (`field-chain.ts`), so the list
              // and the slot's own row agree on what this slot is called.
              // `slotLabel` (not `slotRowLabel`): the export side holds a raw
              // title, which may be empty and must then read as the bare number.
              title: slotLabel(slot.id, editedSlotTitle(slot)),
              matchUrl: slot.urlMatch.value,
              matchType: slot.urlMatch.type,
              searchText: `${editedSlotTitle(slot)} ${slot.titleSnapshot}`,
              trailing: (
                <label className="tbs-settings__import-take">
                  <input
                    type="checkbox"
                    data-testid={`export-record-slot-${String(slot.id)}`}
                    checked={!excludedSlots.includes(slot.id)}
                    aria-label={`Include ${slotLabel(slot.id, editedSlotTitle(slot))}`}
                    onChange={() => { toggleExcluded('slot', slot.id); }}
                  />
                  Include
                </label>
              ),
            }))}
            selectAll={{
              // The exclusions are the ONE source: "all selected" means nothing is
              // excluded, not a second boolean that could drift from it.
              allSelected: excludedSlots.length === 0,
              someSelected: excludedSlots.length > 0
                && records.slots.some((s) => !excludedSlots.includes(s.id)),
              onToggleAll: (all) => {
                setExcludedAll('slot', records.slots.map((s) => String(s.id)), !all);
              },
              noun: 'slots',
            }}
            emptyAll="No saved slots yet."
          />
        </section>
      )}
      {checked.rules && records !== null && (
        <section className="tbs-settings__pick-detail" data-testid="export-records-rules">
          <h4 className="tbs-settings__pick-detail-title">Rules to include</h4>
          <RecordList
            label="Export rules"
            testIdPrefix="export-rules"
            rows={records.rules.map((rule) => ({
              key: rule.id,
              icon: previewFromIconSource(rule.favicon),
              title: rule.title || rule.urlMatch.value,
              matchUrl: rule.urlMatch.value,
              matchType: rule.urlMatch.type,
              priority: rule.priority,
              trailing: (
                <label className="tbs-settings__import-take">
                  <input
                    type="checkbox"
                    data-testid={`export-record-rule-${rule.id}`}
                    checked={!excludedRules.includes(rule.id)}
                    aria-label={`Include ${rule.title || rule.urlMatch.value}`}
                    onChange={() => { toggleExcluded('rule', rule.id); }}
                  />
                  Include
                </label>
              ),
            }))}
            selectAll={{
              allSelected: records.rules.length > 0 && excludedRules.length === 0,
              someSelected: excludedRules.length > 0
                && records.rules.some((r) => !excludedRules.includes(r.id)),
              onToggleAll: (all) => {
                setExcludedAll('rule', records.rules.map((r) => r.id), !all);
              },
              noun: 'rules',
            }}
            emptyAll="No page rules yet."
          />
        </section>
      )}

      {/* Settings is broken into its PARTS, so a user can share the global
          behaviour without shipping every per-slot override with it. Only parts
          that exist on this machine are listed (a slot with no explicit auto-bind
          override has no such part to share). */}
      {checked.settings && records !== null && settingParts.length > 0 && (
        <section className="tbs-settings__pick-detail" data-testid="export-records-settings">
          <h4 className="tbs-settings__pick-detail-title">Settings to include</h4>
          <ul className="tbs-settings__parts-list" data-testid="export-settings-values">
            {settingParts.map((part) => (
              <li key={part.id} data-testid={`export-setting-${part.id}`}>
                <label className="tbs-settings__import-take">
                  <input
                    type="checkbox"
                    data-testid={`export-part-${part.id}`}
                    checked={!excludedSettings.includes(part.id)}
                    aria-label={`Include ${part.label}`}
                    onChange={() => { toggleExcluded('setting', part.id); }}
                  />
                  {part.label}
                </label>
                <span className="tbs-settings__part-value">{part.value}</span>
              </li>
            ))}
          </ul>
          <div className="tbs-settings__parts-actions">
            <Button
              size="sm"
              variant="ghost"
              data-testid="export-settings-select-all"
              onClick={() => {
                setExcludedAll(
                  'setting',
                  settingParts.map((p) => p.id),
                  excludedSettings.length === 0,
                );
              }}
            >
              {excludedSettings.length === 0 ? 'Clear all settings' : 'Select all settings'}
            </Button>
          </div>
        </section>
      )}

      {/* The shortcut dimension now has real data (the browser's own bindings)
          and the same per-binding granularity. */}
      {checked.shortcuts && (
        <section className="tbs-settings__pick-detail" data-testid="export-records-shortcuts">
          <h4 className="tbs-settings__pick-detail-title">Shortcuts to include</h4>
          {shortcutBindings.length === 0 ? (
            <p className="tbs-settings__hint" data-testid="export-shortcuts-none">
              No keyboard shortcuts are set on this browser yet.
            </p>
          ) : (
            <>
              <ul className="tbs-settings__parts-list" data-testid="export-shortcuts-values">
                {shortcutBindings.map((binding) => (
                  <li key={binding.name} data-testid={`export-shortcut-${binding.name}`}>
                    <label className="tbs-settings__import-take">
                      <input
                        type="checkbox"
                        data-testid={`export-part-shortcut-${binding.name}`}
                        checked={!excludedShortcuts.includes(binding.name)}
                        aria-label={`Include ${binding.name}`}
                        onChange={() => { toggleExcluded('shortcut', binding.name); }}
                      />
                      {binding.name}
                    </label>
                    <span className="tbs-settings__part-value">
                      <kbd>{binding.shortcut}</kbd>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="tbs-settings__parts-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="export-shortcuts-select-all"
                  onClick={() => {
                    setExcludedAll(
                      'shortcut',
                      shortcutBindings.map((b) => b.name),
                      excludedShortcuts.length === 0,
                    );
                  }}
                >
                  {excludedShortcuts.length === 0 ? 'Clear all shortcuts' : 'Select all shortcuts'}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {/* The action row is the LAST thing in reading order and states the
          consequence of the current selection, so "nothing chosen" is explained
          next to the control it disables rather than floating above it. */}
      <footer className="tbs-settings__panel-foot">
        <p
          className="tbs-settings__panel-status"
          data-testid={anyChecked ? undefined : 'export-empty-reason'}
          aria-live="polite"
        >
          {anyChecked
            ? `${String(selectedCount)} of 4 parts selected`
            : 'Select at least one part to export.'}
        </p>
        <Button
          size="md"
          variant="primary"
          data-testid="export-submit"
          disabled={!anyChecked}
          loading={exporting}
          onClick={() => { void handleExport(); }}
        >
          Create package
        </Button>
      </footer>

      {pkg && summary && (
        <div
          className="tbs-settings__export-summary"
          data-testid="export-summary"
          role="region"
          aria-label="Export package summary"
        >
          <h4>Package ready</h4>
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

/**
 * The pick cards' prose. Both surfaces ask the same four questions ("what is
 * this part, and what does taking it do?"), so the wording lives in ONE table —
 * a second copy would drift and the two panels would describe the same
 * dimension differently.
 */
const DIMENSION_META: Record<keyof DimensionPresence, { title: string; blurb: string }> = {
  slots: { title: 'Slots', blurb: 'Saved tab positions and their names' },
  rules: { title: 'Rules', blurb: 'Title and icon rewrites for matching pages' },
  settings: { title: 'Settings', blurb: 'Matching behaviour, switch direction and auto-bind' },
  shortcuts: { title: 'Shortcuts', blurb: 'Keyboard bindings for your slots' },
};

/**
 * A record's diff status as a badge. Import is irreversible, so "what will be
 * replaced / kept" must be scannable at a glance rather than four similar words
 * read one line at a time.
 *
 * Typed as a TOTAL `Record`, not a lookup with a fallback: `skipped` is declared
 * on `ImportRecordStatus` but NO diff producer ever emits it for a record (it is
 * only a {@link ImportApplyResult} count key), so it is mapped — and marked
 * unreachable — so that a future producer must choose a badge consciously rather
 * than inherit a silent default.
 */
const RECORD_BADGE: Record<ImportRecordStatus, StatusBadgeProps['status']> = {
  added: 'active',
  replaced: 'pending',
  kept: 'inactive',
  deleted: 'error',
  skipped: 'inactive', // UNREACHABLE for records (count key only).
};

/**
 * The one plain default intent (incremental, no overrides). A VALUE, not a call,
 * so the per-open derivation can name it without minting a throwaway object.
 */
const DEFAULT_INTENT: ImportIntent = defaultImportIntent();

/**
 * The intent a freshly chosen file starts from: accept EVERY record (all rows
 * checked), so the user DECLINES what they do not want instead of ticking each
 * one.
 *
 * Every row is seeded, `added` included — the diff honours a `take` on a
 * file-only row (it stays `added`) and a `keep` on it (it is not created), so
 * the seeded state and the rendered state agree row by row. A row left unseeded
 * would render unchecked and look like a decision the user never made.
 *
 * Without a usable current state there is no diff to read this from, so the
 * plain default (no overrides) stands.
 *
 * The fallback returns a FRESH object rather than the shared {@link DEFAULT_INTENT}
 * constant: the intent lives in state and callers edit it, so handing out one
 * module-level instance invites an in-place edit that would leak across renders.
 */
function defaultIntentFor(pkg: ExportPackage | null, current: SyncState | null): ImportIntent {
  if (!pkg || !current) return defaultImportIntent();
  const diff = computeDiff(pkg, current, DEFAULT_INTENT);
  const allTake: ImportRecordOverride[] = diff.records
    .map((r) => ({ kind: r.kind, id: r.id, action: 'take' }));
  return { ...DEFAULT_INTENT, recordOverrides: allTake };
}

/** `Slot N` — the placeholder the diff and the export both fall back to. */
function slotPlaceholder(id: number): string {
  return `Slot ${String(id)}`;
}

/**
 * A slot row's identity. The slot NUMBER is always shown: slots are a fixed
 * 1–10 set and the number is how users refer to them, so a bare title made a
 * file-ordered list unreadable ("which one is slot 3?"). A title decorates the
 * identity, it never replaces it.
 *
 * The diff's own label ALREADY falls back to `Slot N` when a record has no
 * title, so that placeholder must not be repeated (`Slot 5 — Slot 5`).
 */
// ─── Import row cells (they describe the TARGET MACHINE) ─────────────────────
//
// Every cell of an import row answers "what does this machine have right now?".
// The file's version of a field is shown in the row's Fields detail as
// `<target> → <imported>`, and nowhere else — reading the file into the row made
// a record the machine already had look as though its title, Match URL or Match
// Type had come from the package.

/**
 * The icon of the record AS IT STANDS ON THIS MACHINE.
 *
 * The list answers ONE question — "what does this machine have right now?" — so
 * every cell is read from the machine's side (`before`) and NEVER from the
 * package. A record the machine does not have (`added`) therefore shows NO icon:
 * the file's icon would be a value the machine has never held, presented as
 * though it were current. The file's side is reported in the Fields detail.
 */
function importRowIcon(r: ImportRecordDiff): IconPreviewSource {
  return previewFromFieldValue(r.before?.icon ?? null);
}

/**
 * The machine's title for the record.
 *
 * `Slot N` is used when the machine has nothing to name, because the slot NUMBER
 * is machine-side identity (slots are the fixed set 1–10), not a value from the
 * file. A rule has no such number, so a rule the machine does not have shows no
 * title at all — its file-side name lives in the Fields detail, where the
 * incoming values belong.
 */
function importRowTitle(r: ImportRecordDiff): string {
  if (r.before === null || r.before === undefined) {
    return r.kind === 'slot' ? slotPlaceholder(Number(r.id)) : '';
  }
  // A rule with no title of its own falls back to its OWN match URL — still a
  // machine value, which is the only kind this list may show.
  const raw = textOf(r.before.title)
    || (r.kind === 'slot' ? slotPlaceholder(Number(r.id)) : textOf(r.before.urlMatch));
  return r.kind === 'slot' ? slotRowLabel(Number(r.id), raw) : raw;
}

/** The machine's Match URL (empty when there is no record to describe). */
function importRowMatchUrl(r: ImportRecordDiff): string {
  return textOf(r.before?.urlMatch ?? null);
}

/**
 * A facet as plain text, with "no value" becoming an empty string.
 *
 * `formatFieldValue` answers `'None'` for a missing value because it renders a
 * DIFF LINE, where the word is meaningful ("Icon: None"). Used as a cell value it
 * would print the word itself — the bug that produced a slot titled
 * "Slot 1 — None".
 */
function textOf(value: import('@shared/types').ImportFieldValue | null): string {
  if (value === null || value.kind !== 'text') return '';
  return value.value;
}

/**
 * The machine's Match Type, as the contract value the list expects.
 *
 * `null` when the machine has no record to read — NOT `'exact'`. Defaulting to
 * `exact` would put a machine value on screen that the machine never had, and
 * would make an `added` row look as though its match type were already `exact`.
 * The record list renders `—` for an unknown type (the same convention the field
 * detail uses), so "no record, nothing to say" stays distinguishable from
 * "a record whose type is Exact URL".
 */
function importRowMatchType(r: ImportRecordDiff): UrlMatchType | null {
  const value = r.before?.matchType?.kind === 'text' ? r.before.matchType.value : '';
  return (Object.keys(MATCH_TYPE_LABELS) as UrlMatchType[]).find(
    (type) => MATCH_TYPE_LABELS[type] === value,
  ) ?? null;
}

function slotRowLabel(id: number, label: string): string {
  const base = slotPlaceholder(id);
  return label === base ? base : `${base} — ${label}`;
}

/**
 * The export list's identity, where the input is a free-form TITLE rather than
 * the diff's already-fallback-composed label — so an empty title must collapse
 * to the bare number instead of producing "Slot 1 — ". Both helpers share the
 * exact-equality rule so neither repeats a title that happens to BE the
 * placeholder.
 */
/**
 * The title a slot CURRENTLY shows.
 *
 * `uiMarker.customTitle` is the user's own edit (set from the sidebar or the
 * Data Dashboard); `titleSnapshot` is only the page title captured when the slot
 * was saved, and it goes stale the moment the slot is renamed. Reading the
 * snapshot made an edited slot look unchanged — the order here mirrors the
 * read-side chain in `field-chain.ts` (`customTitle` then `titleSnapshot`) so the
 * two surfaces cannot describe the same slot by different names.
 */
function editedSlotTitle(slot: Pick<SlotDefinition, 'uiMarker' | 'titleSnapshot'>): string {
  return slot.uiMarker.customTitle?.trim() || slot.titleSnapshot;
}

function slotLabel(id: number, title: string | null | undefined): string {
  const base = slotPlaceholder(id);
  return !title || title === base ? base : `${base} — ${title}`;
}

/**
 * Does this slot deviate from the global strategy in EITHER of the two parts?
 *
 * One predicate, used by the row highlight AND the "N of 10 customised" tally,
 * so the summary cannot disagree with the rows it summarises. Counting only the
 * strategy reported "1 of 10 customised" beside two visibly non-inheriting rows
 * — the kind of tally that teaches the reader to stop believing it.
 */
function isSlotOverridden(slot: SlotDefinition | undefined): boolean {
  return (slot?.strategy ?? 'inherit') !== 'inherit' || slot?.autoBindOverride !== undefined;
}

/** How many of the ten slot rows deviate from the global strategy. */
function overriddenCount(slots: SlotDefinition[]): number {
  return slots.filter((s) => isSlotOverridden(s)).length;
}

/**
 * A stable fingerprint of everything the review surface SHOWS about a diff.
 *
 * Used to decide whether a version conflict actually invalidated the user's
 * review: a conflict is only worth refusing if the reviewed outcome moved. The
 * signature covers the rows and their statuses plus the settings/shortcut parts
 * — exactly what the panel renders — and deliberately nothing else, so a bump
 * that changed no visible outcome (a clock stamp on an unrelated record, a write
 * to a dimension this file does not carry) does not force a re-review.
 */
function diffSignature(diff: ImportDiff): string {
  const records = diff.records
    .map((r) => `${r.kind}:${String(r.id)}:${r.status}`)
    .sort()
    .join('|');
  const settings = (diff.settingsParts ?? [])
    .map((p) => `${p.id}:${p.status}`)
    .sort()
    .join('|');
  const shortcuts = (diff.shortcutParts ?? [])
    .map((p) => `${p.id}:${p.status}`)
    .sort()
    .join('|');
  return `${records}#${settings}#${shortcuts}`;
}

/**
 * A one-line report of what an APPLY actually did, per dimension.
 *
 * Built from the SERVER's own outcome (`ImportApplyResult.dimensions`) rather
 * than re-counted from the UI's diff: the shortcut bindings are written in the
 * background and the UI cannot observe them at all, and a second count here
 * would be free to disagree with the write. Dimensions the file did not carry
 * are omitted (the outcome reports 0/0 for them, which is "nothing to say",
 * not "nothing changed").
 *
 * `failed` is never folded into `changed`: a record the domain rejected, or a
 * shortcut the platform refused, must be visible as a failure.
 */
function summariseApplied(result: ImportApplyResult | null): string {
  if (result === null) return 'Import applied.';
  const parts: string[] = [];
  const failures: string[] = [];
  for (const { dim } of DIMENSION_LABELS) {
    const outcome = result.dimensions[dim];
    if (outcome.changed > 0) parts.push(`${String(outcome.changed)} ${DIMENSION_META[dim].title}`);
    if (outcome.failed > 0) failures.push(`${String(outcome.failed)} ${DIMENSION_META[dim].title}`);
  }
  const changed = parts.length > 0 ? `Updated ${parts.join(', ')}.` : 'No changes were needed.';
  return failures.length > 0
    ? `${changed} ${failures.join(', ')} could not be applied.`
    : changed;
}

/**
 * Slots in slot-number order. Display-only — the diff's and the export's own
 * record order is deliberately untouched (those are data orders, not views).
 */
function bySlotId<T extends { id: number | string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Both summaries now live in `@shared/export-package` (`summariseMatchSettings`
 * / `summariseStrategy`) because the settings-part diff rows in `import-diff.ts`
 * render the SAME values. Two spellings of one triple is the drift a single
 * source exists to prevent, so these are aliases rather than re-implementations.
 */
const matchSettingsSummary = summariseMatchSettings;
const strategyText = summariseStrategy;

/**
 * The settings dimension's PARTS as take-checkbox rows.
 *
 * The rows come from `diff.settingsParts` — the same derivation the server uses
 * to decide what to write — so a row's checkbox can never disagree with what the
 * apply would do. Only parts the FILE carries are listed: a part the file omits
 * is not applied, so a checkbox for it would be a control that does nothing.
 *
 * The visible text follows the established `current → file` vocabulary (7a),
 * with the same test anchors as before so the value-comparison coverage that
 * already existed keeps its grip.
 */
const SETTINGS_PART_TESTIDS: Record<string, string> = {
  matchSettings: 'import-setting-match-settings',
  switchDirection: 'import-setting-switch-direction',
  autoBindGlobal: 'import-setting-auto-bind',
};

/**
 * The shortcut bindings the file carries, as take-checkbox rows.
 *
 * Kept separate from `ImportSettingsParts` because the two address different
 * intent fields (`takeSettingIds` vs `takeShortcutNames`) and use a different id
 * space, but they render the SAME row shape — a shared `ImportPartRow` would
 * have been a third abstraction for two call sites, so the rows are written out
 * and kept deliberately identical in structure.
 */
/**
 * The `id` a select-all passes to mean "every row of this dimension".
 *
 * A sentinel rather than a loop of per-row calls: one state update means the
 * rows and the control cannot be observed mid-flight disagreeing, and the
 * allow-list is written in one place.
 */
const allPartsSentinel = '__all__';

/**
 * The per-dimension select-all for the settings / shortcut rows.
 *
 * The record lists get this from `RecordList`, but the settings and shortcut
 * dimensions are not records — they are parts of one dimension — so they need
 * the same control here rather than a second, differently-shaped one. State is
 * read from the intent (`undefined` = take everything), which is the same single
 * source the individual checkboxes use, so the two can never disagree.
 */
function PartsSelectAll({
  ids,
  taken,
  onToggleAll,
  noun,
}: {
  ids: string[];
  taken: (id: string) => boolean;
  onToggleAll: (take: boolean) => void;
  /** Plural noun for the label, e.g. "settings". */
  noun: string;
}) {
  const allTaken = ids.length > 0 && ids.every(taken);
  const someTaken = !allTaken && ids.some(taken);
  return (
    <label className="tbs-record-list__select-all">
      <input
        type="checkbox"
        data-testid={`import-${noun}-select-all`}
        checked={allTaken}
        ref={(el) => {
          if (el) el.indeterminate = someTaken;
        }}
        // The control is a VIEW of the rows, so it does not toggle the
        // "everything" value: when every row is taken it CLEARS them all, and in
        // any other state (some or none) it takes them all. Reading
        // `e.currentTarget.checked` would be wrong precisely in the
        // indeterminate case, where the browser reports `checked === true` while
        // the box is drawn as a dash.
        onChange={() => { onToggleAll(!allTaken); }}
      />
      {allTaken ? `Clear all ${noun}` : `Select all ${noun}`}
    </label>
  );
}

function ImportShortcutParts({
  parts,
  intent,
  onToggle,
  onToggleAll,
}: {
  parts: ImportPartDiff[];
  intent: ImportIntent;
  onToggle: (name: string, take: boolean) => void;
  /** Take or clear EVERY row at once (the per-dimension select-all). */
  onToggleAll: (take: boolean) => void;
}) {
  if (parts.length === 0) return null;
  const taken = (id: string): boolean =>
    intent.takeShortcutNames === undefined || intent.takeShortcutNames.includes(id);
  return (
    <div className="tbs-settings__parts" data-testid="import-shortcuts-values">
      <PartsSelectAll
        ids={parts.map((p) => p.id)}
        taken={taken}
        onToggleAll={onToggleAll}
        noun="shortcuts"
      />
      <ul className="tbs-settings__import-records">
        {parts.map((part) => {
          const checked =
            intent.takeShortcutNames === undefined || intent.takeShortcutNames.includes(part.id);
          return (
            <li key={part.id} data-testid={`import-shortcut-${part.id}`}>
              <span>
                {part.label}
                {': '}
                {formatFieldValue(part.after)}
              </span>
              <StatusBadge status={RECORD_BADGE[part.status]} label={part.status} />
              <label className="tbs-settings__import-take">
                <input
                  type="checkbox"
                  data-testid={`import-shortcut-take-${part.id}`}
                  checked={checked}
                  aria-label={`Take ${part.label}`}
                  onChange={(e) => { onToggle(part.id, e.currentTarget.checked); }}
                />
                Take
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ImportSettingsParts({
  parts,
  intent,
  onToggle,
  onToggleAll,
}: {
  parts: ImportPartDiff[];
  intent: ImportIntent;
  onToggle: (id: SettingPartId, take: boolean) => void;
  /** Take or clear EVERY row at once (the per-dimension select-all). */
  onToggleAll: (take: boolean) => void;
}) {
  const globals = parts.filter((p) => p.group === 'global');
  const perSlot = parts.filter((p) => p.group === 'slot');
  const taken = (id: string): boolean =>
    intent.takeSettingIds === undefined || intent.takeSettingIds.includes(id);

  return (
    <div className="tbs-settings__parts" data-testid="import-settings-values">
      <PartsSelectAll
        ids={parts.map((p) => p.id)}
        taken={taken}
        onToggleAll={onToggleAll}
        noun="settings"
      />
      <ul className="tbs-settings__import-records">
        {globals.map((part) => (
          <ImportPartRow key={part.id} part={part} intent={intent} onToggle={onToggle} />
        ))}
      </ul>
      {perSlot.length > 0 && (
        <>
          <p className="tbs-settings__parts-head" data-testid="import-setting-slot-strategies">
            Per-slot settings
          </p>
          <ul className="tbs-settings__import-records">
            {perSlot.map((part) => (
              <ImportPartRow key={part.id} part={part} intent={intent} onToggle={onToggle} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * One settings part as a row: label, the take checkbox, the current → file
 * comparison, and the row's status badge.
 *
 * The test id follows the part id, so a per-slot row keeps the addressable
 * `import-slot-strategy-N` anchor the value coverage uses while a global row
 * keeps its name-based one.
 */
function ImportPartRow({
  part,
  intent,
  onToggle,
}: {
  part: ImportPartDiff;
  intent: ImportIntent;
  onToggle: (id: SettingPartId, take: boolean) => void;
}) {
  const checked = intent.takeSettingIds === undefined || intent.takeSettingIds.includes(part.id);
  const testId =
    SETTINGS_PART_TESTIDS[part.id] ??
    (part.id.endsWith(':strategy')
      ? `import-slot-strategy-${String(part.slotId)}`
      : `import-part-${part.id}`);

  return (
    <li data-testid={testId}>
      {/* The colon and its trailing SPACE live inside one string literal: JSX drops
          the whitespace between sibling elements, so `{label}{':'}` would render
          "Match settings:Tab ID…". */}
      <span className="tbs-settings__part-label">{`${part.label}: `}</span>
      {/* The comparison is rendered from the diff's own facets — the same values
          the server will act on, not a re-derived pair. Its own element (rather
          than one text run with the label) is what lets a reader — or a test —
          address the VALUE without also picking up the badge and the checkbox. */}
      <span className="tbs-settings__part-diff">
        {formatFieldValue(part.before)} → {formatFieldValue(part.after)}
      </span>
      <StatusBadge status={RECORD_BADGE[part.status]} label={part.status} />
      <label className="tbs-settings__import-take">
        <input
          type="checkbox"
          data-testid={`import-part-take-${part.id}`}
          checked={checked}
          aria-label={`Take ${part.label}`}
          onChange={(e) => { onToggle(part.id as SettingPartId, e.currentTarget.checked); }}
        />
        Take
      </label>
    </li>
  );
}

function ImportExportSection({
  onJumpToRecord,
  onApplied,
  refreshToken = 0,
  onRefreshed,
}: {
  onJumpToRecord: (kind: 'slot' | 'rule', id: number | string) => void;
  /** Called after a successful APPLY, so the page's own state re-reads. */
  onApplied?: () => void;
  /** Bumped by the floating refresh button to force a re-read. */
  refreshToken?: number;
  /** Called once a re-read (auto or manual) has landed. */
  onRefreshed?: () => void;
}) {
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
  /**
   * T22: the APPLY result (C11 one-shot list) + the pre-apply diff snapshot used
   * for the per-record success rows. Both are cleared by every new file/cancel.
   */
  const [applyResult, setApplyResult] = useState<ImportApplyResult | null>(null);
  const [appliedDiff, setAppliedDiff] = useState<ImportDiff | null>(null);
  /** The quantized confirmation is CONSTANT (D7) — opened by Apply, always. */
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Read the machine's live sync state, or `null` when it cannot be read.
   *
   * Shared by the file-open path and the conflict re-check, so both compare
   * against a state read the same way — a second, subtly different read would
   * make "did the reviewed result change?" answerable two ways.
   */
  const readCurrentState = useCallback(async (): Promise<SyncState | null> => {
    try {
      const stateRes = await sendMessage('GET_STATE');
      const stateResult = extractResult(stateRes);
      if (stateResult?.success && stateResult.sync) {
        return stateResult.sync as SyncState;
      }
    } catch {
      // Non-fatal: the caller decides what "unknown" means.
    }
    return null;
  }, []);

  /**
   * Read a chosen file and (re)build the inspection. `resetIntent` re-seeds the
   * intent to the default; it is FALSE when re-inspecting after a version
   * conflict, because the user's dimension/record choices must survive the
   * refresh (only the state-derived numbers change, not their decisions).
   */
  const inspectFile = useCallback(async (text: string, opts: { resetIntent: boolean }) => {
    const res = await sendMessage('IMPORT_INSPECT', { file: text });
    const result = extractResult(res);
    if (!result?.success || !result.inspection) {
      setToast({ variant: 'error', message: (result?.message as string) || 'Invalid import file' });
      return false;
    }
    const pkgLocal = parseExportPackage(text);
    setFile(text);
    setInspection(result.inspection as ImportInspection);
    setPkg(pkgLocal);
    // D7: the quantification needs the CURRENT state. A failure here is
    // NON-fatal — `current` stays null and the copy reports "unknown"
    // rather than the false claim "no records".
    const currentLocal = await readCurrentState();
    if (currentLocal !== null) setCurrent(currentLocal);
    // A NEW file starts at "accept everything", derived from the diff against
    // the state read just above (the locals, never state that has not settled
    // yet). This is the ONLY resetIntent:true caller — choosing a file means
    // starting fresh — so it resets UNCONDITIONALLY, including when a previous
    // file's choices are still in the intent.
    // A version-conflict RE-check (resetIntent=false) must keep the user's
    // choices, so that path is left wholly alone.
    if (opts.resetIntent) setIntent(defaultIntentFor(pkgLocal, currentLocal));
    return true;
  }, []);

  /**
   * D6/A11: choose a file → `IMPORT_INSPECT` (read-only). Its COMPUTATION is
   * intent-independent (a pure function of the file); the RESULT is produced
   * under the DEFAULT intent (no intent is sent). Later mode/record changes
   * RECOMPUTE the diff from the file under the user's CURRENT intent — they never
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
    setApplyResult(null);
    setAppliedDiff(null);
    try {
      const text = typeof chosen.text === 'function' ? await chosen.text() : '';
      await inspectFile(text, { resetIntent: true });
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

  /**
   * One settings part or shortcut binding's take choice.
   *
   * `undefined` means "take everything", so the FIRST untick has to materialise
   * the allow-list from the rows currently on screen — otherwise the first click
   * would silently drop every row the user had not touched, which is the
   * opposite of what unticking one box means. Subsequent toggles edit that list.
   */
  const setPartTaken = (
    kind: 'settings' | 'shortcuts',
    id: string,
    take: boolean,
    allIds: string[],
  ) => {
    setIntent((prev) => {
      const key = kind === 'settings' ? 'takeSettingIds' : 'takeShortcutNames';
      // The select-all passes the sentinel instead of a row id: it sets the list
      // to EVERY row (take) or to none (clear). Without this branch the sentinel
      // was just an id that matched nothing, so clearing left the allow-list
      // untouched and the control appeared not to respond.
      if (id === allPartsSentinel) {
        return { ...prev, [key]: take ? [...allIds] : [] };
      }
      const seed = prev[key] ?? allIds;
      const next = take
        ? [...new Set([...seed, id])]
        : seed.filter((x) => x !== id);
      return { ...prev, [key]: next };
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

  /**
   * The LIVE diff — recomputed under the user's CURRENT intent, the same call
   * APPLY performs. The inspection's own diff is COMPUTED UNDER THE DEFAULT INTENT
   * (the computation itself is intent-independent), so reading it after a
   * mode/record change would describe a different outcome than the write. Before
   * `current` loads there is nothing to recompute against, so the inspection's
   * diff is used as-is.
   */
  const liveDiff: ImportDiff | undefined =
    current && pkg ? computeDiff(pkg, current, intent) : inspection?.diff;

  /**
   * What this import is about to change, per dimension.
   *
   * Derived from the LIVE diff — the same rows the panel shows and the same
   * derivation APPLY uses — so the dialog's numbers cannot describe a different
   * outcome than the write. A dimension the file did not carry is omitted
   * entirely rather than reported as zero: "0 slots" would read as "your slots
   * are safe" when the truth is "this file says nothing about slots".
   */
  const changeSummary = (() => {
    if (liveDiff === undefined) return [];
    const rows: Array<{ dim: keyof DimensionPresence; changed: number; total: number; unit: string }> = [];
    for (const { dim } of DIMENSION_LABELS) {
      if (!carried(dim)) continue;
      if (dim === 'slots' || dim === 'rules') {
        const records = liveDiff.records.filter((r) =>
          dim === 'slots' ? r.kind === 'slot' : r.kind === 'rule',
        );
        rows.push({
          dim,
          changed: records.filter((r) => r.status !== 'kept').length,
          total: records.length,
          unit: dim,
        });
      } else if (dim === 'settings') {
        const parts = liveDiff.settingsParts ?? [];
        rows.push({ dim, changed: parts.filter((p) => p.status !== 'kept').length, total: parts.length, unit: 'parts' });
      } else {
        const parts = liveDiff.shortcutParts ?? [];
        rows.push({ dim, changed: parts.filter((p) => p.status !== 'kept').length, total: parts.length, unit: 'bindings' });
      }
    }
    return rows;
  })();

  /**
   * The review is derived from a SNAPSHOT of the machine taken when the file was
   * chosen, so a change made elsewhere afterwards is invisible: the diff keeps
   * comparing the file against values that no longer exist. Re-reading closes
   * that gap, and it is the same read the file-open path performs — a different
   * derivation would make "is my review still accurate" answerable two ways.
   *
   * Deliberately skips row decisions: `current` is state-derived, while the
   * intent is the user's own choice, so a refresh must not touch it.
   */
  const refreshTargetState = useCallback(async () => {
    if (!pkg) return;
    const fresh = await readCurrentState();
    if (fresh !== null) setCurrent(fresh);
  }, [pkg, readCurrentState]);

  useEffect(() => {
    if (refreshToken === 0) return;
    void refreshTargetState().then(() => { onRefreshed?.(); });
    // `refreshToken` is the trigger; `onRefreshed` is excluded on purpose — its
    // identity can change every render, which would re-read endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, refreshTargetState]);

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
      // T22: snapshot the diff the user is about to apply, using the SAME pure
      // function and the SAME `(pkg, current, intent)` the D7 count used. Taken
      // BEFORE the write (the write clears replaced records' icon slots).
      const snapshotDiff =
        pkg && current ? computeDiff(pkg, current, intent) : null;
      // D12: the SAME string read at INSPECT; C3/F4: bind to the INSPECT version.
      const write = (expectedVersion: number) =>
        sendMessage('IMPORT_APPLY', { file, intent }, expectedVersion);
      const res = await write(inspection.configVersion);
      const result = extractResult(res);
      if (result?.errorCode === 'CONFIG_CONFLICT') {
        // F4 refused the write because the config moved under it. That guarantee
        // exists so the import cannot land on a state the user never reviewed —
        // but a refusal is only CORRECT if the REVIEWED RESULT actually changed.
        // Re-read the live state and re-derive the outcome the user is looking
        // at; if it is identical, they reviewed exactly what will be written, so
        // the import is retried against the fresh version instead of throwing
        // their review away. If it differs, nothing is written and they are sent
        // back to re-check (the behaviour they already had).
        const fresh = await readCurrentState();
        const reviewedBefore = pkg && current ? computeDiff(pkg, current, intent) : null;
        const freshAfter = fresh && pkg ? computeDiff(pkg, fresh, intent) : null;
        const unchanged = reviewedBefore !== null && freshAfter !== null
          && diffSignature(reviewedBefore) === diffSignature(freshAfter);
        if (unchanged && fresh !== null) {
          const retry = await write(fresh.configVersion);
          const retryResult = extractResult(retry);
          if (retryResult?.success) {
            const applied = extractApplyResult(retry);
            setToast({ variant: 'success', message: summariseApplied(applied) });
            setApplyResult(applied);
            setAppliedDiff(freshAfter);
            setInspection(null);
            setFile(null);
            setPkg(null);
            setCurrent(null);
            onApplied?.();
            return;
          }
        }
        // The reviewed result genuinely moved (or the retry also lost a race):
        // refuse, and re-check so the user reviews the new numbers.
        setToast({
          variant: 'error',
          message: 'The configuration changed since this file was checked. It has been re-checked — review the updated changes, then apply again.',
        });
        if (file) await inspectFile(file, { resetIntent: false });
        return;
      }
      if (result?.success) {
        const applied = extractApplyResult(res);
        // The toast reports WHAT changed per dimension, not just that
        // something did — "Import applied" left the user to scroll the result
        // list to find out whether their slots or their shortcuts landed.
        setToast({ variant: 'success', message: summariseApplied(applied) });
        setApplyResult(applied);
        setAppliedDiff(snapshotDiff);
        setInspection(null);
        setFile(null);
        setPkg(null);
        setCurrent(null);
        // The rest of the page re-reads, so Global Strategy (and this
        // panel's own target-machine lists) stop showing the pre-import values.
        onApplied?.();
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
    <section aria-label="Import and export" className="tbs-settings__panel">
      {/* The file input must exist from first paint: the test anchor and the
          "Choose file" button both drive it, and it is hidden from view, not
          from the DOM. */}
      <input
        ref={fileInputRef}
        data-testid="import-file-input"
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => { void handleFileChosen(e.currentTarget); }}
      />

      <header className="tbs-settings__panel-head">
        <h3 className="tbs-settings__panel-title">Bring in a package</h3>
        <p className="tbs-settings__panel-sub">
          Choose an exported JSON file. Nothing changes until you review the comparison and
          confirm.
        </p>
      </header>

      {/* Reading a file is async (file → text → INSPECT). Without this the pane
          stays blank after "Choose file" and the action looks dead, so announce
          it in the same `role="status"` vocabulary as the load. */}
      {importing && inspection === null && (
        <p className="tbs-settings__loading" role="status" aria-busy="true">
          Reading package…
        </p>
      )}

      {/* STEP 1 — nothing chosen yet. The picker is a full-width, one-click
          target instead of a bare button beside a sentence: the common case is
          "I have a file, open it", and it should read as the page's only job. */}
      {!inspection && !importing && (
        <button type="button" className="tbs-settings__dropzone" onClick={handleImportClick}>
          <span className="tbs-settings__dropzone-icon" aria-hidden="true">＋</span>
          <span className="tbs-settings__dropzone-title">Choose a package file</span>
          <span className="tbs-settings__dropzone-hint">
            A <code>.json</code> file exported from this extension
          </span>
        </button>
      )}

      {/* The APPLY result owns the pane after a successful write: the file is
          gone and the next thing the user needs is "what happened". */}
      {applyResult && !inspection && (
        <section className="tbs-settings__import-result" data-testid="import-result" aria-label="Import result">
          <h3>Import result</h3>

          <div className="tbs-settings__result-counts" data-testid="import-result-counts">
            {(['added', 'replaced', 'kept', 'deleted', 'skipped'] as const).map((key) => (
              <span key={key} data-testid={`import-result-count-${key}`}>
                {key}: {applyResult.counts[key]}
              </span>
            ))}
          </div>

          {/* What changed PER DIMENSION, from the server's own outcome. The
              tally above counts record STATUSES; it says nothing about which
              dimension moved and cannot express a failure — a rule the domain
              rejected and a shortcut the browser refused were both invisible
              here, which is exactly what "did my shortcuts import?" needs. */}
          <ul className="tbs-settings__result-dims" data-testid="import-result-dims">
            {DIMENSION_LABELS.map(({ dim }) => {
              const outcome = applyResult.dimensions[dim];
              return (
                <li key={dim} data-testid={`import-result-dim-${dim}`}>
                  <span className="tbs-settings__part-label">{`${DIMENSION_META[dim].title}: `}</span>
                  <span className="tbs-settings__part-value">
                    {`${String(outcome.changed)} changed`}
                    {outcome.failed > 0 && (
                      <span className="tbs-settings__result-failed">
                        {`, ${String(outcome.failed)} failed`}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {appliedDiff && appliedDiff.records.length > 0 && (
            <ul className="tbs-settings__result-records">
              {appliedDiff.records.map((r) => (
                <li key={`${r.kind}-${String(r.id)}`} data-testid={`import-result-record-${r.kind}-${String(r.id)}`}>
                  {r.label} <StatusBadge status={RECORD_BADGE[r.status]} label={r.status} />
                </li>
              ))}
            </ul>
          )}

          {applyResult.tolerant.length > 0 && (
            <details className="tbs-settings__result-tolerant" data-testid="import-tolerant">
              <summary data-testid="import-tolerant-summary">
                {applyResult.tolerant.length} fields in this package will be ignored or defaulted (expand to view)
              </summary>
              <ul>
                {applyResult.tolerant.map((t, i) => (
                  <li key={`${t.detail}-${String(i)}`} data-testid={`import-tolerant-item-${String(i)}`}>
                    {t.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {applyResult.domainViolations.length > 0 && (
            <div className="tbs-settings__result-violations" data-testid="import-violations" role="alert">
              <h4>Records skipped (unsafe)</h4>
              <ul>
                {applyResult.domainViolations.map((v) => (
                  <li key={`${v.kind}-${String(v.id)}`} data-testid={`import-violation-${v.kind}-${String(v.id)}`}>
                    {v.kind} {String(v.id)}: {v.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {applyResult.missingIcons.length > 0 && (
            <div className="tbs-settings__result-missing" data-testid="import-missing-icons">
              <h4>{applyResult.missingIcons.length} icons need to be re-selected</h4>
              <ul>
                {applyResult.missingIcons.map((m) => (
                  <li key={`${m.kind}-${String(m.id)}`}>
                    {m.kind} {String(m.id)}
                    {/* D9: repair = go to the record's own home surface; the
                        record's EXISTING editor does the edit. No new component,
                        and NO state is persisted (C9: no "needs re-selection" marker). */}
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid={`import-missing-repair-${m.kind}-${String(m.id)}`}
                      onClick={() => { onJumpToRecord(m.kind, m.id); }}
                    >
                      Re-select icon
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {applyResult.overlaps.length > 0 && (
            <div className="tbs-settings__result-overlaps" data-testid="import-overlaps">
              <h4>{applyResult.overlaps.length} match overlaps after import (same Match URL + Match Type)</h4>
              <ul>
                {applyResult.overlaps.map((o, i) => (
                  <li key={`${o.urlMatch.value}-${String(i)}`} data-testid={`import-overlap-${String(i)}`}>
                    {o.urlMatch.value} — {o.recordIds.map(String).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {applyResult.shortcutGuidance && (
            <p className="tbs-settings__result-shortcut" data-testid="import-shortcut-guidance">
              {applyResult.shortcutGuidance}
            </p>
          )}

          <footer className="tbs-settings__panel-foot">
            <p className="tbs-settings__panel-status" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setApplyResult(null); setAppliedDiff(null); }}
            >
              Import another file
            </Button>
          </footer>
        </section>
      )}

      {/* D6: single page — dimension groups, diff and the confirm dialog are all
          reachable without stepping through a wizard. */}
      {inspection && (
        <div className="tbs-settings__import-diff" data-testid="import-diff" role="region" aria-label="Import diff">
          <header className="tbs-settings__panel-head">
            <h3 className="tbs-settings__panel-title">Review changes</h3>
            <p className="tbs-settings__panel-sub">
              Each part of the file is listed against what you have now. Untick anything you do
              not want to take.
            </p>
          </header>
          {DIMENSION_LABELS.map(({ dim }) => {
            const meta = DIMENSION_META[dim];
            // Live records (status under the CURRENT intent) — see `liveDiff`.
            const records = (liveDiff?.records ?? []).filter((r) =>
              dim === 'slots' ? r.kind === 'slot' : dim === 'rules' ? r.kind === 'rule' : false,
            );
            // Display order only: slots are a numbered 1–10 set, so showing them
            // in the file's order made the list unscannable. The diff's own
            // record order (which tests may rely on) is deliberately untouched.
            const shown = dim === 'slots' ? bySlotId(records) : records;
            const isRecordDimension = dim === 'slots' || dim === 'rules';
            const changedCount = records.filter((r) => r.status !== 'kept').length;
            // The settings parts and shortcut bindings the file carries,
            // read from the LIVE diff (so their status follows the user's choices).
            const shownParts = dim === 'settings' ? (liveDiff?.settingsParts ?? []) : [];
            const shortcutParts = dim === 'shortcuts' ? (liveDiff?.shortcutParts ?? []) : [];
            // No separate record lookup: every cell of a row comes from the diff
            // itself (`before` / `icon` / `priority`), which is the one place that
            // already resolved "does this exist on the machine, and did the user
            // keep it". A second lookup over the package could only disagree with
            // it — and did: it made rows report the FILE's URL and priority.
            return (
              <section
                key={dim}
                className={`tbs-settings__card${carried(dim) ? '' : ' tbs-settings__card--absent'}`}
                data-testid={`import-dim-${dim}`}
              >
                <header className="tbs-settings__card-head">
                  <h4 className="tbs-settings__card-title">{meta.title}</h4>
                  {/* A count, not a status word: "3 of 5 change" says both the
                      size of the part and how much of it the import will touch,
                      which is what decides whether the user opens it. */}
                  <span className="tbs-settings__card-meta">
                    {!carried(dim)
                      ? 'not in this file'
                      : isRecordDimension
                        ? `${String(changedCount)} of ${String(records.length)} change`
                        : 'included'}
                  </span>
                </header>
                {!carried(dim) ? (
                  // A2: a dimension the package did not carry cannot be chosen —
                  // offering a selector here would be a lie.
                  <p className="tbs-settings__hint" data-testid={`import-absent-${dim}`}>
                    This package does not include {meta.title.toLowerCase()}.
                  </p>
                ) : (
                  <>
                    <div className="tbs-settings__mode">
                      <label className="tbs-settings__mode-label" htmlFor={`import-mode-${dim}`}>
                        Mode
                      </label>
                      <select
                        id={`import-mode-${dim}`}
                        className="tbs-settings__mode-select"
                        data-testid={`import-mode-${dim}`}
                        value={intent.dimensionModes[dim]}
                        // The consequence sentence is the select's description,
                        // not adjacent prose: a screen reader must hear what
                        // "Overwrite" does to the records the file omits, or the
                        // option name is the only thing announced.
                        aria-describedby={`import-mode-${dim}-help`}
                        onChange={(e) => { setDimensionMode(dim, e.currentTarget.value as DimensionMode); }}
                      >
                        <option value="incremental">Incremental (add / replace)</option>
                        <option value="overwrite">Overwrite</option>
                      </select>
                      {/* The consequence, in the words the confirmation dialog
                          will use. A bare option name ("Overwrite") does not say
                          what becomes of the records it does not contain. */}
                      <span className="tbs-settings__mode-help" id={`import-mode-${dim}-help`}>
                        {intent.dimensionModes[dim] === 'overwrite'
                          ? `Everything in ${meta.title.toLowerCase()} is replaced, including records this file does not contain.`
                          : `Records in this file are added or replaced; ${meta.title.toLowerCase()} you already have stay.`}
                      </span>
                    </div>
                    {dim === 'settings' && shownParts.length > 0 && (
                      <ImportSettingsParts
                        parts={shownParts}
                        intent={intent}
                        onToggle={(id, take) => {
                          setPartTaken('settings', id, take, shownParts.map((p) => p.id));
                        }}
                        onToggleAll={(take) => {
                          setPartTaken('settings', allPartsSentinel, take, shownParts.map((p) => p.id));
                        }}
                      />
                    )}
                    {/* The shortcut bindings, one row each, with the same take-checkbox
                        granularity the settings parts use. */}
                    {dim === 'shortcuts' && shortcutParts.length > 0 && (
                      <ImportShortcutParts
                        parts={shortcutParts}
                        intent={intent}
                        onToggle={(name, take) => {
                          setPartTaken('shortcuts', name, take, shortcutParts.map((p) => p.id));
                        }}
                        onToggleAll={(take) => {
                          setPartTaken('shortcuts', allPartsSentinel, take, shortcutParts.map((p) => p.id));
                        }}
                      />
                    )}
                    {isRecordDimension && shown.length > 0 && (
                      <RecordList
                        label={`Import ${meta.title.toLowerCase()}`}
                        testIdPrefix={`import-${dim}`}
                        rows={shown.map((r) => ({
                          key: String(r.id),
                          // EVERY cell describes the TARGET MACHINE. The file's
                          // version appears only in the field detail, as
                          // `<target> → <imported>`; reading the FILE here made an
                          // untouched record display a title / URL / type that
                          // existed only inside the package.
                          icon: importRowIcon(r),
                          title: importRowTitle(r),
                          matchUrl: importRowMatchUrl(r),
                          matchType: importRowMatchType(r),
                          // The machine's OWN priority, and only that. A rule the
                          // machine does not have (`added`) has no priority yet,
                          // so the column is omitted rather than showing the
                          // file's number as if it were the machine's.
                          ...(r.before?.priority !== undefined ? { priority: r.before.priority } : {}),
                          // A12: record level by default, field level on demand —
                          // but the disclosure lives INSIDE the row, so "whose
                          // fields are these" is answered by the DOM rather than
                          // by adjacency. A long list used to push the record
                          // list and the field blocks apart with no visible tie.
                          //
                          // The field ROWS are `RecordFields`, not a `<ul>` built
                          // here: label / value / state is a layout, and inline
                          // markup is how per-row wording drifts between panels.
                          detail: r.fields.length > 0 ? (
                            <RecordFields
                              fields={r.fields}
                              status={r.status}
                              testId={`import-fields-${r.kind}-${String(r.id)}`}
                              testIdPrefix={`import-field-${r.kind}-${String(r.id)}`}
                            />
                          ) : null,
                          trailing: (
                            <>
                              <StatusBadge status={RECORD_BADGE[r.status]} label={r.status} />
                              {/* A4 checkpoint: the checkbox is a VIEW of the live
                                  row status, not a second boolean that could drift
                                  from it — checked ⟺ `status !== 'kept'`, and
                                  toggling writes a sparse keep/take override, after
                                  which the diff is recomputed and the view follows.
                                  The accessible name stays `Take <label>` (the test
                                  anchor); the label text is fixed for all rows.

                                  EVERY row is declinable, including a file-only
                                  (`added`) one: declining it means "do not create
                                  this on my machine", which the diff honours by
                                  reporting the row `kept`. A disabled box used to
                                  assert the opposite — that the file's own records
                                  were applied no matter what the user chose. */}
                              <label className="tbs-settings__import-take">
                                <input
                                  type="checkbox"
                                  data-testid={`import-record-${r.kind}-${String(r.id)}`}
                                  checked={r.status !== 'kept'}
                                  aria-label={`Take ${r.label}`}
                                  onChange={(e) => {
                                    setRecordAction(r.kind, r.id, e.currentTarget.checked ? 'take' : 'keep');
                                  }}
                                />
                                Take
                              </label>
                            </>
                          ),
                        }))}
                        emptyAll={`This file contains no ${meta.title.toLowerCase()}.`}
                        selectAll={{
                          // The per-record overrides are the ONE source: "all
                          // taken" means no row was declined, so the checkbox
                          // cannot disagree with the rows it controls.
                          allSelected: !shown.some((r) => r.status === 'kept'),
                          someSelected: shown.some((r) => r.status === 'kept')
                            && shown.some((r) => r.status !== 'kept'),
                          onToggleAll: (all) => {
                            // EVERY row is controlled, `added` included: a
                            // file-only row can now be declined, so excluding it
                            // would leave "clear all" clearing everything except
                            // the rows the user most likely wants to skip.
                            for (const r of shown) {
                              setRecordAction(r.kind, r.id, all ? 'take' : 'keep');
                            }
                          },
                          noun: meta.title.toLowerCase(),
                        }}
                      />
                    )}
                  </>
                )}
              </section>
            );
          })}

          {/* The commit bar states what this import will DO before it is
              committed: the same deletion count the confirmation dialog uses
              (one derivation, `deletionCounts`), so the two can never disagree.
              Cancel stays a quiet text button — the primary action is the only
              emphasised control in the panel. */}
          <footer className="tbs-settings__commit">
            <p className="tbs-settings__commit-summary" data-testid="import-summary" aria-live="polite">
              {quantizedMessage}
            </p>
            <div className="tbs-settings__commit-actions">
              <Button size="sm" variant="ghost" onClick={() => { setInspection(null); setFile(null); setPkg(null); setCurrent(null); setApplyResult(null); setAppliedDiff(null); }}>Cancel</Button>
              <Button
                size="sm"
                variant="primary"
                data-testid="import-apply"
                onClick={handleApply}
                loading={importing}
              >
                Apply import
              </Button>
            </div>
          </footer>
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
        {/* The sentence is IDENTICAL to the one already shown in the commit bar
            (`quantizedMessage`) — this dialog repeats it at the point of no
            return, it does not restate the outcome in new words. */}
        <p className="tbs-settings__confirm-line">{quantizedMessage}</p>

        {/* What is about to change, per dimension. A user asked "Confirm
            import" for a reason and could not tell whether it would touch their
            slots, their rules or only a shortcut — the deletion sentence above
            says nothing about what IS written. */}
        {changeSummary.length > 0 && (
          <div className="tbs-settings__confirm-changes" data-testid="import-confirm-changes">
            <h4 className="tbs-settings__parts-head">Changes in this import</h4>
            <ul className="tbs-settings__parts-list">
              {changeSummary.map((row) => (
                <li key={row.dim} data-testid={`import-confirm-change-${row.dim}`}>
                  <span className="tbs-settings__part-label">{`${DIMENSION_META[row.dim].title}: `}</span>
                  <span className="tbs-settings__part-value">
                    {row.changed === 0
                      ? `no change (${String(row.total)} ${row.unit} in the file)`
                      : `${String(row.changed)} of ${String(row.total)} ${row.unit} change`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="tbs-settings__confirm-hint">
          You can export a backup before confirming. Applying starts immediately and cannot be
          reversed from here.
        </p>
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
  /** T22/D9: a record the result list asked to reveal (repair entry target). */
  const [importFocus, setImportFocus] = useState<{ kind: 'slot' | 'rule'; id: number | string } | null>(null);
  /**
   * Which half of the Import / Export section is showing. Import is the default
   * because it is the rarer, more consequential job: a user opening this section
   * usually already has a file in hand.
   */
  const [importExportTab, setImportExportTab] = useState<'import' | 'export'>('import');
  /**
   * A monotonically increasing token that tells the Import / Export panels to
   * re-read the target machine. A TOKEN rather than a boolean so two refreshes
   * in a row are both observed (a boolean would collapse them).
   */
  const [targetRefreshToken, setTargetRefreshToken] = useState(0);
  /**
   * True when a write happened elsewhere since the target values were last read:
   * "the machine may have moved, look again". Set from `storage.onChanged`, which
   * is the only signal that covers a sidebar edit, a Rules edit, a Global
   * Strategy change and an applied import alike — they all land in `sync`.
   */
  const [targetMayBeStale, setTargetMayBeStale] = useState(false);
  const [refreshingTarget, setRefreshingTarget] = useState(false);

  /**
   * T22/D9: reveal the record the missing-icon entry points at. Reuses the
   * app's ONE jump visual language (`JUMP_HIGHLIGHT_CLASS`); it reads the live
   * DOM so the record simply has to be rendered by the surface we switched to.
   * No write, no persisted marker (C9).
   */
  useEffect(() => {
    if (!importFocus) return;
    const selector = importFocus.kind === 'slot'
      ? `[data-testid="slot-row-${String(importFocus.id)}"]`
      : `[data-testid="rule-row-${String(importFocus.id)}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return; // surface not rendered yet; a later render re-runs this
    // jsdom has no layout engine; a missing scroll must never cost the
    // highlight (the cue is the point) — mirror the dashboard's approach.
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    el.classList.add(JUMP_HIGHLIGHT_CLASS);
    const timer = setTimeout(() => { el.classList.remove(JUMP_HIGHLIGHT_CLASS); }, JUMP_HIGHLIGHT_MS);
    setImportFocus(null);
    return () => { clearTimeout(timer); };
  }, [importFocus]);

  // Load state
  const loadState = useCallback(async (opts: { silent?: boolean } = {}) => {
    // A SILENT refresh re-reads without the loading state. The post-import
    // refresh must not blank the page: `loading` unmounts every section, which
    // would throw away the just-rendered apply result the user is reading.
    if (!opts.silent) {
      setLoading(true);
      setError(null);
    }
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

  /**
   * Watch for configuration writes made ANYWHERE, so the Import / Export panels
   * can say "the target machine may have moved".
   *
   * Mounted at the page level (not inside the panels) for two reasons: it must
   * run while the user is on the sidebar / Rules / Dashboard sections — that is
   * exactly when they change a slot or a rule — and it must survive the panels
   * being unmounted by a section switch.
   *
   * `storage.onChanged` is used rather than `MessageClient.onExternalChange`
   * because the latter only fires when the *configVersion* changed, which misses
   * a same-version write and is silent about the `local` area entirely.
   */
  useEffect(() => {
    const onChangedApi = (globalThis as unknown as {
      chrome?: { storage?: { onChanged?: StorageOnChangedApi } };
    }).chrome?.storage?.onChanged;
    if (!onChangedApi) return;
    /**
     * A burst (one user edit can touch several keys) must not become a burst of
     * reads, so the re-read is coalesced onto a short timer.
     */
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChanged: StorageChangeListener = (changes, areaName) => {
      if (areaName !== 'sync' && areaName !== 'local') return;
      if (Object.keys(changes).length === 0) return;
      setTargetMayBeStale(true);
      // Re-read as well as flagging. Flagging alone left the panels showing the
      // old values while telling the user they might have changed — the exact
      // report of "I edited a slot and the lists never caught up".
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setTargetRefreshToken((n) => n + 1);
      }, 150);
    };
    onChangedApi.addListener(onChanged);
    return () => {
      if (timer !== null) clearTimeout(timer);
      onChangedApi.removeListener(onChanged);
    };
  }, []);

  /**
   * The manual refresh behind the floating button.
   *
   * Bumping the token is what makes the panels re-read; the flag is cleared only
   * after they have done so, so the "may have changed" hint cannot be dismissed
   * by a click that failed to refresh anything.
   */
  const handleRefreshTarget = useCallback(async () => {
    setRefreshingTarget(true);
    setTargetRefreshToken((n) => n + 1);
    // Read the SAME thing the panels read, and report what came back.
    //
    // This is not decoration: a refresh that silently does nothing is
    // indistinguishable from a refresh that is not wired up, so the confirmation
    // states the actual figures and the version. If the values on screen do not
    // match this report, the fault is in the rendering; if the report itself
    // carries the old figures, the write never reached storage.
    try {
      const res = await sendMessage('GET_STATE');
      const result = extractResult(res);
      const sync = result?.success ? (result.sync as SyncState | undefined) : undefined;
      if (sync) {
        setToast({
          variant: 'success',
          message: `Read from storage: ${String(sync.slots.length)} slots, ${String(sync.rules.length)} rules, config v${String(sync.configVersion)}.`,
        });
      } else {
        setToast({ variant: 'error', message: 'Refresh failed: could not read the configuration.' });
      }
    } catch {
      setToast({ variant: 'error', message: 'Refresh failed: could not read the configuration.' });
    }
    setTargetMayBeStale(false);
    setRefreshingTarget(false);
  }, []);

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
              /* Import and Export are two DIFFERENT jobs that used to be two
                 stacked headings — "which one am I looking at" had no answer at
                 a glance, and both stayed on screen while the user worked in one
                 of them. The `Tabs` primitive (shared with every other source
                 picker, so the a11y wiring cannot drift) makes them mutually
                 exclusive and the choice visible as a control.

                 Both panels are always MOUNTED and the inactive one is hidden:
                 export reads its own state on mount, and hiding (rather than
                 unmounting) keeps that fetch and any in-progress import review
                 from being discarded by a tab switch. */
              <>
                <h2>Import / Export</h2>
                {/* The strip is rendered WITHOUT children and the two panels are
                    declared here instead. `Tabs` renders a single panel keyed by
                    the CURRENT value, so passing both panels as children would
                    leave the inactive tab's `aria-controls` pointing at an id
                    that does not exist. Two real `role="tabpanel"` nodes (ids
                    matching the tabs' `aria-controls`) keep every reference
                    resolvable while both stay mounted. */}
                <Tabs
                  items={[
                    { id: 'import', label: 'Import' },
                    { id: 'export', label: 'Export' },
                  ]}
                  value={importExportTab}
                  // `Tabs` speaks in `string` ids (it is shared with pickers whose
                  // ids are not a closed union), so the narrow state is narrowed
                  // back here rather than widening the state itself.
                  onChange={(id) => { setImportExportTab(id === 'export' ? 'export' : 'import'); }}
                  label="Import or export"
                  idPrefix="import-export"
                />
                {/* D9: the missing-icon repair entry sends the user to the
                    record's OWN surface (slot table / rules table) — that
                    surface's existing editor does the edit. Nothing is persisted
                    here (C9: no "needs re-selection" marker). */}
                <div
                  className="tbs-settings__tabpanel"
                  id="import-export-panel-import"
                  role="tabpanel"
                  aria-labelledby="import-export-tab-import"
                  tabIndex={0}
                  hidden={importExportTab !== 'import'}
                >
                  <ImportExportSection
                    onJumpToRecord={(kind, id) => {
                      setActiveSection(kind === 'slot' ? 'slots' : 'rules');
                      setImportFocus({ kind, id });
                    }}
                    // An applied import changes the configuration the
                    // OTHER sections are showing (Global Strategy holds its own
                    // copy of `matchSettings`), so the page re-reads after the
                    // write. SILENT: the user is reading the apply result, and
                    // the loading state would unmount it.
                    onApplied={() => {
                      void loadState({ silent: true });
                      setTargetRefreshToken((n) => n + 1);
                    }}
                    refreshToken={targetRefreshToken}
                    onRefreshed={() => { setTargetMayBeStale(false); }}
                  />
                </div>
                <div
                  className="tbs-settings__tabpanel"
                  id="import-export-panel-export"
                  role="tabpanel"
                  aria-labelledby="import-export-tab-export"
                  tabIndex={0}
                  hidden={importExportTab !== 'export'}
                >
                  <ExportSection
                    refreshToken={targetRefreshToken}
                    onRefreshed={() => { setTargetMayBeStale(false); }}
                  />
                </div>
              </>
            )}
            {activeSection === 'diagnostics' && <DiagnosticsSection />}
          </>
        )}
      </main>

      {toast && (
        <Toast variant={toast.variant} message={toast.message} onDismiss={() => { setToast(null); }} />
      )}

      {/* The manual refresh, available on the Import / Export section.
          The automatic refresh listens for `storage.onChanged`, but that signal
          does not survive every real-world case — most notably a Service Worker
          that was asleep when the write happened, which is exactly the "I changed
          a slot and the lists never caught up" report. A control the user can
          press turns an unexplainable stale list into a one-click fix, and the
          hint on it says WHY they might need it. */}
      {activeSection === 'import-export' && (
        <button
          type="button"
          className={`tbs-settings__refresh${targetMayBeStale ? ' tbs-settings__refresh--stale' : ''}`}
          data-testid="import-export-refresh"
          aria-label="Refresh target machine values"
          title="Re-read the slots, rules, settings and shortcuts on this machine"
          aria-busy={refreshingTarget || undefined}
          onClick={() => { void handleRefreshTarget(); }}
        >
          <span className="tbs-settings__refresh-icon" aria-hidden="true">⟳</span>
          <span className="tbs-settings__refresh-label">Refresh</span>
          {/* A live, non-visual announcement: the dot alone would convey the
              "may have changed" state by colour, which is not accessible. */}
          <span className="tbs-settings__refresh-status" role="status" aria-live="polite">
            {targetMayBeStale
              ? 'Target values may have changed — refresh to see the latest.'
              : ''}
          </span>
          {targetMayBeStale && (
            <span className="tbs-settings__refresh-dot" data-testid="import-export-refresh-stale" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}
