import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * T25: Rule application to ALL matching tabs + refresh persistence + slot priority chain.
 *
 * Covers:
 * - Auto rule applies to every matching tab (not just one).
 * - tabs.onUpdated status==='complete' re-applies title/favicon after refresh.
 * - Slot tier (current page) ranks above rule; slot field wins when the bound tabId matches.
 * - Slot tier is tabId-scoped: only the bound tab gets the slot value, other matching tabs
 *   still resolve via the rule tier.
 */
describe('T25: Rule apply-to-all, refresh persistence, slot priority chain', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  const tabA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original A', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabB: NormalizedTab = { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'Original B', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabC: NormalizedTab = { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'Original C', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabDiff: NormalizedTab = { id: 13, windowId: 1, index: 3, url: 'https://other.com/x', title: 'Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  /** Collect { title, favicon } payloads delivered via scripting.executeScript. */
  interface ApplyPayloadInCall { title?: string; favicon?: string; force?: boolean; }
  function sendCallsFor(tabId: number): ApplyPayloadInCall[] {
    return adapter.calls
      .filter((c) => c.method === 'scripting.executeScript'
        && (c.args[0] as { target: { tabId: number } }).target.tabId === tabId)
      .map((c) => {
        const args = (c.args[0] as { args: unknown[] }).args;
        return (args[0] as ApplyPayloadInCall) ?? {};
      });
  }

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  describe('Rule applies to ALL matching tabs', () => {
    it('should send APPLY_REWRITE to every matching tab when an auto rule matches N tabs', async () => {
      adapter.setTabs([tabA, tabB, tabC, tabDiff]);

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Rewritten Title',
      }, 0);
      expect(result.success).toBe(true);

      // tabA, tabB, tabC match; tabDiff does not.
      expect(sendCallsFor(10).length).toBeGreaterThan(0);
      expect(sendCallsFor(11).length).toBeGreaterThan(0);
      expect(sendCallsFor(12).length).toBeGreaterThan(0);
      expect(sendCallsFor(13).length).toBe(0);

      // Each matching tab received the rule title.
      for (const tabId of [10, 11, 12]) {
        const payloads = sendCallsFor(tabId);
        expect(payloads.some((p) => p.title === 'Rewritten Title')).toBe(true);
      }
    });

    it('should re-apply to ALL matching tabs after a rule update', async () => {
      adapter.setTabs([tabA, tabB]);

      const create = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Before',
      }, 0);
      expect(create.success).toBe(true);
      if (!create.success) return;

      const rule = create.rule;
      const update = await worker.ruleService.updateRule(rule.id, { title: 'After' });
      expect(update.success).toBe(true);

      expect(sendCallsFor(10).some((p) => p.title === 'After')).toBe(true);
      expect(sendCallsFor(11).some((p) => p.title === 'After')).toBe(true);
    });
  });

  describe('Refresh persistence via tabs.onUpdated', () => {
    it('should re-send APPLY_REWRITE on status==="complete"', async () => {
      adapter.setTabs([tabA]);

      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Persisted Title',
      }, 0);

      // Clear calls to isolate the onUpdated-triggered re-apply.
      adapter.calls.length = 0;

      adapter.emitTabUpdated(10, { status: 'complete' }, tabA);
      await new Promise((r) => setTimeout(r, 50));

      const payloads = sendCallsFor(10);
      expect(payloads.length).toBeGreaterThan(0);
      expect(payloads.some((p) => p.title === 'Persisted Title')).toBe(true);
    });

    it('should re-apply favicon on refresh and preserve it', async () => {
      adapter.setTabs([tabA]);

      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        favicon: { type: 'url', value: 'https://example.com/favicon.ico' },
      }, 0);

      adapter.calls.length = 0;

      adapter.emitTabUpdated(10, { status: 'complete' }, tabA);
      await new Promise((r) => setTimeout(r, 50));

      const payloads = sendCallsFor(10);
      expect(payloads.some((p) => p.favicon === 'https://example.com/favicon.ico')).toBe(true);
    });

    it('should re-apply on url change even without status complete', async () => {
      adapter.setTabs([{ ...tabA, url: 'https://example.com/page' }]);

      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'URL Change Title',
      }, 0);

      adapter.calls.length = 0;

      adapter.emitTabUpdated(10, { url: 'https://example.com/page' }, tabA);
      await new Promise((r) => setTimeout(r, 50));

      const payloads = sendCallsFor(10);
      expect(payloads.some((p) => p.title === 'URL Change Title')).toBe(true);
    });
  });

  describe('Slot priority tier (current page beats rule)', () => {
    function seedSlotBinding(tabId: number, slotId = 1, title = 'Slot Custom Title', favicon = 'https://slot.com/icon.png') {
      return worker.repo.saveSlot({
        id: slotId,
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        strategy: 'inherit',
        uiMarker: {},
        titleSnapshot: title,
        faviconSnapshot: favicon,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, 0).then(() =>
        worker.repo.setBinding({ slotId, tabId, windowId: 1, boundAt: new Date().toISOString() })
      );
    }

    it('should let slot field win over a matching rule for the bound tab', async () => {
      adapter.setTabs([tabA]);
      await seedSlotBinding(10);
      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 100,
        title: 'Rule Low Priority',
      }, 0);

      adapter.calls.length = 0;
      const result = await (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'nav-1', action: 'CONTENT_NAVIGATION', payload: { tabId: 10, url: 'https://example.com/page', navigationType: 'initial' } },
        { tab: { id: 10 } }
      );
      expect(result).toEqual(expect.objectContaining({ success: true }));

      const payloads = sendCallsFor(10);
      expect(payloads.length).toBeGreaterThan(0);
      // Slot value wins over the rule value.
      expect(payloads.some((p) => p.title === 'Slot Custom Title')).toBe(true);
      expect(payloads.some((p) => p.title === 'Rule Low Priority')).toBe(false);
    });

    it('should apply slot value ONLY to its bound tab, not other matching tabs', async () => {
      adapter.setTabs([tabA, tabB]);
      // Bind slot to tabA only.
      await seedSlotBinding(10, 1, 'Bound Tab Slot Title', 'https://slot.com/icon.png');
      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Shared Rule Title',
      }, 0);

      adapter.calls.length = 0;

      // Trigger re-apply for both tabs via onUpdated (fresh page).
      adapter.emitTabUpdated(10, { status: 'complete' }, tabA);
      adapter.emitTabUpdated(11, { status: 'complete' }, tabB);
      await new Promise((r) => setTimeout(r, 50));

      // Bound tab (10) gets slot value.
      expect(sendCallsFor(10).some((p) => p.title === 'Bound Tab Slot Title')).toBe(true);
      // Other tab (11) does NOT get slot value; it gets the rule value.
      expect(sendCallsFor(11).some((p) => p.title === 'Bound Tab Slot Title')).toBe(false);
      expect(sendCallsFor(11).some((p) => p.title === 'Shared Rule Title')).toBe(true);
    });

    it('should use slot favicon faviconSnapshot for the bound tab favicon rewrite', async () => {
      adapter.setTabs([tabA]);
      await seedSlotBinding(10, 1, 'Slot Title', 'https://slot.com/icon.png');
      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        favicon: { type: 'url', value: 'https://rule.com/icon.png' },
      }, 0);

      adapter.calls.length = 0;
      await (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'nav-2', action: 'CONTENT_READY', payload: { tabId: 10, url: 'https://example.com/page' } },
        { tab: { id: 10 } }
      );

      const payloads = sendCallsFor(10);
      expect(payloads.some((p) => p.favicon === 'https://slot.com/icon.png')).toBe(true);
      expect(payloads.some((p) => p.favicon === 'https://rule.com/icon.png')).toBe(false);
    });

    it('should re-apply the slot fields to the bound tab when the slot uiMarker is updated', async () => {
      adapter.setTabs([tabA]);
      await seedSlotBinding(10, 1, 'Original Snapshot', 'https://snapshot.com/icon.png');

      // Clear calls so we only see the UPDATE_SLOT_UI_MARKER-triggered re-apply.
      adapter.calls.length = 0;

      const result = await (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(
        {
          requestId: 'marker-1',
          action: 'UPDATE_SLOT_UI_MARKER',
          payload: { slotId: 1, uiMarker: { customTitle: 'Renamed Slot', icon: { type: 'url', value: 'https://newicon.com/icon.png' } } },
        },
        {},
      );
      expect(result).toEqual(expect.objectContaining({ success: true }));

      const payloads = sendCallsFor(10);
      expect(payloads.length).toBeGreaterThan(0);
      // The updated uiMarker value is re-applied to the bound tab.
      expect(payloads.some((p) => p.title === 'Renamed Slot')).toBe(true);
      expect(payloads.some((p) => p.favicon === 'https://newicon.com/icon.png')).toBe(true);
    });

    it('should prefer the user-modified uiMarker over the stale snapshot in the slot tier', async () => {
      adapter.setTabs([tabA]);
      // Slot has stale snapshot but a user-modified uiMarker.
      await worker.repo.saveSlot({
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        strategy: 'inherit',
        uiMarker: { customTitle: 'User Custom Title', icon: { type: 'url', value: 'https://usericon.com/icon.png' } },
        titleSnapshot: 'Stale Snapshot Title',
        faviconSnapshot: 'https://stale.com/icon.png',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, 0);
      await worker.repo.setBinding({ slotId: 1, tabId: 10, windowId: 1, boundAt: new Date().toISOString() });

      adapter.calls.length = 0;
      await (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'nav-4', action: 'CONTENT_NAVIGATION', payload: { tabId: 10, url: 'https://example.com/page', navigationType: 'initial' } },
        { tab: { id: 10 } }
      );

      const payloads = sendCallsFor(10);
      expect(payloads.some((p) => p.title === 'User Custom Title')).toBe(true);
      expect(payloads.some((p) => p.title === 'Stale Snapshot Title')).toBe(false);
      expect(payloads.some((p) => p.favicon === 'https://usericon.com/icon.png')).toBe(true);
      expect(payloads.some((p) => p.favicon === 'https://stale.com/icon.png')).toBe(false);
    });

    it('should fall back to rule when the bound tab has no slot favicon/title data', async () => {
      adapter.setTabs([tabA]);
      // Binding exists but slot has empty snapshots.
      await worker.repo.saveSlot({
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        strategy: 'inherit',
        uiMarker: {},
        titleSnapshot: '',
        faviconSnapshot: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, 0);
      await worker.repo.setBinding({ slotId: 1, tabId: 10, windowId: 1, boundAt: new Date().toISOString() });

      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Rule Fallback Title',
      }, 0);

      adapter.calls.length = 0;
      await (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'nav-3', action: 'CONTENT_NAVIGATION', payload: { tabId: 10, url: 'https://example.com/page', navigationType: 'initial' } },
        { tab: { id: 10 } }
      );

      const payloads = sendCallsFor(10);
      expect(payloads.some((p) => p.title === 'Rule Fallback Title')).toBe(true);
    });
  });
});