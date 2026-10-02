/**
 * FieldDeliveryService — the single WRITE-SIDE delivery coordinator (A2/A3/A5).
 *
 * Every write that can change a field (override / slot marker / rule CRUD /
 * Dashboard edit or clear) lands in storage and then funnels through
 * `recomputeAndRedeliver` — one entry point, so "changed but not applied"
 * becomes structurally impossible rather than a per-writer responsibility.
 *
 * Scheduling rules (A5 / C4):
 * - per-tab single-flight: an in-flight delivery triggers a `pending` flag,
 *   never a queued replay of intermediate states (the trailing run always reads
 *   the LATEST state);
 * - edits are debounced ~300ms;
 * - one retry queue per tab with the fixed 1/2/3/5/10/20/30s ladder, after
 *   which the tab is marked `degraded` (in-memory only).
 *
 * Protection (A8): `isProtectedUrl` is evaluated exactly ONCE, here, at the
 * delivery entry. Protected tabs are reported `protected` and never delivered.
 */

import type { BrowserAdapter } from '@adapters/contract';
import type { StorageRepository } from './storage-repository';
import type { FieldDirective } from '@shared/messages';
import { isProtectedUrl } from '@shared/url-utils';
import { matchesUrl } from '@shared/url-utils';
import { resolveFieldChain } from '@shared/field-chain';
import { applyFieldsToTab, directiveToApplyPayload } from './apply-fields';

export type DeliveryStatus = 'ok' | 'degraded' | 'protected' | 'unknown';

export type DeliveryReport = Record<number, DeliveryStatus>;

/**
 * Internal attempt outcome. `retry` is NOT a user-visible status — it marks a
 * transient failure that should be retried on the fixed ladder, whereas
 * `degraded` is a CAPABILITY statement (the tab was reached through the
 * apply-only fallback, so `restore` cannot be honoured) and is reported
 * immediately (A6: "命中即标 `degraded`").
 */
type AttemptOutcome = DeliveryStatus | 'retry';

/** C4: fixed bounded retry ladder — after the last step the tab is degraded. */
export const RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 10000, 20000, 30000];

/** C4: editing actions are debounced before a delivery is attempted. */
export const EDIT_DEBOUNCE_MS = 300;

/** Test seam: allows the backoff tests to run without real timers. */
export interface DeliveryTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

const defaultTimers: DeliveryTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
  now: () => Date.now(),
};

interface TabDeliveryState {
  inFlight: boolean;
  pending: boolean;
  attempt: number;
  retryTimer: unknown;
  debounceTimer: unknown;
}

export class FieldDeliveryService {
  private readonly states = new Map<number, TabDeliveryState>();
  private readonly degraded = new Set<number>();
  private timers: DeliveryTimers;

  constructor(
    private adapter: BrowserAdapter,
    private repo: StorageRepository,
    timers: DeliveryTimers = defaultTimers,
  ) {
    this.timers = timers;
  }

  /** Test seam: swap the timer implementation. */
  setTimers(timers: DeliveryTimers): void {
    this.timers = timers;
  }

  isDegraded(tabId: number): boolean {
    return this.degraded.has(tabId);
  }

  private stateFor(tabId: number): TabDeliveryState {
    let state = this.states.get(tabId);
    if (!state) {
      state = { inFlight: false, pending: false, attempt: 0, retryTimer: null, debounceTimer: null };
      this.states.set(tabId, state);
    }
    return state;
  }

  // ─── Public entry ───────────────────────────────────────────────────────

  /**
   * Recompute the chain for every affected tab and deliver the result.
   *
   * Leading/trailing (A5): the first call for a tab runs immediately; any
   * further call while it is in flight only marks `pending`, and the in-flight
   * run picks up the LATEST state once through a single trailing pass.
   */
  async recomputeAndRedeliver(tabIds: number[]): Promise<DeliveryReport> {
    const unique = [...new Set(tabIds)];
    const report: DeliveryReport = {};

    await Promise.all(
      unique.map(async (tabId) => {
        report[tabId] = await this.deliverOnce(tabId);
      }),
    );

    return report;
  }

  /**
   * Debounced variant for editing actions (C4: ~300ms). The delivery is run
   * once the typing stops; a new edit resets the timer.
   */
  recomputeAndRedeliverDebounced(tabIds: number[], delayMs = EDIT_DEBOUNCE_MS): void {
    for (const tabId of [...new Set(tabIds)]) {
      const state = this.stateFor(tabId);
      if (state.debounceTimer !== null) this.timers.clearTimeout(state.debounceTimer);
      state.debounceTimer = this.timers.setTimeout(() => {
        state.debounceTimer = null;
        void this.deliverOnce(tabId);
      }, delayMs);
    }
  }

  // ─── Delivery core ──────────────────────────────────────────────────────

  private async deliverOnce(tabId: number): Promise<DeliveryStatus> {
    const state = this.stateFor(tabId);

    // Leading/trailing: never run two deliveries for the same tab at once.
    if (state.inFlight) {
      state.pending = true;
      return this.currentStatus(tabId);
    }

    state.inFlight = true;
    try {
      const status = await this.performDelivery(tabId);

      if (status === 'ok' || status === 'protected') {
        state.attempt = 0;
        this.degraded.delete(tabId);
        return status;
      }

      if (status === 'degraded') {
        // The content script was unreachable and the stateless fallback handled
        // the write — this is a standing capability limitation, reported now.
        this.degraded.add(tabId);
        return 'degraded';
      }

      if (status === 'retry') {
        // Transient failure: walk the full 1/2/3/5/10/20/30s ladder (7 retries,
        // each one ALSO reset-free), after which the tab is degraded.
        if (state.attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[state.attempt];
          state.attempt += 1;
          if (state.retryTimer !== null) this.timers.clearTimeout(state.retryTimer);
          state.retryTimer = this.timers.setTimeout(() => {
            state.retryTimer = null;
            void this.deliverOnce(tabId);
          }, delay);
          return 'degraded';
        }
        this.degraded.add(tabId);
        return 'degraded';
      }

      // unknown
      return status;
    } finally {
      state.inFlight = false;
      // Trailing run: the state was mutated while we were in flight.
      if (state.pending) {
        state.pending = false;
        void this.deliverOnce(tabId);
      }
    }
  }

  /** Read the latest state and push the resulting directives. */
  private async performDelivery(tabId: number): Promise<AttemptOutcome> {
    const local = await this.repo.getLocalState();
    const sync = await this.repo.getSyncState();

    let tabUrl: string | null = null;
    try {
      const tab = await this.adapter.tabs.get(tabId);
      tabUrl = tab.url;
    } catch {
      // Tab no longer exists.
      return 'unknown';
    }
    if (!tabUrl) return 'unknown';

    // A8: the ONE protection decision point.
    if (isProtectedUrl(tabUrl)) return 'protected';

    const titleChain = resolveFieldChain('title', { sync, local, tabId, tabUrl });
    const faviconChain = resolveFieldChain('favicon', { sync, local, tabId, tabUrl });

    const title = this.directiveFor(titleChain);
    const favicon = this.directiveFor(faviconChain);

    return this.push(tabId, { title, favicon });
  }

  /**
   * A4: a winner ABOVE the site tier becomes `set`. A winner that IS the site
   * tier is not an extension value — it is the reference — so it becomes
   * `restore` (title ← the page-scoped snapshot; favicon ← remove our link and
   * fall back to the site's own). An unknown site value becomes `none` (the page
   * is left alone and the UI shows `—`).
   *
   * The site/favicon distinction matters: `set`-ing the captured favicon value
   * would INSERT a second link rather than fall back to the site's own one.
   */
  private directiveFor(chain: import('@shared/field-chain').ChainResult): FieldDirective {
    const { winner, tiers } = chain;
    if (winner.source !== 'site' && winner.value !== null) {
      return { kind: 'set', value: winner.value };
    }
    return tiers.site.known ? { kind: 'restore' } : { kind: 'none' };
  }

  /**
   * Deliver one `FIELD_APPLY` message.
   *
   * The content script is the ONLY implementation (it holds the page-scoped
   * snapshot that `restore` needs). When it is unreachable we fall back to the
   * stateless `executeScript` apply-only path — which is reported as `degraded`
   * precisely because `restore` cannot be honoured there.
   */
  private async push(tabId: number, directives: { title: FieldDirective; favicon: FieldDirective }): Promise<AttemptOutcome> {
    const needsRestore = directives.title.kind === 'restore' || directives.favicon.kind === 'restore';

    try {
      await this.adapter.tabs.sendMessage(tabId, {
        type: 'FIELD_APPLY',
        title: directives.title,
        favicon: directives.favicon,
      });
      return 'ok';
    } catch {
      // Content script unreachable → apply-only fallback.
    }

    const payload = {
      title: directiveToApplyPayload(directives.title),
      favicon: directiveToApplyPayload(directives.favicon),
    };
    if (payload.title === undefined && payload.favicon === undefined) {
      // Nothing the fallback can express; a restore-only request degrades to
      // "stop rewriting" (the page keeps whatever the site has).
      return needsRestore ? 'degraded' : 'ok';
    }

    // Apply-only fallback (A6): a successful fallback is still `degraded`,
    // because `restore` cannot be honoured on a stateless path. If even the
    // fallback fails, the failure is transient → retry on the fixed ladder.
    const applied = await applyFieldsToTab(this.adapter, tabId, payload);
    return applied ? 'degraded' : 'retry';
  }

  private currentStatus(tabId: number): DeliveryStatus {
    return this.degraded.has(tabId) ? 'degraded' : 'ok';
  }

  // ─── Affected-set helpers (A3) ──────────────────────────────────────────

  /** A rule write affects every tab whose URL it matched OR now matches. */
  async affectedTabsForRule(rule: { urlMatch: import('@shared/types').UrlMatchDefinition }): Promise<number[]> {
    const allTabs = await this.adapter.tabs.query({});
    return allTabs
      .filter((tab) => !isProtectedUrl(tab.url) && matchesUrl(tab.url, rule.urlMatch))
      .map((tab) => tab.id);
  }
}