import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * FIX-3: create-or-focus must never silently fail.
 *
 * Pre-fix `openOrFocusRecoveryWindow` called `windows.update(existing.windowId)`
 * without checking liveness; Chrome rejects a dead windowId, the error
 * propagated, and the window never opened ("notification sent, window absent").
 *
 * And `createRecoverySession` added a fresh session on every trigger, so the
 * "at most one active session per slot" invariant (design §3.5) was violated.
 */
describe('FIX-3: recovery create-or-focus', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const win1: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab = (id: number, url: string, active = false): NormalizedTab => ({
    id,
    windowId: 1,
    index: id,
    url,
    title: 'T' + String(id),
    favIconUrl: '',
    active,
    incognito: false,
    status: 'complete',
  });

  const route = (msg: unknown) =>
    (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

  const windowsCreated = () => adapter.calls.filter((c) => c.method === 'windows.create').length;
  const windowsFocused = () => adapter.calls.filter((c) => c.method === 'windows.update').length;

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win1]);
    adapter.setTabs([tab(10, 'https://example.com/page', true)]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  async function saveSlot1(): Promise<void> {
    await route({
      requestId: 'save-1',
      action: 'SAVE_SLOT',
      configVersion: worker.repo.getConfigVersion(),
      payload: {
        slotId: 1,
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        titleSnapshot: 'T',
        faviconSnapshot: '',
      },
    });
  }

  async function triggerRecovery(): Promise<{ success: boolean; outcome?: { type: string } }> {
    return (await route({ requestId: 'sw-' + String(Date.now()), action: 'SWITCH_SLOT', payload: { slotId: 1 } })) as {
      success: boolean;
      outcome?: { type: string };
    };
  }

  it('FIX-3 RED ①: retriggering after the recovery window is closed opens a NEW window (no silent failure)', async () => {
    await saveSlot1();
    adapter.setTabs([]); // no candidates → needs_recovery

    const first = await triggerRecovery();
    expect(first.success).toBe(true);
    expect(first.outcome?.type).toBe('needs_recovery');
    expect(windowsCreated()).toBe(1);

    const local = await worker.repo.getLocalState();
    const session = local.recoverySessions.find((s) => s.slotId === 1);
    expect(session).toBeDefined();
    expect(session?.windowId).toBeGreaterThan(0);

    // Simulate the user closing the recovery window (its id is now dead).
    adapter.setWindows([win1]);
    adapter.calls.length = 0;

    const second = await triggerRecovery();
    expect(second.success).toBe(true);
    expect(second.outcome?.type).toBe('needs_recovery');
    // The notification was sent ⇒ the window MUST open (create a fresh one).
    expect(windowsCreated()).toBe(1);
  });

  it('FIX-3 RED ②: two consecutive needs_recovery for one slot leave exactly ONE active session', async () => {
    await saveSlot1();
    adapter.setTabs([]); // no candidates → needs_recovery

    const first = await triggerRecovery();
    expect(first.outcome?.type).toBe('needs_recovery');
    expect(windowsCreated()).toBe(1);

    // Second trigger while the window is still open → focus, not re-create.
    adapter.calls.length = 0;
    const second = await triggerRecovery();
    expect(second.success).toBe(true);
    expect(second.outcome?.type).toBe('needs_recovery');

    const local = await worker.repo.getLocalState();
    const slotSessions = local.recoverySessions.filter((s) => s.slotId === 1);
    expect(slotSessions).toHaveLength(1);

    // The existing window is reused → focused, never duplicated.
    expect(windowsCreated()).toBe(0);
    expect(windowsFocused()).toBeGreaterThanOrEqual(1);
  });

  it('FIX-3: an EXPIRED same-slot session is not reused (lazy expiry parity with getSession)', async () => {
    await saveSlot1();
    adapter.setTabs([]);

    // Seed an expired session for slot 1 that still carries a live windowId.
    const past = new Date(Date.now() - 60_000);
    await worker.repo.addRecoverySession({
      recoveryId: 'rec-expired-seed',
      slotId: 1,
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      titleSnapshot: 'T',
      faviconSnapshot: '',
      createdAt: past.toISOString(),
      expiresAt: past.toISOString(),
      windowId: 1,
      candidateCursor: null,
    });
    adapter.calls.length = 0;

    const res = await triggerRecovery();
    expect(res.success).toBe(true);
    expect(res.outcome?.type).toBe('needs_recovery');

    // The stale session must be discarded, and a fresh window created rather
    // than "focusing" a session that getSession() would have reported as gone.
    const local = await worker.repo.getLocalState();
    const slotSessions = local.recoverySessions.filter((s) => s.slotId === 1);
    expect(slotSessions).toHaveLength(1);
    expect(slotSessions[0].recoveryId).not.toBe('rec-expired-seed');
    expect(windowsCreated()).toBe(1);
  });
});