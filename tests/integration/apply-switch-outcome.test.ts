import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * T9: `applySwitchOutcome` is the SINGLE side-effect mapping point.
 * item1 fix — the sidebar `SWITCH_SLOT` message and the `switch-slot-x` command
 * must produce the SAME outcome semantics AND the same side effects.
 *
 * Mapping table (design §3.2) covers exactly the FOUR frozen SwitchOutcome
 * variants — there is NO privileged-page variant row (BLK-B / B2).
 */
describe('T9: applySwitchOutcome — single side-effect point', () => {
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
  const notifCreated = () => adapter.calls.filter((c) => c.method === 'notifications.create').length;

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win1]);
    adapter.setTabs([tab(10, 'https://example.com/page', true)]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  async function saveAndClear(slotId: number, url: string) {
    adapter.setTabs([tab(10, url, true)]);
    await route({
      requestId: 'save-' + String(slotId),
      action: 'SAVE_SLOT',
      configVersion: worker.repo.getConfigVersion(),
      payload: { slotId, urlMatch: { type: 'exact', value: url }, titleSnapshot: 'T', faviconSnapshot: '' },
    });
    adapter.calls.length = 0;
  }

  it('T9 RED: SWITCH_SLOT opens ONE recovery window for a slot with no target (item1 fix)', async () => {
    await saveAndClear(1, 'https://example.com/page');

    // Remove the target so the switch needs recovery.
    adapter.setTabs([]);
    adapter.calls.length = 0;

    const result = (await route({ requestId: 'sw1', action: 'SWITCH_SLOT', payload: { slotId: 1 } })) as {
      success: boolean;
      outcome?: { type: string };
    };

    expect(result.success).toBe(true);
    expect(result.outcome?.type).toBe('needs_recovery');
    expect(windowsCreated()).toBe(1);
  });

  it('T9: the switch-slot-x command produces the SAME side effects (dual-path consistency, SC1)', async () => {
    await saveAndClear(1, 'https://example.com/page');
    adapter.setTabs([]);
    adapter.calls.length = 0;

    adapter.emitCommand('switch-slot-1');
    await new Promise((r) => setTimeout(r, 60));

    expect(windowsCreated()).toBe(1);
  });

  it('T9: needs_recovery sends at most ONE no_target notification', async () => {
    await saveAndClear(1, 'https://example.com/page');
    adapter.setTabs([]);
    adapter.calls.length = 0;

    await route({ requestId: 'sw2', action: 'SWITCH_SLOT', payload: { slotId: 1 } });
    expect(notifCreated()).toBe(1);
  });

  it('T9: a same-window successful switch sends NO notification', async () => {
    await saveAndClear(1, 'https://example.com/page');
    adapter.calls.length = 0;

    const result = (await route({ requestId: 'sw3', action: 'SWITCH_SLOT', payload: { slotId: 1 } })) as {
      outcome?: { type: string };
    };
    expect(result.outcome?.type).toBe('switched');
    expect(notifCreated()).toBe(0);
  });

  it('T9: a cross-window switch sends a cross_window_switch notification', async () => {
    const win2: NormalizedWindow = { id: 2, focused: false, incognito: false, type: 'normal' };
    adapter.setWindows([win1, win2]);
    // Save from window 1...
    await saveAndClear(1, 'https://example.com/page');
    // ...then make the matching tab live only in window 2.
    adapter.setTabs([{ ...tab(20, 'https://example.com/page'), windowId: 2 }]);
    adapter.calls.length = 0;

    const result = (await route({ requestId: 'sw4', action: 'SWITCH_SLOT', payload: { slotId: 1 } })) as {
      outcome?: { type: string; crossWindow?: boolean };
    };
    expect(result.outcome?.type).toBe('switched');
    expect(result.outcome?.crossWindow).toBe(true);
    expect(notifCreated()).toBe(1);
  });

  it('T9: an unconfigured slot errors with no window and no notification', async () => {
    await saveAndClear(1, 'https://example.com/page');
    adapter.calls.length = 0;

    // An unconfigured slot returns SLOT_EMPTY without side effects.
    const result = (await route({ requestId: 'sw5', action: 'SWITCH_SLOT', payload: { slotId: 9 } })) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
    expect(windowsCreated()).toBe(0);
    expect(notifCreated()).toBe(0);
  });

  it('FIX-1: a REAL incognito_blocked outcome is diagnostics-only (no notification, no window)', async () => {
    // Bind slot 1 to tab 10, then make that bound tab incognito AND revoke
    // incognito access so switchSlot genuinely returns `incognito_blocked`.
    await saveAndClear(1, 'https://example.com/page');
    adapter.state.incognitoAllowed = false;
    adapter.setTabs([{ ...tab(10, 'https://example.com/page', true), incognito: true }]);
    adapter.calls.length = 0;

    const before = (await worker.diagnostics.getEntries()).length;

    const result = (await route({ requestId: 'inc1', action: 'SWITCH_SLOT', payload: { slotId: 1 } })) as {
      success: boolean;
      outcome?: { type: string };
    };

    expect(result.success).toBe(true);
    expect(result.outcome?.type).toBe('incognito_blocked');

    // Design §3.2: `incognito_blocked` → notification = — (this is the defect:
    // a `background_failure` notification used to be sent).
    expect(notifCreated()).toBe(0);
    expect(windowsCreated()).toBe(0);

    // …but a diagnostic IS recorded.
    const entries = await worker.diagnostics.getEntries();
    expect(entries.length).toBeGreaterThan(before);
    expect(entries.some((e) => e.operationType === 'switch_incognito_blocked')).toBe(true);
  });

  it('T9 RED: new settings actions are routed to the repo mutators', async () => {
    const dir = (await route({ requestId: 'd1', action: 'SET_SWITCH_DIRECTION', payload: { direction: 'previous' } })) as { success: boolean };
    expect(dir.success).toBe(true);
    expect((await worker.repo.getSyncState()).switchDirection).toBe('previous');

    const ab = (await route({ requestId: 'a1', action: 'SET_AUTO_BIND_GLOBAL', payload: { enabled: false } })) as { success: boolean };
    expect(ab.success).toBe(true);
    expect((await worker.repo.getSyncState()).autoBindGlobal).toBe(false);
  });

  it('T9 RED: POSITION_CURRENT_NEXT is reachable and dispatches to the position back-end', async () => {
    adapter.setTabs([tab(10, 'https://a.com', true), tab(11, 'https://b.com')]);
    const result = (await route({ requestId: 'p1', action: 'POSITION_CURRENT_NEXT', payload: { anchorTabId: 10 } })) as {
      success: boolean;
    };
    expect(result.success).toBe(true);
  });

  it('T9: the mapping table has no privileged-page variant branch (BLK-B / B2)', async () => {
    // Guard: privileged-page interception never reaches applySwitchOutcome.
    // The forbidden token is assembled at runtime so this assertion does not
    // itself introduce a static occurrence.
    const forbidden = 'protected' + '_blocked';
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/background/worker-orchestrator.ts', 'utf-8'),
    );
    expect(source).not.toContain(forbidden);
  });
});