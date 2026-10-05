/**
 * T10 — server-authoritative APPLY bound to the preview's `configVersion` (F4).
 *
 * The design splits INSPECT (read-only, pure over the FILE) from APPLY (the only
 * writer). APPLY therefore receives ONLY the file string + the user's intent and
 * RECOMPUTES the result server-side (C4: the client cannot be the authority —
 * the old code's own comment admitted the preview "may have been built by hand
 * or mutated").
 *
 * F4: the optimistic lock in `writeSync` already exists, but the UI never sent a
 * version, so APPLY always passed. Here APPLY carries the `configVersion` read
 * at INSPECT time, so a change made in between is genuinely refused with ZERO
 * modification.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { defaultImportIntent } from '@shared/types';
import type { ExportPackage } from '@shared/export-package';
import type { PageRule, ImportIntent } from '@shared/types';

const exact = (value: string) => ({ type: 'exact' as const, value });

function rule(id: string, value: string): PageRule {
  return {
    id,
    urlMatch: exact(value),
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** A minimal well-formed package (the strict validator rejects anything less). */
function pkgString(parts: Partial<ExportPackage>): string {
  const pkg: ExportPackage = {
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-05T00:00:00.000Z',
    scope: { rules: true },
    ...parts,
  };
  return JSON.stringify(pkg);
}

describe('T10: APPLY is server-authoritative and bound to the preview version', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo);
  });

  it('a stale configVersion is refused with ZERO modification (F4)', async () => {
    await repo.addRule(rule('rule-a', 'https://a.example/'));
    const stale = repo.getConfigVersion(); // the version INSPECT would have read
    await repo.addRule(rule('rule-b', 'https://b.example/')); // a write happens in between
    const nowVersion = repo.getConfigVersion();
    expect(nowVersion).not.toBe(stale);

    const before = JSON.stringify(await repo.getSyncState());
    const result = await service.applyImport(
      pkgString({ rules: [{ id: 'rule-c', urlMatch: exact('https://c.example/'), priority: 0 }] }),
      defaultImportIntent(),
      stale,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('CONFIG_CONFLICT');
    // Zero modification — the whole state is byte-identical.
    expect(JSON.stringify(await repo.getSyncState())).toBe(before);
  });

  it('the happy path writes once and advances the version', async () => {
    const version = repo.getConfigVersion();
    const result = await service.applyImport(
      pkgString({
        rules: [
          { id: 'rule-c', urlMatch: exact('https://c.example/'), priority: 0 },
          { id: 'rule-d', urlMatch: exact('https://d.example/'), priority: 1 },
        ],
      }),
      defaultImportIntent(),
      version,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.configVersion).toBe(version + 1);

    const rules = (await repo.getSyncState()).rules;
    expect(rules.map((r) => r.id).sort()).toEqual(['rule-c', 'rule-d']);
  });

  it('recomputes from the FILE, not any client preview (C4)', async () => {
    await repo.addRule(rule('rule-target', 'https://target.example/'));
    const version = repo.getConfigVersion();

    // The file carries an EMPTY rules array with the dimension present (A3:
    // "carried but empty"), so `rules` participates.
    const result = await service.applyImport(
      pkgString({ rules: [] }),
      defaultImportIntent(),
      version,
    );
    expect(result.success).toBe(true);

    // incremental ⇒ "file-missing, target-has" is KEPT. The old code replaced
    // `state.rules` wholesale; the server recomputation must not.
    expect((await repo.getSyncState()).rules.map((r) => r.id)).toEqual(['rule-target']);
  });

  it('an overwrite intent deletes file-missing records (the mode is honoured)', async () => {
    await repo.addRule(rule('rule-target', 'https://target.example/'));
    const version = repo.getConfigVersion();
    const base = defaultImportIntent();
    const intent: ImportIntent = {
      ...base,
      dimensionModes: { ...base.dimensionModes, rules: 'overwrite' },
    };

    const result = await service.applyImport(pkgString({ rules: [] }), intent, version);
    expect(result.success).toBe(true);
    expect((await repo.getSyncState()).rules).toEqual([]);
  });

  it('an unparseable / invalid file is refused with zero modification', async () => {
    await repo.addRule(rule('rule-a', 'https://a.example/'));
    const version = repo.getConfigVersion();
    const before = JSON.stringify(await repo.getSyncState());

    const bad = await service.applyImport('not json at all', defaultImportIntent(), version);
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.errorCode).toBe('IMPORT_INVALID');

    const wrongShape = await service.applyImport(JSON.stringify({ hello: 'world' }), defaultImportIntent(), version);
    expect(wrongShape.success).toBe(false);

    expect(JSON.stringify(await repo.getSyncState())).toBe(before);
    expect(repo.getConfigVersion()).toBe(version);
  });

  it('does NOT re-read the disk or fingerprint the file (D12 — same string in, same result)', async () => {
    const version = repo.getConfigVersion();
    const file = pkgString({ slots: [{ id: 3, urlMatch: exact('https://s3/'), marker: {}, titleSnapshot: 'S3', faviconSnapshot: '' }] });

    const first = await service.applyImport(file, defaultImportIntent(), version);
    expect(first.success).toBe(true);

    // Applying the SAME string again against the NEW version succeeds again —
    // it is a pure function of (file, intent, current), never of the disk.
    const second = await service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());
    expect(second.success).toBe(true);
    expect((await repo.getSyncState()).slots.map((s) => s.id)).toEqual([3]);
  });
});