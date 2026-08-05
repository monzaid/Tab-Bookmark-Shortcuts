/**
 * Service Worker — lifecycle, message routing, command dispatch, cleanup events.
 *
 * - Startup: cache hydrate + cleanup (stale tabIds, expired recovery)
 * - commands.onCommand: 21 command dispatch
 * - UI/content request routing to services
 * - tabs.onRemoved: atomic cleanup
 * - Recovery TTL cleanup
 * - Rule computation + content script delivery
 * - Notification and domain error translation
 *
 * Does NOT: depend on long-lived Worker/port, let UI call browser APIs directly
 */

import type { BrowserAdapter } from '@adapters/contract';
import { StorageRepository } from './storage-repository';
import { SlotService } from './slot-service';
import { RecoveryService } from './recovery-service';
import { RuleService } from './rule-service';
import { IconService } from './icon-service';
import { ImportExportService } from './import-export-service';
import { DiagnosticsService, NotificationService, IncognitoService } from './diagnostics-service';
import type { AnyRequest } from '@shared/messages';
import { openOrReusePage } from '@shared/open-page';
import { isProtectedUrl } from '@shared/url-utils';
import { applyFieldsToTab } from './apply-fields';

// ─── Worker Orchestrator ─────────────────────────────────────────────────────

export class WorkerOrchestrator {
  readonly repo: StorageRepository;
  readonly slotService: SlotService;
  readonly recoveryService: RecoveryService;
  readonly ruleService: RuleService;
  readonly iconService: IconService;
  readonly importExportService: ImportExportService;
  readonly diagnostics: DiagnosticsService;
  readonly notifications: NotificationService;
  readonly incognito: IncognitoService;

  private initialized = false;

  constructor(private adapter: BrowserAdapter) {
    this.repo = new StorageRepository(adapter);
    this.slotService = new SlotService(adapter, this.repo);
    this.recoveryService = new RecoveryService(adapter, this.repo);
    this.ruleService = new RuleService(adapter, this.repo);
    this.iconService = new IconService(this.repo);
    this.importExportService = new ImportExportService(this.repo);
    this.diagnostics = new DiagnosticsService(adapter, this.repo);
    this.notifications = new NotificationService(adapter);
    this.incognito = new IncognitoService(adapter);
  }

  /**
   * Initialize: register event listeners FIRST (cold-start safety), then hydrate cache and run cleanup.
   * Listeners must be registered synchronously before any await to ensure messages
   * arriving during MV3 Service Worker cold start are not lost.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register event listeners BEFORE async work — ensures messages are captured during cold start
    this.adapter.commands.onCommand(this.handleCommand.bind(this));
    this.adapter.tabs.onRemoved(this.handleTabRemoved.bind(this));
    this.adapter.tabs.onUpdated(this.handleTabUpdated.bind(this));
    this.adapter.runtime.onMessage(this.handleMessage.bind(this));

    await this.repo.initialize();
    await this.repo.startupCleanup();
    await this.recoveryService.cleanupExpired();

    this.initialized = true;
    await this.diagnostics.record('SUCCESS', 'worker_init');
  }

  /**
   * Handle cold start — re-hydrate if cache is invalid.
   */
  async ensureReady(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ─── Command Dispatch ──────────────────────────────────────────────────

  private async handleCommand(command: string): Promise<void> {
    await this.ensureReady();

    try {
      // Parse command: save-slot-N, switch-slot-N, next-match
      if (command === 'next-match') {
        const result = await this.slotService.nextMatch();
        if (result.success && result.outcome.type === 'switched' && result.outcome.crossWindow) {
          await this.notifications.notify({ type: 'cross_window_switch', crossWindow: true });
        }
        await this.diagnostics.record(result.success ? 'SUCCESS' : 'NO_MATCH', 'next_match');
        return;
      }

      const saveMatch = command.match(/^save-slot-(\d+)$/);
      if (saveMatch) {
        const slotId = parseInt(saveMatch[1]);
        const version = this.repo.getConfigVersion();

        // Check if slot is already occupied (Problem 3: conflict confirm)
        const sync = await this.repo.getSyncState();
        const existingSlot = sync.slots.find((s) => s.id === slotId);

        if (existingSlot) {
          // Get current active tab info for the conflict dialog
          const tabs = await this.adapter.tabs.query({ active: true, currentWindow: true });
          const activeTab = tabs[0];
          if (activeTab) {
            const params = new URLSearchParams({
              slotId: String(slotId),
              oldTitle: existingSlot.titleSnapshot ?? '',
              oldUrl: existingSlot.urlMatch.type === 'exact' ? existingSlot.urlMatch.value : '',
              newTitle: activeTab.title ?? '',
              newUrl: activeTab.url ?? '',
              tabId: String(activeTab.id),
              favIconUrl: activeTab.favIconUrl ?? '',
            });
            await this.adapter.windows.create({
              url: this.adapter.runtime.getURL(`src/ui/conflict-confirm/index.html?${params.toString()}`),
              type: 'popup',
              width: 400,
              height: 420,
              focused: true,
            });
            await this.diagnostics.record('SUCCESS', 'save_slot_conflict_prompt');
            return;
          }
        }

        const result = await this.slotService.saveSlot(slotId, version);
        await this.diagnostics.record(result.success ? 'SUCCESS' : 'INTERNAL_ERROR', 'save_slot');

        // Problem 3a: Show notification on successful save
        if (result.success) {
          const tabs = await this.adapter.tabs.query({ active: true, currentWindow: true });
          const savedTitle = tabs[0]?.title ?? 'Unknown page';
          const notificationId = `tbs-save-${slotId}-${Date.now()}`;
          try {
            await this.adapter.notifications.create(notificationId, {
              type: 'basic',
              title: 'Tab Bookmark Shortcuts',
              message: `Saved to Slot ${slotId}: ${savedTitle}`,
              iconUrl: this.adapter.runtime.getURL('icons/icon-128.png'),
            });
            // Auto-clear after 5 seconds
            setTimeout(() => {
              this.adapter.notifications.clear(notificationId).catch(() => {});
            }, 5000);
          } catch {
            // Notification failure is non-critical but must not vanish silently
            await this.diagnostics.record('BROWSER_API_ERROR', 'save_slot_notification');
          }
        }
        return;
      }

      const switchMatch = command.match(/^switch-slot-(\d+)$/);
      if (switchMatch) {
        const slotId = parseInt(switchMatch[1]);
        const result = await this.slotService.switchSlot(slotId);
        if (result.success) {
          const outcome = result.outcome;
          if (outcome.type === 'switched' && outcome.crossWindow) {
            await this.notifications.notify({ type: 'cross_window_switch', slotId, crossWindow: true });
          }
          if (outcome.type === 'needs_recovery') {
            await this.notifications.notify({ type: 'no_target', slotId });
            // Open recovery window with slot info params
            const syncState = await this.repo.getSyncState();
            const recoverySlot = syncState.slots.find((s) => s.id === slotId);
            const recoveryParams = new URLSearchParams({
              recoveryId: outcome.recoveryId,
              title: recoverySlot?.titleSnapshot ?? '',
              url: recoverySlot?.urlMatch.type === 'exact' ? recoverySlot.urlMatch.value : '',
            });
            await this.adapter.windows.create({
              url: this.adapter.runtime.getURL(`src/ui/recovery/index.html?${recoveryParams.toString()}`),
              type: 'popup',
              width: 400,
              height: 300,
              focused: true,
            });
          }
        }
        await this.diagnostics.record(result.success ? 'SUCCESS' : 'SLOT_NOT_FOUND', 'switch_slot');
        return;
      }

      // Unknown command
      await this.diagnostics.record('COMMAND_NOT_FOUND', 'unknown_command');
    } catch (e) {
      await this.diagnostics.record('INTERNAL_ERROR', 'command_handler');
    }
  }

  // ─── Tab Removed Cleanup ───────────────────────────────────────────────

  private async handleTabRemoved(tabId: number, _removeInfo: { windowId: number; isWindowClosing: boolean }): Promise<void> {
    await this.ensureReady();
    await this.repo.cleanupForRemovedTab(tabId);
  }

  /**
   * Handle tab update events (page refresh / navigation) — the persistence mechanism.
   *
   * Mirrors the reference plugin (Tab_Renmae/background.js): on `status === 'complete'`
   * (and/or a URL change) we re-apply the full field chain to the tab so titles and
   * favicons survive refresh. This is the ROBUST delivery path that complements the
   * content-script reporting path (which is unreliable for already-open tabs).
   */
  private async handleTabUpdated(
    tabId: number,
    changeInfo: { url?: string; status?: string },
    tab: import('@adapters/contract').NormalizedTab,
  ): Promise<void> {
    await this.ensureReady();

    // Re-apply on load completion and/or URL change (mirrors reference plugin).
    const shouldReapply = changeInfo.status === 'complete' || changeInfo.url !== undefined;
    if (!shouldReapply) return;

    const url = tab.url ?? changeInfo.url;
    if (!url) return;

    await this.handleContentNavigation(tabId, url, true);
  }

  // ─── Message Routing ───────────────────────────────────────────────────

  private handleMessage(message: unknown, sender: { tab?: { id?: number; url?: string } }, sendResponse: (response?: unknown) => void): boolean {
    // Async handling — return true to indicate async response
    void this.routeMessage(message, sender).then(sendResponse).catch(() => {
      sendResponse({ success: false, errorCode: 'INTERNAL_ERROR', message: 'Worker error' });
    });
    return true;
  }

  private async routeMessage(message: unknown, sender: { tab?: { id?: number } }): Promise<unknown> {
    await this.ensureReady();

    if (!message || typeof message !== 'object') {
      return { success: false, errorCode: 'INVALID_REQUEST', message: 'Invalid message format' };
    }

    const request = message as AnyRequest;

    switch (request.action) {
      // ─── Slot operations ─────────────────────────────────────────────
      case 'SAVE_SLOT': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.slotService.saveSlot(
          request.payload.slotId,
          version,
          request.payload.uiMarker,
          request.payload.strategy,
        );
      }

      case 'SWITCH_SLOT':
        return this.slotService.switchSlot(request.payload.slotId);

      case 'NEXT_MATCH':
        return this.slotService.nextMatch();

      case 'NEXT_MATCH_SLOT':
        return this.slotService.nextMatchForSlot(request.payload.slotId);

      case 'PREV_MATCH_SLOT':
        return this.slotService.prevMatchForSlot(request.payload.slotId);

      case 'NEXT_MATCH_CURRENT':
        return this.slotService.nextMatchForUrl(request.payload.url);

      case 'PREV_MATCH_CURRENT':
        return this.slotService.prevMatchForUrl(request.payload.url);

      case 'UNBIND_SLOT':
        await this.slotService.unbindSlot(request.payload.slotId);
        return { success: true };

      case 'UNDO_SAVE': {
        // Undo is handled by re-saving previous state (simplified)
        await this.slotService.unbindSlot(request.payload.slotId);
        return { success: true };
      }

      // ─── Rule operations ─────────────────────────────────────────────
      // No version check — single-user local extension, direct write.
      case 'CREATE_RULE': {
        try {
          return await this.ruleService.createRule(request.payload);
        } catch (e) {
          return { success: false, errorCode: 'INTERNAL', message: String(e) };
        }
      }

      case 'UPDATE_RULE': {
        try {
          // expectedUpdatedAt is a version marker, not a rule field — extract it
          // so it never leaks into the persisted rule object.
          const payload = request.payload as {
            ruleId: string;
            expectedUpdatedAt?: string;
            urlMatch?: import('@shared/types').UrlMatchDefinition;
            mode?: import('@shared/types').RuleMode;
            priority?: number;
            title?: string;
            favicon?: import('@shared/types').IconSource;
            enabled?: boolean;
          };
          const { ruleId, expectedUpdatedAt, ...updates } = payload;
          return await this.ruleService.updateRule(ruleId, updates, expectedUpdatedAt);
        } catch (e) {
          return { success: false, errorCode: 'INTERNAL', message: String(e) };
        }
      }

      case 'DELETE_RULE': {
        try {
          return await this.ruleService.deleteRule(request.payload.ruleId);
        } catch (e) {
          return { success: false, errorCode: 'INTERNAL', message: String(e) };
        }
      }

      case 'APPLY_RULE_TO_TAB':
        return this.ruleService.applyToTab(request.payload.ruleId, request.payload.tabId);

      // ─── Tab override ────────────────────────────────────────────────
      case 'SET_TAB_OVERRIDE':
        await this.ruleService.setTabOverride(request.payload.tabId, request.payload.title, request.payload.favicon);
        return { success: true };

      case 'REMOVE_TAB_OVERRIDE':
        await this.ruleService.removeTabOverride(request.payload.tabId);
        return { success: true };

      // ─── Settings ────────────────────────────────────────────────────
      case 'SET_GLOBAL_STRATEGY': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.repo.setGlobalStrategy(request.payload.strategy, version);
      }

      case 'SET_SLOT_STRATEGY': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        const sync = await this.repo.getSyncState();
        const slot = sync.slots.find((s) => s.id === request.payload.slotId);
        if (!slot) {
          // Problem 2: empty slots should also be able to set strategy override
          // Create a minimal slot configuration with the strategy
          const now = new Date().toISOString();
          const minimalSlot: import('@shared/types').SlotDefinition = {
            id: request.payload.slotId,
            urlMatch: { type: 'exact', value: '' },
            strategy: request.payload.strategy,
            uiMarker: {},
            titleSnapshot: '',
            faviconSnapshot: '',
            createdAt: now,
            updatedAt: now,
          };
          return this.repo.saveSlot(minimalSlot, version);
        }
        return this.repo.saveSlot({ ...slot, strategy: request.payload.strategy }, version);
      }

      case 'UPDATE_SLOT_UI_MARKER': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        const sync = await this.repo.getSyncState();
        const slot = sync.slots.find((s) => s.id === request.payload.slotId);
        if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', message: 'Slot not found' };
        const saved = await this.repo.saveSlot(
          { ...slot, uiMarker: request.payload.uiMarker, updatedAt: new Date().toISOString() },
          version,
        );
        if (!saved.success) return saved;
        // Problem: slot tier must win — re-apply the slot's fields to its bound
        // tabId immediately so the browser tab reflects the modified icon/title
        // (and current page syncs when it is the bound tab). Only the bound tabId
        // is affected; other matching tabs fall through to rule/original tiers.
        await this.reapplyFieldsToBoundTab(request.payload.slotId);
        return saved;
      }

      // ─── Slot URL update (Problem 8: double-click URL edit) ─────────
      case 'UPDATE_SLOT_URL': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        const sync = await this.repo.getSyncState();
        const slot = sync.slots.find((s) => s.id === request.payload.slotId);
        if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', message: 'Slot not found' };
        const updatedSlot = {
          ...slot,
          urlMatch: { type: request.payload.matchType, value: request.payload.url },
          updatedAt: new Date().toISOString(),
        };
        return this.repo.saveSlot(updatedSlot, version);
      }

      // ─── Recovery ────────────────────────────────────────────────────
      case 'RECOVERY_OPEN_URL':
        return this.recoveryService.openUrl(request.payload.recoveryId);

      case 'RECOVERY_NEXT_MATCH':
        return this.recoveryService.nextMatch(request.payload.recoveryId);

      case 'RECOVERY_DISMISS':
        await this.recoveryService.dismiss(request.payload.recoveryId);
        return { success: true };

      // ─── Import/Export ───────────────────────────────────────────────
      case 'EXPORT_CONFIG':
        return this.importExportService.exportConfig();

      case 'IMPORT_PREVIEW':
        return this.importExportService.generatePreview(request.payload.json);

      case 'IMPORT_COMMIT': {
        const version = request.configVersion ?? this.repo.getConfigVersion();
        return this.importExportService.commitImport(request.payload.preview, request.payload.slotDecisions, version);
      }

      // ─── Diagnostics ─────────────────────────────────────────────────
      case 'GET_DIAGNOSTICS': {
        const entries = await this.diagnostics.getEntries();
        return { success: true, entries };
      }

      case 'CLEAR_DIAGNOSTICS':
        await this.diagnostics.clear();
        return { success: true };

      case 'EXPORT_DIAGNOSTICS': {
        const json = await this.diagnostics.export();
        return { success: true, json };
      }

      // ─── State queries ───────────────────────────────────────────────
      case 'GET_STATE': {
        const sync = await this.repo.getSyncState();
        const local = await this.repo.getLocalState();
        return { success: true, sync, local };
      }

      case 'GET_DASHBOARD': {
        const sync = await this.repo.getSyncState();
        const local = await this.repo.getLocalState();

        // Map tabId -> url for current-page entries.
        const allTabs = await this.adapter.tabs.query({});
        const tabUrlById = new Map<number, string>();
        for (const t of allTabs) if (t.url) tabUrlById.set(t.id, t.url);

        const items: import('@shared/types').DashboardItem[] = [];

        // Current-page overrides (tabOverrides)
        for (const o of local.tabOverrides) {
          items.push({
            id: `cp-${o.tabId}`,
            kind: 'current-page',
            label: `Tab ${o.tabId}`,
            title: o.title?.trim() ? o.title : null,
            icon: o.favicon?.value?.trim() ? o.favicon.value : null,
            url: tabUrlById.get(o.tabId) ?? null,
            tabId: o.tabId,
          });
        }

        // Slot uiMarkers (custom title / icon set via the slot object)
        for (const slot of sync.slots) {
          const hasData = slot.uiMarker.customTitle?.trim() || slot.uiMarker.icon?.value;
          if (!hasData) continue;
          items.push({
            id: `slot-${slot.id}`,
            kind: 'slot',
            label: `Slot ${slot.id}`,
            title: slot.uiMarker.customTitle?.trim() || null,
            icon: slot.uiMarker.icon?.value?.trim() || null,
            url: slot.urlMatch.value ?? null,
            slotId: slot.id,
          });
        }

        return { success: true, items };
      }

      case 'GET_COMMANDS': {
        const commands = await this.adapter.commands.getAll();
        return { success: true, commands };
      }

      case 'GET_CANDIDATES': {
        if (request.payload.ruleId) {
          return this.ruleService.getManualCandidates(request.payload.ruleId);
        }
        // Slot candidates handled by switch logic
        return { success: true, candidates: [] };
      }

      // ─── Icon operations ─────────────────────────────────────────────
      case 'DOWNLOAD_ICON':
        return this.iconService.downloadAndCache(request.payload.url, request.payload.cacheKey);

      case 'UPLOAD_ICON':
        await this.repo.setIconCache(request.payload.cacheKey, request.payload.dataUri);
        return { success: true };

      // ─── Page opening (sidebar fallback, Problem 1) ─────────────────
      // Bug 1: reuse an already-open tab instead of always creating a new one.
      // Matching is hash-insensitive; a different hash triggers a hash-only
      // navigation (activate + update url), never a new tab.
      case 'OPEN_PAGE': {
        const msg = message as { payload?: { url?: string } };
        const url = msg.payload?.url;
        if (url) {
          await openOrReusePage({
            queryAllTabs: async () => {
              const tabs = await this.adapter.tabs.query({});
              return tabs.map((t) => ({ id: t.id, url: t.url }));
            },
            activateTab: async (tabId) => {
              await this.adapter.tabs.update(tabId, { active: true });
            },
            navigateTab: async (tabId, targetUrl) => {
              await this.adapter.tabs.update(tabId, { url: targetUrl });
            },
            createTab: async (targetUrl) => {
              await this.adapter.tabs.create({ url: targetUrl, active: true });
            },
          }, url);
        }
        return { success: true };
      }

      // ─── Conflict cancel (Problem 3) ────────────────────────────────
      case 'CONFLICT_CANCEL':
        // No-op: user chose not to overwrite. Just acknowledge.
        return { success: true };

      // ─── Conflict overwrite (Problem 1 fix: use captured tab data) ──
      case 'CONFLICT_OVERWRITE': {
        const version = this.repo.getConfigVersion();
        const overwriteResult = await this.slotService.saveSlotFromData(
          request.payload.slotId,
          version,
          {
            tabId: request.payload.tabId,
            url: request.payload.url,
            title: request.payload.title,
            favIconUrl: request.payload.favIconUrl,
          },
        );
        // Problem 3: Show notification on successful conflict overwrite
        if (overwriteResult.success) {
          const notificationId = `tbs-save-${request.payload.slotId}-${Date.now()}`;
          try {
            await this.adapter.notifications.create(notificationId, {
              type: 'basic',
              title: 'Tab Bookmark Shortcuts',
              message: `Saved to Slot ${request.payload.slotId}: ${request.payload.title}`,
              iconUrl: this.adapter.runtime.getURL('icons/icon-128.png'),
            });
            setTimeout(() => {
              this.adapter.notifications.clear(notificationId).catch(() => {});
            }, 5000);
          } catch {
            // Notification failure is non-critical but must not vanish silently
            await this.diagnostics.record('BROWSER_API_ERROR', 'save_slot_notification');
          }
        }
        return overwriteResult;
      }

      // ─── Content script messages ─────────────────────────────────────
      case 'CONTENT_NAVIGATION': {
        // Handle navigation report from content script
        const tabId = sender.tab?.id;
        if (tabId) {
          await this.handleContentNavigation(tabId, request.payload.url, false);
        }
        return { success: true };
      }

      case 'CONTENT_READY': {
        // DOM is ready — re-push overrides with force to ensure favicon is applied
        const tabId = sender.tab?.id;
        if (tabId) {
          await this.handleContentNavigation(tabId, request.payload.url, true);
        }
        return { success: true };
      }

      default:
        return { success: false, errorCode: 'UNKNOWN_ACTION', message: 'Unknown action' };
    }
  }

  // ─── Content Navigation Handler ────────────────────────────────────────

  private async handleContentNavigation(tabId: number, url: string, force = false): Promise<void> {
    // Compute fields via the shared source of truth (RuleService.computeFields).
    // This resolves the full priority chain: slot (bound tab) → override → rule → site.
    const computed = await this.ruleService.computeFields(tabId, url, '', '');

    if (computed.title || computed.favicon) {
      // Robust delivery: executeScript primary (works on already-open tabs),
      // sendMessage fallback for restricted pages.
      await applyFieldsToTab(this.adapter, tabId, {
        title: computed.title ?? undefined,
        favicon: computed.favicon ?? undefined,
        force,
      });
    }
  }

  /**
   * Re-apply the full field chain (slot → override → rule → site) to the tab that
   * is bound to a given slot. Used when a slot's icon/title is modified so the
   * bound tabId immediately reflects the slot values (slot tier wins).
   *
   * Strictly tabId-scoped: only the bound tabId is touched; other tabs that merely
   * match the same URL are not affected (they fall through to rule/original tiers).
   */
  private async reapplyFieldsToBoundTab(slotId: number): Promise<void> {
    const local = await this.repo.getLocalState();
    const binding = local.bindings.find((b) => b.slotId === slotId);
    if (!binding) return;
    try {
      const tab = await this.adapter.tabs.get(binding.tabId);
      if (isProtectedUrl(tab.url)) return;
      await this.handleContentNavigation(binding.tabId, tab.url, true);
    } catch {
      // Tab no longer exists — nothing to re-apply.
    }
  }
}

// ─── Bootstrap (only in actual Service Worker context) ───────────────────────

export function bootstrapWorker(adapter: BrowserAdapter): WorkerOrchestrator {
  const orchestrator = new WorkerOrchestrator(adapter);
  void orchestrator.initialize();
  return orchestrator;
}
