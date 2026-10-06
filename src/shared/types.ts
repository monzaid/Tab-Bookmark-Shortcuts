/**
 * Domain models for Tab Bookmark Shortcuts extension.
 * Covers: slots, strategies, rules, icons, overrides, recovery, diagnostics, import.
 */

// Type-only import (erased at runtime — no module cycle with `field-chain.ts`,
// which imports these same models back from here).
import type { ChainResult, TierOwner } from './field-chain';

// ─── Matching Strategy (tri-knob model) ──────────────────────────────────────
//
// The legacy single-letter strategy type and its default constant were removed
// entirely (D17) — no dead type, no dead constant. The old A/B/C → four-cell
// correspondence lives ONLY in the design doc §3.1 markdown table; it does not
// exist in code or types.

/** Does the slot require its bound tab to exist? */
export type TabIdMode = 'exists' | 'no-exists';
/** Does the slot require a URL/regex match? */
export type RuleCheckMode = 'match' | 'no-match';
/** Combination 1 only: which source wins when both are available. */
export type Priority = 'tabId' | 'rule-check' | 'none';

export interface MatchRuleSettings {
  tabIdMode: TabIdMode;
  ruleCheckMode: RuleCheckMode;
  priority: Priority;
}

/** Global switch direction for single-command entries (design §3.3). */
export type SwitchDirection = 'previous' | 'next';

/**
 * New default settings = combination 1 + `priority = tabId` (design D9).
 * Replaces the removed legacy strategy default.
 */
export const DEFAULT_MATCH_SETTINGS: MatchRuleSettings = {
  tabIdMode: 'exists',
  ruleCheckMode: 'match',
  priority: 'tabId',
};

// ─── URL Matching ────────────────────────────────────────────────────────────

export type UrlMatchType = 'exact' | 'regex';

export interface UrlMatchDefinition {
  type: UrlMatchType;
  /** For exact: normalized URL. For regex: pattern string (max 500 chars) */
  value: string;
}

// ─── Icon Source ─────────────────────────────────────────────────────────────

export type IconSourceType = 'url' | 'upload' | 'template';

export interface IconSource {
  type: IconSourceType;
  /** For url: the source URL. For upload/template: identifier */
  value: string;
  /** Template only: background color hex */
  backgroundColor?: string;
  /** Template only: display text */
  text?: string;
  /**
   * Template only: display text colour hex.
   *
   * T2/C1: a recipe (background + text + text colour) is the durable truth for
   * a `type: 'template'` icon. Without this field a round-trip would silently
   * fall back to `autoTextColor` and change the icon's appearance.
   */
  textColor?: string;
}

// ─── UI Marker (slot display customization) ──────────────────────────────────

export interface SlotUiMarker {
  /** `null` = explicitly cleared (DT11: writes unify on null, never `''`). */
  customTitle?: string | null;
  /** `null` = explicitly cleared (DT11 unified write shape). */
  icon?: IconSource | null;
  backgroundColor?: string;
}

// ─── Slot Definition (sync) ──────────────────────────────────────────────────

export interface SlotDefinition {
  id: number; // 1-10
  urlMatch: UrlMatchDefinition;
  strategy: 'inherit' | MatchRuleSettings; // 'inherit' uses global default
  /** undefined = inherit `autoBindGlobal` (D14). */
  autoBindOverride?: boolean;
  uiMarker: SlotUiMarker;
  /** Title snapshot at save time */
  titleSnapshot: string;
  /** Favicon URL snapshot at save time */
  faviconSnapshot: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ─── Slot Binding (local) ────────────────────────────────────────────────────

export interface SlotBinding {
  slotId: number;
  tabId: number;
  windowId: number;
  boundAt: string; // ISO 8601
}

// ─── Page Rewrite Rule (sync) ────────────────────────────────────────────────

export interface PageRule {
  id: string;
  urlMatch: UrlMatchDefinition;
  /** -100 to 100, default 0. Higher wins. */
  priority: number;
  title?: string;
  favicon?: IconSource;
  /** Whether this rule is active. Defaults to true if undefined. */
  enabled?: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ─── Tab Temporary Override (local) ─────────────────────────────────────────

export interface TabOverride {
  tabId: number;
  title?: string;
  favicon?: IconSource;
  createdAt: string; // ISO 8601
}

// ─── Data Dashboard Row (A10) ────────────────────────────────────────────────

/**
 * A single row in the settings Data Dashboard.
 *
 * `kind` mirrors the three managed sets: an explicit tab override, a slot whose
 * title/icon was explicitly set, and a page whose value comes from a rule hit.
 *
 * `chain` carries the FULL A1 `ChainResult` for both fields (computed once in the
 * background, so the UI never assembles a second copy of the chain), and
 * `delivery` reports whether the background could actually apply the value.
 */
export interface DashboardRow {
  id: string;
  kind: 'override' | 'slot' | 'rule-hit';
  label: string;
  url: string | null;
  /** Jump-to-row address (null when there is nothing to jump to). */
  anchor: TierOwner | null;
  tabId?: number;
  slotId?: number;
  ruleId?: string;
  chain: { title: ChainResult; favicon: ChainResult };
  delivery: 'ok' | 'degraded' | 'protected' | 'unknown';
}

// ─── Recovery Session (local) ────────────────────────────────────────────────

export interface RecoverySession {
  recoveryId: string;
  slotId: number;
  urlMatch: UrlMatchDefinition;
  titleSnapshot: string;
  faviconSnapshot: string;
  createdAt: string; // ISO 8601
  /** TTL: 5 minutes from createdAt */
  expiresAt: string; // ISO 8601
  /**
   * Window id of the recovery window (design A11/DT1). Backfilled by the worker
   * when the window is created so create-or-focus can reuse one window per slot.
   */
  windowId: number;
  /**
   * Prev/Next cursor anchored to a tabId (DT2). `null` = not yet positioned, in
   * which case the first browse anchors on the active tab's neighbour. Browsing
   * does NOT consume the session (DT1/DT5).
   */
  candidateCursor: number | null;
}

// ─── Recovery Snapshot (local) ───────────────────────────────────────────────

export interface RecoverySnapshot {
  slotId: number;
  url: string;
  title: string;
  favicon: string;
  recoveredAt: string; // ISO 8601
}

// ─── Cycle Cursor (local) ────────────────────────────────────────────────────

export interface CycleCursor {
  slotId: number;
  /** Index into last known candidate list */
  currentIndex: number;
  /** Candidate tab IDs from last query (for reference) */
  candidateTabIds: number[];
  updatedAt: string; // ISO 8601
}

// ─── Diagnostics (local) ─────────────────────────────────────────────────────

export interface DiagnosticEntry {
  timestamp: string; // ISO 8601
  errorCode: DomainErrorCode | 'SUCCESS';
  browserType: 'chrome' | 'edge' | 'firefox';
  operationType: string;
}

// ─── Import/Export (sync config only) ────────────────────────────────────────

// (T14b/T21: the legacy export-payload / slot-decision / slot-conflict /
// import-preview types were deleted — the redesigned protocol carries
// `ExportPackage` / `ImportInspection` / `ImportApplyResult`.)

// ─── Import / Export — Iteration types (T2) ──────────────────────────────────
//
// The four dimensions are FIXED (D5): slots / rules / settings / shortcuts.

export interface ExportScope {
  /** Dimension flags — `true` when the user selected that dimension (D1). */
  slots?: boolean;
  rules?: boolean;
  settings?: boolean;
  shortcuts?: boolean;
  /** Per-record deselection within a selected dimension (D1 "展开到记录级"). */
  excludedSlotIds?: number[];
  excludedRuleIds?: string[];
}

/** How a dimension's records combine with the target machine (A1). */
export type DimensionMode = 'incremental' | 'overwrite';

/** A sparse per-record override of the dimension mode (A4). `keep`=leave target. */
export interface ImportRecordOverride {
  kind: 'slot' | 'rule';
  id: number | string;
  action: 'keep' | 'take';
}

export interface ImportIntent {
  dimensionModes: {
    slots: DimensionMode;
    rules: DimensionMode;
    settings: DimensionMode;
    shortcuts: DimensionMode;
  };
  /** Sparse: only rows the user actually changed. */
  recordOverrides?: ImportRecordOverride[];
}

/** Default import intent: incremental + no overrides (A1 — the safer default). */
export function defaultImportIntent(): ImportIntent {
  return {
    dimensionModes: {
      slots: 'incremental',
      rules: 'incremental',
      settings: 'incremental',
      shortcuts: 'incremental',
    },
  };
}

/**
 * A field value in a RENDERABLE form — never an internal comparison string, so
 * the diff's internal representation cannot leak into a consumer (A14/D9).
 * `null` (on `ImportFieldDiff`) means "this side has no value", which is
 * distinct from a value that happens to be empty.
 */
export type ImportFieldValue =
  | { kind: 'text'; value: string }
  | { kind: 'url'; value: string }
  | { kind: 'local-ref'; key: string }
  | { kind: 'recipe'; bgColor: string; text: string; textColor: string };

/** Per-field change detail inside a record (A12). */
/**
 * The facets a record can differ on. `match-url` / `match-type` carry the match
 * definition (the URL and the mode name) as plain `text` values, so a row can
 * say WHICH part of a record differs and what the two sides hold — a record
 * whose URL match moved is otherwise indistinguishable from an unchanged one.
 */
export interface ImportFieldDiff {
  field: 'title' | 'icon' | 'match-url' | 'match-type';
  before: ImportFieldValue | null;
  after: ImportFieldValue | null;
  changed: boolean;
}

/** One record's outcome in the diff (A12). */
export type ImportRecordStatus = 'added' | 'replaced' | 'kept' | 'deleted' | 'skipped';

export interface ImportRecordDiff {
  kind: 'slot' | 'rule';
  id: number | string;
  label: string;
  status: ImportRecordStatus;
  fields: ImportFieldDiff[];
}

/** Which dimensions the package actually carried (A2/A3 three-state). */
export interface DimensionPresence {
  slots: boolean;
  rules: boolean;
  settings: boolean;
  shortcuts: boolean;
}

/** Record-level + field-level diff over the package against current state (A12). */
export interface ImportDiff {
  records: ImportRecordDiff[];
  dimensions: DimensionPresence;
}

/** A forgiving-but-disclosed item (unknown field ignored, default filled). */
export interface TolerantItem {
  kind: string;
  detail: string;
}

/** A record skipped because it violates a domain constraint (D15). */
export interface DomainViolation {
  kind: 'slot' | 'rule';
  id: number | string;
  reason: string;
}

/** A match overlap: two records share the exact same Match URL + Match Type (D10). */
export interface MatchOverlap {
  urlMatch: UrlMatchDefinition;
  recordIds: Array<number | string>;
}

/** Read-only inspection result (D6/§6.2): what the package would do. */
export interface ImportInspection {
  diff: ImportDiff;
  dimensions: DimensionPresence;
  tolerant: TolerantItem[];
  domainViolations: DomainViolation[];
  overlaps: MatchOverlap[];
  /** configVersion read at INSPECT time — APPLY must bind to this (C3/F4). */
  configVersion: number;
}

/** Applied-result checklist (§4.3). */
export interface ImportApplyResult {
  success: boolean;
  configVersion: number;
  counts: { added: number; replaced: number; kept: number; deleted: number; skipped: number };
  tolerant: TolerantItem[];
  domainViolations: DomainViolation[];
  missingIcons: Array<{ kind: 'slot' | 'rule'; id: number | string }>;
  overlaps: MatchOverlap[];
  /** Chrome/Edge: manual-set guidance for the shortcut dimension (D4). */
  shortcutGuidance?: string;
}

export interface ExportPackageSummary {
  slots: number;
  rules: number;
  settings: number;
  shortcuts: number;
}

// ─── Sync Root State ─────────────────────────────────────────────────────────

export interface SyncState {
  configVersion: number;
  /** Global tri-knob settings (directly replaces the removed legacy strategy field). */
  matchSettings: MatchRuleSettings;
  /** Global direction for single-command entries (design §3.3). */
  switchDirection: SwitchDirection;
  /** Global auto-bind default; slots may override (D14). */
  autoBindGlobal: boolean;
  slots: SlotDefinition[];
  rules: PageRule[];
}

// ─── Site Snapshot (local, strictly sealed — A7/C6) ──────────────────────────

/**
 * The ORIGINAL page value captured before the first rewrite, so the `restore`
 * directive can put it back (Q19/Q20/Q28).
 *
 * Strictly sealed to `local`: it never enters `sync`, export, import or
 * diagnostics. Only `{ title, faviconHref }` is stored — never the URL or any
 * page content.
 */
export interface SiteSnapshotEntry {
  tabId: number;
  title: string | null;
  faviconHref: string | null;
  capturedAt: string; // ISO 8601
}

// ─── Local Root State ────────────────────────────────────────────────────────

export interface LocalState {
  bindings: SlotBinding[];
  cycleCursors: CycleCursor[];
  lastSuccessSlotId: number | null;
  recoverySessions: RecoverySession[];
  recoverySnapshots: RecoverySnapshot[];
  tabOverrides: TabOverride[];
  iconCache: Record<string, string>; // url -> data URI
  diagnostics: DiagnosticEntry[];
  /** Optional for backwards compatibility with pre-A7 local data. */
  siteSnapshot?: SiteSnapshotEntry[];
}

// ─── Domain Error Codes ──────────────────────────────────────────────────────

export type DomainErrorCode =
  // Request validation
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ACTION'
  // Config conflicts
  | 'CONFIG_CONFLICT'
  | 'STALE_VERSION'
  // Slot operations
  | 'SLOT_NOT_FOUND'
  | 'SLOT_EMPTY'
  | 'SLOT_ALREADY_BOUND'
  // Matching
  | 'NO_MATCH'
  | 'NO_CANDIDATES'
  // Recovery
  | 'RECOVERY_EXPIRED'
  | 'RECOVERY_NOT_FOUND'
  // Rules
  | 'RULE_CONFLICT_BLOCK'
  | 'RULE_CONFLICT_WARN'
  | 'DUPLICATE_RULE'
  | 'VERSION_CONFLICT'
  | 'RULE_INVALID_REGEX'
  | 'RULE_REGEX_TOO_LONG'
  | 'RULE_PROTECTED_URL'
  | 'RULE_NOT_FOUND'
  // Icons
  | 'ICON_TOO_LARGE'
  | 'ICON_INVALID_FORMAT'
  | 'ICON_DOWNLOAD_FAILED'
  // Import/Export
  | 'IMPORT_INVALID'
  | 'IMPORT_VERSION_MISMATCH'
  | 'IMPORT_CANCELLED'
  // Permissions
  | 'INCOGNITO_NOT_AUTHORIZED'
  | 'PROTECTED_PAGE'
  // Adapter/Browser
  | 'BROWSER_API_ERROR'
  | 'TAB_NOT_FOUND'
  | 'WINDOW_NOT_FOUND'
  | 'COMMAND_NOT_FOUND'
  // General
  | 'INTERNAL_ERROR'
  | 'TIMEOUT';

// ─── Candidate (for matching results) ────────────────────────────────────────

export interface TabCandidate {
  tabId: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl: string;
  isCurrentWindow: boolean;
  isIncognito: boolean;
}

// ─── Switch Result ───────────────────────────────────────────────────────────

export type SwitchOutcome =
  | { type: 'switched'; tabId: number; windowId: number; crossWindow: boolean }
  | { type: 'no_match'; slotId: number }
  | { type: 'needs_recovery'; recoveryId: string; slotId: number }
  | { type: 'incognito_blocked'; slotId: number };

// ─── Notification Types ──────────────────────────────────────────────────────

export type NotificationType =
  | 'cross_window_switch'
  | 'recovery_rebind'
  | 'no_target'
  | 'background_failure';
