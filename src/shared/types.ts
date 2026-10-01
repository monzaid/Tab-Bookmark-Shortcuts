/**
 * Domain models for Tab Bookmark Shortcuts extension.
 * Covers: slots, strategies, rules, icons, overrides, recovery, diagnostics, import.
 */

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
}

// ─── UI Marker (slot display customization) ──────────────────────────────────

export interface SlotUiMarker {
  customTitle?: string;
  icon?: IconSource;
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

export type RuleMode = 'auto' | 'manual';

export interface PageRule {
  id: string;
  urlMatch: UrlMatchDefinition;
  mode: RuleMode;
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

// ─── Data Dashboard Item ─────────────────────────────────────────────────────

/** A single row in the settings Data Dashboard (a current-page or slot source). */
export interface DashboardItem {
  id: string;
  kind: 'current-page' | 'slot';
  label: string;
  title: string | null;
  icon: string | null;
  url: string | null;
  tabId?: number;
  slotId?: number;
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

export interface ExportPayload {
  version: number;
  exportedAt: string; // ISO 8601
  slots: SlotDefinition[];
  rules: PageRule[];
  matchSettings: MatchRuleSettings;
  switchDirection: SwitchDirection;
  autoBindGlobal: boolean;
  configVersion: number;
}

export type ImportSlotDecision = 'import' | 'existing';

export interface ImportSlotConflict {
  slotId: number;
  existing: SlotDefinition | null;
  imported: SlotDefinition;
  decision: ImportSlotDecision;
}

export interface ImportPreview {
  valid: boolean;
  error?: DomainErrorCode;
  slotConflicts: ImportSlotConflict[];
  newSlots: SlotDefinition[];
  rules: PageRule[];
  matchSettings: MatchRuleSettings;
  switchDirection: SwitchDirection;
  autoBindGlobal: boolean;
  configVersion: number;
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
