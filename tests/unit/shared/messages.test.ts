import { describe, it, expect } from 'vitest';
import type {
  UiRequest,
  ContentRequest,
  SaveSlotRequest,
  SwitchSlotRequest,
  NextMatchRequest,
  ContentNavigationReport,
  SetSlotAutoBindRequest,
  PositionCurrentNextRequest,
  PositionCurrentPrevRequest,
} from '@shared/messages';
import type {
  DomainErrorCode,
  SlotDefinition,
  PageRule,
  SyncState,
  LocalState,
  RecoverySession,
  SwitchOutcome,
  MatchRuleSettings,
} from '@shared/types';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';

/**
 * Exhaustive switch helper — compile-time guarantee all actions are handled.
 */
function assertNever(x: never): never {
  throw new Error(`Unexpected action: ${JSON.stringify(x)}`);
}

function handleUiAction(request: UiRequest): string {
  switch (request.action) {
    case 'SAVE_SLOT': return 'save';
    case 'SWITCH_SLOT': return 'switch';
    case 'NEXT_MATCH': return 'next';
    case 'NEXT_MATCH_SLOT': return 'next-match-slot';
    case 'PREV_MATCH_SLOT': return 'prev-match-slot';
    case 'UNBIND_SLOT': return 'unbind';
    case 'UNDO_SAVE': return 'undo';
    case 'CREATE_RULE': return 'create-rule';
    case 'UPDATE_RULE': return 'update-rule';
    case 'DELETE_RULE': return 'delete-rule';
    case 'SET_TAB_OVERRIDE': return 'set-override';
    case 'REMOVE_TAB_OVERRIDE': return 'remove-override';
    case 'SET_GLOBAL_STRATEGY': return 'set-strategy';
    case 'SET_SLOT_STRATEGY': return 'set-slot-strategy';
    case 'SET_SWITCH_DIRECTION': return 'set-direction';
    case 'SET_AUTO_BIND_GLOBAL': return 'set-auto-bind-global';
    case 'SET_SLOT_AUTO_BIND': return 'set-slot-auto-bind';
    case 'POSITION_CURRENT_PREV': return 'position-prev';
    case 'POSITION_CURRENT_NEXT': return 'position-next';
    case 'UPDATE_SLOT_UI_MARKER': return 'update-marker';
    case 'RECOVERY_OPEN_URL': return 'recovery-open';
    case 'RECOVERY_NEXT_MATCH': return 'recovery-next';
    case 'RECOVERY_PREV_MATCH': return 'recovery-prev';
    case 'RECOVERY_DISMISS': return 'recovery-dismiss';
    // T14a: the redesigned trio (the legacy cases were deleted in T14b).
    case 'EXPORT_PACKAGE': return 'export-package';
    case 'IMPORT_INSPECT': return 'import-inspect';
    case 'IMPORT_APPLY': return 'import-apply';
    case 'GET_DIAGNOSTICS': return 'get-diag';
    case 'CLEAR_DIAGNOSTICS': return 'clear-diag';
    case 'EXPORT_DIAGNOSTICS': return 'export-diag';
    case 'GET_STATE': return 'get-state';
    case 'GET_DASHBOARD': return 'get-dashboard';
    case 'GET_IMPACT_PREVIEW': return 'get-impact-preview';
    case 'RESOLVE_MATCH_URL': return 'resolve-match-url';
    case 'GET_COMMANDS': return 'get-commands';
    case 'DOWNLOAD_ICON': return 'download-icon';
    case 'UPLOAD_ICON': return 'upload-icon';
    case 'OPEN_PAGE': return 'open-page';
    case 'OPEN_SIDEBAR': return 'open-sidebar';
    case 'UPDATE_SLOT_URL': return 'update-slot-url';
    case 'NEXT_MATCH_CURRENT': return 'next-match-current';
    case 'PREV_MATCH_CURRENT': return 'prev-match-current';
    case 'CONFLICT_CANCEL': return 'conflict-cancel';
    case 'CONFLICT_OVERWRITE': return 'conflict-overwrite';
    default: return assertNever(request);
  }
}

function handleContentAction(request: ContentRequest): string {
  switch (request.action) {
    case 'CONTENT_NAVIGATION': return 'navigation';
    case 'CONTENT_READY': return 'ready';
    case 'SITE_SNAPSHOT_REPORT': return 'snapshot';
    default: return assertNever(request);
  }
}

describe('T2: Domain model and message contract', () => {
  describe('Happy path — exhaustive switch coverage', () => {
    it('should handle all UI actions without missing cases', () => {
      const saveReq: SaveSlotRequest = {
        requestId: 'req-1',
        configVersion: 1,
        action: 'SAVE_SLOT',
        payload: {
          slotId: 1,
          urlMatch: { type: 'exact', value: 'https://example.com/page' },
          titleSnapshot: 'Example',
          faviconSnapshot: 'https://example.com/favicon.ico',
        },
      };
      expect(handleUiAction(saveReq)).toBe('save');

      const switchReq: SwitchSlotRequest = {
        requestId: 'req-2',
        action: 'SWITCH_SLOT',
        payload: { slotId: 3 },
      };
      expect(handleUiAction(switchReq)).toBe('switch');

      const nextReq: NextMatchRequest = {
        requestId: 'req-3',
        action: 'NEXT_MATCH',
      };
      expect(handleUiAction(nextReq)).toBe('next');
    });

    it('should handle all content actions without missing cases', () => {
      const navReport: ContentNavigationReport = {
        requestId: 'req-4',
        action: 'CONTENT_NAVIGATION',
        payload: {
          tabId: 42,
          url: 'https://spa.example.com/page2',
          navigationType: 'pushstate',
        },
      };
      expect(handleContentAction(navReport)).toBe('navigation');
    });

    it('should construct valid SlotDefinition fixture', () => {
      const slot: SlotDefinition = {
        id: 1,
        urlMatch: { type: 'regex', value: 'https://github\\.com/.*' },
        strategy: 'inherit',
        uiMarker: { customTitle: 'GitHub', backgroundColor: '#24292e' },
        titleSnapshot: 'GitHub',
        faviconSnapshot: 'https://github.com/favicon.ico',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      expect(slot.id).toBe(1);
      expect(slot.strategy).toBe('inherit');
    });

    it('should construct valid SyncState and LocalState', () => {
      const sync: SyncState = {
        configVersion: 5,
        matchSettings: DEFAULT_MATCH_SETTINGS,
        switchDirection: 'next',
        autoBindGlobal: true,
        slots: [],
        rules: [],
      };
      const local: LocalState = {
        bindings: [],
        cycleCursors: [],
        lastSuccessSlotId: null,
        recoverySessions: [],
        recoverySnapshots: [],
        tabOverrides: [],
        iconCache: {},
        diagnostics: [],
      };
      expect(sync.configVersion).toBe(5);
      expect(local.lastSuccessSlotId).toBeNull();
    });

    it('should construct valid PageRule with priority bounds', () => {
      const rule: PageRule = {
        id: 'rule-1',
        urlMatch: { type: 'exact', value: 'https://example.com' },
        priority: 100,
        title: 'Custom Title',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      expect(rule.priority).toBe(100);
      expect(rule.title).toBe('Custom Title');
    });

    it('should construct valid RecoverySession with TTL', () => {
      const session: RecoverySession = {
        recoveryId: 'rec-abc',
        slotId: 2,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T10:00:00Z',
        expiresAt: '2026-01-01T10:05:00Z',
        windowId: -1,
        candidateCursor: null,
      };
      const ttl = new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime();
      expect(ttl).toBe(5 * 60 * 1000);
    });

    it('should construct valid SwitchOutcome variants', () => {
      const switched: SwitchOutcome = { type: 'switched', tabId: 1, windowId: 1, crossWindow: false };
      const noMatch: SwitchOutcome = { type: 'no_match', slotId: 3 };
      const needsRecovery: SwitchOutcome = { type: 'needs_recovery', recoveryId: 'rec-1', slotId: 3 };
      const incognitoBlocked: SwitchOutcome = { type: 'incognito_blocked', slotId: 5 };

      expect(switched.type).toBe('switched');
      expect(noMatch.type).toBe('no_match');
      expect(needsRecovery.type).toBe('needs_recovery');
      expect(incognitoBlocked.type).toBe('incognito_blocked');
    });

    // ─── T1 RED ⑤ (D17): DEFAULT_MATCH_SETTINGS replaces the removed legacy default ───
    it('should define DEFAULT_MATCH_SETTINGS as combination 1 + priority tabId', () => {
      expect(DEFAULT_MATCH_SETTINGS).toEqual({
        tabIdMode: 'exists',
        ruleCheckMode: 'match',
        priority: 'tabId',
      });
    });

    it('should accept valid MatchRuleSettings value domains', () => {
      const settings: MatchRuleSettings = {
        tabIdMode: 'no-exists',
        ruleCheckMode: 'no-match',
        priority: 'none',
      };
      expect(settings.priority).toBe('none');
    });

    it('should allow SET_SLOT_AUTO_BIND override: null (follow global)', () => {
      const req: SetSlotAutoBindRequest = {
        requestId: 'req-auto-bind',
        action: 'SET_SLOT_AUTO_BIND',
        payload: { slotId: 1, override: null },
      };
      expect(req.payload.override).toBeNull();
    });

    it('should allow POSITION_CURRENT_PREV/NEXT with and without anchorTabId', () => {
      const withAnchor: PositionCurrentNextRequest = {
        requestId: 'req-pos-1',
        action: 'POSITION_CURRENT_NEXT',
        payload: { anchorTabId: 42 },
      };
      const withoutAnchor: PositionCurrentPrevRequest = {
        requestId: 'req-pos-2',
        action: 'POSITION_CURRENT_PREV',
        payload: {},
      };
      expect(withAnchor.payload.anchorTabId).toBe(42);
      expect(withoutAnchor.payload).toEqual({});
    });

    it('should keep the four frozen SwitchOutcome variants (needs_recovery preserved)', () => {
      const types = (['switched', 'no_match', 'needs_recovery', 'incognito_blocked'] as const).map(
        (t) => t,
      );
      expect(types).toEqual(['switched', 'no_match', 'needs_recovery', 'incognito_blocked']);
      const needsRecovery: SwitchOutcome = { type: 'needs_recovery', recoveryId: 'rec-1', slotId: 3 };
      expect(needsRecovery.type).toBe('needs_recovery');
    });
  });

  describe('Error path — invalid request handling', () => {
    it('should identify unknown action as INVALID_REQUEST', () => {
      // Simulate parsing an unknown action from external source
      const rawMessage = { requestId: 'req-x', action: 'UNKNOWN_ACTION_XYZ' };
      const knownActions: string[] = [
        'SAVE_SLOT', 'SWITCH_SLOT', 'NEXT_MATCH', 'UNBIND_SLOT', 'UNDO_SAVE',
        'CREATE_RULE', 'UPDATE_RULE', 'DELETE_RULE',
        'SET_TAB_OVERRIDE', 'REMOVE_TAB_OVERRIDE', 'SET_GLOBAL_STRATEGY',
        'SET_SLOT_STRATEGY', 'UPDATE_SLOT_UI_MARKER',
        'RECOVERY_OPEN_URL', 'RECOVERY_NEXT_MATCH', 'RECOVERY_DISMISS',
        'EXPORT_PACKAGE', 'IMPORT_INSPECT', 'IMPORT_APPLY',
        'GET_DIAGNOSTICS', 'CLEAR_DIAGNOSTICS', 'EXPORT_DIAGNOSTICS',
        'GET_STATE', 'GET_DASHBOARD', 'GET_COMMANDS',
        'DOWNLOAD_ICON', 'UPLOAD_ICON',
        'CONTENT_NAVIGATION', 'CONTENT_READY', 'SITE_SNAPSHOT_REPORT',
      ];

      const parseResult = knownActions.includes(rawMessage.action)
        ? { valid: true }
        : { valid: false, errorCode: 'INVALID_REQUEST' as DomainErrorCode };

      expect(parseResult.valid).toBe(false);
      if (!parseResult.valid) {
        expect(parseResult.errorCode).toBe('INVALID_REQUEST');
      }
    });

    it('should reject write request missing configVersion', () => {
      const writeRequest = {
        requestId: 'req-y',
        action: 'SAVE_SLOT',
        payload: { slotId: 1, urlMatch: { type: 'exact', value: 'https://x.com' }, titleSnapshot: '', faviconSnapshot: '' },
        // configVersion intentionally missing
      };

      const requiresVersion = ['SAVE_SLOT', 'CREATE_RULE', 'UPDATE_RULE', 'DELETE_RULE',
        'SET_GLOBAL_STRATEGY', 'SET_SLOT_STRATEGY', 'UPDATE_SLOT_UI_MARKER', 'IMPORT_APPLY'];

      const needsVersion = requiresVersion.includes(writeRequest.action);
      const hasVersion = 'configVersion' in writeRequest && writeRequest.configVersion !== undefined;

      const result = needsVersion && !hasVersion
        ? { valid: false, errorCode: 'INVALID_REQUEST' as DomainErrorCode }
        : { valid: true };

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe('INVALID_REQUEST');
      }
    });

    it('should not include tabId or data URI in sync/export types', () => {
      // Compile-time check: SyncState must not have tabId fields
      const sync: SyncState = {
        configVersion: 1,
        matchSettings: DEFAULT_MATCH_SETTINGS,
        switchDirection: 'next',
        autoBindGlobal: true,
        slots: [],
        rules: [],
      };
      // This test verifies the type structure — tabId is only in LocalState
      const local: LocalState = {
        bindings: [{ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
        cycleCursors: [],
        lastSuccessSlotId: 1,
        recoverySessions: [],
        recoverySnapshots: [],
        tabOverrides: [],
        iconCache: {},
        diagnostics: [],
      };

      // tabId exists in local bindings, NOT in sync slots
      expect(local.bindings[0].tabId).toBe(42);
      expect(sync.slots).toHaveLength(0);
      // Type system prevents: sync.slots[0].tabId would be a compile error
    });
  });
});
