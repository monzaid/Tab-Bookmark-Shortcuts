import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import { wildcardToRegex } from '@shared/url-utils';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * Robust rule delivery — scripting.executeScript primary + sendMessage fallback.
 *
 * Covers:
 * - Rule apply uses scripting.executeScript for ALL matching tabs (not one).
 * - tabs.onUpdated status==='complete' re-applies via executeScript (persistence).
 * - Regex rule (converted from wildcard input) matches multiple tabs and applies.
 * - Fallback: when executeScript throws, tabs.sendMessage is used.
 * - Slot tier: bound-tabId gets slot value, other matching tabs get rule value.
 */
describe('Robust rule delivery via scripting.executeScript', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  const tabA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original A', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabB: NormalizedTab = { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'Original B', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabC: NormalizedTab = { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'Original C', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabDiff: NormalizedTab = { id: 13, windowId: 1, index: 3, url: 'https://other.com/x', title: 'Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  /** Collect { title, favicon } payloads for a tab delivered via executeScript. */
  interface ApplyPayloadInCall { title?: string; favicon?: string; force?: boolean; }
  function executeCallsFor(tabId: number): ApplyPayloadInCall[] {
    return adapter.calls
      .filter((c) => c.method === 'scripting.executeScript'
        && (c.args[0] as { target: { tabId: number } }).target.tabId === tabId)
      .map((c) => {
        const args = (c.args[0] as { args: unknown[] }).args;
        return (args[0] as ApplyPayloadInCall) ?? {};
      });
  }

  /** Collect sendMessage APPLY_REWRITE payloads for a tab (fallback path). */
  function sendCallsFor(tabId: number) {
    return adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage' && c.args[0] === tabId)
      .map((c) => c.args[1] as { type: string; payload: { title?: string; favicon?: string } });
  }

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  describe('Rule apply uses executeScript for ALL matching tabs', () => {
    it('should call scripting.executeScript for every matching tab with the rule title', async () => {
      adapter.setTabs([tabA, tabB, tabC, tabDiff]);

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Rewritten Title',
      }, 0);
      expect(result.success).toBe(true);

      // tabA, tabB, tabC match; tabDiff does not.
      for (const tabId of [10, 11, 12]) {
        const calls = executeCallsFor(tabId);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.some((p) => p.title === 'Rewritten Title')).toBe(true);
      }
      expect(executeCallsFor(13)).toHaveLength(0);
    });

    it('should apply favicon via executeScript to every matching tab', async () => {
      adapter.setTabs([tabA, tabB]);

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        favicon: { type: 'url', value: 'https://example.com/favicon.ico' },
      }, 0);
      expect(result.success).toBe(true);

      for (const tabId of [10, 11]) {
        const calls = executeCallsFor(tabId);
        expect(calls.some((p) => p.favicon === 'https://example.com/favicon.ico')).toBe(true);
      }
    });
  });

  describe('Refresh persistence via tabs.onUpdated', () => {
    it('should re-apply via executeScript on status==="complete"', async () => {
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

      const calls = executeCallsFor(10);
      expect(calls.some((p) => p.title === 'Persisted Title')).toBe(true);
    });
  });

  describe('Regex rule (wildcard-converted) matches multiple tabs and applies', () => {
    it('should apply a wildcard-converted regex rule to all matching tabs', async () => {
      // Simulate what the UI does: convert `https://example.com/*` to a valid regex.
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
        mode: 'auto',
        priority: 5,
        title: 'Regex Title',
      }, 0);
      expect(result.success).toBe(true);

      // Both example.com tabs match via regex; other.com does not.
      for (const tabId of [10, 11]) {
        const calls = executeCallsFor(tabId);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.some((p) => p.title === 'Regex Title')).toBe(true);
      }
      expect(executeCallsFor(13)).toHaveLength(0);
    });
  });

  describe('Fallback to sendMessage when executeScript throws', () => {
    it('should fall back to tabs.sendMessage when executeScript fails', async () => {
      adapter.setTabs([tabA]);
      // Force executeScript to fail — e.g. restricted page where scripting is unavailable.
      adapter.state.executeScriptError = { code: 'BROWSER_API_ERROR', message: 'Cannot access restricted page' };

      const result = await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Fallback Title',
      }, 0);
      expect(result.success).toBe(true);

      // executeScript was attempted and failed; sendMessage fallback used.
      const sends = sendCallsFor(10);
      expect(sends.length).toBeGreaterThan(0);
      expect(sends.some((p) => p.payload.title === 'Fallback Title')).toBe(true);
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
        mode: 'auto',
        priority: 5,
        title: 'Shared Rule Title',
      }, 0);

      adapter.calls.length = 0;

      adapter.emitTabUpdated(10, { status: 'complete' }, tabA);
      adapter.emitTabUpdated(11, { status: 'complete' }, tabB);
      await new Promise((r) => setTimeout(r, 50));

      // Bound tab (10) gets slot value.
      expect(executeCallsFor(10).some((p) => p.title === 'Bound Tab Slot Title')).toBe(true);
      // Other tab (11) does NOT get slot value; it gets the rule value.
      expect(executeCallsFor(11).some((p) => p.title === 'Bound Tab Slot Title')).toBe(false);
      expect(executeCallsFor(11).some((p) => p.title === 'Shared Rule Title')).toBe(true);
    });
  });
});