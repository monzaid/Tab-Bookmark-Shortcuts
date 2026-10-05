/**
 * Rule Service — page rewrite rules and field-level chain computation.
 *
 * - Rule matching with priority/createdAt selection (via the shared chain)
 * - Field-level computation delegated to `@shared/field-chain` (single source)
 * - Protected URL rejection for rules
 * - Immediate re-delivery on save for matching tabs
 * - Does NOT save/restore DOM snapshots
 * - Does NOT continuously monitor page titles
 */

import type { BrowserAdapter } from '@adapters/contract';
import type { StorageRepository } from './storage-repository';
import type {
  PageRule,
  UrlMatchDefinition,
  IconSource,
  LocalState,
  SyncState,
} from '@shared/types';
import { resolveFieldChain } from '@shared/field-chain';
import {
  matchesUrl,
  detectRuleConflict,
  isProtectedUrl,
  isSafeFaviconProtocol,
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

    // 1. Validate the favicon protocol (T33 / B9-8). The compute layer skips
    //    unsafe values, but rejecting them at the WRITE layer stops the bad
    //    value from being persisted and re-surfacing on every read.
    //
    //    T12/R1: exempt `type:'template'` — a recipe carries `value:''` (the
    //    recipe fields are the truth, T7), so `isSafeFaviconProtocol('')` would
    //    falsely reject it. Security equivalence: the recipe value never reaches
    //    `link.href`; it is rendered to a PNG that then passes the gate, and the
    //    delivery/chain layers remain guarded. Only the recipe branch is relaxed.
    if (params.favicon && params.favicon.type !== 'template' && !isSafeFaviconProtocol(params.favicon.value)) {
      return {
        success: false,
        errorCode: 'RULE_INVALID_REGEX',
        message: 'Unsupported favicon protocol. Use http(s) or a data: image.',
      };
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
        message: 'A rule with the same match pattern already exists.',
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
        message: 'A rule with the same match pattern already exists.',
      };
    }

    // Q11: every rule participates in the chain — apply to matching tabs now.
    await this.applyToMatchingTabs(rule);

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
    updates: Partial<Pick<PageRule, 'urlMatch' | 'priority' | 'title' | 'favicon' | 'enabled'>>,
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
        message: 'This rule was modified elsewhere. Please refresh and retry.',
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

    // T33 (B9-8): a favicon arriving through update must clear the same
    // protocol gate as createRule, otherwise the write layer is bypassable.
    //
    // T12/R1: the SAME `type:'template'` exemption as createRule (the edit-rule
    // path carries recipes too — normalizeRuleDraft → resolveDraftFavicon). Only
    // the recipe branch is relaxed; every other type keeps the protocol check,
    // so the write layer is NOT bypassable.
    if (updates.favicon && updates.favicon.type !== 'template' && !isSafeFaviconProtocol(updates.favicon.value)) {
      return {
        success: false,
        errorCode: 'RULE_INVALID_REGEX',
        message: 'Unsupported favicon protocol. Use http(s) or a data: image.',
      };
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
          message: 'A rule with the same match pattern already exists.',
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
    await this.applyToMatchingTabs(updated);

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

    // Re-trigger all tabs that matched the deleted rule's URL pattern so the
    // removed rule's icon/title is undone (falls back to original/slot/other
    // rules). The clear is implicit now: the chain no longer yields the rule's
    // value, so the delivery layer emits `set` to the next tier or `restore`.
    if (target) {
      await this.applyToMatchingTabs(target);
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
    return this.computeFieldsFrom(local, sync, tabId, tabUrl);
  }

  /**
   * Pure field computation over an already-resolved state snapshot (B7b / T11).
   *
   * Callers that process many tabs (e.g. `reapplyToMatchingTabs`) read the state
   * ONCE and reuse it, turning an N× fan-out into a single read. This carries the
   * entire priority chain — it is the same implementation `computeFields` uses,
   * so `computeFields` behaviour is unchanged by construction.
   */
  computeFieldsFrom(
    local: LocalState,
    sync: SyncState,
    tabId: number,
    tabUrl: string,
  ): FieldComputation {
    // The priority chain is delegated to the single shared implementation so
    // this service can never disagree with the three views (SC1 / A1). The
    // `site` tier of the chain result is intentionally not consulted here: the
    // delivery layer decides `set` / `restore` from the site snapshot it holds.
    const title = resolveFieldChain('title', { sync, local, tabId, tabUrl });
    const favicon = resolveFieldChain('favicon', { sync, local, tabId, tabUrl });

    return {
      title: title.winner.value,
      favicon: favicon.winner.value,
      titleSource: title.winner.source,
      faviconSource: favicon.winner.source,
    };
  }

  // ─── Delivery hook (A2 single entry) ───────────────────────────────────

  /**
   * The delivery entry point, injected by the worker (A2: the coordinator is
   * constructed with the services, not the other way round). Every write that
   * can change a field routes here AFTER storage has been updated, so
   * "changed but not applied" cannot happen per-writer.
   */
  private deliver: (tabIds: number[]) => Promise<unknown> = async () => undefined;

  setDelivery(fn: (tabIds: number[]) => Promise<unknown>): void {
    this.deliver = fn;
  }

  // ─── Tab Override ──────────────────────────────────────────────────────

  /**
   * Set a temporary tabId override (field-level partial MERGE).
   * Only updates provided fields — does NOT wipe unprovided fields.
   *
   * Storage write is the critical operation; the redelivery that follows is the
   * same single entry used by every other write path.
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

    await this.repo.setTabOverride(merged);

    // A3: an override affects exactly this tabId.
    await this.deliver([tabId]);
  }

  /**
   * Remove a temporary tabId override and redeliver so the cleared field falls
   * back to the next tier (spy #6: removal previously did NOT redeliver).
   */
  async removeTabOverride(tabId: number): Promise<void> {
    await this.repo.removeTabOverride(tabId);
    await this.deliver([tabId]);
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

  /** A rule write affects every tab it matches (A3: multi-hit dimension). */
  private async applyToMatchingTabs(rule: PageRule): Promise<void> {
    const allTabs = await this.adapter.tabs.query({});
    // A8: protection is NOT decided here — the delivery entry owns that single
    // decision. This only computes the URL-match affected set.
    const tabIds = allTabs
      .filter((tab) => matchesUrl(tab.url, rule.urlMatch))
      .map((tab) => tab.id);
    await this.deliver(tabIds);
  }
}
