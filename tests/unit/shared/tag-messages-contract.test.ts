/**
 * T7 — the tag message family and its registration in the action whitelist.
 *
 * The whitelist test drives the REAL `handleMessage` gate (the private-access
 * pattern used by `messages-import-export-contract.test.ts`) rather than
 * `routeMessage`, which bypasses the gate. `KNOWN_ACTIONS` is hand-written and
 * the union is derived from the request types, so the failure this guards
 * against is specific: a message that COMPILES into the union but is REJECTED at
 * runtime because nobody added it to the whitelist (G-D).
 *
 * The second assertion — that the literal appears in BOTH source files — catches
 * the half-commit where the union and the whitelist drift apart.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';

describe('T7: the four tag actions really pass the whitelist gate', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const gate = (action: string, payload?: unknown): { claimed: boolean } => {
    const claimed = (
      worker as unknown as {
        handleMessage: (m: unknown, s: unknown, r: (resp?: unknown) => void) => boolean;
      }
    ).handleMessage({ requestId: `t-${action}`, action, payload }, {}, () => { /* noop */ });
    return { claimed };
  };

  beforeEach(async () => {
    adapter.reset();
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  // `UPDATE_TAG` replaced `RENAME_TAG`: one action edits name + both colours, so
// there is no second action writing the same fields.
  const TAG_ACTIONS = ['CREATE_TAG', 'UPDATE_TAG', 'DELETE_TAG', 'SET_RULE_TAGS'] as const;

  for (const action of TAG_ACTIONS) {
    it(`${action} is claimed by the gate`, () => {
      expect(gate(action, {}).claimed).toBe(true);
    });
  }

  it('the literal lives in BOTH the contract and the whitelist (no half-commit)', () => {
    const messagesSrc = readFileSync('src/shared/messages.ts', 'utf8');
    const orchestratorSrc = readFileSync('src/background/worker-orchestrator.ts', 'utf8');
    for (const action of TAG_ACTIONS) {
      expect(messagesSrc).toContain(`'${action}'`);
      expect(orchestratorSrc).toContain(`'${action}'`);
    }
  });

  it('the bidirectional Exclude guard is intact (not widened to a plain array)', () => {
    const orchestratorSrc = readFileSync('src/background/worker-orchestrator.ts', 'utf8');
    // A widened annotation would silently disable the compile-time guard (R6).
    expect(orchestratorSrc).toContain("as const satisfies readonly AnyRequest['action'][]");
  });
});

describe('T7: the existing rule protocol is not polluted by tags (A1)', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  beforeEach(async () => {
    adapter.reset();
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  const gate = (action: string): boolean => (
    worker as unknown as {
      handleMessage: (m: unknown, s: unknown, r: (resp?: unknown) => void) => boolean;
    }
  ).handleMessage({ requestId: `t-${action}`, action, payload: {} }, {}, () => { /* noop */ });

  it('the existing rule actions are still claimed', () => {
    for (const action of ['CREATE_RULE', 'UPDATE_RULE', 'DELETE_RULE']) {
      expect(gate(action)).toBe(true);
    }
  });

  it('CREATE_RULE / UPDATE_RULE payloads carry no tag field (tags are a separate write)', () => {
    const messagesSrc = readFileSync('src/shared/messages.ts', 'utf8');
    // Isolate the two rule request declarations and assert their payloads never
    // grew a tag field — that would route tags through `applyToMatchingTabs`.
    const createRuleBlock = messagesSrc.slice(
      messagesSrc.indexOf('interface CreateRuleRequest'),
      messagesSrc.indexOf('interface UpdateRuleRequest'),
    );
    const updateRuleBlock = messagesSrc.slice(
      messagesSrc.indexOf('interface UpdateRuleRequest'),
      messagesSrc.indexOf('interface DeleteRuleRequest'),
    );
    expect(createRuleBlock).not.toContain('tagIds');
    expect(createRuleBlock).not.toContain('tags');
    expect(updateRuleBlock).not.toContain('tagIds');
    expect(updateRuleBlock).not.toContain('tags');
  });
});