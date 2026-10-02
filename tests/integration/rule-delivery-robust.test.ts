import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import { wildcardToRegex } from '@shared/url-utils';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { FieldApplyMessage, FieldDirective } from '@shared/messages';

/**
 * T8 / C7 — PRIMARY/BACKUP REVERSAL.
 *
 * The old suite asserted `scripting.executeScript` as the PRIMARY delivery path
 * with `tabs.sendMessage` as a fallback. That is exactly the defect fixed here:
 * the content script is now the ONE apply/restore implementation (it holds the
 * page-scoped snapshot `restore` needs), and `executeScript` is a stateless
 * apply-only fallback marked `degraded`.
 *
 * The assertions below are therefore INVERTED relative to the pre-T8 file:
 *  - delivery to every matching tab is asserted on `tabs.sendMessage`;
 *  - the fallback test forces the content-script path to fail and asserts the
 *    degraded `executeScript` path is used instead.
 *
 * The behavioural intents (multi-tab coverage, refresh persistence, wildcard
 * regex, slot-tier scoping) are preserved unchanged.
 */
describe('Rule delivery — content script primary, executeScript degraded fallback', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  const tabA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original A', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabB: NormalizedTab = { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'Original B', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabC: NormalizedTab = { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'Original C', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabDiff: NormalizedTab = { id: 13, windowId: 1, index: 3, url: 'https://other.com/x', title: 'Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  /** FIELD_APPLY messages delivered to a tab (primary path). */
  function fieldAppliesFor(tabId: number): FieldApplyMessage[] {
    return adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage' && c.args[0] === tabId)
      .map((c) => c.args[1] as FieldApplyMessage)
      .filter((m) => m?.type === 'FIELD_APPLY');
  }

  function titleSetValue(msg: FieldDirective | undefined): string | undefined {
    return msg?.kind === 'set' ? msg.value : undefined;
  }

  /** Values pushed through the degraded executeScript fallback. */
  function execCallsFor(tabId: number): { title?: string; favicon?: string }[] {
    return adapter.calls
      .filter((c) => c.method === 'scripting.executeScript'
        && (c.args[0] as { target: { tabId: number } }).target.tabId === tabId)
      .map((c) => {
        const args = (c.args[0] as { args: unknown[] }).args;
        return (args[0] as { title?: string; favicon?: string }) ?? {};
      });
  }

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  describe('Delivery uses the content script for ALL matching tabs', () => {
    it('should FIELD_APPLY to every matching tab with the rule title', async () => {
      adapter.setTabs([tabA, tabB, tabC, tabDiff]);

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        priority: 5,
        title: 'Rewritten Title',
      }, 0);
      expect(result.success).toBe(true);

      for (const tabId of [10, 11, 12]) {
        const msgs = fieldAppliesFor(tabId);
        expect(msgs.length).toBeGreaterThan(0);
        expect(msgs.some((m) => titleSetValue(m.title) === 'Rewritten Title')).toBe(true);
      }
      expect(fieldAppliesFor(13)).toHaveLength(0);
    });

    it('should deliver the favicon directive to every matching tab', async () => {
      adapter.setTabs([tabA, tabB]);

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        priority: 5,
        favicon: { type: 'url', value: 'https://example.com/favicon.ico' },
      }, 0);
      expect(result.success).toBe(true);

      for (const tabId of [10, 11]) {
        const msgs = fieldAppliesFor(tabId);
        expect(msgs.some((m) => m.favicon?.kind === 'set' && m.favicon.value === 'https://example.com/favicon.ico')).toBe(true);
      }
    });
  });

  describe('Refresh persistence via tabs.onUpdated (routed to the single entry)', () => {
    it('should re-deliver on status==="complete"', async () => {
      adapter.setTabs([tabA]);

      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        priority: 5,
        title: 'Persisted Title',
      }, 0);

      adapter.calls.length = 0;

      adapter.emitTabUpdated(10, { status: 'complete' }, tabA);
      await new Promise((r) => setTimeout(r, 50));

      const msgs = fieldAppliesFor(10);
      expect(msgs.some((m) => titleSetValue(m.title) === 'Persisted Title')).toBe(true);
    });
  });

  describe('Regex rule (wildcard-converted) matches multiple tabs and applies', () => {
    it('should apply a wildcard-converted regex rule to all matching tabs', async () => {
      const conversion = wildcardToRegex('https://example.com/*');
      expect(conversion.converted).toBe(true);
      const storedRegex = conversion.pattern;

      adapter.setTabs([
        { ...tabA, url: 'https://example.com/a' },
        { ...tabB, url: 'https://example.com/b' },
        tabDiff,
      ]);

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'regex', value: storedRegex },
        priority: 5,
        title: 'Regex Title',
      }, 0);
      expect(result.success).toBe(true);

      for (const tabId of [10, 11]) {
        const msgs = fieldAppliesFor(tabId);
        expect(msgs.length).toBeGreaterThan(0);
        expect(msgs.some((m) => titleSetValue(m.title) === 'Regex Title')).toBe(true);
      }
      expect(fieldAppliesFor(13)).toHaveLength(0);
    });
  });

  describe('Degraded fallback when the content script is unreachable', () => {
    it('should fall back to the apply-only executeScript path and mark the tab degraded', async () => {
      adapter.setTabs([tabA]);
      // The content script is unreachable on this tab → primary path throws.
      adapter.state.sendMessageError = { code: 'BROWSER_API_ERROR', message: 'Could not establish connection' };

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        priority: 5,
        title: 'Fallback Title',
      }, 0);
      expect(result.success).toBe(true);

      // The degraded path pushed the SET value through executeScript.
      const execs = execCallsFor(10);
      expect(execs.length).toBeGreaterThan(0);
      expect(execs.some((p) => p.title === 'Fallback Title')).toBe(true);
      // …and the tab is reported degraded (restore is unavailable there).
      expect(worker.delivery.isDegraded(10)).toBe(true);
    });
  });

  describe('Slot priority tier (bound tab beats rule, other matching tabs get rule)', () => {
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

    it('should apply slot value ONLY to its bound tab, other matching tabs get rule value', async () => {
      adapter.setTabs([tabA, tabB]);
      await seedSlotBinding(10, 1, 'Bound Tab Slot Title', 'https://slot.com/icon.png');
      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        priority: 5,
        title: 'Shared Rule Title',
      }, 0);

      adapter.calls.length = 0;

      adapter.emitTabUpdated(10, { status: 'complete' }, tabA);
      adapter.emitTabUpdated(11, { status: 'complete' }, tabB);
      await new Promise((r) => setTimeout(r, 50));

      // Bound tab (10) gets slot value.
      expect(fieldAppliesFor(10).some((m) => titleSetValue(m.title) === 'Bound Tab Slot Title')).toBe(true);
      // Other tab (11) does NOT get slot value; it gets the rule value.
      expect(fieldAppliesFor(11).some((m) => titleSetValue(m.title) === 'Bound Tab Slot Title')).toBe(false);
      expect(fieldAppliesFor(11).some((m) => titleSetValue(m.title) === 'Shared Rule Title')).toBe(true);
    });
  });
});