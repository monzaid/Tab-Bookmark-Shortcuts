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
import { SearchField } from '@ui/shared/search-field';
import { IconAction, PencilIcon, TrashIcon, GoToIcon, ResetIcon } from '@ui/shared/icons';
import { EmptyState } from '@ui/shared/empty-state';
import type { IconConfig } from '@ui/components/IconEditor';
import { PRESET_BG_COLORS, PRESET_TEXT_COLORS, autoTextColor } from '@ui/components/IconEditor';
import type { MatchRuleSettings, SwitchDirection, Priority, TabIdMode, RuleCheckMode, SlotDefinition, PageRule, IconSource, TabOverride, DashboardRow, ImportInspection, ImportIntent, ImportRecordOverride, ImportApplyResult, ImportDiff, ImportRecordDiff, ImportRecordStatus, ImportPartDiff, ImportFieldDiff, DimensionPresence, DimensionMode, ExportScope, SyncState, UrlMatchType } from '@shared/types';
import { MATCH_TYPE_LABELS } from '@shared/match-type-labels';
import { RecordList, RecordFields } from '@ui/shared/record-list';
import { IconPreview, previewFromIconSource, previewFromFieldValue } from '@ui/shared/icon-preview';
import type { IconPreviewSource } from '@ui/shared/icon-preview';
import type { StatusBadgeProps } from '@ui/shared/components';
import { DEFAULT_MATCH_SETTINGS, defaultImportIntent } from '@shared/types';
import type { TagDefinition } from '@shared/types';
import { evaluateExpression, resolveChipDisplayName } from '@shared/tag-expression';
import type { ChipToken } from '@shared/tag-expression';
import { TagExpressionInput } from '@ui/shared/tag-chip-input';
import { applyIntent, computeDiff, quantifyDeletions } from '@shared/import-diff';
import { isExportPackage, summariseMatchSettings, summariseStrategy, slotStrategyPartId, slotAutoBindPartId, syncStateToPackage, computeExportSelfConsistency, DEFAULT_TAG_APPEARANCE } from '@shared/export-package';
import type { ExportPackage, SettingPartId, ExportSelfConsistency } from '@shared/export-package';

import { RuleFormFields } from '@ui/shared/rule-form-fields';
import { FieldEditor } from '@ui/shared/field-editor';
import type { FieldMode } from '@ui/shared/field-editor';
import { InlineEditorShell } from '@ui/shared/inline-editor-shell';
import { normalizeRuleDraft, resolveDraftFavicon, validateRuleDraft } from '@ui/shared/rule-form-submit';
import type { RuleDraftValue } from '@ui/shared/rule-form-submit';
import { resolveFieldChain } from '@shared/field-chain';
import type { ChainResult, TierKey, TierOwner } from '@shared/field-chain';
import { useJumpToRow, JUMP_HIGHLIGHT_CLASS, JUMP_HIGHLIGHT_MS } from '@ui/shared/use-jump-to-row';

/**
 * How long a cross-section jump waits for its target row to exist.
 *
 * The destination section mounts BEFORE it has data, so the row can appear a
 * render (or a fetch) later. These bound the wait: 15 × 40ms ≈ 600ms, past any
 * fixture-backed render and short enough that a genuinely absent target gives up
 * rather than leaving a timer alive.
 */
const JUMP_FIND_ATTEMPTS = 15;
const JUMP_FIND_INTERVAL_MS = 40;
import { canonicalIconSource, iconSourceForOwner, iconSourceToFieldSeed } from '@ui/shared/icon-source';
import { UndoBar, UNDO_DEFAULT_MS } from '@ui/shared/undo-bar';
import type { UndoSnapshot } from '@ui/shared/undo-bar';
import { useUndoStack } from '@ui/shared/undo-stack';
import { countTagReferences, TAG_NAME_MAX, isTagColorValid, isTagNameValid } from '@shared/tags';
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

type SettingsSection = 'slots' | 'rules' | 'strategy' | 'dashboard' | 'tags' | 'import-export' | 'diagnostics';

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
    sync: { configVersion: 0, matchSettings: DEFAULT_MATCH_SETTINGS, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [], tags: [] },
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
  // D-a: the tag vocabulary's own page, beside the other per-domain pages. It is
  // the ONLY place a tag can be renamed or deleted, and the only place an
  // unreferenced tag is guaranteed to be reachable (C3).
  { id: 'tags', label: 'Tags' },
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
  /**
   * G3: the rule's tags as a FORM DRAFT, alongside the other fields.
   *
   * It travels with the form rather than in a parallel piece of state so the
   * shared field set renders it as one more field of this rule — and so
   * "what the form holds" and "what gets submitted" are the same object rather
   * than two things that can drift.
   */
  tagIds: string[];
}

const EMPTY_RULE_FORM: RuleFormState = {
  url: '',
  matchType: 'exact',
  titleMode: { kind: 'use-chain' },
  iconMode: { kind: 'use-chain' },
  iconConfig: undefined,
  priority: 0,
  tagIds: [],
};

// ─── Tags Section (D-a: the 7th navigation page) ────────────────────────────

/**
 * The tag management page: list, add, rename, recolour, delete.
 *
 * The DELETE flow is the whole reason this page is careful (C4/C5/R3):
 *
 *   click Delete  ->  `Confirm` stating the impact  ->  (confirm)  ->  commit
 *                 ->  THEN `UndoBar`
 *
 * Strictly serial, on the existing g2 ruling: a confirmation and an undo bar on
 * screen at once would offer to undo something that has not happened yet. The
 * `Confirm` is `danger` with no default button (R4) — a stray Enter must not
 * delete anything.
 *
 * Orphan tags (referenced by no rule) are FIRST-CLASS here: they are listed like
 * any other tag, because C3 makes "visible" a requirement — an orphan the user
 * cannot see is an orphan that silently accumulates.
 */
/**
 * The undo snapshot a `DELETE_TAG` response carries, or `undefined`.
 *
 * One accessor for the SINGLE delete and the BATCH one: they must read the same
 * field the same way, or a batch would collect snapshots a single delete would have
 * accepted (or vice versa) and the undo would silently differ by path. `extractResult`
 * unwraps the worker's envelope, but the snapshot sits BESIDE `result` rather than
 * inside it, which is why this is a separate read rather than a field on that type.
 */
function deleteSnapshotOf(response: unknown): { tag: TagDefinition; refs: Array<{ ruleId: string; tagIds: string[] }> } | undefined {
  return (response as { snapshot?: { tag: TagDefinition; refs: Array<{ ruleId: string; tagIds: string[] }> } } | undefined)?.snapshot;
}

function TagsSection({ onRedirectToRule }: { onRedirectToRule: (ruleId: string) => void }) {
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [rules, setRules] = useState<PageRule[]>([]);
  const [loadError, setLoadError] = useState(false);
  /**
   * Has the first read finished?
   *
   * `tags` starts as `[]`, which is ALSO what a genuinely empty table looks like —
   * so before this the panel's first frame said "No tags yet. Create one with +
   * New Tag" to every user, including one with fifty tags. The empty state is a
   * claim about the machine, and it may not be made before the machine has
   * answered.
   */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TagDefinition | null>(null);
  /**
   * IMP-6/DT9 + U4 (T9): the atomic undo for tag writes, on the SHARED stack.
   *
   * This section pushes `client` entries only — the snapshot lives in the UI and
   * the replay sends ONE message per write (the canonical `createUndoReplay`
   * mapping), wrapped by `handleTagUndo` in this section's own side effects
   * (busy flag, toast, reload). One stack per surface (U4); several writes now
   * stack instead of overwriting each other (U1/U6).
   */
  const undoStack = useUndoStack({
    onReplay: (entry) => {
      // T9 pushes `client` entries only (the tag writes' snapshot lives in the
      // UI). The replay LOOP is kept verbatim below (D9: "keep the existing
      // RESTORE_TAG/SET_RULE_TAGS loop"), now reached via `consume(id)`.
      if (entry.replay === 'client') return handleTagUndo(entry.snapshot);
      return undefined;
    },
  });
  /**
   * Which tags' Edit forms are open UNDER their rows — a SET, so several can be
   * edited at once.
   *
   * A single id was the first cut, and it made comparing or batch-tweaking two
   * tags a sequence of open/close/open rather than one pass. The rules table
   * already establishes the multi-open behaviour ("multiple can be open"), so
   * this is the same convention rather than a new one.
   */
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  /**
   * Which tags' "which items use this" panels are open.
   *
   * Also a set, and for a reason worth stating: if this stayed single-open while
   * edits became multi-open, opening one panel would have to CLOSE another — so
   * a user inspecting tag A would lose tag B's open Edit form to a control that
   * does not mention it. Two independent sets keep each action's blast radius to
   * the row it was clicked on.
   */
  const [inspectingIds, setInspectingIds] = useState<Set<string>>(new Set());
  /** Is the `+ New Tag` appearance form open? */
  const [showCreate, setShowCreate] = useState(false);
  /** Substring match over the tag NAME. `''` = no search. */
  const [query, setQuery] = useState('');
  /** `null` = the table's own order. Name is the only sortable column. */
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  /** The rows the bulk affordance operates on (mirrors the rules table's ☑). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** The bulk bar is showing / a bulk write is running (mirrors the rules table). */
  const [batchProcessing, setBatchProcessing] = useState(false);
  /** D-12: the bulk delete is confirmed before it runs — a destructive action (N1). */
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await sendMessage('GET_STATE');
      const result = extractResult(res);
      if (result?.success) {
        const sync = result.sync as { tags?: TagDefinition[]; rules?: PageRule[] } | undefined;
        setTags(sync?.tags ?? []);
        setRules(sync?.rules ?? []);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      // In `finally` rather than per-branch: a failure also means "the read is
      // over", and leaving the panel in its loading state after an error would
      // hide the error behind a spinner.
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const onStorageChanged = (_c: unknown, areaName: string) => {
      if (areaName === 'sync') void load();
    };
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    return () => { chrome.storage?.onChanged?.removeListener(onStorageChanged); };
  }, [load]);

  const referenceCount = (tagId: string): number => countTagReferences(tagId, rules);

  /**
   * The `+ New Tag` form's submit. `appearance` carries all three fields, so a
   * tag can be created with the colours the user picked rather than appearing in
   * a default grey they then have to edit (the form is the only chance to set
   * them before the tag exists).
   *
   * Returns the backend's verdict so the form can stay OPEN on a refusal (a
   * duplicate name) instead of discarding what the user typed.
   */
  const handleCreate = async (appearance: TagAppearance): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await sendMessage('CREATE_TAG', {
        name: appearance.name,
        backgroundColor: appearance.backgroundColor,
        textColor: appearance.textColor,
      });
      const result = extractResult(res) as { success?: boolean; message?: string } | undefined;
      if (result && result.success === false) {
        setToast({ variant: 'error', message: result.message ?? 'Could not create the tag' });
        return false;
      }
      setToast({ variant: 'success', message: 'Tag created' });
      await load();
      return true;
    } catch {
      setToast({ variant: 'error', message: 'Could not create the tag' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * The Edit form's submit — name AND both colours in ONE `UPDATE_TAG`.
   *
   * One write for one decision: sending a rename plus a separate colour write
   * could half-succeed, leaving a tag renamed but not recoloured with no single
   * value to report. C1: the id is untouched, so every referencing rule follows
   * the new name with no write to any rule — the reference count does NOT move.
   */
  const handleUpdate = async (tagId: string, appearance: TagAppearance): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await sendMessage('UPDATE_TAG', {
        tagId,
        name: appearance.name,
        backgroundColor: appearance.backgroundColor,
        textColor: appearance.textColor,
      });
      const result = extractResult(res) as { success?: boolean; message?: string } | undefined;
      if (result && result.success === false) {
        setToast({ variant: 'error', message: result.message ?? 'Could not save the tag' });
        return false;
      }
      // Closes THIS row's form only. Closing "the" edit form would be wrong now
      // that several can be open — saving one tag must not dismiss another.
      setEditingIds((prev) => {
        const next = new Set(prev);
        next.delete(tagId);
        return next;
      });
      setToast({ variant: 'success', message: 'Tag updated' });
      await load();
      return true;
    } catch {
      setToast({ variant: 'error', message: 'Could not save the tag' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * "Delete" from the association panel's rule row: remove ONE tag from ONE rule.
   *
   * `SET_RULE_TAGS` with the id filtered out — not `DELETE_TAG`, which would
   * remove the tag everywhere. The distinction is the whole reason the panel can
   * offer the action at all: from inside "which rules use this tag", the
   * destructive-sounding verb means "stop using it HERE".
   */
  const handleUnlinkRule = async (ruleId: string, tagId: string): Promise<void> => {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;
    // Captured BEFORE the write: this is exactly what the undo restores.
    const previousTagIds = [...rule.tagIds];
    setBusy(true);
    try {
      const res = await sendMessage('SET_RULE_TAGS', {
        ruleId,
        tagIds: previousTagIds.filter((id) => id !== tagId),
      });
      const result = extractResult(res) as { success?: boolean; message?: string } | undefined;
      if (result && result.success === false) {
        setToast({ variant: 'error', message: result.message ?? 'Could not remove the tag from that rule' });
        return;
      }
      setToast({ variant: 'success', message: 'Tag removed from the rule' });
      await load();
      // Undoable, like every other tag write. The message names the RULE, because
      // this action is scoped to one rule — "Tag removed" would leave the user
      // unsure which of several open association panels it referred to.
      undoStack.push({
        replay: 'client',
        message: `Tag removed from "${rule.title ?? rule.urlMatch.value}"`,
        snapshot: { writes: [{ kind: 'rule-tags', ruleId, previousTagIds }], affectedTabIds: [] },
        expiresAt: Date.now() + UNDO_DEFAULT_MS,
      });
    } catch {
      setToast({ variant: 'error', message: 'Could not remove the tag from that rule' });
    } finally {
      setBusy(false);
    }
  };

  const toggleSort = (): void => {
    setSortDir((prev) => (prev === null ? 'asc' : prev === 'asc' ? 'desc' : null));
  };

  /**
   * Flip one id in a set of open panels.
   *
   * One helper for both toggles so the two cannot drift: each returns a NEW set
   * (a mutated `prev` would not re-render and would silently share identity with
   * the previous state).
   */
  const toggleInSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ): void => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** The list the table renders: searched, then sorted. ONE derivation. */
  const visibleTags = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle === ''
      ? tags
      : tags.filter((t) => t.name.toLowerCase().includes(needle));
    if (sortDir === null) return matching;
    const dir = sortDir === 'asc' ? 1 : -1;
    // A stable key: `localeCompare` so `Tag 10` follows `Tag 9` the way a reader
    // expects, rather than falling into lexicographic order.
    return [...matching].sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [tags, query, sortDir]);

  // D-13's counterpart on this table: a row that a search hid must not stay
  // "selected", or a later bulk action would operate on rows the user cannot see.
  useEffect(() => {
    const visible = new Set(visibleTags.map((t) => t.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleTags]);

  /** The commit half of the serial flow. Runs ONLY after the Confirm closes. */
  const commitDelete = async (tag: TagDefinition): Promise<void> => {
    setConfirmDelete(null);
    setBusy(true);
    try {
      const res = await sendMessage('DELETE_TAG', { tagId: tag.id });
      const result = extractResult(res) as { success?: boolean; message?: string; affectedRuleCount?: number } | undefined;
      const snapshot = deleteSnapshotOf(res);
      if (result && result.success === false) {
        setToast({ variant: 'error', message: result.message ?? 'Could not delete the tag' });
        return;
      }
      await load();
      // Only NOW does the undo bar appear — after the confirm is gone and the
      // write has happened (C5/R3).
      if (snapshot) {
        undoStack.push({
          replay: 'client',
          message: `Tag "${tag.name}" deleted`,
          snapshot: { writes: [{ kind: 'tag-delete', tag: snapshot.tag, refs: snapshot.refs }], affectedTabIds: [] },
          expiresAt: Date.now() + UNDO_DEFAULT_MS,
        });
      }
    } catch {
      setToast({ variant: 'error', message: 'Could not delete the tag' });
    } finally {
      setBusy(false);
    }
  };

  const selectedTags = tags.filter((t) => selectedIds.has(t.id));

  /**
   * Delete every selected tag, one `DELETE_TAG` each.
   *
   * One message per tag rather than a new bulk action, deliberately: `DELETE_TAG`
   * is the single delete path (it captures the undo snapshot and cascades the
   * reference strip atomically), and a second bulk route would be a second
   * implementation of the same cascade — the shape that drifts. A partial failure
   * is REPORTED rather than swallowed (D-12), exactly as the rules table's batch
   * delete does.
   *
   * The snapshots are COLLECTED, so one Undo restores the whole batch: the
   * `UndoBar` already replays a list of `tag-delete` writes, so the batch is one
   * undoable action rather than N separate bars fighting for the same slot.
   */
  const handleBatchDelete = async (): Promise<void> => {
    setConfirmBatchDelete(false);
    const ids = [...selectedIds];
    setBatchProcessing(true);
    const writes: Array<{ kind: 'tag-delete'; tag: TagDefinition; refs: Array<{ ruleId: string; tagIds: string[] }> }> = [];
    /**
     * The tags the write did NOT remove, kept by ID so the selection can name them.
     *
     * This used to be a bare counter while `setSelectedIds(new Set())` ran
     * unconditionally — so a batch that partly failed cleared the selection and
     * reported only "2 failed", leaving the user to find which two among rows that
     * may since have been re-sorted or filtered. The failed rows stay SELECTED, so
     * the answer is still on screen and the retry is the same button.
     */
    const failedIds: string[] = [];
    try {
      for (const id of ids) {
        try {
          const res = await sendMessage('DELETE_TAG', { tagId: id });
          const result = extractResult(res) as { success?: boolean } | undefined;
          const snapshot = deleteSnapshotOf(res);
          if (result && result.success === false) {
            failedIds.push(id);
          } else if (snapshot) {
            writes.push({ kind: 'tag-delete', tag: snapshot.tag, refs: snapshot.refs });
          }
        } catch {
          failedIds.push(id);
        }
      }
      setSelectedIds(new Set(failedIds));
      await load();
      const failed = failedIds.length;
      const deleted = ids.length - failed;
      setToast(
        failed === 0
          ? { variant: 'success', message: `Deleted ${String(deleted)} ${deleted === 1 ? 'tag' : 'tags'}` }
          : {
              variant: 'error',
              // Names them as well as counting: the selection now holds exactly
              // these rows, so keeping them selected is only useful if the user can
              // tell WHICH ones they are.
              message: `Deleted ${String(deleted)} of ${String(ids.length)} · ${String(failed)} failed: ${failedIds.map((id) => `"${tags.find((t) => t.id === id)?.name ?? id}"`).join(', ')}`,
            },
      );
      // Only the tags that WERE deleted go into the undo: replaying one that is
      // still present would be a write with nothing to restore.
      if (writes.length > 0) {
        // U1/T9: one push for the whole batch — the collected `writes` are a
        // single undoable action, so the bar count must not become N.
        undoStack.push({
          replay: 'client',
          message: `${String(writes.length)} ${writes.length === 1 ? 'tag' : 'tags'} deleted`,
          snapshot: { writes, affectedTabIds: [] },
          expiresAt: Date.now() + UNDO_DEFAULT_MS,
        });
      }
    } finally {
      setBatchProcessing(false);
    }
  };

  return (
    <section data-testid="tags-section" aria-label="Tags" className="tbs-settings__panel">
      <header className="tbs-settings__panel-head">
        <h3 className="tbs-settings__panel-title">Tags</h3>
        <p className="tbs-settings__panel-sub">
          Labels for organising rules, each with its own text and background colour. Editing keeps every rule
          that carries the tag; deleting removes it from all of them.
        </p>
      </header>

      {loadError && <p role="alert">Could not load tags.</p>}

      {/* The searches sit under the sentence that says what this list is and
          ABOVE the table, so narrowing is reachable before the rows. Same control
          vocabulary as the rules and dashboard lists (`tbs-shared-search`). */}
      <div className="tbs-settings__toolbar">
        <SearchField
          testId="tags-search"
          placeholder="Search tags..."
          value={query}
          onChange={setQuery}
          ariaLabel="Search tags"
        />
        <Button
          size="sm"
          variant="primary"
          onClick={() => { setShowCreate((v) => !v); }}
          aria-expanded={showCreate}
        >
          + New Tag
        </Button>
      </div>

      {/* The BULK BAR, shown only while rows are selected — the same affordance the
          rules table puts above its own table, so "I checked some rows" has one
          consequence across the app. It sits below the search because narrowing the
          list is how a user makes a bulk delete safe, and it must be reachable
          before the destructive control rather than after it (the dashboard's
          reasoning, applied here). */}
      {selectedIds.size > 0 && (
        <div className="tbs-settings__batch-bar" role="toolbar" aria-label="Batch operations">
          <span>
            {`${String(selectedIds.size)} selected`}
            {/* The denominator is the VISIBLE set, not the whole table: selection is
                pruned to what the search left on screen (D-13), so quoting the full
                count would claim an "all selected" state the user has not reached. */}
            {selectedIds.size < visibleTags.length ? ` of ${String(visibleTags.length)}` : ''}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => { setSelectedIds(new Set()); }}
            disabled={batchProcessing}
          >
            Clear selection
          </Button>
          <Button
            size="sm"
            variant="danger"
            data-testid="tags-batch-delete"
            onClick={() => { setConfirmBatchDelete(true); }}
            disabled={batchProcessing}
          >
            {batchProcessing ? 'Processing…' : 'Delete'}
          </Button>
        </div>
      )}

      {/* The create form is a SIBLING of the table, not a row: the tag does not
          exist yet, so it has no place in an ordered list of tags (the rules
          table draws the same line with its own form). */}
      {showCreate && (
        <TagAppearanceForm
          legend="New Tag"
          submitLabel="Create Tag"
          disabled={busy}
          onSubmit={handleCreate}
          onCancel={() => { setShowCreate(false); }}
        />
      )}

      <table className="tbs-settings__table" role="table" aria-label="Tags">
        <thead>
          <tr>
            <th scope="col" style={{ width: '32px' }}>
              <input
                type="checkbox"
                checked={visibleTags.length > 0 && selectedIds.size === visibleTags.length}
                onChange={() => {
                  setSelectedIds(
                    selectedIds.size === visibleTags.length
                      ? new Set()
                      : new Set(visibleTags.map((t) => t.id)),
                  );
                }}
                aria-label="Select all tags"
              />
            </th>
            {/* The NAME column carries the tag's identity: the colour pair is
                rendered as a chip, so the columns answer "what is it" (the chip)
                and "what is it called" (the text) separately. */}
            <th scope="col">
              <button
                type="button"
                className="tbs-settings__sortable"
                onClick={toggleSort}
                aria-label="Sort by Name"
              >
                Tag {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}
              </button>
            </th>
            <th scope="col">
              <div className="tbs-settings__actions-head">
                Actions
                <button
                  type="button"
                  className="tbs-settings__sort-reset"
                  onClick={() => { setSortDir(null); }}
                  aria-label="Reset sorting"
                  title="Reset sorting"
                >
                  <ResetIcon size={14} />
                </button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleTags.map((tag) => {
            const count = referenceCount(tag.id);
            const isInspecting = inspectingIds.has(tag.id);
            const isEditing = editingIds.has(tag.id);
            return (
              <Fragment key={tag.id}>
                <tr data-testid={`tag-row-${tag.id}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tag.id)}
                      onChange={() => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(tag.id)) next.delete(tag.id);
                          else next.add(tag.id);
                          return next;
                        });
                      }}
                      aria-label={`Select tag ${tag.name}`}
                    />
                  </td>
                  <td>
                    {/* The icon IS the appearance: name on its own background in
                        its own text colour, which is the whole of what a tag
                        looks like. */}
                    <TagChip tag={tag} />
                  </td>
                  <td>
                    <div className="tbs-settings__row-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Show items using ${tag.name}`}
                        aria-expanded={isInspecting}
                        onClick={() => {
                          // Toggles THIS row's panel and touches no other row:
                          // several inspections and several edits can be open
                          // together, so no action here can silently dismiss
                          // another row's open form.
                          toggleInSet(setInspectingIds, tag.id);
                        }}
                      >
                        {/* The count rides the Show control, because it is what
                            the panel behind it contains — and it keeps C3's
                            "an orphan is legible as an orphan (0)" visible
                            without a column of its own. */}
                        {`Show (${String(count)})`}
                      </Button>
                      <IconAction
                        label={`Edit ${tag.name}`}
                        expanded={isEditing}
                        onClick={() => { toggleInSet(setEditingIds, tag.id); }}
                      >
                        <PencilIcon />
                      </IconAction>
                      <IconAction
                        label={`Delete ${tag.name}`}
                        danger
                        onClick={() => { setConfirmDelete(tag); }}
                      >
                        <TrashIcon />
                      </IconAction>
                    </div>
                  </td>
                </tr>
                {isEditing && (
                  <tr className="tbs-settings__inline-editor-row">
                    <td colSpan={3}>
                      <TagAppearanceForm
                        legend={`Edit ${tag.name}`}
                        submitLabel="Save Tag"
                        disabled={busy}
                        initial={{ name: tag.name, backgroundColor: tag.backgroundColor, textColor: tag.textColor }}
                        onSubmit={(appearance) => handleUpdate(tag.id, appearance)}
                        onCancel={() => { toggleInSet(setEditingIds, tag.id); }}
                      />
                    </td>
                  </tr>
                )}
                {isInspecting && (
                  <tr>
                    <td colSpan={3}>
                      <TagAssociations
                        tagId={tag.id}
                        rules={rules}
                        busy={busy}
                        onRedirect={(ruleId) => { onRedirectToRule(ruleId); }}
                        onUnlink={(ruleId) => { void handleUnlinkRule(ruleId, tag.id); }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {visibleTags.length === 0 && (
            <tr>
              <td colSpan={3}>
                {/* Three states, not two. `!hasLoaded` is "the read is still out",
                    which is NOT the same claim as "this machine has no tags" — the
                    second is a fact about the user's data and may only be stated
                    once it has been read. */}
                {!hasLoaded ? (
                  <p className="tbs-settings__loading" role="status" data-testid="tags-loading">
                    Loading tags…
                  </p>
                ) : tags.length === 0 ? (
                  <EmptyState
                    variant="empty"
                    message="No tags yet. Create one with + New Tag, or tag a rule from the sidebar."
                  />
                ) : (
                  <EmptyState variant="no-match" action={{ label: 'Clear search', onClick: () => { setQuery(''); } }} />
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* C4: the confirmation states the IMPACT — the rules that will lose the
          tag, not a generic "are you sure". */}
      <Confirm
        open={confirmDelete !== null}
        title={`Delete tag "${confirmDelete?.name ?? ''}"?`}
        message={
          confirmDelete
            ? (referenceCount(confirmDelete.id) > 0
                ? `This tag will be removed from ${String(referenceCount(confirmDelete.id))} ${referenceCount(confirmDelete.id) === 1 ? 'rule' : 'rules'}.`
                : 'No rules use this tag; it will simply be removed.')
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => { setConfirmDelete(null); }}
        onConfirm={() => { if (confirmDelete) void commitDelete(confirmDelete); }}
      />

      {/* C4 applied to the batch: the message states the IMPACT (how many rules lose
          a tag in total), not a generic "are you sure" — and a batch that would strip
          nothing is stated as such rather than dressed up as a risk. Names are listed
          because a bulk delete is the one place the user cannot see the rows they
          are about to lose (the list may be scrolled or filtered). */}
      <Confirm
        open={confirmBatchDelete}
        title={`Delete ${String(selectedIds.size)} selected ${selectedIds.size === 1 ? 'tag' : 'tags'}?`}
        message={(() => {
          const affected = selectedTags.reduce((sum, t) => sum + referenceCount(t.id), 0);
          const names = selectedTags.map((t) => `"${t.name}"`).join(', ');
          const impact = affected > 0
            ? `In total, they will be removed from ${String(affected)} ${affected === 1 ? 'rule' : 'rules'}.`
            : 'No rules use them; they will simply be removed.';
          return `${names}. ${impact}`;
        })()}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => { setConfirmBatchDelete(false); }}
        onConfirm={() => { void handleBatchDelete(); }}
      />

      {/* U1/T9: the SHARED stack, rendered as several stacked bars — each with
          its own Undo button (`onUndo` carries the entry id) and its own
          countdown (`onExpire` carries the id). */}
      <UndoBar
        entries={undoStack.entries}
        onUndo={(id) => { undoStack.consume(id); }}
        onExpire={(id) => { undoStack.expire(id); }}
      />

      {toast && <Toast variant={toast.variant} message={toast.message} onDismiss={() => { setToast(null); }} />}
    </section>
  );

  /**
   * C5/P3 + U6: replay ONE entry's snapshot through the EXISTING loop.
   *
   * The loop itself is unchanged (T9 keeps the existing replay loop verbatim,
   * now driven by `consume(id)`): one `RESTORE_TAG` per `tag-delete` write, one
   * `SET_RULE_TAGS` per `rule-tags` write. The surrounding side effects (busy,
   * toast, reload) stay here; the stack owns only push/consume/expire.
   */
  async function handleTagUndo(snapshot: UndoSnapshot): Promise<void> {
    setBusy(true);
    try {
      for (const write of snapshot.writes) {
        if (write.kind === 'tag-delete') {
          await sendMessage('RESTORE_TAG', { tag: write.tag, refs: write.refs });
        } else if (write.kind === 'rule-tags') {
          // The exact inverse of the unlink: write the set the rule had before.
          // `SET_RULE_TAGS` replaces the whole list, so replaying it restores the
          // relationship without needing to know which tag was removed.
          await sendMessage('SET_RULE_TAGS', { ruleId: write.ruleId, tagIds: write.previousTagIds });
        }
      }
      setToast({ variant: 'success', message: 'Tag restored' });
      await load();
    } catch {
      setToast({ variant: 'error', message: 'Could not restore the tag' });
    } finally {
      setBusy(false);
    }
  }
}

// ─── Tag appearance form (create + edit) ─────────────────────────────────────

/** The three fields a tag has. One shape, so create and edit cannot drift. */
interface TagAppearance {
  name: string;
  backgroundColor: string;
  textColor: string;
}

/**
 * The defaults a new tag starts from.
 *
 * The NAME is empty (the form's own concern) and the colours come from the shared
 * `DEFAULT_TAG_APPEARANCE` — the same pair the import uses to fill a miss, so a tag
 * created here and one created by an import cannot look different while both being
 * called "the default".
 */
const NEW_TAG_APPEARANCE: TagAppearance = {
  name: '',
  ...DEFAULT_TAG_APPEARANCE,
};

/**
 * The tag's own icon: its name drawn in its own text colour on its own background.
 *
 * This IS the tag's visual identity — there is no separate glyph to draw, because
 * a tag is a coloured label. `textColor` carries the name's colour; the outline
 * keeps a light-on-light pair (which the form permits) from vanishing against a
 * white row without silently overriding either colour the user chose.
 */
function TagChip({ tag }: { tag: TagDefinition }) {
  return (
    <span
      className="tbs-tag-chip tbs-tag-chip--swatch"
      style={{ backgroundColor: tag.backgroundColor, color: tag.textColor }}
    >
      {tag.name}
    </span>
  );
}

/**
 * The name + colours editor, shared by `+ New Tag` and per-row Edit.
 *
 * ONE component for both, because the two forms edit the same three fields and a
 * second copy is how the validation ("is this a colour") or the palette would
 * come to differ between creating and editing the same thing.
 *
 * `initial` is read ONCE (on mount) rather than on every render: the row's tag
 * object is replaced by `load()` after any write, and re-seeding from it would
 * discard whatever the user had typed since.
 */
function TagAppearanceForm({
  legend,
  submitLabel,
  disabled,
  initial,
  onSubmit,
  onCancel,
}: {
  legend: string;
  submitLabel: string;
  disabled: boolean;
  initial?: TagAppearance;
  /** Resolves to `true` when the write landed, so the form can close (or stay). */
  onSubmit: (appearance: TagAppearance) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? NEW_TAG_APPEARANCE.name);
  const [backgroundColor, setBackgroundColor] = useState(initial?.backgroundColor ?? NEW_TAG_APPEARANCE.backgroundColor);
  const [textColor, setTextColor] = useState(initial?.textColor ?? NEW_TAG_APPEARANCE.textColor);
  const [localError, setLocalError] = useState<string | null>(null);
  /**
   * "A submit is in flight", as a REF.
   *
   * `disabled` arrives from the parent's `busy` state, which only changes on the
   * next render — so two submits in the SAME tick (a double click, a second Enter)
   * both get past it and both create. A ref is synchronous, so it closes that
   * window. The service's in-write dedupe is the other half: it decides WHO wins,
   * this decides that only one is ever sent.
   */
  const submittingRef = useRef(false);

  // Mirrors the service's rules so an invalid value never reaches the write. The
  // SERVICE still validates (the UI is not the boundary); this is so the user
  // learns it from the form rather than from a round trip.
  const nameValid = isTagNameValid(name);
  const colorsValid = isTagColorValid(backgroundColor) && isTagColorValid(textColor);
  const canSubmit = nameValid && colorsValid && !disabled;

  const submit = async (): Promise<void> => {
    if (!nameValid) {
      setLocalError(`Tag names must be 1-${String(TAG_NAME_MAX)} characters.`);
      return;
    }
    if (!colorsValid) {
      setLocalError('Colours must be hex values, like #3366CC.');
      return;
    }
    if (disabled || submittingRef.current) return;
    submittingRef.current = true;
    setLocalError(null);
    try {
      // Close ONLY on success: a refused write (a duplicate name) must not discard
      // what the user typed, which is what a close-on-submit would do.
      if (await onSubmit({ name: name.trim(), backgroundColor, textColor })) {
        setName('');
        setBackgroundColor(NEW_TAG_APPEARANCE.backgroundColor);
        setTextColor(NEW_TAG_APPEARANCE.textColor);
        setLocalError(null);
      }
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="tbs-settings__rule-form" role="form" aria-label={legend}>
      <h3>{legend}</h3>
      {localError && <p role="alert" className="tbs-form-error">{localError}</p>}
      <div className="tbs-settings__rule-form-grid">
        <label className="tbs-tag-form__field">
          <span>Name</span>
          <input
            type="text"
            aria-label={`${legend} name`}
            value={name}
            maxLength={TAG_NAME_MAX}
            onChange={(e) => { setName(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          />
        </label>

        {/* The preview sits beside the two colour controls, because it shows the
            pair together — which is the thing being chosen. */}
        <div className="tbs-tag-form__preview">
          <span className="tbs-tag-form__preview-label">Preview</span>
          <TagChip tag={{ id: 'preview', name: name.trim() === '' ? 'Preview' : name, backgroundColor, textColor }} />
        </div>

        <ColorField
          label="Background Color"
          value={backgroundColor}
          presets={PRESET_BG_COLORS}
          ariaLabel={`${legend} background color`}
          onChange={setBackgroundColor}
        />
        <ColorField
          label="Text Color"
          value={textColor}
          presets={PRESET_TEXT_COLORS}
          ariaLabel={`${legend} text color`}
          onChange={setTextColor}
        />
      </div>
      <div className="tbs-settings__rule-form-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        {/* A tag that is white-on-white, or unreadable, is offered a fix rather
            than blocked: the pair is a legibility judgement the user can make
            once they can see it, and "Auto" states what it did. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setTextColor(autoTextColor(backgroundColor)); }}
        >
          Auto text colour
        </Button>
        <Button size="sm" variant="primary" onClick={() => void submit()} disabled={!canSubmit} loading={disabled}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * A native colour input plus the app's preset palette.
 *
 * The same interaction as the icon editor (`type="color"` + swatches), reusing
 * `PRESET_BG_COLORS` / `PRESET_TEXT_COLORS` so the two pickers offer one
 * vocabulary — a tag doing its own palette would be a difference with no reason
 * behind it.
 */
function ColorField({
  label,
  value,
  presets,
  ariaLabel,
  onChange,
}: {
  label: string;
  value: string;
  presets: string[];
  ariaLabel: string;
  onChange: (next: string) => void;
}) {
  // A native colour input only accepts `#RRGGBB`. A stored `#fff` is therefore
  // DISPLAYED as-is above (never rewritten) while the swatch input is seeded with
  // its expanded form, so opening the editor cannot canonicalise a value the user
  // did not touch.
  const expanded = value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
  return (
    <div className="tbs-tag-form__field">
      <span>{label}</span>
      <div className="tbs-icon-editor__colors">
        <input
          type="color"
          value={expanded}
          onChange={(e) => { onChange(e.currentTarget.value); }}
          aria-label={ariaLabel}
          className="tbs-icon-editor__color-input"
        />
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            className={`tbs-icon-editor__swatch${value.toLowerCase() === c.toLowerCase() ? ' tbs-icon-editor__swatch--active' : ''}`}
            style={{ background: c }}
            onClick={() => { onChange(c); }}
            aria-label={`${label} ${c}`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Tag associations (which items use this tag) ─────────────────────────────

/**
 * "Which items use this tag", behind the row's Show action.
 *
 * A TAB STRIP with one tab, because the rule system is currently the only tag
 * dimension. The single tab is deliberate rather than a hard-coded list: when a
 * second dimension gains tags (slots, say) it becomes a second `TabItem` and a
 * second panel — no restructuring, and the tab strip already behaves correctly
 * with one entry.
 *
 * The rule list mirrors the rules table's vocabulary (search, sortable Title,
 * reset) with ONE deliberate difference: no Priority sort. Priority orders how
 * rules COMPETE for a tab; inside "rules using this tag" it orders nothing the
 * reader is comparing, so offering it would be a control with no question behind
 * it.
 *
 * The two actions are not the same verb:
 *   - Redirect jumps to the rule on the Page Rules page (the app's one jump);
 *   - Delete removes THIS tag from that ONE rule (`SET_RULE_TAGS`), never
 *     `DELETE_TAG` — from inside "which rules use this tag", "delete" means stop
 *     using it here, and destroying the tag globally from here would be a
 *     different and much larger act than the button implies.
 */
function TagAssociations({
  tagId,
  rules,
  busy,
  onRedirect,
  onUnlink,
}: {
  tagId: string;
  rules: PageRule[];
  busy: boolean;
  onRedirect: (ruleId: string) => void;
  onUnlink: (ruleId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);

  const linked = rules.filter((r) => r.tagIds.includes(tagId));
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle === ''
      ? linked
      : linked.filter((r) =>
          (r.title ?? '').toLowerCase().includes(needle)
          || r.urlMatch.value.toLowerCase().includes(needle));
    if (sortDir === null) return matching;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...matching].sort(
      (a, b) => dir * (a.title ?? '').localeCompare(b.title ?? '', undefined, { numeric: true }),
    );
  }, [linked, query, sortDir]);

  return (
    <div className="tbs-tag-assoc" data-testid={`tag-associations-${tagId}`}>
      <Tabs
        items={[{ id: 'rule', label: 'Rules', badge: String(linked.length) }]}
        value="rule"
        onChange={() => { /* one dimension today; see the component note */ }}
        label={`Items using this tag`}
        idPrefix={`tag-assoc-${tagId}`}
      />
      <div
        className="tbs-settings__tabpanel"
        id={`tag-assoc-${tagId}-panel-rule`}
        role="tabpanel"
        aria-label="Rules using this tag"
        tabIndex={0}
      >
        {/* The search sits above the list it narrows, matching every other list
            in the app (rules, dashboard, import) rather than introducing a new
            position for the same control. */}
        <div className="tbs-settings__toolbar">
          <SearchField
            testId={`tag-assoc-search-${tagId}`}
            placeholder="Search rules..."
            value={query}
            onChange={setQuery}
            ariaLabel="Search linked rules"
          />
        </div>

        {linked.length === 0 ? (
          // C3: an orphan is stated, not left as an empty box — "nothing uses
          // this tag" is the fact the panel exists to report.
          <p className="tbs-settings__result-note">
            No rules use this tag yet. It is available to pick in any rule.
          </p>
        ) : (
          <table className="tbs-settings__table" role="table" aria-label="Rules using this tag">
            <thead>
              <tr>
                <th scope="col" style={{ width: '32px' }}>Icon</th>
                <th scope="col">
                  <button
                    type="button"
                    className="tbs-settings__sortable"
                    onClick={() => { setSortDir((prev) => (prev === null ? 'asc' : prev === 'asc' ? 'desc' : null)); }}
                    aria-label="Sort linked rules by Title"
                  >
                    Title {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}
                  </button>
                </th>
                <th scope="col">URL Pattern</th>
                <th scope="col">Priority</th>
                <th scope="col">
                  <div className="tbs-settings__actions-head">
                    Actions
                    <button
                      type="button"
                      className="tbs-settings__sort-reset"
                      onClick={() => { setSortDir(null); }}
                      aria-label="Reset linked-rule sorting"
                      title="Reset sorting"
                    >
                      <ResetIcon size={14} />
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((rule) => (
                <tr key={rule.id} data-testid={`tag-assoc-row-${tagId}-${rule.id}`}>
                  <td>
                    {/* The rule's OWN icon, rendered through the shared preview so
                        a recipe is drawn from its values rather than from its
                        materialised bitmap (R2). */}
                    <IconPreview source={previewFromIconSource(rule.favicon)} size={16} />
                  </td>
                  <td>{rule.title ?? '—'}</td>
                  <td title={rule.urlMatch.value}>
                    <code>{rule.urlMatch.type === 'regex' ? `/${rule.urlMatch.value}/` : rule.urlMatch.value}</code>
                  </td>
                  <td>{rule.priority}</td>
                  <td>
                    <div className="tbs-settings__row-actions">
                      <IconAction
                        label={`Go to rule ${rule.title ?? rule.urlMatch.value}`}
                        onClick={() => { onRedirect(rule.id); }}
                      >
                        <GoToIcon />
                      </IconAction>
                      <IconAction
                        label={`Remove this tag from rule ${rule.title ?? rule.urlMatch.value}`}
                        danger
                        disabled={busy}
                        onClick={() => { onUnlink(rule.id); }}
                      >
                        <TrashIcon />
                      </IconAction>
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState variant="no-match" action={{ label: 'Clear search', onClick: () => { setQuery(''); } }} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Inline Rule Editor (Module 2: row-level expandable editor) ─────────────

interface InlineRuleEditorProps {
  rule: PageRule;
  onSave: (
    ruleId: string,
    updates: Partial<Pick<PageRule, 'urlMatch' | 'priority' | 'title' | 'favicon' | 'enabled'>>,
    expectedUpdatedAt: string,
  ) => Promise<{ success: boolean; errorCode?: string; message?: string }>;
  onCancel: () => void;
  /**
   * The table's CURRENT column count, handed in rather than hard-coded: the
   * Tags column (D-c) changes it, and a fixed span would leave the editor's row
   * one cell short of the header the moment the column is toggled on.
   */
  colSpan?: number;
  /** G3: the live tag table, so the editor can show and change this rule's tags. */
  availableTags: TagDefinition[];
  /** G3/D-f: create a tag in place — the parent owns the one write path. */
  onCreateTag: (appearance: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>;
  /**
   * G3: write this rule's tags AFTER the rule itself saved.
   *
   * `SET_RULE_TAGS` is a separate message (A1: tags cannot reach the delivery
   * path), so it is a second write — and the ORDER matters: the rule must exist
   * before a tag can reference it. The parent owns it because it owns the tag
   * table refresh; this editor only knows which ids the user picked.
   */
  onSaveTags: (ruleId: string, tagIds: string[]) => Promise<void>;
}

/**
 * Inline edit form rendered below a rule row. Maintains its own independent
 * form state (each expanded editor is isolated). Carries the rule's `updatedAt`
 * captured at open time as `expectedUpdatedAt` for lightweight version checking.
 */
function InlineRuleEditor({ rule, onSave, onCancel, colSpan = 7, availableTags, onCreateTag, onSaveTags }: InlineRuleEditorProps) {
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
  /**
   * G3: seeded from the RULE, not from the tag table.
   *
   * A rule's tags are its own stored state, so the editor opens showing what the
   * rule currently carries. Reading them from `rule.tagIds` (rather than from
   * "which tags point back at this rule") also means an id whose tag was deleted is
   * still submitted back unchanged — the editor does not silently drop a reference
   * the user never touched.
   */
  const [tagIds, setTagIds] = useState<string[]>(rule.tagIds);
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
    // G3: the tags are a SECOND write, and only after the rule landed — a tag
    // reference to a rule that does not exist yet would be the C7 broken state.
    // A failure here does NOT roll the rule back: tags are an organising
    // dimension and do not affect delivery, so losing them is a smaller harm than
    // discarding an edit the user made to the rule itself. It is reported instead
    // of swallowed (D-f: the write never happens silently).
    await onSaveTags(rule.id, tagIds);
    setStatus('idle');
    setError(null);
    onCancel();
  }, [url, matchType, titleMode, iconMode, iconConfig, priority, enabled, rule.id, expectedUpdatedAt, onSave, onCancel, tagIds, onSaveTags]);

  return (
    <InlineEditorShell
      colSpan={colSpan}
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
          tagIds,
        }}
        onChange={(patch) => {
          if (patch.url !== undefined) setUrl(patch.url);
          if (patch.matchType !== undefined) setMatchType(patch.matchType);
          if (patch.titleMode !== undefined) setTitleMode(patch.titleMode);
          if (patch.iconMode !== undefined) setIconMode(patch.iconMode);
          if (patch.iconConfig !== undefined) setIconConfig(patch.iconConfig);
          if (patch.priority !== undefined) setPriority(patch.priority);
          if (patch.enabled !== undefined) setEnabled(patch.enabled);
          if (patch.tagIds !== undefined) setTagIds(patch.tagIds);
        }}
        // G3: the tag table and the create-in-place hook, so this editor edits
        // tags the same way the sidebar modal does — one shared field set.
        availableTags={availableTags}
        onCreateTag={onCreateTag}
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
  /**
   * The tag-table snapshot this section filters against. `tags` is read here (not
   * passed down) because the expression must resolve names AND detect a deleted
   * reference, and both are facts about THIS machine's live table.
   */
  const [tags, setTags] = useState<TagDefinition[]>([]);
  /** D0/C6/C7: the chip-expression filter. `[]` = no expression yet. */
  const [tagExpression, setTagExpression] = useState<ChipToken[]>([]);
  /**
   * D-c: whether the Tags column is shown. Default OFF, and OFF means the column
   * is NOT RENDERED — eight tag chips would otherwise squeeze out URL Pattern,
   * the highest-density column in the table. The reason is structural, not
   * aesthetic, which is why "not in the DOM" is the assertion.
   */
  const [showTagsColumn, setShowTagsColumn] = useState(false);
  /**
   * The expression as a STABLE KEY for the D-13 prune dependency: two equal chip
   * sequences produce the same string, so re-renders that rebuild the array do
   * not re-run the prune.
   */
  const tagFilterKey = JSON.stringify(tagExpression);

  // Load rules from background (D-15: a failure becomes a non-blocking error state).
  const loadRules = useCallback(async () => {
    try {
      const res = await sendMessage('GET_STATE');
      const result = extractResult(res);
      if (result?.success && (result.sync as Record<string, unknown>)?.rules) {
        setRules((result.sync as { rules: PageRule[] }).rules);
        // D0: the tag table, from the SAME snapshot — the expression resolves
        // against it and a deleted reference is detected against it.
        setTags((result.sync as { tags?: TagDefinition[] }).tags ?? []);
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

  /**
   * G5/D-b: create a tag from the expression filter's chip input.
   *
   * Uses the SAME `CREATE_TAG` message every other create-in-place surface uses
   * (`TagsSection` above, the sidebar's rule modal) — the requirement is that a
   * tag created anywhere is indistinguishable from one created on the manage
   * page, so there is one write path and no second dialect of "new tag".
   *
   * This was a STUB (`async () => null`) until now, which is the worst of the
   * three possible states: worse than not offering the control, because the
   * create row appears EXACTLY when the typed name matches no existing tag — so
   * the user is looking at "Create tag X" at the moment it silently does nothing.
   *
   * The tag is NOT rolled back if the expression is then cleared: the same D-f
   * outcome the sidebar documents (it becomes an orphan, visible on the Tags
   * page). Cancelling a filter is not a reason to delete a tag the user named.
   */
  const handleCreateTag = useCallback(async (appearance: { name: string; backgroundColor: string; textColor: string }): Promise<TagDefinition | null> => {
    try {
      // The appearance comes from the caller, not from a constant here: the
      // sidebar's selector offers both colours, so a tag made from a rule form is
      // the same object as one made on the Tags page.
      const res = await sendMessage('CREATE_TAG', {
        name: appearance.name,
        backgroundColor: appearance.backgroundColor,
        textColor: appearance.textColor,
      });
      const result = extractResult(res);
      if (result?.success && result.tag) {
        // Refresh on the section's OWN channel: `loadRules` re-reads the rules
        // AND the tag table from ONE snapshot, so the new tag both appears as a
        // candidate chip and resolves as an expression operand. `TagExpressionInput`
        // appends the created chip from the returned value, so the two agree.
        await loadRules();
        return result.tag as TagDefinition;
      }
      setToast({ variant: 'error', message: (result?.message as string) || 'Could not create the tag' });
      return null;
    } catch {
      setToast({ variant: 'error', message: 'Could not create the tag' });
      return null;
    }
  }, [loadRules]);

  /**
   * G3: write a rule's tags — the SECOND half of saving a rule, on both the create
   * and the edit path.
   *
   * `SET_RULE_TAGS` rather than a field on the rule: tags travel in their own
   * message (A1) so they cannot reach the delivery path. It is called only after
   * the rule write succeeded, because a tag reference needs its rule to exist.
   *
   * A failure is reported and NOT rolled back — the same D-f outcome the sidebar
   * documents: tags are an organising dimension, so losing them is a smaller harm
   * than discarding the rule the user just saved.
   */
  const handleSaveTags = useCallback(async (ruleId: string, tagIds: string[]): Promise<void> => {
    try {
      const res = await sendMessage('SET_RULE_TAGS', { ruleId, tagIds });
      const result = extractResult(res);
      if (result && result.success === false) {
        setToast({ variant: 'error', message: (result.message as string) || 'Could not save the rule\'s tags' });
        return;
      }
      // Re-read on the section's own channel so the Tags column and the tag
      // reference counts reflect the write without a manual refresh.
      void loadRules();
    } catch {
      setToast({ variant: 'error', message: 'Could not save the rule\'s tags' });
    }
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
        // G3: the tags go in AFTER the rule exists. `createRule` returns the new
        // rule, so its id is what the tag write targets — without it there would be
        // nothing to reference and the selection would be silently dropped.
        const createdId = (result.rule as { id?: string } | undefined)?.id;
        if (createdId) await handleSaveTags(createdId, form.tagIds);
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

  // C6/C7: the expression's decision, computed ONCE and shared by the filter and
// the notice. `applied` depends only on the chips and the tag table (never on a
// rule), so the notice and the list cannot disagree about whether filtering is
// happening — which is exactly the kind of two-source drift a single computation
// prevents.
  const expressionState = evaluateExpression(tagExpression, new Set<string>(), tags);

  const filteredRules = (() => {
    const matching = rules.filter((r) =>
      r.urlMatch.value.toLowerCase().includes(search.toLowerCase()) ||
      (r.title ?? '').toLowerCase().includes(search.toLowerCase())
    );
    // The expression is a SECOND, independent filter (G6). It applies ONLY when
    // `applied`: an incomplete/empty expression or a reference to a deleted tag
    // means "do not filter", which shows EVERYTHING rather than nothing (C6/C7 —
    // the rejected failure mode was filtering to an empty list).
    const byExpression = expressionState.applied
      ? matching.filter((r) => evaluateExpression(tagExpression, new Set(r.tagIds), tags).matched)
      : matching;
    if (!sort) return byExpression;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...byExpression].sort((a, b) => dir * compareRules(a, b, sort.key));
  })();

  // D-13 (default (a) AUTO-PRUNE): a selection must never outlive visibility.
  // "What you see is what you operate on" — a hidden id is removed from the
  // selection whenever the visible set changes.
  //
  // `tagFilterKey` is the EXPRESSION's input to this effect: a filter that can
  // hide rows IS a visibility input, so leaving it out would let a selected row
  // survive while the expression hides it — exactly the state D-13 exists to
  // prevent (R1). The key is a STRING (the chip sequence serialised) rather than
  // the chips array, so a re-render that rebuilds an equal array does not re-run
  // the prune for no reason.
  useEffect(() => {
    const visible = new Set(filteredRules.map((r) => r.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, rules, tagFilterKey]);

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

      {/* G6: the chip expression filter, BESIDE the text search. They answer
          different questions — the expression asks "which tags?", the search
          looks for a literal — so neither replaces the other. T15 adds the
          pause messages and the Tags column on top of this control. */}
      <TagExpressionInput
        chips={tagExpression}
        onChange={setTagExpression}
        availableTags={tags}
        // G5/D-b: creating a tag from here writes it like every other surface.
        // The control used to be wired to a stub, so "Create tag X" appeared and
        // then did nothing — a dead control wearing the one label that promises
        // a write.
        //
        // The FILTER box only knows a NAME (there is no colour picker in a filter
        // bar), so it supplies the house default rather than pretending to ask.
        // The rule-form selector, which does offer both colours, passes its own.
        onCreateTag={(name) => handleCreateTag({
          name,
          ...DEFAULT_TAG_APPEARANCE,
        })}
      />

      {/* C6 / C7: the expression is NOT filtering, and WHY differs.
          They are two notices because they say different things and are fixed
          differently — merging them loses the one piece of information that
          makes the paused state diagnosable. */}
      {!expressionState.applied && (
        expressionState.missingTagIds.length > 0 ? (
          // C7: a complete expression referencing a DELETED tag. It NAMES the
          // tags, using each chip's insert-time name (the live table cannot name
          // something it no longer has — D2).
          <p className="tbs-settings__tag-notice tbs-settings__tag-notice--missing" data-testid="tag-filter-notice" role="status">
            {`The expression uses ${expressionState.missingTagIds
              .map((id) => {
                const chip = tagExpression.find((c) => c.kind === 'tag' && c.tagId === id);
                return chip && chip.kind === 'tag' ? `"${resolveChipDisplayName(chip, tags)}"` : `"${id}"`;
              })
              .join(', ')} — already deleted, so nothing is filtered. Adjust the expression.`}
          </p>
        ) : (
          // C6: incomplete or empty — the user is mid-edit. It names NOTHING,
          // because there is nothing to name and a name here would read as a
          // problem with a tag rather than with the expression.
          <p className="tbs-settings__tag-notice" data-testid="tag-filter-notice" role="status">
            {tagExpression.length === 0
              ? 'No tag filter — showing all rules.'
              : 'The expression is incomplete, so nothing is filtered. Finish it to narrow the list.'}
          </p>
        )
      )}

      <div className="tbs-settings__toolbar">
        {/* The shared search box. It was a hand-rolled `type="text"` input here —
        the one site the consolidation missed (every other box was found by
        searching for `type="search"`), so this toolbar had a box without the clear
        button and without the keyboard focus ring. */}
        <SearchField
          placeholder="Search rules..."
          value={search}
          onChange={setSearch}
          ariaLabel="Search rules"
        />
        {/* D-c: the Tags column's show/hide control.
            
            It was a 20px square carrying `⊘` and nothing else. Two problems, both
            reported: a glyph is not a label (the accessible name lived only in
            `aria-label`, so a sighted user saw a symbol they had to guess at), and
            a 20px target is below the density floor this table is built to. It is a
            normal small button now, whose TEXT states the state — the same
            convention as the batch bar's Enable/Disable, and unlike an icon it
            cannot be misread. */}
        <Button
          size="sm"
          variant="secondary"
          data-testid="rules-tags-column-toggle"
          aria-pressed={showTagsColumn}
          onClick={() => { setShowTagsColumn((v) => !v); }}
        >
          {showTagsColumn ? 'Hide Tags column' : 'Show Tags column'}
        </Button>
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
              tagIds: form.tagIds,
            }}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            // G3: the tag table and the create-in-place hook — the SAME two props
            // the sidebar modal passes, so "which tags does this rule carry" is one
            // control on every surface that asks it.
            availableTags={tags}
            onCreateTag={handleCreateTag}
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
            {/* D-c: rendered ONLY when toggled on — not rendered-and-empty. Tags
                is not a rule property, so unlike every other column it is NOT
                sortable; giving it a sort control would offer an ordering the
                table does not have. */}
            {showTagsColumn && (
              <th scope="col" data-testid="rules-col-tags">Tags</th>
            )}
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
                  <ResetIcon size={14} />
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
                {showTagsColumn && (
                  <td data-testid={`rule-tags-${rule.id}`}>
                    {rule.tagIds.length === 0 ? '—' : rule.tagIds.map((id) => {
                      const tag = tags.find((t) => t.id === id);
                      // A deleted reference keeps its cell (C7: no auto-removal)
                      // and names itself as the chip's insert-time name would.
                      return (
                        <span
                          key={id}
                          className="tbs-tag-chip"
                          style={tag ? { backgroundColor: tag.backgroundColor } : undefined}
                          title={tag ? tag.name : 'deleted tag'}
                        >
                          {tag ? tag.name : id}
                        </span>
                      );
                    })}
                  </td>
                )}
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
                    <IconAction
                      label={`Edit rule ${rule.id}`}
                      expanded={expandedRuleIds.has(rule.id)}
                      onClick={() => { toggleExpand(rule.id); }}
                    >
                      <PencilIcon />
                    </IconAction>
                    <IconAction
                      label={`Delete rule ${rule.title ?? rule.urlMatch.value}`}
                      danger
                      onClick={() => { setConfirmDeleteId(rule.id); }}
                    >
                      <TrashIcon />
                    </IconAction>
                  </div>
                </td>
              </tr>
              {/* Module 2: inline editor expands directly below the row */}
              {expandedRuleIds.has(rule.id) && (
                <InlineRuleEditor
                  rule={rule}
                  onSave={handleInlineSave}
                  onCancel={() => { toggleExpand(rule.id); }}
                  colSpan={showTagsColumn ? 8 : 7}
                  // G3: this editor edits tags too — the same shared control the
                  // New Rule form and the sidebar modal render, so "which tags does
                  // this rule carry" is answered identically on all three.
                  availableTags={tags}
                  onCreateTag={handleCreateTag}
                  onSaveTags={handleSaveTags}
                />
              )}
            </Fragment>
          ))}
          {filteredRules.length === 0 && (
            <tr>
              {/* The empty state must span the columns that are ACTUALLY shown:
                  a hard-coded 7 would under-span (leaving a gap) once the Tags
                  column appears. */}
              <td colSpan={showTagsColumn ? 8 : 7}>
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

/**
 * Human names for the three Sources a dashboard row can have.
 *
 * The badge on each row shows `entry.label`, which is "Tab 12" / "Slot 3" — an
 * IDENTITY, not a source. A filter that offered those would be a filter over
 * ids, so the three kinds are named for what they actually are.
 */
const SOURCE_LABELS: Record<DashboardEntry['kind'], string> = {
  override: 'This Page',
  slot: 'Slot',
  'rule-hit': 'Rule',
};

/**
 * The order the Source filter lists what it found: the actions a user TAKES,
 * then the configurations they SET, then what a rule decides for them.
 *
 * Module-level (not per-render) so the filter's option list is stable — a value
 * rebuilt inside the component would be a new array on every render, which is
 * what made it an unstable hook dependency.
 */
const SOURCE_FILTER_ORDER: ReadonlyArray<DashboardEntry['kind']> = [
  'override', 'slot', 'rule-hit',
];

function sourceLabel(kind: DashboardEntry['kind']): string {
  return SOURCE_LABELS[kind];
}

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
  /** Substring match over the row's Title / Source / URL. `''` = no search. */
  const [query, setQuery] = useState('');
  /** `'any'` = every Source; otherwise a `DashboardEntry['kind']`. */
  const [sourceFilter, setSourceFilter] = useState<DashboardEntry['kind'] | 'any'>('any');
  /** IMP-4: per-row drafts so several rows can be edited simultaneously. */
  const [drafts, setDrafts] = useState<Map<string, DashboardEditForm>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showUrl, setShowUrl] = useState(false);
  /** D-20: destructive reset is confirmed. */
  const [confirmReset, setConfirmReset] = useState<{ kind: 'entry'; id: string } | { kind: 'all' } | { kind: 'selected' } | null>(null);
  /**
   * IMP-6/DT9 + U4 (T10): the generalized atomic undo for an immediate Clear,
   * on the SHARED stack. `client` entries only — the snapshot lives in the UI
   * and the replay loop is kept verbatim (`handleUndo`), now driven by
   * `consume(id)`. Several Clears now stack instead of overwriting (U1/U6).
   */
  const undoStack = useUndoStack({
    onReplay: (entry) => {
      if (entry.replay === 'client') return handleUndo(entry.snapshot);
      return undefined;
    },
  });
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

  /**
   * What the search box matches, and the ONE place that list is built.
   *
   * Deliberately NOT regex or fuzzy: the user is looking for a page they
   * recognise, and here a surprising match is worse than a missed one — the
   * row's Clear is destructive, so a row the filter wrongly kept is a row the
   * user may bulk-clear by accident.
   *
   * Title means the text the row actually DISPLAYS (`chain.title.winner.value`),
   * not `label` — `label` is the source badge ("Tab 12", "Slot 3"), which would
   * make "title search" report the wrong column.
   */
  const matchesQuery = useCallback((entry: DashboardEntry, needle: string): boolean => {
    if (needle === '') return true;
    const haystack = [
      entry.chain.title.winner.value ?? '',
      entry.label,
      entry.url ?? '',
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  }, []);

  /** Filter first, then the sort order applies to what survived. */
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortedEntries.filter((e) => matchesQuery(e, needle));
  }, [sortedEntries, query, matchesQuery]);

  /**
   * The rows on screen: the search plus the Source filter.
   *
   * This is THE list — the header select-all, the row loop and the "showing N of
   * M" count all read it, so a control can never act on a different set from the
   * one the user is looking at (N8).
   */
  const visibleEntries = useMemo(
    () => (sourceFilter === 'any'
      ? filteredEntries
      : filteredEntries.filter((e) => e.kind === sourceFilter)),
    [filteredEntries, sourceFilter],
  );

  /** The Source values that actually occur, in a stable order. */
  const availableSources = useMemo(
    () => SOURCE_FILTER_ORDER.filter((kind) => entries.some((e) => e.kind === kind)),
    [entries],
  );

  const isFiltering = query.trim() !== '' || sourceFilter !== 'any';

  /**
   * Selection is narrowed to what is ON SCREEN whenever the filter changes.
   *
   * Same rule (and the same failure it prevents) as the rules table below: a
   * selection that outlives the rows it named desyncs the header checkbox — it
   * compares `selected.size` with the VISIBLE count, so a hidden-but-selected row
   * left the box drawn unchecked while every visible row was ticked, and clicking
   * it then silently dropped the hidden ones. Narrowing here is also the safer
   * direction for a destructive action: the user can only ever clear what they
   * could see.
   *
   * The early returns keep this from re-rendering on every unrelated pass — a
   * no-op filter must not churn `selected` and re-render the whole table.
   */
  useEffect(() => {
    const onScreen = new Set(visibleEntries.map((e) => e.id));
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) if (onScreen.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleEntries]);

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

  /**
   * Clear the SHOWN rows — the same list the table draws, so the count in the
   * button's own label is the number of rows this will act on.
   *
   * The scope is `visibleEntries`, not `entries`: a row hidden by the search or
   * the Source filter must survive. The previous version wrote every fetch of
   * `entries`, which meant clicking this with an empty filtered list destroyed
   * the whole panel — the exact opposite of what the user was looking at.
   */
  const clearShown = async () => {
    setBusy(true);
    try {
      for (const entry of visibleEntries) {
        if (entry.kind === 'override' && entry.tabId != null) {
          await sendMessage('REMOVE_TAB_OVERRIDE', { tabId: entry.tabId });
        } else if (entry.kind === 'slot' && entry.slotId != null) {
          await sendMessage('UPDATE_SLOT_UI_MARKER', {
            slotId: entry.slotId,
            uiMarker: { customTitle: '', icon: null },
          });
        }
      }
      setToast({ variant: 'success', message: 'Shown items cleared' });
      setSelected(new Set());
      void load();
    } catch {
      setToast({ variant: 'error', message: 'Failed to clear the shown items' });
    } finally {
      setBusy(false);
      setConfirmReset(null);
    }
  };

  const resetSelected = async () => {
    setBusy(true);
    try {
      // Also scoped to the visible rows: the selection is pruned to that set, so
      // this is normally the same thing — but reading the same list here means a
      // stale id can never be acted on off screen.
      for (const entry of visibleEntries) {
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
      // IMP-6 / DT9: offer the atomic undo for the removed value. U4/T10: pushed
      // onto the SHARED stack, so two rows cleared in a row give two bars.
      undoStack.push({
        replay: 'client',
        message: field === 'title' ? `${entry.label} title cleared` : `${entry.label} icon cleared`,
        snapshot: {
          writes: (entry.kind === 'override' || entry.kind === 'rule-hit') && entry.tabId != null
            ? [{ kind: 'tab-override', tabId: entry.tabId, ...(field === 'title' ? { title: previous } : { favicon: previousIconSource }) }]
            : entry.slotId != null
              ? [{ kind: 'slot-marker', slotId: entry.slotId, ...(field === 'title' ? { customTitle: previous } : { icon: previousIconSource }) }]
              : [],
          affectedTabIds: entry.tabId != null ? [entry.tabId] : [],
        },
        // T2/T10: the hardcoded 5000 is replaced by the shared constant.
        expiresAt: Date.now() + UNDO_DEFAULT_MS,
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

  /**
   * IMP-6 / DT9 + U6: replay ONE entry's snapshot through the EXISTING loop.
   *
   * The loop itself is unchanged (T10 drives the existing loop by `consume(id)`),
   * now reached via the shared stack. The surrounding side effects (busy,
   * toast, reload) stay here.
   */
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
        title={confirmReset?.kind === 'all' ? 'Clear shown items?' : 'Clear selection?'}
        // The count is the SCOPE, stated before the click — and it is the count of
        // SHOWN rows, because that is what the button acts on.
        message={confirmReset?.kind === 'all'
          ? `${String(visibleEntries.length)} ${visibleEntries.length === 1 ? 'item' : 'items'} shown will have the values this layer owns removed. Lower layers will decide again, and the pages fall back to their site values.`
          : 'The values this layer owns will be removed. Lower layers will decide again, and the page falls back to the site value.'}
        confirmLabel="Clear"
        variant="danger"
        onCancel={() => { setConfirmReset(null); }}
        onConfirm={() => {
          const which = confirmReset;
          setConfirmReset(null);
          if (which?.kind === 'all') void clearShown();
          else if (which?.kind === 'selected') void resetSelected();
          else if (which?.kind === 'entry') {
            const entry = entries.find((e) => e.id === which.id);
            if (entry) void resetEntry(entry);
          }
        }}
      />

      {/* The searches sit directly under the sentence that says what this list
          is, and ABOVE the bulk actions: narrowing the list is how a user makes
          a bulk Clear safe, so it must be reachable before the buttons rather
          than after them. Same control vocabulary as the import/export record
          lists (`tbs-shared-search` + `tbs-settings__filter-select`). */}
      <div className="tbs-settings__toolbar" role="group" aria-label="Filter dashboard items">
        <SearchField
          testId="dashboard-search"
          placeholder="Search title or Match URL"
          value={query}
          onChange={setQuery}
          ariaLabel="Search dashboard items"
        />
        <select
          className="tbs-settings__filter-select"
          data-testid="dashboard-source-filter"
          value={sourceFilter}
          aria-label="Filter by Source"
          onChange={(e) => { setSourceFilter(e.currentTarget.value as DashboardEntry['kind'] | 'any'); }}
        >
          <option value="any">Any Source</option>
          {availableSources.map((kind) => (
            <option key={kind} value={kind}>{sourceLabel(kind)}</option>
          ))}
        </select>
      </div>

      {/* G1: a summary sentence when rows exist but none can be applied here. */}
      {summary && (
        <p className="tbs-settings__summary" role="status">{summary}</p>
      )}

      {/* "Showing N of M" only while a filter is on. Every bulk action here is
          scoped to the VISIBLE rows, so the size of what the filter hid has to be
          visible BEFORE the click rather than inferred after it. */}
      {isFiltering && (
        <p className="tbs-settings__filter-count" role="status" data-testid="dashboard-filter-count">
          {visibleEntries.length === entries.length
            ? `Showing all ${String(entries.length)} items`
            : `Showing ${String(visibleEntries.length)} of ${String(entries.length)} items`}
        </p>
      )}

      <div className="tbs-settings__toolbar">
        <Button size="sm" variant="secondary" onClick={() => { setConfirmReset({ kind: 'selected' }); }} disabled={selected.size === 0 || busy} aria-label="Clear selected items">
          Clear Selected ({selected.size})
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => { setConfirmReset({ kind: 'all' }); }}
          // The SHOWN rows, and the label says so: the count in the button is the
          // number of rows this will act on, so with a filter that hides
          // everything the button reads "Clear Shown (0)" and is DISABLED rather
          // than sitting there as a way to wipe the whole panel. A name that said
          // "All" could not be honest about that scope — see `clearShown`.
          disabled={visibleEntries.length === 0 || busy}
          aria-label="Clear shown items"
        >
          {`Clear Shown (${String(visibleEntries.length)})`}
        </Button>
      </div>

      <table className="tbs-settings__table" role="table" aria-label="Set icons and titles">
        <thead>
          <tr>
            <th scope="col" style={{ width: '32px' }}>
              <input
                type="checkbox"
                // N8: the header select-all is derived from the SAME list the rows
                // use — including the filter, so it never selects a row the user
                // cannot see. Both halves are guarded on that list being non-empty
                // so a filter that hides everything cannot (a) draw the box as
                // "all selected" from a stale `selected`, or (b) be clicked into
                // an arbitrary toggle of the previous selection.
                checked={visibleEntries.length > 0 && selected.size === visibleEntries.length}
                disabled={visibleEntries.length === 0}
                onChange={() => {
                  if (visibleEntries.length === 0) return;
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
                  <ResetIcon size={14} />
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
                      {/* D-9: the label is the readable name, not the internal id.
                          It is ALSO the tooltip now — an icon-only control has no
                          visible text, so the name has to be stated somewhere the
                          user can reach; `IconAction` keeps it in `aria-label`,
                          the styled tooltip and `title` from one prop, so the
                          sighted label and the announced one cannot drift.

                          These were the last two TEXT row-actions in the app (the
                          Tags, association and rule tables already draw icons),
                          which made the Dashboard the one place where the same
                          Edit/Remove pair read differently. Same pencil and bin,
                          same `danger` colour for the destructive one. */}
                      <IconAction
                        label={`Edit ${entry.label}`}
                        disabled={busy}
                        onClick={() => { openEdit(entry); }}
                      >
                        <PencilIcon />
                      </IconAction>
                      <IconAction
                        label={`Clear ${entry.label}`}
                        danger
                        disabled={busy}
                        onClick={() => { setConfirmReset({ kind: 'entry', id: entry.id }); }}
                      >
                        <TrashIcon />
                      </IconAction>
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

      {/* IMP-6/DT9 + U1/T10: the generalized undo bars for immediate Clears — the
          SHARED stack, one bar per entry, each with its own Undo and countdown. */}
      <UndoBar
        entries={undoStack.entries}
        onUndo={(id) => { undoStack.consume(id); }}
        onExpire={(id) => { undoStack.expire(id); }}
      />

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
    slots: false, rules: false, settings: false, shortcuts: false, tags: false,
  });
  /** T19-C: per-record deselection inside a selected dimension (D1). */
  const [excludedSlots, setExcludedSlots] = useState<number[]>([]);
  const [excludedRules, setExcludedRules] = useState<string[]>([]);
  /** The settings PARTS the user left out (see `ExportScope`). */
  const [excludedSettings, setExcludedSettings] = useState<string[]>([]);
  /** Shortcut bindings (by command name) the user left out. */
  const [excludedShortcuts, setExcludedShortcuts] = useState<string[]>([]);
  /**
   * Tags (by NAME — a package's tag identity is its name, A4) the user left out.
   *
   * The per-tag picker that FILLS this is T17's; the state and its subtract-only
   * shape (mirroring `excludedSlotIds`, R24) are established here so the export
   * scope is complete and `excludedTagNames` exists on the request from the
   * start. T17 wires the control that writes it.
   */
  const [excludedTags, setExcludedTags] = useState<string[]>([]);
  /**
   * The export tag picker's own search.
   *
   * A vocabulary is a vocabulary: it can be long, and scanning a row of chips for
   * one name is the same problem every other list here already solved with a
   * search box. Filtering is by NAME only — that is the tag's identity (A4), and a
   * colour is not something a user searches by.
   */
  const [tagQuery, setTagQuery] = useState('');
  /**
   * D-e: the pending self-consistency decision, or null. Holds the computed
   * difference object itself, so the dialog renders the SAME value the gate
   * tested (one source for both).
   */
  const [consistencyChoice, setConsistencyChoice] = useState<ExportSelfConsistency | null>(null);
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
    tags: TagDefinition[];
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
            tags?: TagDefinition[];
            matchSettings?: MatchRuleSettings;
            switchDirection?: SwitchDirection;
            autoBindGlobal?: boolean;
          } | undefined)
        : undefined;
      setRecords({
        slots: sync?.slots ?? [],
        rules: sync?.rules ?? [],
        // D0: the vocabulary, for the export picker's per-tag unticking. Read
        // from the SAME GET_STATE snapshot the other records come from, so the
        // panel never assembles a second view of the machine.
        tags: sync?.tags ?? [],
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

  /**
   * The tags the picker is showing.
   *
   * ONE derivation, used by the rows AND by the select-all: the control is a view
   * of the visible rows (the rule every filtered list here follows), so a filtered
   * select-all cannot silently include the chips the user cannot see.
   */
  const visibleTags = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase();
    const all = records?.tags ?? [];
    return needle === '' ? all : all.filter((t) => t.name.toLowerCase().includes(needle));
  }, [records, tagQuery]);

  const scope: ExportScope = {
    slots: checked.slots, rules: checked.rules, settings: checked.settings, shortcuts: checked.shortcuts,
    // D0: the fifth dimension. `checked.tags` / `excludedTags` are supplied by
    // the tags picker (T17); the scope SHAPE is completed here so the export
    // path type-checks and the dimension is not silently absent.
    tags: checked.tags,
    excludedSlotIds: excludedSlots, excludedRuleIds: excludedRules,
    excludedSettingIds: excludedSettings, excludedShortcutNames: excludedShortcuts,
    excludedTagNames: excludedTags,
  };

  /**
   * Tick/untick one record, part or binding.
   *
   * The `allSelected` flag is passed IN rather than derived from the exclusion
   * array: the list filters rows, so "all" means "all currently visible". The
   * exclusion array must still be filled with the rows the user cannot see,
   * otherwised a filtered select-all would silently include them.
   */
  const toggleExcluded = (kind: 'slot' | 'rule' | 'setting' | 'shortcut' | 'tag', id: number | string) => {
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
      case 'tag':
        // A5: keyed by NAME — a package's tag identity is its name (A4), so a
        // name is what the exclusion list must address.
        setExcludedTags((prev) =>
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
      const parsed = JSON.parse(pkg) as { slots?: unknown[]; rules?: unknown[]; settings?: unknown; shortcuts?: unknown; tags?: unknown[] };
      return {
        slots: parsed.slots?.length ?? 0,
        rules: parsed.rules?.length ?? 0,
        settings: parsed.settings ? 1 : 0,
        shortcuts: parsed.shortcuts ? 1 : 0,
        // The vocabulary is a PART: a carried-but-empty list is still "carried",
        // so the count is the number of entries (0 is a real answer here).
        tags: parsed.tags?.length ?? 0,
      };
    } catch {
      return null;
    }
  })();

  /**
   * D-e/A-f: the self-consistency check that runs BEFORE the package is created.
   *
   * The difference is computed from the SAME construction the export uses
   * (`syncStateToPackage` on this machine's snapshot + the chosen scope), and the
   * dialog's text and options are rendered from THAT array — so the wording
   * cannot drift from the decision it describes. An empty difference means the
   * export proceeds silently; a non-empty one raises the dialog.
   */
  const selfConsistency = records === null
    ? null
    : computeExportSelfConsistency(
        syncStateToPackage(
          {
            configVersion: 0,
            matchSettings: records.matchSettings,
            switchDirection: records.switchDirection,
            autoBindGlobal: records.autoBindGlobal,
            slots: records.slots,
            rules: records.rules,
            tags: records.tags,
          },
          scope,
        ),
        records.tags,
      );

  const handleExport = async () => {
    // Gate on the difference: a real inconsistency is a decision the user must
    // make, so it is raised instead of being silently resolved either way.
    if (selfConsistency && selfConsistency.diff.length > 0) {
      setConsistencyChoice(selfConsistency);
      return;
    }
    // No flag: the ordinary export carries each rule's names as they are, which is
    // what makes the difference DETECTABLE at all. Passing `false` explicitly would
    // read as "resolve it for me", and the gate above has already established there
    // is nothing to resolve.
    await doExport({ ...scope });
  };

  /**
   * Build the package.
   *
   * `scopeOverride` exists for the D-e dialog, whose two answers are scope
   * DECISIONS: their `setState` calls do not change `scope` until React re-renders,
   * so an export that read the state would build the package the user did not
   * choose. Passing the decision through makes the choice the thing that is
   * exported, and keeps the ordinary button (no argument) reading the live scope.
   */
  const doExport = async (scopeOverride?: ExportScope) => {
    setExporting(true);
    setPkg(null);
    try {
      const res = await sendMessage('EXPORT_PACKAGE', { scope: scopeOverride ?? scope });
      const result = extractResult(res);
      if (result?.success && result.package) setPkg(result.package as string);
    } finally {
      setExporting(false);
    }
  };

  /**
   * D-e's two options. BOTH just change the scope and re-export:
   *  - supplement: put the missing tags back into the vocabulary (their colour
   *    comes from the LOCAL entity — the export side has one);
   *  - drop: leave them out, which costs the named rules their tags.
   * Neither is defaulted, because an accidental Enter would either push extra
   * definitions into a recipient's machine or quietly strip tags from the user's
   * own rules.
   */
  const resolveConsistency = async (choice: 'supplement' | 'drop') => {
    setConsistencyChoice(null);
    if (choice === 'drop') {
      // "Leave them out": ship the rules as they are, orphan references included.
      //
      // This used to fall through to a plain re-export, which the projection then
      // made self-consistent anyway — so the two buttons produced the SAME file and
      // the difference the dialog had just described was not implemented anywhere.
      // The flag is the difference.
      await doExport({ ...scope, stripOrphanTagNames: true });
      return;
    }
    // "Include them": un-exclude exactly the difference's names...
    const nextExcluded = excludedTags.filter((n) => !(selfConsistency?.diff ?? []).includes(n));
    setExcludedTags(nextExcluded);
    // ...and export with THAT scope. Passing it explicitly rather than letting the
    // export read state is what makes the repair real: `setExcludedTags` does not
    // update `scope` until React re-renders, so the previous version re-exported the
    // OLD exclusion list and the missing tags stayed missing. The call looked like
    // it worked because the dialog closed.
    await doExport({ ...scope, excludedTagNames: nextExcluded });
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
    // Tags ARE a countable list of things being chosen, so the card states how
    // many the current selection would SHIP — live, because the number the user
    // needs is "how many am I sending", not "how many exist". It changes as chips
    // are unticked or excluded by the self-consistency dialog.
    if (dim === 'tags') {
      if (!checked.tags) return records?.tags.length ?? 0;
      return (records?.tags ?? []).filter((t) => !excludedTags.includes(t.name)).length;
    }
    // `settings` / `shortcuts` deliberately report `null`: settings carries a fixed
    // bundle of values rather than a countable list, and shortcuts has no producer.
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

      {/* D0/A5: the tag vocabulary, listed PER TAG so a user can share their
          rules without shipping a label they did not mean to. Keyed by NAME —
          a package has no tag ids (A4). Unticking a tag the exported rules
          reference is what creates the difference the export dialog then
          explains. */}
      {checked.tags && records !== null && (
        <section className="tbs-settings__pick-detail" data-testid="export-records-tags">
          <h4 className="tbs-settings__pick-detail-title">Tags to include</h4>
          {/* Search + select-all, the same two controls every other list here
              carries. Without the search, finding one tag among a large vocabulary
              meant reading the whole row of chips; without the select-all, the
              only way to include nothing was to untick every chip by hand. */}
          <div className="tbs-settings__pick-toolbar">
            <SearchField
              testId="export-tags-search"
              placeholder="Search tags..."
              value={tagQuery}
              onChange={setTagQuery}
              ariaLabel="Search tags to include"
            />
            <label className="tbs-settings__import-take">
              <input
                type="checkbox"
                data-testid="export-tags-select-all"
                checked={visibleTags.length > 0 && visibleTags.every((t) => !excludedTags.includes(t.name))}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = visibleTags.some((t) => excludedTags.includes(t.name))
                      && visibleTags.some((t) => !excludedTags.includes(t.name));
                  }
                }}
                onChange={() => {
                  // A VIEW of the rows: when every visible tag is included, this
                  // clears them all; in any other state (some or none) it includes
                  // them all — the same rule `PartsSelectAll` uses, so the two
                  // controls cannot disagree about what "select all" means.
                  const allIncluded = visibleTags.length > 0
                    && visibleTags.every((t) => !excludedTags.includes(t.name));
                  const names = visibleTags.map((t) => t.name);
                  setExcludedTags(allIncluded
                    ? [...new Set([...excludedTags, ...names])]
                    : excludedTags.filter((n) => !names.includes(n)));
                }}
              />
              {visibleTags.length > 0 && visibleTags.every((t) => !excludedTags.includes(t.name))
                ? 'Clear all tags'
                : 'Select all tags'}
            </label>
          </div>
          {/* A tag is not a RECORD (no icon / URL / match type), so it uses the
              part-shaped picker rather than `RecordList` — the same "record vs
              part" distinction the diff uses (`ImportPartDiff`).

              A ROW of chips, not one tag per line: the same vocabulary the rule
              forms' tag picker and the expression filter's candidates use, so
              "which tags" is one control shape across the whole app. Each chip is
              the tag's own appearance (background AND text colour), which is what
              a name-only line was missing. */}
          <div className="tbs-tag-picker" role="group" aria-label="Tags to include" data-testid="export-tags-values">
            {visibleTags.map((tag) => {
              const included = !excludedTags.includes(tag.name);
              return (
                <label
                  key={tag.id}
                  className="tbs-tag-picker__option"
                  data-testid={`export-record-tag-${tag.id}`}
                  data-included={included}
                >
                  <input
                    type="checkbox"
                    checked={included}
                    aria-label={`Include tag ${tag.name}`}
                    onChange={() => { toggleExcluded('tag', tag.name); }}
                  />
                  <span
                    className="tbs-tag-picker__chip"
                    style={{ backgroundColor: tag.backgroundColor, color: tag.textColor }}
                    aria-hidden="true"
                  >
                    {tag.name}
                  </span>
                </label>
              );
            })}
          </div>
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
            // Derived from `DIMENSION_LABELS`, not a literal: the "of 4" was a
            // hard-coded count that would have kept saying 4 after the fifth
            // dimension landed (the same class of drift the summary list had).
            ? `${String(selectedCount)} of ${String(DIMENSION_LABELS.length)} parts selected`
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

      {/* D-e: the self-consistency dialog. Its numbers and names come from
          `consistencyChoice.diff` — the SAME array the gate used — so the wording
          cannot describe a different decision. Two options, NEITHER defaulted
          (D-e-D): an unthinking Enter must not choose for the user, because the
          two outcomes affect DIFFERENT machines (the recipient's definitions vs
          the user's own rules). */}
      <Dialog
        open={consistencyChoice !== null}
        onClose={() => { setConsistencyChoice(null); }}
        title="Some rules reference tags that are not included"
        footer={
          <>
            {/* Short labels in the BUTTONS, and the consequence in the BODY.
                The buttons carried the whole sentence ("Include them (2 extra tag
                definitions)") and were clipped by the dialog's width; a label states
                the choice, and the paragraph above already carries the numbers it
                would otherwise repeat. */}
            <Button
              variant="secondary"
              data-testid="export-consistency-include"
              onClick={() => { void resolveConsistency('supplement'); }}
            >
              Include them
            </Button>
            <Button
              variant="secondary"
              data-testid="export-consistency-leave"
              onClick={() => { void resolveConsistency('drop'); }}
            >
              Leave them out
            </Button>
          </>
        }
      >
        <p>
          {`These tags are used by rules you are exporting but are not in the package: ${(consistencyChoice?.diff ?? []).join(', ')}.`}
        </p>
        {/* Both consequences, stated once each beside the button that takes it.
            The numbers live here rather than in the labels so the labels stay
            short enough to read — the reason they were clipped before. */}
        <ul className="tbs-settings__consistency-choices">
          <li>
            <strong>Include them</strong>
            {` — adds ${String(consistencyChoice?.diff.length ?? 0)} extra tag ${(consistencyChoice?.diff.length ?? 0) === 1 ? 'definition' : 'definitions'} to the package.`}
          </li>
          <li>
            <strong>Leave them out</strong>
            {` — ${String(consistencyChoice?.canDrop.length ?? 0)} ${(consistencyChoice?.canDrop.length ?? 0) === 1 ? 'rule' : 'rules'} keeps its reference, but the tag will not exist on the machine you send it to.`}
          </li>
        </ul>
      </Dialog>

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
            <li>Tags: {summary.tags}</li>
          </ul>
          <Button size="sm" variant="secondary" data-testid="export-download" onClick={() => { downloadPackage(pkg); }}>
            Download
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * The fixed FIVE dimensions (D5/D0), in the order the diff groups them.
 *
 * `tags` is last because it is the newest and, unlike the others, carries no
 * record list — its consumers group it as a whole (a vocabulary), not row by row
 * (see `DIMENSION_META` and `dimensionCount`). Every `DIMENSION_LABELS.map`
 * consumer (export cards, import cards, result lists — five of them) picks the
 * new entry up automatically from here, which is why the OLD four-name comment
 * is now wrong and why nothing is hand-listed per panel.
 */
const DIMENSION_LABELS: ReadonlyArray<{ dim: keyof DimensionPresence; label: string }> = [
  { dim: 'slots', label: 'Slots' },
  { dim: 'rules', label: 'Rules' },
  { dim: 'settings', label: 'Settings' },
  { dim: 'shortcuts', label: 'Shortcuts' },
  { dim: 'tags', label: 'Tags' },
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
  // A consequence-shaped blurb (D-e): it says what TAKING the vocabulary does,
  // not what a tag is. The dimension is a whole set, so the wording is about the
  // set ("the labels your rules are organised by"), not about one tag.
  tags: { title: 'Tags', blurb: 'The labels your rules are organised by' },
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
 * One side of a tag facet, when that facet is a colour.
 *
 * Narrowed through the `kind` before it reaches a `style`, for the same reason
 * `RecordList`'s own helper exists: only the discriminated union knows which
 * values are safe to put in CSS. `undefined` means "this side has no colour", so
 * the chip simply does not set that property rather than setting a guess.
 */
function colorFacetOf(
  fields: ImportFieldDiff[] | undefined,
  facet: 'tag-background' | 'tag-text',
  side: 'before' | 'after',
): string | undefined {
  const v = (fields ?? []).find((f) => f.field === facet)?.[side];
  return v !== null && v !== undefined && v.kind === 'color' ? v.value : undefined;
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
    // See `import-result-dims`: a result that reports fewer dimensions than the
    // label list reads as "nothing changed" for the missing one, not a crash.
    const outcome = result.dimensions[dim] ?? { changed: 0, failed: 0 };
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
 * The sentinel the tag list's select-all passes.
 *
 * Its own constant rather than reusing `allPartsSentinel`: the two address
 * DIFFERENT intent fields (`takeTagNames` vs `takeSettingIds`), and sharing one
 * token would make a future change to either silently affect the other.
 */
const allTagsSentinel = '__all_tags__';

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
  /**
   * The import tag list's bulk selection, as a set of the ids the user chose.
   *
   * PRESENTATIONAL, and that is not a shortcut: `ImportIntent` carries no per-tag
   * take list, because the tags dimension has no per-row decision — the MODE is
   * the decision (A8's re-decide button is where the destructive one is
   * revisited). A row checkbox here would therefore be a control with nothing
   * behind it, which is the dead-control class this codebase removes rather than
   * adds. What the bulk control does is operable and real: with nothing selected
   * the list de-emphasises the UNCHANGED rows, so a long vocabulary shows only what
   * this file actually moves.
   */
  /**
   * Whether a tag the file carries would be taken.
   *
   * Read from the intent (`undefined` = take everything), the SAME single source
   * the per-row checkbox and the select-all use, so the two cannot disagree — and
   * so the first untick materialises the allow-list from the rows on screen rather
   * than silently dropping the ones the user never touched.
   */
  const tagsTaken = (name: string): boolean =>
    intent.takeTagNames === undefined || intent.takeTagNames.includes(name);

  const setTagTaken = (name: string, take: boolean, allNames: string[]): void => {
    setIntent((prev) => {
      if (name === allTagsSentinel) {
        return { ...prev, takeTagNames: take ? [...allNames] : [] };
      }
      const seed = prev.takeTagNames ?? allNames;
      return {
        ...prev,
        takeTagNames: take ? [...new Set([...seed, name])] : seed.filter((n) => n !== name),
      };
    });
  };
  /** The quantized confirmation is CONSTANT (D7) — opened by Apply, always. */
  const [confirming, setConfirming] = useState(false);
  /**
   * A-f/D-e on this side: the orphan-tag decision, pending the user's answer.
   *
   * The EXPORT gate asks the same question before a package is built; a file can
   * still reach this machine without having been through it (hand-edited, sent by
   * an older version, or sent after the sender chose "leave them out"), so the
   * decision has to be offered here too. Until it is answered the import must NOT
   * proceed — resolving it either way on the user's behalf is exactly what the
   * design forbids, and here the consequence is a tag created with an appearance no
   * file ever specified.
   */
  const [orphanChoice, setOrphanChoice] = useState<string[] | null>(null);
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
   * A-f/D-e on the IMPORT side: names a carried rule references that the file's
   * own vocabulary does not define.
   *
   * The export side already asks about this state before creating a package. A file
   * can reach this machine from anywhere (hand-edited, produced by a version that
   * allowed it, or sent after the sender chose "leave them out"), so the SAME
   * situation has to be disclosed here — and the consequence is sharper on this
   * side, because there is no tag table to find the colour in: the tag is created
   * with a DEFAULT appearance. The panel already discloses that AFTER the write
   * (`tagsCreatedWithDefaultAppearance`); this states it before.
   *
   * Derived from the PACKAGE rather than the resolved diff: the diff reports the
   * names this machine will end up with, while the question is specifically "what
   * does the file fail to define".
   */
  const importOrphanTagNames = (() => {
    if (!pkg) return [];
    const defined = new Set((pkg.tags ?? []).map((t) => t.name));
    const orphans = new Set<string>();
    for (const rule of pkg.rules ?? []) {
      for (const name of rule.tags ?? []) {
        if (!defined.has(name)) orphans.add(name);
      }
    }
    return [...orphans];
  })();

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
      } else if (dim === 'tags') {
        // TAGS, not "bindings" — the `else` this used to fall into was the SHORTCUT
        // branch, so the confirm dialog reported the tag dimension as "0 bindings",
        // a unit that does not exist for tags. The count is the tag rows the user's
        // choices actually change (`replaced` included now that a colour difference
        // is a change).
        const parts = liveDiff.tagNames ?? [];
        rows.push({ dim, changed: parts.filter((p) => p.status !== 'kept').length, total: parts.length, unit: 'tags' });
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
    // A-f/D-e: an unresolvable tag reference is a DECISION, so it is asked before
    // the quantized confirmation rather than after it — the user is choosing what
    // the import will contain, and that choice belongs with the others (dimension
    // modes, per-record takes) rather than behind a "confirm" they have already
    // read.
    if (importOrphanTagNames.length > 0 && intent.stripOrphanTagNames !== true) {
      setOrphanChoice(importOrphanTagNames);
      return;
    }
    // D7: the dialog is constant — there is no "0 deletions" fast path.
    setConfirming(true);
  };

  const handleConfirmApply = async () => {
    if (!file || !inspection) return;
    // Re-entrancy guard, and it is not theoretical: the confirmation writes with the
    // version INSPECT read, so a second submission carries the SAME expectedVersion
    // — the first write succeeds (bumping the version), and the second is refused
    // with CONFIG_CONFLICT. The data is imported and the user is shown a failure,
    // which is the worst pairing: it invites a retry of something that already
    // happened. The button is `disabled` while `importing`, so this only catches a
    // double dispatch (a synthetic event, or a second Enter), but the guard belongs
    // with the handler rather than with the widget that happens to call it.
    if (importing) return;
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
              // `?? {0,0}`: a result produced before this dimension existed (or by
              // a caller that reports fewer dimensions) must render as "nothing
              // happened here", not crash the whole result panel. The dimension
              // list is what grew, so the list is where the tolerance belongs.
              const outcome = applyResult.dimensions[dim] ?? { changed: 0, failed: 0 };
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

          {/* S6/A10: tags that had to be created with a DEFAULT appearance,
              because the file neither defined them nor did this machine know
              them. The count is disclosed so the user is TOLD rather than left to
              notice new, greyer tags later — the asymmetry (no colour source on
              the import side) is registered, not hidden. */}
          {(applyResult.tagsCreatedWithDefaultAppearance ?? 0) > 0 && (
            <p className="tbs-settings__result-note" data-testid="import-default-appearance">
              {`${String(applyResult.tagsCreatedWithDefaultAppearance)} ${applyResult.tagsCreatedWithDefaultAppearance === 1 ? 'tag was' : 'tags were'} created with a default appearance.`}
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
            // `slots` and `rules` are RECORD dimensions: they carry a list of
            // items with ids, so they render one row per record. The other
            // dimensions are PART dimensions (settings parts, shortcut
            // bindings, and — from the Rule Tags iteration — the tag
            // vocabulary): they are carried as a whole and render part rows
            // instead. `dim === 'tags'` must therefore NOT be captured here;
            // it takes the part-shaped pipeline like `settings`/`shortcuts`.
            const isRecordDimension = dim === 'slots' || dim === 'rules';
            const changedCount = records.filter((r) => r.status !== 'kept').length;
            // The settings parts and shortcut bindings the file carries,
            // read from the LIVE diff (so their status follows the user's choices).
            const shownParts = dim === 'settings' ? (liveDiff?.settingsParts ?? []) : [];
            const shortcutParts = dim === 'shortcuts' ? (liveDiff?.shortcutParts ?? []) : [];
            // The tag vocabulary, one row per tag the file carries. Read from the
            // LIVE diff, so each row's status follows the user's choices — the
            // per-row take-allow-list (`takeTagNames`) and the dimension mode.
            const tagRows = dim === 'tags' ? (liveDiff?.tagNames ?? []) : [];
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
                  {/* The live count of what this import would actually WRITE.
                      A record dimension states "how many of them change"; a PART
                      dimension states how many of its parts are taken — which for
                      tags is the number the user is looking for ("how many tags am
                      I importing"), and which the word "included" answered with
                      nothing. Derived from the user's own take-allow-list, so
                      unticking a row moves the number immediately. */}
                  <span
                    className="tbs-settings__card-meta"
                    data-testid={`import-dim-count-${dim}`}
                  >
                    {!carried(dim)
                      ? 'not in this file'
                      : isRecordDimension
                        ? `${String(changedCount)} of ${String(records.length)} change`
                        : dim === 'tags'
                          ? `${String(tagRows.filter((t) => tagsTaken(t.id)).length)} of ${String(tagRows.length)} selected`
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
                    {/* A8: OVERWRITE on tags deletes target-side tags the file
                        lacks — a destructive default the user may re-decide.
                        "Re-decide" is defined as the SAME decision expressed as a
                        mode change, so choosing here just sets the mode to
                        `incremental` (one reasoning chain, no second path). */}
                    {dim === 'tags' && intent.dimensionModes[dim] === 'overwrite' && (
                      <button
                        type="button"
                        className="tbs-settings__mode-alternative"
                        data-testid="import-tags-to-incremental"
                        onClick={() => { setDimensionMode('tags', 'incremental'); }}
                      >
                        Keep my existing tags instead (do not delete)
                      </button>
                    )}
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
                    {/* The tag DIFF: one row per tag, each with its three facets
                        (name / background / text colour) as label → value → state.
                        This is what makes the vocabulary's content reviewable before
                        the import runs — including the appearance, which no other
                        part of this panel shows and which decides whether an
                        incoming tag will look like the one it maps onto. */}
                    {/* #3: the same disclosure the export gate asks about, on the
                        side where the outcome is worse — an undefined tag is created
                        with a DEFAULT appearance here, because this machine has no
                        colour source for it. Stated before the write, with the names,
                        so "why did my imported tags come out grey" is answered at the
                        point the user can still act on it. */}
                    {dim === 'tags' && importOrphanTagNames.length > 0 && (
                      <p
                        className="tbs-settings__hint tbs-settings__hint--notice"
                        data-testid="import-orphan-tags"
                        role="status"
                      >
                        {`Some rules in this file reference tags it does not define: ${importOrphanTagNames.join(', ')}. ${importOrphanTagNames.length === 1 ? 'That tag' : 'Those tags'} will be created with a default appearance.`}
                      </p>
                    )}
                    {dim === 'tags' && tagRows.length > 0 && (
                      <ul className="tbs-settings__import-records" data-testid="import-tags-values">
                        {/* Select all / none, the same control the settings and
                            shortcut dimensions carry, writing the same kind of
                            allow-list (`takeTagNames`). */}
                        <li>
                          <PartsSelectAll
                            ids={tagRows.map((t) => t.id)}
                            taken={(id) => tagsTaken(id)}
                            onToggleAll={(take) => {
                              setTagTaken(allTagsSentinel, take, tagRows.map((t) => t.id));
                            }}
                            noun="tags"
                          />
                        </li>
                        {tagRows.map((tag) => (
                          <li
                          key={tag.id}
                          data-testid={`import-tag-${tag.id}`}
                          // A DECLINED tag is de-emphasised rather than removed:
                          // the row keeps its place so "I turned this off" stays
                          // visible, and the vocabulary keeps its length.
                          data-muted={!tagsTaken(tag.id)}
                        >
                            {/* The tag's PREVIEW, target → imported, and nothing
                                else. A tag is a coloured label, so the two
                                appearances side by side say everything the row
                                needs to: what the machine has now, and what the
                                import would leave. A per-field table would spell
                                that out as three sentences about a thing the
                                reader can simply look at — and it was the field
                                detail, not the appearance, that made this list
                                tall enough to hide the vocabulary it describes. */}
                            <span className="tbs-settings__import-tag-preview">
                              {/* The TARGET side exists only when the machine HAS
                                  the tag. For a file-only (`added`) row there is
                                  nothing to point from, so the row is a single
                                  chip — an empty first chip with an arrow into the
                                  real one would depict a comparison that does not
                                  exist. This is also what makes the row's shape
                                  itself report "new" at a glance. */}
                              {tag.status !== 'added' && (
                                <span
                                  className="tbs-tag-picker__chip"
                                  data-testid={`import-tag-target-${tag.label}`}
                                  style={{
                                    backgroundColor: colorFacetOf(tag.fields, 'tag-background', 'before'),
                                    color: colorFacetOf(tag.fields, 'tag-text', 'before'),
                                  }}
                                >
                                  {tag.label}
                                </span>
                              )}
                              {tag.status !== 'added' && tag.status !== 'deleted' && (
                                <span className="tbs-field-row__arrow" aria-hidden="true">→</span>
                              )}
                              {tag.status !== 'deleted' && (
                                <span
                                  className="tbs-tag-picker__chip"
                                  data-testid={`import-tag-imported-${tag.label}`}
                                  style={{
                                    backgroundColor: colorFacetOf(tag.fields, 'tag-background', 'after'),
                                    color: colorFacetOf(tag.fields, 'tag-text', 'after'),
                                  }}
                                >
                                  {tag.label}
                                </span>
                              )}
                            </span>
                            <StatusBadge status={RECORD_BADGE[tag.status]} label={tag.status} />
                            {/* The per-row decision, exactly like the other part
                                dimensions: `takeTagNames` is an allow-list, so
                                unticking one tag leaves the others taken. */}
                            <label className="tbs-settings__import-take">
                              <input
                                type="checkbox"
                                data-testid={`import-tag-take-${tag.label}`}
                                checked={tagsTaken(tag.id)}
                                aria-label={`Take ${tag.label}`}
                                onChange={(e) => {
                                  setTagTaken(tag.id, e.currentTarget.checked, tagRows.map((t) => t.id));
                                }}
                              />
                              Take
                            </label>
                          </li>
                        ))}
                      </ul>
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
                          // The tags now live INSIDE the Fields detail, as one more
                          // field row (see the `tags` facet) — so a rule's change is
                          // described in the panel's own vocabulary rather than in a
                          // block of its own beside it.
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

      {/* A-f/D-e: the SAME decision the export gate asks about, asked here because
          a file can arrive without having been through that gate. Answered BEFORE
          the quantized confirmation, so the user decides what the import contains
          while they are still choosing (dimension modes, per-record takes) rather
          than behind a confirmation they have already read.

          Two real options, neither defaulted: "Include them" is the default
          RESOLUTION (the tag is created like any other referenced name), so
          choosing it simply proceeds; "Leave them out" records the decision so the
          reference is dropped and no tag is invented. */}
      <Dialog
        open={orphanChoice !== null}
        onClose={() => { setOrphanChoice(null); }}
        title="Some rules reference tags that are not included"
        footer={
          <>
            <Button
              size="sm"
              variant="secondary"
              data-testid="import-orphan-include"
              onClick={() => {
                setOrphanChoice(null);
                // "Include them" = create the tags, which is what the default does;
                // the flag is explicitly cleared so a previous "leave them out" on
                // this file cannot survive the change of mind.
                setIntent((prev) => ({ ...prev, stripOrphanTagNames: false }));
                setConfirming(true);
              }}
            >
              Include them
            </Button>
            <Button
              size="sm"
              variant="secondary"
              data-testid="import-orphan-leave"
              onClick={() => {
                setOrphanChoice(null);
                setIntent((prev) => ({ ...prev, stripOrphanTagNames: true }));
                setConfirming(true);
              }}
            >
              Leave them out
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setOrphanChoice(null); }}>Cancel</Button>
          </>
        }
      >
        <p>
          {`These tags are referenced by rules in this file but are not included in it: ${(orphanChoice ?? []).join(', ')}.`}
        </p>
        <ul className="tbs-settings__consistency-choices">
          <li>
            <strong>Include them</strong>
            {` — creates ${String(orphanChoice?.length ?? 0)} ${(orphanChoice?.length ?? 0) === 1 ? 'tag' : 'tags'} with a default appearance, because this file does not say what they look like.`}
          </li>
          <li>
            <strong>Leave them out</strong>
            {' — those rules arrive without their tags, and no tag from this file is created.'}
          </li>
        </ul>
      </Dialog>

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
                    {/* Three cases, because there are three facts. "no change (0
                        tags in the file)" conflated "the file carries this
                        dimension and nothing would move" with "the file carries no
                        tags at all" — and those lead to different next steps (carry
                        on vs. go and find a file that has what you meant to send).
                        A dimension with nothing in it is STATED as empty. */}
                    {row.total === 0
                      ? 'nothing in this file'
                      : row.changed === 0
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

    let cancelled = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let clear: ReturnType<typeof setTimeout> | null = null;

    /**
     * Retries until the row exists, because the target surface FETCHES after it
     * mounts.
     *
     * This used to be a single attempt whose comment claimed "a later render
     * re-runs this" — untrue, since the effect's only dependency is
     * `importFocus`, which does not change again. So the pass that mattered ran
     * while the rules/slots table was still empty, found nothing, and returned:
     * a cross-section jump was a SILENT no-op whenever the destination loaded
     * asynchronously (which is every section that holds records). The import
     * panel's existing jump had the same hole; it is now shared correctly.
     *
     * Bounded rather than infinite: a target that never appears must not leave a
     * timer running for the life of the page.
     */
    const run = (): void => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) {
        attempt += 1;
        if (attempt < JUMP_FIND_ATTEMPTS) retry = setTimeout(run, JUMP_FIND_INTERVAL_MS);
        return;
      }
      // jsdom has no layout engine; a missing scroll must never cost the
      // highlight (the cue is the point) — mirror the dashboard's approach.
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
      el.classList.add(JUMP_HIGHLIGHT_CLASS);
      clear = setTimeout(() => { el.classList.remove(JUMP_HIGHLIGHT_CLASS); }, JUMP_HIGHLIGHT_MS);
      setImportFocus(null);
    };

    run();
    return () => {
      cancelled = true;
      if (retry !== null) clearTimeout(retry);
      if (clear !== null) clearTimeout(clear);
    };
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
            {activeSection === 'tags' && (
              <TagsSection
                // 1.4: the association panel's Redirect action reuses the app's ONE
                // jump mechanism (`importFocus`) rather than inventing a second way
                // to reveal a row — same switch-then-highlight, same visual cue.
                onRedirectToRule={(ruleId) => {
                  setActiveSection('rules');
                  setImportFocus({ kind: 'rule', id: ruleId });
                }}
              />
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
