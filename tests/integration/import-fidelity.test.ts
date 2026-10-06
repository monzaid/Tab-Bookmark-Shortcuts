/**
 * T9 — fidelity guard for the "keep existing" path (F2).
 *
 * F2 is one of the iteration's two SILENT DATA-CORRUPTION defects: the old
 * commit replaced `state.rules` and the global settings WHOLESALE, so an import
 * that carried no rules (or that the user chose to keep) still wiped the target
 * machine's rules. No existing test covered it, which is why it survived.
 *
 * This is a CONTRACT test: it asserts the user-visible promise (G4-A — "no import
 * path may modify a record the user did not select"), and it must FAIL against the
 * old wholesale-replace implementation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { IconService } from '@background/icon-service';
import { defaultImportIntent } from '@shared/types';
import type { ExportPackage } from '@shared/export-package';
import type { PageRule, MatchRuleSettings } from '@shared/types';

const exact = (value: string) => ({ type: 'exact' as const, value });

function rule(id: string, value: string, priority: number): PageRule {
  return {
    id,
    urlMatch: exact(value),
    priority,
    title: `title-${id}`,
    createdAt: `2026-01-0${String(priority + 1)}T00:00:00.000Z`,
    updatedAt: `2026-02-0${String(priority + 1)}T00:00:00.000Z`,
  };
}

function pkgString(parts: Partial<ExportPackage>): string {
  const pkg: ExportPackage = {
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-05T00:00:00.000Z',
    scope: {},
    ...parts,
  };
  return JSON.stringify(pkg);
}

const NON_DEFAULT_SETTINGS: MatchRuleSettings = {
  tabIdMode: 'no-exists',
  ruleCheckMode: 'no-match',
  priority: 'none',
};

describe('T9: the keep-existing path preserves target records byte-for-byte (F2)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  it('a package carrying NO rules leaves every target rule untouched', async () => {
    await repo.addRule(rule('rule-1', 'https://a.example/', 0));
    await repo.addRule(rule('rule-2', 'https://b.example/', 5));
    await repo.addRule(rule('rule-3', 'https://c.example/', -3));

    const before = JSON.stringify((await repo.getSyncState()).rules);

    // The `rules` dimension is ABSENT (A2/A3: not carried) → it must not participate.
    const result = await service.applyImport(pkgString({}), defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);

    // Deep, byte-for-byte: id / urlMatch / priority / title / timestamps.
    expect(JSON.stringify((await repo.getSyncState()).rules)).toBe(before);
  });

  it('a CARRIED but EMPTY rules array under incremental also preserves them', async () => {
    await repo.addRule(rule('rule-1', 'https://a.example/', 0));
    await repo.addRule(rule('rule-2', 'https://b.example/', 5));

    const before = JSON.stringify((await repo.getSyncState()).rules);

    // A3: `rules: []` is "carried but empty" — still a valid dimension, and
    // incremental keeps every "file-missing, target-has" record (§3.2).
    const result = await service.applyImport(pkgString({ rules: [] }), defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);

    expect(JSON.stringify((await repo.getSyncState()).rules)).toBe(before);
  });

  it('a dimension the package did NOT carry leaves the globals untouched (G4-A)', async () => {
    await repo.setMatchSettings(NON_DEFAULT_SETTINGS, repo.getConfigVersion());
    await repo.setSwitchDirection('previous', repo.getConfigVersion());
    await repo.setAutoBindGlobal(false, repo.getConfigVersion());

    const before = await repo.getSyncState();

    // Only `rules` is carried (and empty) — settings/switchDirection/autoBindGlobal
    // are absent, so not one byte of them may move.
    const result = await service.applyImport(pkgString({ rules: [] }), defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);

    const after = await repo.getSyncState();
    expect(after.matchSettings).toEqual(before.matchSettings);
    expect(after.switchDirection).toBe(before.switchDirection);
    expect(after.autoBindGlobal).toBe(before.autoBindGlobal);
  });

  it('an explicit per-record "keep" leaves that record untouched under overwrite', async () => {
    await repo.addRule(rule('rule-1', 'https://a.example/', 0));
    await repo.addRule(rule('rule-2', 'https://b.example/', 5));
    const before = JSON.stringify((await repo.getSyncState()).rules);

    const base = defaultImportIntent();
    const result = await service.applyImport(
      pkgString({ rules: [] }),
      {
        ...base,
        dimensionModes: { ...base.dimensionModes, rules: 'overwrite' },
        recordOverrides: [{ kind: 'rule', id: 'rule-1', action: 'keep' }],
      },
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);

    // rule-1 was explicitly kept; rule-2 (no override) is deleted by overwrite.
    const ids = (await repo.getSyncState()).rules.map((r) => r.id);
    expect(ids).toEqual(['rule-1']);
    expect(JSON.stringify((await repo.getSyncState()).rules)).toBe(
      JSON.stringify([JSON.parse(before)[0]]),
    );
  });
});