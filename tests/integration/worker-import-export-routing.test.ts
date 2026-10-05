/**
 * T17 — route the three redesigned import/export actions, and enforce the
 * configVersion on IMPORT_APPLY.
 *
 * T14a added the contracts + whitelist entries; without this wiring the three
 * actions pass the gate and then fall through the dispatch `default` to
 * UNKNOWN_ACTION. This drives the REAL worker entry (`handleMessage` →
 * `routeMessage`), so it tests routing, not just registration.
 *
 * F4: the legacy IMPORT_COMMIT did `request.configVersion ?? repo.getConfigVersion()`,
 * so the optimistic lock always passed. IMPORT_APPLY must REFUSE a missing
 * version — a missing version is not "use the current one".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import { syncStateToPackage } from '@shared/export-package';
import type { SyncState, PageRule } from '@shared/types';
import { DEFAULT_MATCH_SETTINGS, defaultImportIntent } from '@shared/types';

/** Drive the worker exactly as the runtime does, resolving on the reply. */
function emit(
  worker: WorkerOrchestrator,
  action: string,
  payload?: unknown,
  configVersion?: number,
): Promise<Record<string, unknown>> {
  const message: Record<string, unknown> = { requestId: `t17-${action}`, action };
  if (payload !== undefined) message.payload = payload;
  if (configVersion !== undefined) message.configVersion = configVersion;

  return new Promise((resolve) => {
    (
      worker as unknown as {
        handleMessage: (m: unknown, s: unknown, r: (resp?: unknown) => void) => boolean;
      }
    ).handleMessage(message, {}, (resp) => { resolve(resp as Record<string, unknown>); });
  });
}

const RULE: PageRule = {
  id: 'rule-t17',
  urlMatch: { type: 'exact', value: 'https://t17.example/' },
  priority: 5,
  title: 'T17 rule',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function packageFile(rule: PageRule | null): string {
  const source: SyncState = {
    configVersion: 1,
    matchSettings: DEFAULT_MATCH_SETTINGS,
    switchDirection: 'next',
    autoBindGlobal: true,
    slots: [],
    rules: rule ? [rule] : [],
  };
  return JSON.stringify(syncStateToPackage(source, { rules: true }));
}

describe('T17: three import/export actions are routed', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  beforeEach(async () => {
    adapter.reset();
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('EXPORT_PACKAGE returns a serialized package for the scope', async () => {
    const resp = await emit(worker, 'EXPORT_PACKAGE', {
      scope: { slots: true, rules: true, settings: true },
    });

    // The worker replies with the service result verbatim (the declared
    // `action` on the Response types is not added at runtime — same as the
    // legacy EXPORT_CONFIG case).
    expect(resp.success).toBe(true);
    const pkg = JSON.parse(resp.package as string) as { schemaVersion: number; scope: unknown };
    expect(pkg.schemaVersion).toBe(1);
    expect(pkg.scope).toEqual({ slots: true, rules: true, settings: true });
  });

  it('IMPORT_INSPECT returns the read-only inspection (diff + presence + configVersion)', async () => {
    const resp = await emit(worker, 'IMPORT_INSPECT', { file: packageFile(RULE) });

    expect(resp.success).toBe(true);
    const inspection = resp.inspection as {
      diff: { records: unknown[] };
      dimensions: { rules: boolean; slots: boolean };
      configVersion: number;
    };
    expect(inspection.dimensions.rules).toBe(true);
    expect(inspection.dimensions.slots).toBe(false);
    expect(inspection.diff.records.length).toBeGreaterThan(0);
    expect(typeof inspection.configVersion).toBe('number');
  });

  // ── F4: a missing configVersion is refused, never defaulted ────────────────
  it('IMPORT_APPLY without configVersion is rejected with INVALID_REQUEST (F4)', async () => {
    const resp = await emit(worker, 'IMPORT_APPLY', {
      file: packageFile(RULE),
      intent: defaultImportIntent(),
    }); // no configVersion

    expect(resp.success).toBe(false);
    expect(resp.errorCode).toBe('INVALID_REQUEST');
  });

  it('IMPORT_APPLY with the matching configVersion writes once and +1s the version', async () => {
    const current = (await worker.repo.getSyncState()).configVersion;

    const resp = await emit(
      worker,
      'IMPORT_APPLY',
      { file: packageFile(RULE), intent: defaultImportIntent() },
      current,
    );

    expect(resp.success).toBe(true);
    const applied = resp.result as { counts: { added: number }; configVersion: number };
    expect(applied.counts.added).toBe(1);
    expect(applied.configVersion).toBe(current + 1);

    const after = await worker.repo.getSyncState();
    expect(after.rules.some((r) => r.id === 'rule-t17')).toBe(true);
  });

  it('IMPORT_APPLY with a stale configVersion is refused and changes nothing (F4)', async () => {
    const staleVersion = (await worker.repo.getSyncState()).configVersion;

    // Some other write bumps the version AFTER the version was captured.
    await worker.repo.writeSync(staleVersion, (s) => ({
      ...s,
      switchDirection: 'previous',
    }));

    const before = await worker.repo.getSyncState();
    expect(before.configVersion).toBe(staleVersion + 1);

    const resp = await emit(
      worker,
      'IMPORT_APPLY',
      { file: packageFile(RULE), intent: defaultImportIntent() },
      staleVersion,
    );

    expect(resp.success).toBe(false);
    expect(resp.errorCode).toBe('CONFIG_CONFLICT');

    // Zero modification — configVersion and content are untouched.
    expect(await worker.repo.getSyncState()).toEqual(before);
  });
});