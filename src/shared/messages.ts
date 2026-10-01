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
  RuleMode,
  IconSource,
  ImportPreview,
  ImportSlotConflict,
  TabCandidate,
  SwitchOutcome,
  DiagnosticEntry,
  SlotDefinition,
  SyncState,
  LocalState,
  DashboardItem,
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
    mode: RuleMode;
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
    mode?: RuleMode;
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

export interface ApplyRuleToTabRequest extends RequestBase {
  action: 'APPLY_RULE_TO_TAB';
  payload: { ruleId: string; tabId: number };
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

// Import/Export operations
export interface ExportConfigRequest extends RequestBase {
  action: 'EXPORT_CONFIG';
}

export interface ImportPreviewRequest extends RequestBase {
  action: 'IMPORT_PREVIEW';
  payload: { json: string };
}

export interface ImportCommitRequest extends RequestBase {
  action: 'IMPORT_COMMIT';
  payload: {
    preview: ImportPreview;
    slotDecisions: ImportSlotConflict[];
  };
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

export interface GetCommandsRequest extends RequestBase {
  action: 'GET_COMMANDS';
}

export interface GetCandidatesRequest extends RequestBase {
  action: 'GET_CANDIDATES';
  payload: { slotId?: number; ruleId?: string };
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
  | ApplyRuleToTabRequest
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
  | ExportConfigRequest
  | ImportPreviewRequest
  | ImportCommitRequest
  | GetDiagnosticsRequest
  | ClearDiagnosticsRequest
  | ExportDiagnosticsRequest
  | GetStateRequest
  | GetDashboardRequest
  | GetCommandsRequest
  | GetCandidatesRequest
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
  | ContentReadyReport;

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
  result: { success: true; items: DashboardItem[] } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GetCommandsResponse {
  action: 'GET_COMMANDS';
  result: { success: true; commands: Array<{ name: string; shortcut: string | null; description: string }> } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GetCandidatesResponse {
  action: 'GET_CANDIDATES';
  result: { success: true; candidates: TabCandidate[] } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface ImportPreviewResponse {
  action: 'IMPORT_PREVIEW';
  result: { success: true; preview: ImportPreview } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface GetDiagnosticsResponse {
  action: 'GET_DIAGNOSTICS';
  result: { success: true; entries: DiagnosticEntry[] } | { success: false; errorCode: DomainErrorCode; message: string };
}

export interface ExportConfigResponse {
  action: 'EXPORT_CONFIG';
  result: { success: true; json: string } | { success: false; errorCode: DomainErrorCode; message: string };
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

export interface ApplyRewriteMessage {
  type: 'APPLY_REWRITE';
  payload: {
    title?: string;
    favicon?: string;
    /** Force re-application bypassing once-per-URL guard (user-initiated edits) */
    force?: boolean;
  };
}

export type WorkerToContentMessage = ApplyRewriteMessage;

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
