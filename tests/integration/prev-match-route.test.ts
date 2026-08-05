/**
 * Bug 3 (routing): PREV_MATCH_SLOT message type and orchestrator route.
 * Mirrors the NEXT_MATCH_SLOT route.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { PrevMatchSlotRequest } from '@shared/messages';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('Bug 3 (routing): PREV_MATCH_SLOT route', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab1: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tab2: NormalizedTab = { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'Example 2', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([tab1, tab2]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  async function route(message: unknown) {
    return (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(message, {});
  }

  it('should route PREV_MATCH_SLOT to the slot service and switch backwards', async () => {
    await route({ requestId: 's1', action: 'SAVE_SLOT', payload: { slotId: 1, urlMatch: { type: 'exact', value: 'https://example.com/page' }, titleSnapshot: 'Example', faviconSnapshot: '' } });
    await route({ requestId: 's2', action: 'SWITCH_SLOT', payload: { slotId: 1 } });

    const result = await route({ requestId: 'p1', action: 'PREV_MATCH_SLOT', payload: { slotId: 1 } }) as {
      success: boolean; outcome: { type: string; tabId?: number };
    };

    expect(result.success).toBe(true);
    expect(result.outcome.type).toBe('switched');
    // Cursor starts at 0; prev wraps to the last candidate (tab 11)
    expect(result.outcome.tabId).toBe(11);
  });

  it('should return SLOT_EMPTY for an unconfigured slot via the route', async () => {
    const result = await route({ requestId: 'p2', action: 'PREV_MATCH_SLOT', payload: { slotId: 7 } }) as {
      success: boolean; errorCode?: string;
    };

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SLOT_EMPTY');
  });

  it('should accept a typed PrevMatchSlotRequest (contract smoke)', async () => {
    const request: PrevMatchSlotRequest = { requestId: 'p3', action: 'PREV_MATCH_SLOT', payload: { slotId: 7 } };
    const result = await route(request) as { success: boolean; errorCode?: string };
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SLOT_EMPTY');
  });
});
