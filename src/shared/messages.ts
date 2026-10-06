/**
 * Typed message contracts for UI↔Worker and Content↔Worker communication.
 * Discriminated union on `action` field.
 * Only Worker interprets raw browser exceptions; UI consumes domain error codes only.
 */

import type {
  DomainErrorCode,
  MatchRuleSettings,
  SwitchDirection,
  UrlMatchDefinition,
  SlotUiMarker,
  IconSource,
  ExportScope,
  ImportIntent,
  ImportInspection,
  ImportApplyResult,
  SwitchOutcome,
  DiagnosticEntry,
  SlotDefinition,
  SyncState,
  LocalState,
  DashboardRow,
} from './types';

// ─── Base Message Envelope ───────────────────────────────────────────────────

export interface RequestBase {
  /** Monotonically increasing request ID for correlation */
  requestId: string;
  /** Config version for optimistic concurrency on writes */
  configVersion?: number;
}

export type ResponseBase =
  | { success: true }
  | { success: false; errorCode: DomainErrorCode; message: string };

// ─── UI → Worker Actions ─────────────────────────────────────────────────────

// Slot operations
export interface SaveSlotRequest extends RequestBase {
  action: 'SAVE_SLOT';
  payload: {
    slotId: number;
    urlMatch: UrlMatchDefinition;
    titleSnapshot: string;
    faviconSnapshot: string;
    uiMarker?: SlotUiMarker;
    strategy?: 'inherit' | MatchRuleSettings;
  };
}

export interface SwitchSlotRequest extends RequestBase {
  action: 'SWITCH_SLOT';
  payload: { slotId: number };
}

export interface NextMatchRequest extends RequestBase {
  action: 'NEXT_MATCH';
}

export interface NextMatchSlotRequest extends RequestBase {
  action: 'NEXT_MATCH_SLOT';
  payload: { slotId: number };
}

export interface PrevMatchSlotRequest extends RequestBase {
  action: 'PREV_MATCH_SLOT';
  payload: { slotId: number };
}

// Current-page prev/next match — cycle tabs matching a raw URL (exact match).
export interface NextMatchCurrentRequest extends RequestBase {
  action: 'NEXT_MATCH_CURRENT';
  payload: { url: string };
}

export interface PrevMatchCurrentRequest extends RequestBase {
  action: 'PREV_MATCH_CURRENT';
  payload: { url: string };
}

export interface UnbindSlotRequest extends RequestBase {
  action: 'UNBIND_SLOT';
  payload: { slotId: number };
}

export interface UndoSaveRequest extends RequestBase {
  action: 'UNDO_SAVE';
  payload: { slotId: number };
}

// Rule operations
export interface CreateRuleRequest extends RequestBase {
  action: 'CREATE_RULE';
  payload: {
    urlMatch: UrlMatchDefinition;
    priority: number;
    title?: string;
    favicon?: IconSource;
    enabled?: boolean;
  };
}

export interface UpdateRuleRequest extends RequestBase {
  action: 'UPDATE_RULE';
  payload: {
    ruleId: string;
    urlMatch?: UrlMatchDefinition;
    priority?: number;
    title?: string;
    favicon?: IconSource;
    enabled?: boolean;
    /** Lightweight version marker — the rule's updatedAt captured when editing started */
    expectedUpdatedAt?: string;
  };
}

export interface DeleteRuleRequest extends RequestBase {
  action: 'DELETE_RULE';
  payload: { ruleId: string };
}

// Tab override operations
export interface SetTabOverrideRequest extends RequestBase {
  action: 'SET_TAB_OVERRIDE';
  payload: {
    tabId: number;
    /** string = set, null = clear title, undefined = leave unchanged */
    title?: string | null;
    /** IconSource = set, null = clear favicon, undefined = leave unchanged */
    favicon?: IconSource | null;
  };
}

export interface RemoveTabOverrideRequest extends RequestBase {
  action: 'REMOVE_TAB_OVERRIDE';
  payload: { tabId: number };
}

// Settings operations
export interface SetGlobalStrategyRequest extends RequestBase {
  action: 'SET_GLOBAL_STRATEGY';
  payload: { matchSettings: MatchRuleSettings };
}

export interface SetSlotStrategyRequest extends RequestBase {
  action: 'SET_SLOT_STRATEGY';
  payload: { slotId: number; strategy: 'inherit' | MatchRuleSettings };
}

// Direction + auto-bind settings (design §2.4 — new actions)
export interface SetSwitchDirectionRequest extends RequestBase {
  action: 'SET_SWITCH_DIRECTION';
  payload: { direction: SwitchDirection };
}

export interface SetAutoBindGlobalRequest extends RequestBase {
  action: 'SET_AUTO_BIND_GLOBAL';
  payload: { enabled: boolean };
}

export interface SetSlotAutoBindRequest extends RequestBase {
  action: 'SET_SLOT_AUTO_BIND';
  /** `override: null` = follow global; true/false = explicit override (D14). */
  payload: { slotId: number; override: boolean | null };
}

// Position (↑/↓) — Current Page only. BLK-A / A1: the sidebar supplies the
// start point (`lockedTabId ?? currentTabId`); background never reads sidebar
// in-memory state. A stale/closed anchor degrades to the active tab (DT7).
export interface PositionCurrentPrevRequest extends RequestBase {
  action: 'POSITION_CURRENT_PREV';
  payload: { anchorTabId?: number };
}

export interface PositionCurrentNextRequest extends RequestBase {
  action: 'POSITION_CURRENT_NEXT';
  payload: { anchorTabId?: number };
}

export interface UpdateSlotUiMarkerRequest extends RequestBase {
  action: 'UPDATE_SLOT_UI_MARKER';
  payload: { slotId: number; uiMarker: SlotUiMarker };
}

// Recovery operations
export interface RecoveryOpenUrlRequest extends RequestBase {
  action: 'RECOVERY_OPEN_URL';
  payload: { recoveryId: string; autoBind: boolean };
}

export interface RecoveryNextMatchRequest extends RequestBase {
  action: 'RECOVERY_NEXT_MATCH';
  payload: { recoveryId: string; autoBind: boolean };
}

export interface RecoveryPrevMatchRequest extends RequestBase {
  action: 'RECOVERY_PREV_MATCH';
  payload: { recoveryId: string; autoBind: boolean };
}

export interface RecoveryDismissRequest extends RequestBase {
  action: 'RECOVERY_DISMISS';
  payload: { recoveryId: string };
}

// ─── Import/Export — redesigned protocol (T14a / A10 / A11) ──────────────────
//
// Three actions, one semantic each. Each action is added to `UiRequest` AND
// `KNOWN_ACTIONS` in the same change (G-D: never "compiles, rejected at
// runtime"). The legacy trio was deleted in T14b (merged into T21).

/** A10/A11: produce a package for the selected scope. Read-only. */
export interface ExportPackageRequest extends RequestBase {
  action: 'EXPORT_PACKAGE';
  payload: { scope: ExportScope };
}

/**
 * A10/A11: parse a file and diff it against the current state. Read-only. Its
 * COMPUTATION is intent-independent (a pure function of the file); the RESULT is
 * produced under the DEFAULT intent — the UI recomputes under the user's real
 * intent and never re-inspects.
 */
export interface ImportInspectRequest extends RequestBase {
  action: 'IMPORT_INSPECT';
  payload: { file: string };
}

/**
 * A10/A11: apply a file under an intent. The ONLY writer; binds to the
 * configVersion read at INSPECT time via `RequestBase` (C3/F4).
 */
export interface ImportApplyRequest extends RequestBase {
  action: 'IMPORT_APPLY';
  payload: { file: string; intent: ImportIntent };
}

// Diagnostics operations
export interface GetDiagnosticsRequest extends RequestBase {
  action: 'GET_DIAGNOSTICS';
}

export interface ClearDiagnosticsRequest extends RequestBase {
  action: 'CLEAR_DIAGNOSTICS';
}

export interface ExportDiagnosticsRequest extends RequestBase {
  action: 'EXPORT_DIAGNOSTICS';
}

// State queries
export interface GetStateRequest extends RequestBase {
  action: 'GET_STATE';
}

export interface GetDashboardRequest extends RequestBase {
  action: 'GET_DASHBOARD';
}

/**
 * Impact preview for a rule pattern (review item 5.2 / 6.3).
 *
 * Answers "which open tabs would this value affect, and how many are currently
 * masked by a higher tier" so the editor can show
 * `Matches 12 tabs · 3 masked` + the first three entries. Computed in the
 * background against the live tab set (user chose the exact variant), so the UI
 * never guesses from a partial local view.
 */
export interface GetImpactPreviewRequest extends RequestBase {
  action: 'GET_IMPACT_PREVIEW';
  payload: {
    /** Rule pattern to test against the open tabs. */
    urlMatch: UrlMatchDefinition;
    /** Exclude this rule when computing the winner (edit mode). */
    excludeRuleId?: string;
    /** How many entries the caller wants back (UI folds the rest). */
    limit?: number;
  };
}

export interface ImpactPreviewEntry {
  tabId: number;
  label: string;
  url: string;
  /** True when a higher tier (override / slot) currently owns this tab. */
  masked: boolean;
}

export interface ImpactPreview {
  total: number;
  masked: number;
  entries: ImpactPreviewEntry[];
}

/**
 * Resolve the title / icon a Match URL pattern resolves to (review item 6.1).
 *
 * A rule being created has no chain of its own, so the only meaningful value to
 * offer is "what would a tab at this URL show right now?" — answered by the open
 * tabs plus the existing chain (`override > slot > rule > site`). This lets the
 * create form offer `Use matched title` / `Use matched icon` instead of the
 * `Use chain` tab, which would have nothing to fall back to.
 */
export interface ResolveMatchUrlRequest extends RequestBase {
  action: 'RESOLVE_MATCH_URL';
  payload: {
    /** Rule pattern to test against the open tabs. */
    urlMatch: UrlMatchDefinition;
  };
}

export interface ResolveMatchUrlResult {
  /** How many open tabs the pattern matches (0 → no value to offer). */
  matchedTabs: number;
  /** The without-a-doubt winner of the chain among the matched tabs. */
  title: string | null;
  icon: string | null;
  /** Where the offered value came from, for an honest label. */
  source: 'override' | 'slot' | 'rule' | 'site' | null;
}

export interface GetCommandsRequest extends RequestBase {
  action: 'GET_COMMANDS';
}

// Icon operations
export interface DownloadIconRequest extends RequestBase {
  action: 'DOWNLOAD_ICON';
  payload: { url: string; cacheKey: string };
}

export interface UploadIconRequest extends RequestBase {
  action: 'UPLOAD_ICON';
  payload: { dataUri: string; cacheKey: string };
}

// Page opening (sidebar fallback)
export interface OpenPageRequest extends RequestBase {
  action: 'OPEN_PAGE';
  payload: { url: string };
}

// Sidebar opening (B11c / T18). Previously this action existed only as a bare
// string literal inside sidebar-adapter.ts, outside the message contract.
export interface OpenSidebarRequest extends RequestBase {
  action: 'OPEN_SIDEBAR';
  payload?: { windowId?: number };
}

// Update slot URL and match type (Problem 8: double-click URL edit)
export interface UpdateSlotUrlRequest extends RequestBase {
  action: 'UPDATE_SLOT_URL';
  payload: { slotId: number; url: string; matchType: 'exact' | 'regex' };
}

// Conflict cancel (user chose not to overwrite)
export interface ConflictCancelRequest extends RequestBase {
  action: 'CONFLICT_CANCEL';
  payload: { slotId: number };
}

// Conflict overwrite (use captured tab data, not re-query)
export interface ConflictOverwriteRequest extends RequestBase {
  action: 'CONFLICT_OVERWRITE';
  payload: {
    slotId: number;
    tabId: number;
    url: string;
    title: string;
    favIconUrl: string;
  };
}

// ─── Content → Worker Actions ────────────────────────────────────────────────

export interface ContentNavigationReport extends RequestBase {
  action: 'CONTENT_NAVIGATION';
  payload: {
    tabId: number;
    url: string;
    navigationType: 'initial' | 'popstate' | 'hashchange' | 'pushstate' | 'replacestate';
  };
}

export interface ContentReadyReport extends RequestBase {
  action: 'CONTENT_READY';
  payload: { tabId: number; url: string };
}

/**
 * A7: the content script reports the ORIGINAL page value the first time it is
 * about to rewrite the page, so the worker can persist it in the strictly
 * sealed `local.siteSnapshot` store. Never carries a URL or page content.
 */
export interface SiteSnapshotReport extends RequestBase {
  action: 'SITE_SNAPSHOT_REPORT';
  payload: { tabId: number; title: string | null; faviconHref: string | null };
}

// ─── Union of All Requests ───────────────────────────────────────────────────

export type UiRequest =
  | SaveSlotRequest
  | SwitchSlotRequest
  | NextMatchRequest
  | NextMatchSlotRequest
  | PrevMatchSlotRequest
  | UnbindSlotRequest
  | UndoSaveRequest
  | CreateRuleRequest
  | UpdateRuleRequest
  | DeleteRuleRequest
  | SetTabOverrideRequest
  | RemoveTabOverrideRequest
  | SetGlobalStrategyRequest
  | SetSlotStrategyRequest
  | SetSwitchDirectionRequest
  | SetAutoBindGlobalRequest
  | SetSlotAutoBindRequest
  | PositionCurrentPrevRequest
  | PositionCurrentNextRequest
  | UpdateSlotUiMarkerRequest
  | RecoveryOpenUrlRequest
  | RecoveryNextMatchRequest
  | RecoveryPrevMatchRequest
  | RecoveryDismissRequest
  | ExportPackageRequest
  | ImportInspectRequest
  | ImportApplyRequest
  | GetDiagnosticsRequest
  | ClearDiagnosticsRequest
  | ExportDiagnosticsRequest
  | GetStateRequest
  | GetDashboardRequest
  | GetImpactPreviewRequest
  | ResolveMatchUrlRequest
  | GetCommandsRequest
  | DownloadIconRequest
  | UploadIconRequest
  | OpenPageRequest
  | OpenSidebarRequest
  | UpdateSlotUrlRequest
  | NextMatchCurrentRequest
  | PrevMatchCurrentRequest
  | ConflictCancelRequest
  | ConflictOverwriteRequest;

export type ContentRequest =
  | ContentNavigationReport
  | ContentReadyReport
  | SiteSnapshotReport;

export type AnyRequest = UiRequest | ContentRequest;

// ─── Worker → UI Responses ───────────────────────────────────────────────────

export interface SaveSlotResponse {
  action: 'SAVE_SLOT';
  result: { success: true; slot: SlotDefinition } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface SwitchSlotResponse {
  action: 'SWITCH_SLOT';
  result: { success: true; outcome: SwitchOutcome } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface NextMatchResponse {
  action: 'NEXT_MATCH';
  result: { success: true; outcome: SwitchOutcome } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GetStateResponse {
  action: 'GET_STATE';
  result: { success: true; sync: SyncState; local: LocalState } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GetDashboardResponse {
  action: 'GET_DASHBOARD';
  result: { success: true; rows: DashboardRow[] } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GetImpactPreviewResponse {
  action: 'GET_IMPACT_PREVIEW';
  result: { success: true; preview: ImpactPreview } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GetCommandsResponse {
  action: 'GET_COMMANDS';
  result: { success: true; commands: Array<{ name: string; shortcut: string | null; description: string }> } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface ResolveMatchUrlResponse {
  action: 'RESOLVE_MATCH_URL';
  result: { success: true; resolved: ResolveMatchUrlResult } | { success: false; errorCode: DomainErrorCode; message: string };
}



export interface GetDiagnosticsResponse {
  action: 'GET_DIAGNOSTICS';
  result: { success: true; entries: DiagnosticEntry[] } | { success: false; errorCode: DomainErrorCode; message: string };
}

// ─── Import/Export — redesigned protocol responses (T14a) ────────────────────

/** A10/A11: the serialized package. The UI shows it first, then downloads. */
export interface ExportPackageResponse {
  action: 'EXPORT_PACKAGE';
  result: { success: true; package: string } | { success: false; errorCode: DomainErrorCode; message: string };
}

/** A10/A11: the read-only inspection (diff + presence + tolerances + overlaps). */
export interface ImportInspectResponse {
  action: 'IMPORT_INSPECT';
  result: { success: true; inspection: ImportInspection } | { success: false; errorCode: DomainErrorCode; message: string };
}

/** A10/A11: the applied-result checklist (§4.3). */
export interface ImportApplyResponse {
  action: 'IMPORT_APPLY';
  result: { success: true; applied: ImportApplyResult } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface RecoveryResponse {
  action: 'RECOVERY_OPEN_URL' | 'RECOVERY_NEXT_MATCH' | 'RECOVERY_PREV_MATCH' | 'RECOVERY_DISMISS';
  result: { success: true; outcome?: SwitchOutcome } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GenericResponse {
  action: string;
  result: { success: true } | { success: false; errorCode: DomainErrorCode; message: string };
}

// ─── Worker → Content Messages ───────────────────────────────────────────────

/**
 * A4: per-field three-state delivery directive.
 *
 * "Clear" is deliberately NOT expressible here — clearing is implemented as
 * "delete the stored value → recompute the chain → deliver the chain result",
 * so a `restore` (or a `set` to the next tier's value) is what actually arrives.
 */
export type FieldDirective =
  | { kind: 'set'; value: string }
  | { kind: 'restore' }
  | { kind: 'none' };

export interface FieldApplyMessage {
  type: 'FIELD_APPLY';
  title?: FieldDirective;
  favicon?: FieldDirective;
}

export type WorkerToContentMessage = FieldApplyMessage;

// ─── External Change Notification (Worker → UI) ──────────────────────────────

export interface ExternalChangeNotification {
  type: 'EXTERNAL_CHANGE';
  payload: {
    changedKeys: string[];
    newConfigVersion: number;
  };
}

// ─── Action type extraction helper ───────────────────────────────────────────

export type ActionOf<T extends AnyRequest> = T['action'];

/** All valid UI action strings */
export type UiAction = UiRequest['action'];

/** All valid content action strings */
export type ContentAction = ContentRequest['action'];
