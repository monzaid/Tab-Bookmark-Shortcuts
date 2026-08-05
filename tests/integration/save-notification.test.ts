/**
 * Bug 3: "Saved to Slot N" notification after shortcut save / conflict overwrite.
 *
 * - Notification must reference icons/icon-128.png (the icon that actually exists)
 * - Notification failure must NOT silently vanish: it must be recorded in
 *   diagnostics, while the save operation itself still succeeds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('Bug 3: Save notification — icon URL and diagnostics on failure', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab1: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example Page', favIconUrl: '', active: true, incognito: false, status: 'complete' };

  const routeMessage = (msg: unknown, sender: unknown) =>
    (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, sender);

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

  it('should send "Saved to Slot N" notification with icon-128.png on save success', async () => {
    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    const createCalls = adapter.calls.filter((c) => c.method === 'notifications.create');
    expect(createCalls.length).toBe(1);

    const [notificationId, options] = createCalls[0].args as [string, { title: string; message: string; iconUrl: string }];
    expect(notificationId).toContain('tbs-save-1');
    expect(options.message).toBe('Saved to Slot 1: Example Page');
    expect(options.iconUrl).toBe('chrome-extension://mock-id/icons/icon-128.png');
  });

  it('should record a diagnostic entry when the save notification fails (no silent swallow)', async () => {
    const createSpy = vi.spyOn(adapter.notifications, 'create').mockRejectedValue(new Error('Invalid icon URL'));

    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    // Main flow must still succeed
    const sync = await worker.repo.getSyncState();
    expect(sync.slots).toHaveLength(1);
    expect(sync.slots[0].id).toBe(1);

    // Notification failure must be recorded in diagnostics
    const entries = await worker.diagnostics.getEntries();
    const notifError = entries.find((e) => e.operationType.includes('notification') && e.errorCode !== 'SUCCESS');
    expect(notifError).toBeDefined();

    createSpy.mockRestore();
  });

  it('should record a diagnostic entry when the conflict-overwrite notification fails', async () => {
    // First save occupies slot 1
    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    // Second save triggers the conflict dialog path
    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    const createSpy = vi.spyOn(adapter.notifications, 'create').mockRejectedValue(new Error('Invalid icon URL'));

    const result = await routeMessage(
      {
        requestId: 'overwrite-1',
        action: 'CONFLICT_OVERWRITE',
        payload: { slotId: 1, tabId: 10, url: 'https://example.com/page', title: 'Example Page', favIconUrl: '' },
      },
      {},
    ) as { success: boolean };

    expect(result.success).toBe(true);

    // Notification failure must be recorded in diagnostics
    const entries = await worker.diagnostics.getEntries();
    const notifError = entries.find((e) => e.operationType.includes('notification') && e.errorCode !== 'SUCCESS');
    expect(notifError).toBeDefined();

    createSpy.mockRestore();
  });
});
