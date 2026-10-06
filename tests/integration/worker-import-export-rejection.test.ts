/**
 * T14b/T21 #15 — a malformed package must be REFUSED, never crash the worker.
 *
 * Driven at the ORCHESTRATOR boundary (`handleMessage`), not by calling the
 * service directly: the two classify differently. A malformed container
 * (`slots: 'x'`) used to reach `computeDiff` and THROW; `handleMessage`'s
 * `.catch` (worker-orchestrator.ts) turned that into `INTERNAL_ERROR`. Asserting
 * "does not throw" against the service directly would be a FALSE boundary — it
 * flips the moment a guard is added, whereas the user-facing contract is
 * "explicit refusal, no crash, no hang".
 *
 * The guard runs before the single write, so a refused file also leaves the
 * store untouched ("ZERO modification").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';

function emit(
  worker: WorkerOrchestrator,
  action: string,
  payload?: unknown,
  configVersion?: number,
): Promise<Record<string, unknown>> {
  const message: Record<string, unknown> = { requestId: `t15-${action}`, action };
  if (payload !== undefined) message.payload = payload;
  // IMPORT_APPLY requires a version (F4) BEFORE the service runs; without it the
  // dispatcher answers INVALID_REQUEST and the shape guard is never reached.
  if (configVersion !== undefined) message.configVersion = configVersion;
  return new Promise((resolve) => {
    (
      worker as unknown as {
        handleMessage: (m: unknown, s: unknown, r: (resp?: unknown) => void) => boolean;
      }
    ).handleMessage(message, {}, (resp) => { resolve(resp as Record<string, unknown>); });
  });
}

/** A package that is structurally sound except for the injected defect. */
function malformed(extra: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-06T00:00:00.000Z',
    scope: {},
    ...extra,
  });
}

describe('T14b/T21 #15: malformed packages are refused at the worker boundary', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  beforeEach(async () => {
    adapter.reset();
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ['a wrong container type (slots: "x")', { slots: 'x' }],
    ['a wrong container type (rules: "x")', { rules: 'x' }],
    ['a null slotStrategies map', { settings: { matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slotStrategies: null } }],
    ['an out-of-enum matchSettings', { settings: { matchSettings: { tabIdMode: 'sometimes', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slotStrategies: {} } }],
  ];

  for (const [label, extra] of cases) {
    it(`INSPECT refuses ${label} with IMPORT_INVALID and does not crash`, async () => {
      const before = await emit(worker, 'GET_STATE');

      const resp = await emit(worker, 'IMPORT_INSPECT', { file: malformed(extra) });

      expect(resp.success).toBe(false);
      expect(resp.errorCode, 'an explicit refusal, not INTERNAL_ERROR').toBe('IMPORT_INVALID');

      const after = await emit(worker, 'GET_STATE');
      expect(after, 'a refused file must not modify the store').toEqual(before);
    });

    it(`IMPORT_APPLY refuses ${label} with IMPORT_INVALID and does not crash`, async () => {
      const before = await emit(worker, 'GET_STATE');

      const resp = await emit(
        worker,
        'IMPORT_APPLY',
        {
          file: malformed(extra),
          intent: { dimensionModes: { slots: 'incremental', rules: 'incremental', settings: 'incremental', shortcuts: 'incremental' } },
        },
        1,
      );

      expect(resp.success).toBe(false);
      expect(resp.errorCode).toBe('IMPORT_INVALID');

      const after = await emit(worker, 'GET_STATE');
      expect(after).toEqual(before);
    });
  }
});