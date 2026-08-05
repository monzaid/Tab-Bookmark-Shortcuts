import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('T21: Service Worker lifecycle, message routing, command dispatch, cleanup', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab1: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([tab1]);
    adapter.setCommands([
      { name: 'save-slot-1', description: 'Save slot 1', shortcut: 'Ctrl+1' },
      { name: 'switch-slot-1', description: 'Switch slot 1', shortcut: 'Ctrl+Shift+1' },
      { name: 'next-match', description: 'Next match', shortcut: null },
    ]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  describe('Happy path — startup, dispatch, routing', () => {
    it('should initialize and hydrate cache on startup', async () => {
      const sync = await worker.repo.getSyncState();
      expect(sync.configVersion).toBe(0);
      expect(sync.globalStrategy).toBe('B');
    });

    it('should dispatch save-slot-1 command', async () => {
      adapter.emitCommand('save-slot-1');
      // Wait for async handling
      await new Promise((r) => setTimeout(r, 50));

      const sync = await worker.repo.getSyncState();
      expect(sync.slots).toHaveLength(1);
      expect(sync.slots[0].id).toBe(1);
    });

    it('should dispatch switch-slot-1 command after save', async () => {
      adapter.emitCommand('save-slot-1');
      await new Promise((r) => setTimeout(r, 50));

      adapter.emitCommand('switch-slot-1');
      await new Promise((r) => setTimeout(r, 50));

      const local = await worker.repo.getLocalState();
      expect(local.lastSuccessSlotId).toBe(1);
    });

    it('should route GET_STATE message', async () => {
      // Simulate message via the registered listener
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'test-1', action: 'GET_STATE' },
        {}
      );

      expect(result).toEqual(expect.objectContaining({ success: true }));
      const typed = result as { success: boolean; sync: { configVersion: number } };
      expect(typed.sync.configVersion).toBe(0);
    });

    it('should route GET_COMMANDS message', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'test-2', action: 'GET_COMMANDS' },
        {}
      ) as { success: boolean; commands: Array<{ name: string }> };

      expect(result.success).toBe(true);
      expect(result.commands).toHaveLength(3);
    });

    it('should route SAVE_SLOT message with configVersion', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'test-3', action: 'SAVE_SLOT', configVersion: 0, payload: { slotId: 2, urlMatch: { type: 'exact', value: 'https://test.com' }, titleSnapshot: 'Test', faviconSnapshot: '' } },
        {}
      ) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('should handle content navigation and apply rules', async () => {
      // Create an auto rule first
      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Custom Title',
      }, 0);

      // Simulate content navigation
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'nav-1', action: 'CONTENT_NAVIGATION', payload: { tabId: 10, url: 'https://example.com/page', navigationType: 'initial' } },
        { tab: { id: 10 } }
      );

      expect(result).toEqual(expect.objectContaining({ success: true }));

      // Verify rewrite was delivered via scripting.executeScript
      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      expect(execCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Error path — unknown command, cold start, handler rejection', () => {
    it('should handle unknown command gracefully', async () => {
      adapter.emitCommand('unknown-command-xyz');
      await new Promise((r) => setTimeout(r, 50));

      // Should not crash — diagnostics should record it
      const entries = await worker.diagnostics.getEntries();
      const unknownEntry = entries.find((e) => e.operationType === 'unknown_command');
      expect(unknownEntry).toBeDefined();
      expect(unknownEntry!.errorCode).toBe('COMMAND_NOT_FOUND');
    });

    it('should return UNKNOWN_ACTION for invalid message', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'bad-1', action: 'TOTALLY_INVALID' },
        {}
      ) as { success: boolean; errorCode: string };

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN_ACTION');
    });

    it('should return INVALID_REQUEST for null message', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        null,
        {}
      ) as { success: boolean; errorCode: string };

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_REQUEST');
    });

    it('should clean up bindings on tab removed', async () => {
      // Save slot to create binding
      adapter.emitCommand('save-slot-1');
      await new Promise((r) => setTimeout(r, 50));

      let local = await worker.repo.getLocalState();
      expect(local.bindings).toHaveLength(1);

      // Simulate tab removed
      adapter.emitTabRemoved(10, 1);
      await new Promise((r) => setTimeout(r, 50));

      local = await worker.repo.getLocalState();
      expect(local.bindings).toHaveLength(0);
    });

    it('should re-hydrate on cold start (ensureReady)', async () => {
      // Simulate cold start by creating new worker without initialize
      const worker2 = new WorkerOrchestrator(adapter);
      await worker2.ensureReady();

      const sync = await worker2.repo.getSyncState();
      expect(sync.configVersion).toBeGreaterThanOrEqual(0);
    });
  });
});
