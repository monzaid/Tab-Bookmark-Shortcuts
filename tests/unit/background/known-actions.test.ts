import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';

/**
 * GAP-D: KNOWN_ACTIONS is a hand-written allow-list that does NOT auto-sync with
 * the UiAction union (see the N4 note in worker-orchestrator.ts). Newly added
 * actions must be registered explicitly or `isKnownAction` rejects them with
 * UNKNOWN_ACTION.
 *
 * Access path note (execution-logged adaptation): `isKnownAction` is not
 * exported, and the whitelist gate lives on `handleMessage` — `routeMessage`
 * BYPASSES the gate (it is called *after* it), so asserting the gate through
 * `routeMessage` would test the dispatch switch, not the registration. We
 * therefore drive the real gate via `handleMessage` (same private-access cast
 * pattern as tests/integration/worker-orchestrator.test.ts:56) and assert the
 * port-claim result, keeping T1 strictly within "contract + whitelist
 * registration" without stubbing T6/T8/T9 behaviour.
 */
describe('GAP-D: newly added actions pass the KNOWN_ACTIONS gate', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const gate = (action: string, payload?: unknown): { claimed: boolean; response?: unknown } => {
    let response: unknown;
    const claimed = (
      worker as unknown as {
        handleMessage: (
          m: unknown,
          s: unknown,
          r: (resp?: unknown) => void,
        ) => boolean;
      }
    ).handleMessage({ requestId: `t-${action}`, action, payload }, {}, (r) => {
      response = r;
    });
    return { claimed, response };
  };

  beforeEach(async () => {
    adapter.reset();
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  const newActions = [
    ['SET_SWITCH_DIRECTION', { direction: 'next' }],
    ['SET_AUTO_BIND_GLOBAL', { enabled: true }],
    ['SET_SLOT_AUTO_BIND', { slotId: 1, override: null }],
    ['POSITION_CURRENT_PREV', { anchorTabId: 10 }],
    ['POSITION_CURRENT_NEXT', {}],
    ['RECOVERY_PREV_MATCH', { recoveryId: 'rec-x', autoBind: false }],
  ] as const;

  for (const [action, payload] of newActions) {
    it(`${action} is registered in KNOWN_ACTIONS`, () => {
      expect(gate(action, payload).claimed).toBe(true);
    });
  }

  it('unknown action is rejected with UNKNOWN_ACTION (negative control)', () => {
    const { claimed, response } = gate('NOT_A_REAL_ACTION');
    expect(claimed).toBe(false);
    expect(response).toEqual(expect.objectContaining({ success: false, errorCode: 'UNKNOWN_ACTION' }));
  });

  it('SITE_SNAPSHOT_REPORT is registered (A7 content → worker report)', () => {
    expect(gate('SITE_SNAPSHOT_REPORT', { tabId: 1, title: 'X', faviconHref: null }).claimed).toBe(true);
  });

  // ── T4: REMOVED actions must be gated out (Q11 / A9) ──────────────────────
  it('APPLY_RULE_TO_TAB is no longer recognized (Q11 manual path deleted)', () => {
    const { claimed, response } = gate('APPLY_RULE_TO_TAB', { ruleId: 'r1', tabId: 1 });
    expect(claimed).toBe(false);
    expect(response).toEqual(expect.objectContaining({ success: false, errorCode: 'UNKNOWN_ACTION' }));
  });

  it('GET_CANDIDATES is no longer recognized (Q11 candidates path deleted)', () => {
    const { claimed, response } = gate('GET_CANDIDATES', { ruleId: 'r1' });
    expect(claimed).toBe(false);
    expect(response).toEqual(expect.objectContaining({ success: false, errorCode: 'UNKNOWN_ACTION' }));
  });
});