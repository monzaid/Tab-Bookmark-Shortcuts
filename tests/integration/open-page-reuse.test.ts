/**
 * Bug 1: OPEN_PAGE must reuse an already-open tab instead of creating a new one.
 *
 * Matching rule: URLs are compared WITHOUT their hash/fragment, so
 * `settings/index.html#diagnostics` reuses an open `settings/index.html` tab.
 *
 * - Existing tab found  → activate it; if the target URL carries a hash that
 *   differs from the tab's current URL, navigate via tabs.update({ url })
 *   (hash-only changes do not reload the page). No tabs.create.
 * - No existing tab     → tabs.create.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

const SETTINGS_BASE = 'chrome-extension://mock-id/src/ui/settings/index.html';
const SETTINGS_DIAG = `${SETTINGS_BASE}#diagnostics`;

describe('Bug 1: OPEN_PAGE reuses an already-open tab (hash-insensitive)', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  function makeTab(id: number, url: string): NormalizedTab {
    return {
      id, windowId: 1, index: id, url, title: 'T', favIconUrl: '',
      active: id === 1, incognito: false, status: 'complete',
    };
  }

  async function openPage(url: string) {
    return (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
      { requestId: `op-${Math.random()}`, action: 'OPEN_PAGE', payload: { url } },
      {},
    );
  }

  const createCalls = () => adapter.calls.filter((c) => c.method === 'tabs.create');
  const updateCalls = () => adapter.calls.filter((c) => c.method === 'tabs.update');

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('should activate the existing tab and NOT create when the base URL matches', async () => {
    adapter.setTabs([makeTab(7, SETTINGS_BASE)]);

    const result = await openPage(SETTINGS_BASE) as { success: boolean };
    expect(result.success).toBe(true);

    // Activated the existing tab
    const activates = updateCalls().filter(
      (c) => c.args[0] === 7 && (c.args[1] as { active?: boolean }).active === true,
    );
    expect(activates.length).toBeGreaterThan(0);
    // No new tab created
    expect(createCalls()).toHaveLength(0);
  });

  it('should treat settings/index.html#diagnostics as the same page as settings/index.html (hash-insensitive match)', async () => {
    adapter.setTabs([makeTab(7, SETTINGS_BASE)]);

    await openPage(SETTINGS_DIAG);

    expect(createCalls()).toHaveLength(0);
    const activates = updateCalls().filter(
      (c) => c.args[0] === 7 && (c.args[1] as { active?: boolean }).active === true,
    );
    expect(activates.length).toBeGreaterThan(0);
  });

  it('should hash-navigate via tabs.update({ url }) when target has a different hash', async () => {
    adapter.setTabs([makeTab(7, SETTINGS_BASE)]);

    await openPage(SETTINGS_DIAG);

    const navigations = updateCalls().filter(
      (c) => c.args[0] === 7 && (c.args[1] as { url?: string }).url === SETTINGS_DIAG,
    );
    expect(navigations).toHaveLength(1);
    expect(createCalls()).toHaveLength(0);
  });

  it('should not navigate when the existing tab already has the exact target URL', async () => {
    adapter.setTabs([makeTab(7, SETTINGS_DIAG)]);

    await openPage(SETTINGS_DIAG);

    const navigations = updateCalls().filter(
      (c) => (c.args[1] as { url?: string }).url !== undefined,
    );
    expect(navigations).toHaveLength(0);
    expect(createCalls()).toHaveLength(0);
  });

  it('should not navigate when the target has no hash (even if open tab has one)', async () => {
    adapter.setTabs([makeTab(7, SETTINGS_DIAG)]);

    await openPage(SETTINGS_BASE);

    // Only activation, no URL navigation
    const navigations = updateCalls().filter(
      (c) => (c.args[1] as { url?: string }).url !== undefined,
    );
    expect(navigations).toHaveLength(0);
    const activates = updateCalls().filter(
      (c) => c.args[0] === 7 && (c.args[1] as { active?: boolean }).active === true,
    );
    expect(activates.length).toBeGreaterThan(0);
    expect(createCalls()).toHaveLength(0);
  });

  it('should create a new tab when no open tab matches the base URL', async () => {
    adapter.setTabs([makeTab(7, 'https://example.com/other')]);

    await openPage(SETTINGS_BASE);

    expect(createCalls()).toHaveLength(1);
    expect((createCalls()[0].args[0] as { url: string }).url).toBe(SETTINGS_BASE);
  });
});
