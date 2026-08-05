import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('Problem 1: Conflict overwrite must use captured tab data, not re-query active tab', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const originalTab: NormalizedTab = {
    id: 10,
    windowId: 1,
    index: 0,
    url: 'https://original.com/page',
    title: 'Original Page',
    favIconUrl: 'https://original.com/favicon.ico',
    active: true,
    incognito: false,
    status: 'complete',
  };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([originalTab]);
    adapter.setCommands([
      { name: 'save-slot-1', description: 'Save slot 1', shortcut: 'Ctrl+1' },
      { name: 'switch-slot-1', description: 'Switch slot 1', shortcut: 'Ctrl+Shift+1' },
    ]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('should include tabId and favIconUrl in conflict dialog URL params when slot is occupied', async () => {
    // First save to occupy slot 1
    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    // Clear calls to isolate the conflict dialog creation
    adapter.calls.length = 0;

    // Second save triggers conflict
    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    // Should have opened a conflict window
    const windowCreateCalls = adapter.calls.filter((c) => c.method === 'windows.create');
    expect(windowCreateCalls.length).toBe(1);

    const createArgs = windowCreateCalls[0].args[0] as { url: string };
    const url = new URL(createArgs.url.replace('chrome-extension://mock-id/', 'http://localhost/'));

    // Must include tabId and favIconUrl params
    expect(url.searchParams.get('tabId')).toBe('10');
    expect(url.searchParams.get('favIconUrl')).toBe('https://original.com/favicon.ico');
    expect(url.searchParams.get('newUrl')).toBe('https://original.com/page');
    expect(url.searchParams.get('newTitle')).toBe('Original Page');
  });

  it('CONFLICT_OVERWRITE should save using provided tab data without re-querying active tab', async () => {
    // Occupy slot 1 first
    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    // Simulate: conflict popup is now the active tab (different from original)
    const conflictTab: NormalizedTab = {
      id: 99,
      windowId: 2,
      index: 0,
      url: 'chrome-extension://mock-id/src/ui/conflict-confirm/index.html',
      title: 'Conflict Confirm',
      favIconUrl: '',
      active: true,
      incognito: false,
      status: 'complete',
    };
    // Make conflict tab the "active" one that would be returned by query
    adapter.setTabs([
      { ...originalTab, active: false },
      conflictTab,
    ]);
    adapter.setWindows([
      { ...currentWindow, focused: false },
      { id: 2, focused: true, incognito: false, type: 'popup' },
    ]);

    // Send CONFLICT_OVERWRITE with the original tab data
    const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
      {
        requestId: 'conflict-ow-1',
        action: 'CONFLICT_OVERWRITE',
        payload: {
          slotId: 1,
          tabId: 10,
          url: 'https://original.com/page',
          title: 'Original Page',
          favIconUrl: 'https://original.com/favicon.ico',
        },
      },
      {}
    ) as { success: boolean; slot?: { urlMatch: { value: string }; titleSnapshot: string; faviconSnapshot: string } };

    expect(result.success).toBe(true);

    // Verify the slot was saved with the ORIGINAL tab data, not the conflict popup
    const sync = await worker.repo.getSyncState();
    const slot = sync.slots.find((s) => s.id === 1);
    expect(slot).toBeDefined();
    expect(slot!.urlMatch.value).toBe('https://original.com/page');
    expect(slot!.titleSnapshot).toBe('Original Page');
    expect(slot!.faviconSnapshot).toBe('https://original.com/favicon.ico');
  });

  it('CONFLICT_OVERWRITE should bind the original tabId, not the conflict popup tabId', async () => {
    // Occupy slot 1
    adapter.emitCommand('save-slot-1');
    await new Promise((r) => setTimeout(r, 50));

    // Send CONFLICT_OVERWRITE
    await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
      {
        requestId: 'conflict-ow-2',
        action: 'CONFLICT_OVERWRITE',
        payload: {
          slotId: 1,
          tabId: 10,
          url: 'https://original.com/page',
          title: 'Original Page',
          favIconUrl: 'https://original.com/favicon.ico',
        },
      },
      {}
    );

    // Verify binding uses original tabId
    const local = await worker.repo.getLocalState();
    const binding = local.bindings.find((b) => b.slotId === 1);
    expect(binding).toBeDefined();
    expect(binding!.tabId).toBe(10);
  });
});
