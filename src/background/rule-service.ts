/**
 * Rule Service — page rewrite rules, field-level override computation, manual apply.
 *
 * - Auto/manual rule matching with priority/createdAt selection
 * - Field-level computation chain: tabId temp override → rule → original site
 * - Protected URL rejection for rules
 * - Immediate apply on save for current tab
 * - Cross-window manual candidate query
 * - Does NOT save/restore DOM snapshots
 * - Does NOT continuously monitor page titles
 */

import type { BrowserAdapter } from '@adapters/contract';
import type { StorageRepository } from './storage-repository';
import { applyFieldsToTab } from './apply-fields';
import type {
  PageRule,
  RuleMode,
  UrlMatchDefinition,
  IconSource,
  TabCandidate,
} from '@shared/types';
import {
  matchesUrl,
  detectRuleConflict,
  isProtectedUrl,
  validateRegex,
  urlsMatch,
} from '@shared/url-utils';
import type { ConflictResult } from '@shared/url-utils';

// ─── Field Computation Result ────────────────────────────────────────────────

export interface FieldComputation {
  title: string | null;
  favicon: string | null;
  titleSource: 'slot' | 'override' | 'rule' | 'site';
  faviconSource: 'slot' | 'override' | 'rule' | 'site';
}

// ─── Rule Service ────────────────────────────────────────────────────────────

export class RuleService {
  constructor(
    private adapter: BrowserAdapter,
    private repo: StorageRepository,
  ) {}

  // ─── Rule CRUD ─────────────────────────────────────────────────────────

  /**
   * Create a new page rule. Strict save chain:
   * 1. Validate input (protected URL, regex syntax, priority bounds)
   * 2. Read current configVersion (latest state from repo — cross-channel freshness)
   * 3. Duplicate detection (identical urlMatch) → DUPLICATE_RULE
   *    then undecidable-overlap detection → block level → RULE_CONFLICT_BLOCK
   * 4. Write (repo.addRule)
   * 5. auto mode → apply immediately to all matching tabs
   *
   * Both settings page and sidebar route CREATE_RULE here, so conflict
   * detection reads the same latest storage state for both channels.
   */
  async createRule(
    params: {
      urlMatch: UrlMatchDefinition;
      mode: RuleMode;
      priority: number;
      title?: string;
      favicon?: IconSource;
      enabled?: boolean;
    },
    _expectedVersion?: number,
  ): Promise<
    { success: true; rule: PageRule } |
    { success: false; errorCode: string; message: string; conflict?: ConflictResult }
  > {
    // 1. Validate protected URL
    if (params.urlMatch.type === 'exact' && isProtectedUrl(params.urlMatch.value)) {
      return { success: false, errorCode: 'RULE_PROTECTED_URL', message: 'Cannot create rules for protected internal pages' };
    }

    // 1. Validate regex syntax
    if (params.urlMatch.type === 'regex') {
      const validation = validateRegex(params.urlMatch.value);
      if (!validation.valid) {
        return {
          success: false,
          errorCode: validation.error === 'REGEX_TOO_LONG' ? 'RULE_REGEX_TOO_LONG' : 'RULE_INVALID_REGEX',
          message: validation.message ?? 'Invalid regex',
        };
      }
    }

    // 1. Validate priority bounds (clamp)
    const priority = Math.max(-100, Math.min(100, params.priority));

    // 2. Fetch the latest sync state (includes current configVersion).
    //    getSyncState() re-hydrates from storage when the cache is invalid,
    //    guaranteeing cross-channel freshness (settings vs sidebar).
    const sync = await this.repo.getSyncState();
    void sync.configVersion; // version tracked internally by mutateSync

    // 3a. Duplicate detection — identical URL pattern (exact normalized or regex literal)
    const isDuplicate = sync.rules.some((r) => {
      if (r.urlMatch.type !== params.urlMatch.type) return false;
      if (params.urlMatch.type === 'exact') {
        return urlsMatch(r.urlMatch.value, params.urlMatch.value);
      }
      return r.urlMatch.value === params.urlMatch.value;
    });
    if (isDuplicate) {
      return {
        success: false,
        errorCode: 'DUPLICATE_RULE',
        message: '已存在相同匹配规则的规则，请勿重复添加',
      };
    }

    // 3b. Undecidable potential overlap → block level conflicts
    const conflict = detectRuleConflict(params.urlMatch, sync.rules);
    if (conflict.level === 'block') {
      return {
        success: false,
        errorCode: 'RULE_CONFLICT_BLOCK',
        message: conflict.message ?? 'Rule conflict detected',
        conflict,
      };
    }

    const now = new Date().toISOString();
    const rule: PageRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      urlMatch: params.urlMatch,
      mode: params.mode,
      priority,
      title: params.title,
      favicon: params.favicon,
      enabled: params.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };

    // Direct write — no version check. addRule performs an ATOMIC duplicate
    // check inside the serialized write queue, so a concurrent CREATE_RULE that
    // slipped past the pre-check above cannot append a second identical rule.
    const added = await this.repo.addRule(rule);

    if (!added) {
      return {
        success: false,
        errorCode: 'DUPLICATE_RULE',
        message: '已存在相同匹配规则的规则，请勿重复添加',
      };
    }

    // If auto rule, apply to current matching tab immediately
    if (rule.mode === 'auto') {
      await this.applyToMatchingTabs(rule);
    }

    return { success: true, rule };
  }

  /**
   * Update an existing rule with a lightweight version check.
   *
   * If `expectedUpdatedAt` is provided (captured when the editor was opened),
   * the stored rule's `updatedAt` must match exactly; otherwise VERSION_CONFLICT
   * is returned and nothing is written. On success `updatedAt` advances.
   * Omitting `expectedUpdatedAt` skips the check (backwards compatible).
   */
  async updateRule(
    ruleId: string,
    updates: Partial<Pick<PageRule, 'urlMatch' | 'mode' | 'priority' | 'title' | 'favicon' | 'enabled'>>,
    expectedUpdatedAt?: string,
  ): Promise<
    { success: true; rule: PageRule } |
    { success: false; errorCode: string; message: string; conflict?: ConflictResult }
  > {
    const sync = await this.repo.getSyncState();
    const existing = sync.rules.find((r) => r.id === ruleId);
    if (!existing) {
      return { success: false, errorCode: 'RULE_NOT_FOUND', message: `Rule ${ruleId} not found` };
    }

    // Lightweight version check — updatedAt timestamp comparison
    if (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) {
      return {
        success: false,
        errorCode: 'VERSION_CONFLICT',
        message: '规则已被其他渠道修改，请刷新后重试',
      };
    }

    // Validate protected URL if urlMatch is being updated
    if (updates.urlMatch?.type === 'exact' && isProtectedUrl(updates.urlMatch.value)) {
      return { success: false, errorCode: 'RULE_PROTECTED_URL', message: 'Cannot set rules for protected internal pages' };
    }

    // Validate regex if being updated
    if (updates.urlMatch?.type === 'regex') {
      const validation = validateRegex(updates.urlMatch.value);
      if (!validation.valid) {
        return {
          success: false,
          errorCode: validation.error === 'REGEX_TOO_LONG' ? 'RULE_REGEX_TOO_LONG' : 'RULE_INVALID_REGEX',
          message: validation.message ?? 'Invalid regex',
        };
      }
    }

    // Duplicate + conflict checks (exclude self) when urlMatch is being changed
    if (updates.urlMatch) {
      // Duplicate detection — identical URL pattern as ANOTHER rule (exclude self)
      const isDuplicate = sync.rules.some((r) => {
        if (r.id === ruleId) return false;
        if (r.urlMatch.type !== updates.urlMatch!.type) return false;
        if (updates.urlMatch!.type === 'exact') {
          return urlsMatch(r.urlMatch.value, updates.urlMatch!.value);
        }
        return r.urlMatch.value === updates.urlMatch!.value;
      });
      if (isDuplicate) {
        return {
          success: false,
          errorCode: 'DUPLICATE_RULE',
          message: '已存在相同匹配规则的规则，请勿重复添加',
        };
      }

      const conflict = detectRuleConflict(updates.urlMatch, sync.rules, ruleId);
      if (conflict.level === 'block') {
        return {
          success: false,
          errorCode: 'RULE_CONFLICT_BLOCK',
          message: conflict.message ?? 'Rule conflict detected',
          conflict,
        };
      }
    }

    // Clamp priority
    const clampedUpdates = {
      ...updates,
      priority: updates.priority !== undefined ? Math.max(-100, Math.min(100, updates.priority)) : undefined,
    };

    // Direct write — no version check
    const updated = await this.repo.updateRuleById(ruleId, clampedUpdates);
    if (!updated) {
      return { success: false, errorCode: 'RULE_NOT_FOUND', message: `Rule ${ruleId} not found` };
    }

    // Re-apply to all matching tabs immediately
    await this.reapplyToMatchingTabs(updated);

    return { success: true, rule: updated };
  }

  /**
   * Delete a rule and re-apply the field chain to all tabs that matched it.
   * No version check — single-user local extension, direct write.
   */
  async deleteRule(ruleId: string): Promise<
    { success: true } | { success: false; errorCode: string; message: string }
  > {
    // Capture the rule's urlMatch BEFORE removal so we can re-trigger the tabs
    // that matched it. After removal their effective fields fall back to the
    // lower tiers (slot-bound / override / remaining rules / original site).
    const before = await this.repo.getSyncState();
    const target = before.rules.find((r) => r.id === ruleId);

    const found = await this.repo.removeRuleById(ruleId);
    if (!found) {
      return { success: false, errorCode: 'RULE_NOT_FOUND', message: `Rule ${ruleId} not found` };
    }

    // Re-apply to all tabs that matched the deleted rule's URL pattern so the
    // removed rule's icon/title is undone (falls back to original/slot/other rules).
    // Uses a variant that CLEARS the previously-applied rewrite on tabs whose
    // computed fields now fall back to the site's original value (nothing to set).
    if (target) {
      await this.reapplyToMatchingTabs(target, true);
    }

    return { success: true };
  }

  // ─── Field Computation ─────────────────────────────────────────────────

  /**
   * Compute effective title/favicon for a tab using the field-level chain.
   *
   * Priority tier (highest → lowest):
   *   current page (tab's own temporary override — what the user directly edited) >
   *   slot-bound-tab (applies ONLY to the slot's bound tabId, never other matching tabs) >
   *   page rewrite rule >
   *   original site value
   *
   * The slot tier is resolved and, crucially, only when a SlotBinding exists
   * whose `tabId` equals the current `tabId`. Tabs that merely match the same URL
   * but are NOT the bound tabId fall straight through to the override/rule tiers.
   */
  async computeFields(tabId: number, tabUrl: string, _siteTitle: string, _siteFavicon: string): Promise<FieldComputation> {
    const local = await this.repo.getLocalState();
    const sync = await this.repo.getSyncState();

    // Slot tier: applies ONLY to the slot's bound tabId.
    const slotField = this.resolveSlotField(tabId, local.bindings, sync.slots);

    // Current page tier (highest): tab's own temporary override.
    const override = local.tabOverrides.find((o) => o.tabId === tabId);

    // Find matching auto rules (only enabled ones)
    const matchingRules = sync.rules
      .filter((r) => r.mode === 'auto' && r.enabled !== false && matchesUrl(tabUrl, r.urlMatch))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    const winningRule = matchingRules.length > 0 ? matchingRules[0] : null;

    // Compute title — current page (override) tier wins, then slot, then rule.
    let title: string | null = null;
    let titleSource: FieldComputation['titleSource'] = 'site';

    if (override?.title) {
      title = override.title;
      titleSource = 'override';
    } else if (slotField?.title) {
      title = slotField.title;
      titleSource = 'slot';
    } else if (winningRule?.title) {
      title = winningRule.title;
      titleSource = 'rule';
    }

    // Compute favicon — current page (override) tier wins, then slot, then rule.
    let favicon: string | null = null;
    let faviconSource: FieldComputation['faviconSource'] = 'site';

    if (override?.favicon) {
      favicon = override.favicon.value;
      faviconSource = 'override';
    } else if (slotField?.favicon) {
      favicon = slotField.favicon;
      faviconSource = 'slot';
    } else if (winningRule?.favicon) {
      favicon = winningRule.favicon.value;
      faviconSource = 'rule';
    }

    return { title, favicon, titleSource, faviconSource };
  }

  /**
   * Resolve the slot field for a specific tabId.
   *
   * Returns a field value ONLY when a SlotBinding's `tabId` matches the given tabId.
   * The slot's title comes from `titleSnapshot`; the favicon's rewrite value is taken
   * from `faviconSnapshot` when present, falling back to `uiMarker.icon.value` when it
   * is a usable value. This tier is strictly tabId-scoped — it never bleeds onto other
   * tabs that merely match the same URL.
   */
  private resolveSlotField(
    tabId: number,
    bindings: import('@shared/types').SlotBinding[],
    slots: import('@shared/types').SlotDefinition[],
  ): { title: string | null; favicon: string | null } | null {
    const binding = bindings.find((b) => b.tabId === tabId);
    if (!binding) return null;

    const slot = slots.find((s) => s.id === binding.slotId);
    if (!slot) return null;

    // User-modified uiMarker wins over the stale snapshot (current page > snapshot).
    const title = slot.uiMarker.customTitle?.trim() || slot.titleSnapshot.trim() || null;

    let favicon: string | null = null;
    if (slot.uiMarker.icon?.value.trim()) {
      favicon = slot.uiMarker.icon.value;
    } else if (slot.faviconSnapshot.trim()) {
      favicon = slot.faviconSnapshot;
    }

    if (!title && !favicon) return null;
    return { title, favicon };
  }

  // ─── Manual Apply ──────────────────────────────────────────────────────

  /**
   * Apply a rule to a specific tab (manual mode).
   */
  async applyToTab(ruleId: string, tabId: number): Promise<
    { success: true } | { success: false; errorCode: string; message: string }
  > {
    const sync = await this.repo.getSyncState();
    const rule = sync.rules.find((r) => r.id === ruleId);
    if (!rule) {
      return { success: false, errorCode: 'RULE_NOT_FOUND', message: `Rule ${ruleId} not found` };
    }

    // Verify tab exists and URL matches
    try {
      const tab = await this.adapter.tabs.get(tabId);

      // Check protected URL
      if (isProtectedUrl(tab.url)) {
        return { success: false, errorCode: 'PROTECTED_PAGE', message: 'Cannot apply rules to protected pages' };
      }

      if (!matchesUrl(tab.url, rule.urlMatch)) {
        return { success: false, errorCode: 'NO_MATCH', message: 'Tab URL does not match rule pattern' };
      }

      // Apply title/favicon via robust delivery (executeScript primary + sendMessage fallback)
      await applyFieldsToTab(this.adapter, tabId, {
        title: rule.title,
        favicon: rule.favicon?.value,
      });

      return { success: true };
    } catch (e) {
      return { success: false, errorCode: 'TAB_NOT_FOUND', message: `Tab ${tabId} not found` };
    }
  }

  /**
   * Get cross-window candidates for manual rule application.
   */
  async getManualCandidates(ruleId: string): Promise<
    { success: true; candidates: TabCandidate[] } | { success: false; errorCode: string; message: string }
  > {
    const sync = await this.repo.getSyncState();
    const rule = sync.rules.find((r) => r.id === ruleId);
    if (!rule) {
      return { success: false, errorCode: 'RULE_NOT_FOUND', message: `Rule ${ruleId} not found` };
    }

    const incognitoAllowed = await this.adapter.incognito.isAllowed();
    const allTabs = await this.adapter.tabs.query({});
    const currentWindow = await this.adapter.windows.getCurrent();

    const candidates: TabCandidate[] = allTabs
      .filter((tab) => {
        if (tab.incognito && !incognitoAllowed) return false;
        if (isProtectedUrl(tab.url)) return false;
        return matchesUrl(tab.url, rule.urlMatch);
      })
      .map((tab) => ({
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
        isCurrentWindow: tab.windowId === currentWindow.id,
        isIncognito: tab.incognito,
      }));

    // Sort: current window first, then by index
    candidates.sort((a, b) => {
      if (a.isCurrentWindow && !b.isCurrentWindow) return -1;
      if (!a.isCurrentWindow && b.isCurrentWindow) return 1;
      if (a.windowId === b.windowId) return a.index - b.index;
      return a.windowId - b.windowId;
    });

    return { success: true, candidates };
  }

  // ─── Tab Override ──────────────────────────────────────────────────────

  /**
   * Set a temporary tabId override (field-level partial MERGE).
   * Only updates provided fields — does NOT wipe unprovided fields.
   *
   * Problem 5 fix: storage write success = operation success.
   * APPLY_REWRITE send failure is non-fatal (logged, retried once after 100ms).
   */
  async setTabOverride(tabId: number, title?: string | null, favicon?: IconSource | null): Promise<void> {
    // Merge with existing override — only update provided fields. A `null` value
    // means "clear this field" (title '' or favicon removed), so the field chain
    // falls through to slot → rule → original.
    const local = await this.repo.getLocalState();
    const existing = local.tabOverrides.find((o) => o.tabId === tabId);

    const merged: { tabId: number; title?: string; favicon?: IconSource; createdAt: string } = {
      tabId,
      title: title !== undefined ? (title === null ? '' : title) : existing?.title,
      favicon: favicon !== undefined ? (favicon === null ? undefined : favicon) : existing?.favicon,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    // Storage write is the critical operation — if this succeeds, the operation succeeds
    await this.repo.setTabOverride(merged);

    // Apply immediately to the tab with the FULL merged state (force bypasses once-per-URL guard)
    // Failure here is NON-FATAL — the override is already persisted and will be applied
    // on next CONTENT_READY or navigation event.
    // When favicon was cleared, push an explicit clear so the tab DOM reverts.
    await applyFieldsToTab(this.adapter, tabId, {
      title: merged.title,
      favicon: favicon === null ? null : merged.favicon?.value,
      force: true,
    });
  }

  /**
   * Remove a temporary tabId override.
   * Does NOT restore DOM — site recovers on refresh/navigation.
   */
  async removeTabOverride(tabId: number): Promise<void> {
    await this.repo.removeTabOverride(tabId);
  }

  // ─── Conflict Check (for UI) ───────────────────────────────────────────

  /**
   * Check conflict for a proposed rule without saving.
   */
  async checkConflict(urlMatch: UrlMatchDefinition, excludeRuleId?: string): Promise<ConflictResult> {
    const sync = await this.repo.getSyncState();
    return detectRuleConflict(urlMatch, sync.rules, excludeRuleId);
  }

  // ─── Private ───────────────────────────────────────────────────────────

  /**
   * Apply an auto rule to all currently matching tabs.
   * Computes the full field chain (tabId override → rule → site) via computeFields
   * so priority/override resolution stays correct, and pushes with force:true so the
   * content script bypasses the once-per-URL guard.
   */
  private async applyToMatchingTabs(rule: PageRule): Promise<void> {
    await this.reapplyToMatchingTabs(rule);
  }

  /**
   * Re-apply computed fields to all tabs matching a rule's URL pattern.
   * Used after rule update/enable/disable so tabs reflect changes immediately.
   * Computes the full field chain (override → rule → site) for each matching tab.
   *
   * When `clearOnEmpty` is true (used on rule delete), tabs whose computed fields
   * now fall back to the site's original value receive an explicit CLEAR (null
   * title/favicon) so the previously-applied rewrite is undone in the page DOM.
   */
  private async reapplyToMatchingTabs(rule: PageRule, clearOnEmpty = false): Promise<void> {
    const allTabs = await this.adapter.tabs.query({});

    for (const tab of allTabs) {
      if (isProtectedUrl(tab.url)) continue;
      if (!matchesUrl(tab.url, rule.urlMatch)) continue;

      // Compute the full field chain for this tab (considers override + all rules)
      const computed = await this.computeFields(tab.id, tab.url, tab.title, tab.favIconUrl);

      // On delete, if there is nothing computed to set, send an explicit CLEAR so
      // the removed rule's rewrite is undone (title/favicon revert to the site).
      const clear = clearOnEmpty && !computed.title && !computed.favicon;
      await applyFieldsToTab(this.adapter, tab.id, {
        title: clear ? null : (computed.title ?? undefined),
        favicon: clear ? null : (computed.favicon ?? undefined),
        force: true,
      });
    }
  }
}
