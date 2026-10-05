/**
 * T14a — the redesigned import/export protocol: three new actions.
 *
 * A10/A11 replaced the three legacy actions (EXPORT_CONFIG / IMPORT_PREVIEW /
 * IMPORT_COMMIT) with three, one-semantic-each actions:
 *   EXPORT_PACKAGE(scope) · IMPORT_INSPECT(file) · IMPORT_APPLY(file, intent)
 *
 * T14a is ADDITIVE ONLY: the new contracts, their KNOWN_ACTIONS entries and the
 * message-client wrappers are introduced while the legacy actions remain
 * registered (they still have live callers in settings + tests). T14b deletes
 * the legacy trio (merged into T21), so this file deliberately does NOT assert
 * their absence.
 *
 * The runtime half drives the REAL whitelist gate via `handleMessage` (same
 * private-access pattern as known-actions.test.ts) rather than `routeMessage`,
 * which bypasses the gate — a regression here is exactly "compiles, rejected at
 * runtime" (G-D).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { UiRequest, UiAction, ExportPackageRequest, ImportInspectRequest, ImportApplyRequest, ExportPackageResponse, ImportInspectResponse, ImportApplyResponse } from '@shared/messages';
import type { ImportInspection, ImportApplyResult } from '@shared/types';
import { defaultImportIntent } from '@shared/types';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';

describe('T14a: import/export protocol — three new actions', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const gate = (action: string, payload?: unknown): { claimed: boolean; response?: unknown } => {
    let response: unknown;
    const claimed = (
      worker as unknown as {
        handleMessage: (m: unknown, s: unknown, r: (resp?: unknown) => void) => boolean;
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

  const NEW_ACTIONS = ['EXPORT_PACKAGE', 'IMPORT_INSPECT', 'IMPORT_APPLY'] as const;
  const LEGACY_ACTIONS = ['EXPORT_CONFIG', 'IMPORT_PREVIEW', 'IMPORT_COMMIT'] as const;

  // ── Runtime whitelist (this is the G-D guard) ──────────────────────────────
  for (const action of NEW_ACTIONS) {
    it(`${action} is registered in KNOWN_ACTIONS`, () => {
      expect(gate(action, {}).claimed).toBe(true);
    });
  }

  it('the legacy trio stays registered (additive phase — T14b deletes it)', () => {
    for (const action of LEGACY_ACTIONS) {
      expect(gate(action, {}).claimed).toBe(true);
    }
  });

  it('an unregistered action is still rejected (negative control)', () => {
    expect(gate('NOT_A_REAL_ACTION').claimed).toBe(false);
  });

  // ── Type-level: the new actions are members of the UiAction union ──────────
  it('UiAction union includes exactly the three new action strings', () => {
    const actions: UiAction[] = ['EXPORT_PACKAGE', 'IMPORT_INSPECT', 'IMPORT_APPLY'];
    expect(actions).toEqual(NEW_ACTIONS);
  });

  // ── Type-level: the new request shapes are UiRequest members ───────────────
  it('the three new request shapes are assignable to UiRequest', () => {
    const exportReq: ExportPackageRequest = {
      requestId: 'r-export',
      action: 'EXPORT_PACKAGE',
      payload: { scope: { slots: true } },
    };
    const inspectReq: ImportInspectRequest = {
      requestId: 'r-inspect',
      action: 'IMPORT_INSPECT',
      payload: { file: '{"manifest":{}}' },
    };
    const applyReq: ImportApplyRequest = {
      requestId: 'r-apply',
      configVersion: 1,
      action: 'IMPORT_APPLY',
      payload: { file: '{"manifest":{}}', intent: defaultImportIntent() },
    };

    const all: UiRequest[] = [exportReq, inspectReq, applyReq];
    expect(all.map((r) => r.action)).toEqual(['EXPORT_PACKAGE', 'IMPORT_INSPECT', 'IMPORT_APPLY']);
  });

  it('IMPORT_APPLY carries configVersion through RequestBase (C3 binding)', () => {
    const applyReq: ImportApplyRequest = {
      requestId: 'r-apply',
      configVersion: 7,
      action: 'IMPORT_APPLY',
      payload: { file: '{}', intent: defaultImportIntent() },
    };
    expect(applyReq.configVersion).toBe(7);
  });

  // ── Type-level: the three new responses carry the designed payloads ────────
  it('the new responses carry a package string / inspection / apply result', () => {
    const inspection: ImportInspection = {
      diff: { records: [], dimensions: { slots: false, rules: false, settings: false, shortcuts: false } },
      dimensions: { slots: false, rules: false, settings: false, shortcuts: false },
      tolerant: [],
      domainViolations: [],
      overlaps: [],
      configVersion: 1,
    };
    const applied: ImportApplyResult = {
      success: true,
      configVersion: 2,
      counts: { added: 0, replaced: 0, kept: 0, deleted: 0, skipped: 0 },
      tolerant: [],
      domainViolations: [],
      missingIcons: [],
      overlaps: [],
    };

    const exportResp = {
      action: 'EXPORT_PACKAGE',
      result: { success: true, package: '{"manifest":{}}' },
    } satisfies ExportPackageResponse;
    const inspectResp = {
      action: 'IMPORT_INSPECT',
      result: { success: true, inspection },
    } satisfies ImportInspectResponse;
    const applyResp = {
      action: 'IMPORT_APPLY',
      result: { success: true, applied },
    } satisfies ImportApplyResponse;

    expect(exportResp.result.package).toBe('{"manifest":{}}');
    expect(inspectResp.result.inspection.configVersion).toBe(1);
    expect(applyResp.result.applied.counts.added).toBe(0);
  });
});