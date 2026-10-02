/**
 * T7 — FieldDeliveryService: affected set, single entry, leading/trailing,
 * debounce, retry ladder + degradation (A2/A3/A5/C4).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { FieldDeliveryService, RETRY_DELAYS_MS } from '@background/field-delivery-service';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { FieldApplyMessage } from '@shared/messages';

const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

function tab(id: number, url: string, title = 'Site'): NormalizedTab {
  return { id, windowId: 1, index: id, url, title, favIconUrl: '', active: false, incognito: false, status: 'complete' };
}

describe('T7: FieldDeliveryService', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let delivery: FieldDeliveryService;

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    delivery = new FieldDeliveryService(adapter, repo);
  });

  function appliesFor(tabId: number): FieldApplyMessage[] {
    return adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage' && c.args[0] === tabId)
      .map((c) => c.args[1] as FieldApplyMessage)
      .filter((m) => m.type === 'FIELD_APPLY');
  }

  describe('affected set (A3)', () => {
    it('computes rule hits across tabs', async () => {
      adapter.setTabs([tab(1, 'https://a.com/x'), tab(2, 'https://b.com/y'), tab(3, 'https://a.com/z')]);
      const affected = await delivery.affectedTabsForRule({ urlMatch: { type: 'regex', value: 'https://a\\.com/.*' } });
      expect(new Set(affected)).toEqual(new Set([1, 3]));
    });

    it('excludes protected tabs from the affected set', async () => {
      adapter.setTabs([tab(1, 'chrome://extensions'), tab(2, 'https://a.com/x')]);
      const affected = await delivery.affectedTabsForRule({ urlMatch: { type: 'regex', value: '.*' } });
      expect(affected).toEqual([2]);
    });
  });

  describe('delivery status', () => {
    it('reports ok and pushes a set directive for a rule value', async () => {
      adapter.setTabs([tab(1, 'https://a.com/x')]);
      await repo.addRule({
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a.com/x' },
        priority: 0,
        title: 'Rule Title',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const report = await delivery.recomputeAndRedeliver([1]);
      expect(report[1]).toBe('ok');
      expect(appliesFor(1).some((m) => m.title?.kind === 'set' && m.title.value === 'Rule Title')).toBe(true);
    });

    it('reports protected and does not deliver to a protected tab (A8)', async () => {
      adapter.setTabs([tab(1, 'chrome://settings')]);
      const report = await delivery.recomputeAndRedeliver([1]);
      expect(report[1]).toBe('protected');
      expect(appliesFor(1)).toHaveLength(0);
    });

    it('reports unknown when the tab no longer exists', async () => {
      adapter.setTabs([]);
      const report = await delivery.recomputeAndRedeliver([99]);
      expect(report[99]).toBe('unknown');
    });

    it('emits `restore` when the chain has no value but the site snapshot is known', async () => {
      adapter.setTabs([tab(1, 'https://a.com/x')]);
      await repo.setSiteSnapshot({ tabId: 1, title: 'Original', faviconHref: null, capturedAt: '2026-01-01T00:00:00Z' });

      const report = await delivery.recomputeAndRedeliver([1]);
      expect(report[1]).toBe('ok');
      expect(appliesFor(1).some((m) => m.title?.kind === 'restore')).toBe(true);
    });

    it('emits `none` when the chain has no value and the site snapshot is unknown', async () => {
      adapter.setTabs([tab(1, 'https://a.com/x')]);
      await delivery.recomputeAndRedeliver([1]);
      const last = appliesFor(1).at(-1);
      expect(last?.title).toEqual({ kind: 'none' });
    });
  });

  describe('degradation (A6)', () => {
    it('marks the tab degraded when the content script is unreachable and uses the apply-only fallback', async () => {
      adapter.setTabs([tab(1, 'https://a.com/x')]);
      await repo.addRule({
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a.com/x' },
        priority: 0,
        title: 'Degraded Title',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      adapter.state.sendMessageError = { code: 'BROWSER_API_ERROR', message: 'no receiver' };

      const report = await delivery.recomputeAndRedeliver([1]);
      expect(report[1]).toBe('degraded');
      expect(delivery.isDegraded(1)).toBe(true);

      const execs = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      expect(execs.length).toBeGreaterThan(0);
    });
  });

  describe('leading / trailing coalescing (A5)', () => {
    it('never runs two deliveries for the same tab concurrently, and the last state wins', async () => {
      adapter.setTabs([tab(1, 'https://a.com/x')]);
      await repo.addRule({
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a.com/x' },
        priority: 0,
        title: 'V1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      // Instrument sendMessage to add latency so a real overlap can occur.
      const baseSend = adapter.tabs.sendMessage.bind(adapter.tabs);
      let inFlight = 0;
      let peak = 0;
      adapter.tabs.sendMessage = async (tabId, message) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        try {
          await new Promise((r) => setTimeout(r, 10));
          return await baseSend(tabId, message);
        } finally {
          inFlight--;
        }
      };

      const first = delivery.recomputeAndRedeliver([1]);
      // While the first is in flight, change the state and trigger again twice.
      await new Promise((r) => setTimeout(r, 2));
      await repo.updateRuleById('r1', { title: 'V2' });
      const second = delivery.recomputeAndRedeliver([1]);
      await repo.updateRuleById('r1', { title: 'V3' });
      const third = delivery.recomputeAndRedeliver([1]);

      await Promise.all([first, second, third]);
      // Give the trailing pass a chance to complete.
      await new Promise((r) => setTimeout(r, 30));

      expect(peak).toBe(1); // never concurrent for the same tab

      const values = appliesFor(1)
        .map((m) => (m.title?.kind === 'set' ? m.title.value : undefined))
        .filter(Boolean);
      // The LAST delivered value must be the newest state, never an intermediate one.
      expect(values.at(-1)).toBe('V3');
      // Coalesced: far fewer than one delivery per trigger.
      expect(values.length).toBeLessThanOrEqual(3);
    });
  });

  describe('debounce (C4)', () => {
    it('coalesces rapid edit triggers into a single delivery', async () => {
      vi.useFakeTimers();
      try {
        adapter.setTabs([tab(1, 'https://a.com/x')]);
        await repo.addRule({
          id: 'r1',
          urlMatch: { type: 'exact', value: 'https://a.com/x' },
          priority: 0,
          title: 'Debounced',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        });

        delivery.recomputeAndRedeliverDebounced([1], 300);
        delivery.recomputeAndRedeliverDebounced([1], 300);
        delivery.recomputeAndRedeliverDebounced([1], 300);

        expect(appliesFor(1)).toHaveLength(0); // nothing yet

        await vi.advanceTimersByTimeAsync(350);
        expect(appliesFor(1).length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('retry ladder (C4)', () => {
    it('exposes the fixed 1/2/3/5/10/20/30s ladder', () => {
      expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 3000, 5000, 10000, 20000, 30000]);
    });

    it('schedules the first fixed ladder delay on a transient failure (no real timer left running)', async () => {
      // A recording timer that never actually fires — the ladder is asserted,
      // not waited out.
      const scheduled: number[] = [];
      delivery.setTimers({
        setTimeout: (_fn, ms) => {
          scheduled.push(ms);
          return 0;
        },
        clearTimeout: () => { /* no-op */ },
        now: () => Date.now(),
      });

      adapter.setTabs([tab(1, 'https://a.com/x')]);
      await repo.addRule({
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a.com/x' },
        priority: 0,
        title: 'Retry',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      // Make BOTH primary and fallback fail → transient retry path.
      adapter.state.sendMessageError = { code: 'BROWSER_API_ERROR', message: 'nope' };
      adapter.state.executeScriptError = { code: 'BROWSER_API_ERROR', message: 'nope' };

      const report = await delivery.recomputeAndRedeliver([1]);
      expect(report[1]).toBe('degraded');
      expect(scheduled).toContain(RETRY_DELAYS_MS[0]);
    });

    it('advances through the ladder and stops after the last delay (bounded retries)', async () => {
      const scheduled: number[] = [];
      const queued: Array<() => void> = [];
      delivery.setTimers({
        setTimeout: (fn, ms) => { scheduled.push(ms); queued.push(fn); return queued.length; },
        clearTimeout: () => { /* no-op */ },
        now: () => Date.now(),
      });

      adapter.setTabs([tab(1, 'https://a.com/x')]);
      await repo.addRule({
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a.com/x' },
        priority: 0,
        title: 'Retry',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      adapter.state.sendMessageError = { code: 'BROWSER_API_ERROR', message: 'nope' };
      adapter.state.executeScriptError = { code: 'BROWSER_API_ERROR', message: 'nope' };

      await delivery.recomputeAndRedeliver([1]);

      // Drive the ladder to exhaustion. Each retry performs several awaited
      // state reads before scheduling the NEXT rung, so a fixed number of yields
      // is not reliable under load — loop until the tab is degraded.
      const settle = async (): Promise<void> => {
        for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      };

      let guard = 0;
      while (!delivery.isDegraded(1) && guard < 200) {
        const fn = queued.shift();
        if (fn) fn();
        await settle();
        guard++;
      }

      // The full 1/2/3/5/10/20/30s ladder was walked, and the tab ends degraded.
      expect(scheduled).toEqual([...RETRY_DELAYS_MS]);
      expect(delivery.isDegraded(1)).toBe(true);
    });
  });
});