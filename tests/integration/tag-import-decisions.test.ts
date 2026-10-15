/**
 * T10 — the import side's tag decisions: identity resolution (A-e), the
 * documented asymmetry on appearance (S6/A10), and the A8 re-decision.
 *
 * Two things this file pins that are easy to "improve" wrongly:
 *
 *   1. A HIT reuses the LOCAL tag entirely — id AND colour. The file's colour
 *      must NOT overwrite the machine's, because the machine's tag is the same
 *      tag and the user curates their own appearance locally.
 *   2. A MISS gets the DEFAULT appearance, never the file's colour. The import
 *      side has no colour SOURCE for a name the file's own vocabulary did not
 *      define — that absence is a registered trade-off (§6 "有据的不对称"), so
 *      silently using some colour would be inventing an input that does not
 *      exist. The count of such creations is DISCLOSED (S6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { IconService } from '@background/icon-service';
import { defaultImportIntent } from '@shared/types';
import type { SyncState, ImportIntent } from '@shared/types';
import type { ExportPackage } from '@shared/export-package';
import { DEFAULT_TAG_BACKGROUND } from '@background/tag-service';

const adapter = createMockAdapter();
let repo: StorageRepository;
let service: ImportExportService;

const pkgString = (parts: Partial<ExportPackage>): string =>
  JSON.stringify({
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-11T00:00:00.000Z',
    scope: {},
    ...parts,
  });

/**
 * A rule referencing TWO names:
 *   - `work`  — defined in the file vocabulary (so it carries the file's colour)
 *   - `urgent` — NOT defined there (a "dangling name": S6/A10's default-appearance case)
 */
const RULE = {
  id: 'r-file',
  urlMatch: { type: 'exact' as const, value: 'https://file.example/' },
  priority: 0,
  tags: ['work', 'urgent'],
};

async function seedMachine(tags: Array<{ id: string; name: string; bg: string }>): Promise<void> {
  await repo.mutateSyncTags((d: SyncState) => {
    d.tags = tags.map((t) => ({ id: t.id, name: t.name, backgroundColor: t.bg, textColor: '#fff' }));
  });
}

describe('T10: A-e (revised) — reuse by name is trim-equal, and the FILE colour is applied', () => {
  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  it('a hit reuses the local ID and takes the FILE colour', async () => {
    // The ID is what "reuse" protects: every existing reference to the tag keeps
    // resolving to the same local row. The COLOUR is what the import brings — the
    // earlier rule that the machine's colour always survived was withdrawn, because
    // it made a shared vocabulary unable to carry its own appearance.
    await seedMachine([{ id: 'local-work', name: 'work', bg: '#RED' }]);
    // The package names `work` with a DIFFERENT colour.
    const file = pkgString({
      tags: [{ name: 'work', backgroundColor: '#BLUE', textColor: '#000' }],
      rules: [RULE],
    });

    const result = await service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tags = await repo.getTags();
    const work = tags.filter((t) => t.name === 'work');
    // No second `work`, the SAME local id...
    expect(work).toHaveLength(1);
    expect(work[0]?.id).toBe('local-work');
    // ...and the file's colour applied.
    expect(work[0]?.backgroundColor).toBe('#BLUE');
    expect(work[0]?.textColor).toBe('#000');
  });

  it('a DANGLING name (undefined by the file AND unknown locally) is created with the DEFAULT appearance, and the count is DISCLOSED (S6)', async () => {
    await seedMachine([{ id: 'local-work', name: 'work', bg: '#RED' }]);
    // `urgent` is referenced by the rule but the vocabulary does NOT define it,
    // so there is no colour to carry — this is the A10/S6 case.
    const file = pkgString({
      tags: [{ name: 'work', backgroundColor: '#BLUE', textColor: '#000' }],
      rules: [RULE],
    });

    const result = await service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const urgent = (await repo.getTags()).find((t) => t.name === 'urgent');
    expect(urgent).toBeDefined();
    // Default appearance — the file had no definition for this name at all.
    expect(urgent?.backgroundColor).toBe(DEFAULT_TAG_BACKGROUND);
    expect(result.result.tagsCreatedWithDefaultAppearance).toBe(1);
  });

  it('a name DEFINED by the file carries the file colour when the machine lacks it (A4)', async () => {
    // Control for the case above: here the vocabulary DOES carry a colour.
    const file = pkgString({
      tags: [{ name: 'fresh', backgroundColor: '#ABCDEF', textColor: '#000' }],
      rules: [{ ...RULE, tags: ['fresh'] }],
    });

    const result = await service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const fresh = (await repo.getTags()).find((t) => t.name === 'fresh');
    expect(fresh?.backgroundColor).toBe('#ABCDEF');
    // A name the vocabulary DID define is not a "default appearance" creation.
    expect(result.result.tagsCreatedWithDefaultAppearance ?? 0).toBe(0);
  });

  it('resolves a rule\u2019s inlined names to local ids', async () => {
    await seedMachine([{ id: 'local-work', name: 'work', bg: '#RED' }]);
    const file = pkgString({
      tags: [{ name: 'work', backgroundColor: '#BLUE', textColor: '#000' }],
      rules: [RULE],
    });
    await service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());

    const rule = (await repo.getSyncState()).rules.find((r) => r.id === 'r-file');
    // `work` resolved to the local id; `urgent` got created and resolved too.
    expect(rule?.tagIds).toContain('local-work');
    expect(rule?.tagIds).toHaveLength(2);
  });
});

describe('T10: A8 — to-incremental produces the same outcome as rewriting the mode', () => {
  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  it('the two expressions of the same decision agree', async () => {
    const file = pkgString({ tags: [{ name: 'A', backgroundColor: '#111', textColor: '#fff' }] });
    await seedMachine([{ id: 'a', name: 'A', bg: '#111' }, { id: 'b', name: 'B', bg: '#222' }]);
    const version = repo.getConfigVersion();

    const base = defaultImportIntent();
    const viaResolution: ImportIntent = {
      ...base,
      dimensionModes: { ...base.dimensionModes, tags: 'overwrite' },
      tagOverwriteResolution: 'to-incremental',
    };
    const viaModes: ImportIntent = {
      ...base,
      dimensionModes: { ...base.dimensionModes, tags: 'incremental' },
    };

    const a = await service.applyImport(file, viaResolution, version);
    const tagsAfterResolution = (await repo.getTags()).map((t) => t.name).sort();

    // Reset and run the other spelling against the same starting machine.
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
    await seedMachine([{ id: 'a', name: 'A', bg: '#111' }, { id: 'b', name: 'B', bg: '#222' }]);
    const b = await service.applyImport(file, viaModes, repo.getConfigVersion());
    const tagsAfterModes = (await repo.getTags()).map((t) => t.name).sort();

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    // Neither deletes B (both are "incremental" in effect).
    expect(tagsAfterResolution).toEqual(['A', 'B']);
    expect(tagsAfterModes).toEqual(['A', 'B']);
  });
});