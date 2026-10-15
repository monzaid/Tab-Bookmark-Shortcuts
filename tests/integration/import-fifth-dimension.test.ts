/**
 * T8 — the fifth (tags) dimension wired through diff, intent resolution, apply.
 *
 * The dimension is NOT a record list: a tag vocabulary is carried as a whole, so
 * it takes the "part-shaped" pipeline the settings/shortcuts dimensions already
 * use (a row per part, no record ids). Two consequences are asserted here:
 *
 *   1. `presence.tags` distinguishes ABSENT from CARRIED-AND-EMPTY (A2 three-state).
 *   2. `overwrite` on tags DELETES target-side tags by default (cascade), but A8
 *      lets the user re-decide that as `to-incremental` — and because the two are
 *      the same decision expressed two ways, the diff must DISCLOSE the deletion
 *      before it happens. A silent overwrite would bypass the C4 protection.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { IconService } from '@background/icon-service';
import { computeDiff } from '@shared/import-diff';
import { defaultImportIntent } from '@shared/types';
import type { SyncState, ImportIntent } from '@shared/types';
import type { ExportPackage, PortableTag } from '@shared/export-package';

const portableTag = (name: string, bg = '#000', fg = '#fff'): PortableTag => ({
  name, backgroundColor: bg, textColor: fg,
});

const pkg = (parts: Partial<ExportPackage>): ExportPackage => ({
  schemaVersion: 1,
  generator: { name: 'test', version: '1' },
  exportedAt: '2026-10-11T00:00:00.000Z',
  scope: {},
  ...parts,
});

const stateWith = (tags: Array<{ id: string; name: string }>): SyncState => ({
  configVersion: 1,
  matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
  switchDirection: 'next',
  autoBindGlobal: true,
  slots: [],
  rules: [],
  tags: tags.map((t) => ({ ...t, backgroundColor: '#111', textColor: '#eee' })),
});

describe('T8: presence distinguishes absent from carried-and-empty (A2)', () => {
  it('a package carrying `tags: []` reports tags present', () => {
    expect(computeDiff(pkg({ tags: [] }), stateWith([]), defaultImportIntent()).dimensions.tags).toBe(true);
  });

  it('a package without `tags` reports tags absent', () => {
    expect(computeDiff(pkg({}), stateWith([]), defaultImportIntent()).dimensions.tags).toBe(false);
  });
});

describe('T8: A8 — overwrite on tags discloses the delete and can be re-decided', () => {
  const file = pkg({ tags: [portableTag('A')] });

  it('cascade is the default under overwrite, and the inspect diff DISCLOSES the loss', () => {
    const current = stateWith([{ id: 'x1', name: 'A' }, { id: 'x2', name: 'B' }]);
    const intent: ImportIntent = {
      ...defaultImportIntent(),
      dimensionModes: { ...defaultImportIntent().dimensionModes, tags: 'overwrite' },
      tagOverwriteResolution: 'cascade',
    };
    const diff = computeDiff(file, current, intent);
    // §7 item 5: a destructive delete must be visible as a row before it happens.
    const tagRows = diff.tagNames ?? [];
    expect(tagRows.some((r) => r.id === 'B' && r.status === 'deleted')).toBe(true);
  });

  it('to-incremental discloses NO deletion (nothing will be removed)', () => {
    const current = stateWith([{ id: 'x1', name: 'A' }, { id: 'x2', name: 'B' }]);
    const intent: ImportIntent = {
      ...defaultImportIntent(),
      dimensionModes: { ...defaultImportIntent().dimensionModes, tags: 'overwrite' },
      tagOverwriteResolution: 'to-incremental',
    };
    const diff = computeDiff(file, current, intent);
    const tagRows = diff.tagNames ?? [];
    expect(tagRows.some((r) => r.id === 'B' && r.status === 'deleted')).toBe(false);
  });

  it('tag row count matches the number of carried tags (number and rows cannot disagree)', () => {
    const current = stateWith([{ id: 'x1', name: 'A' }, { id: 'x2', name: 'B' }]);
    const diff = computeDiff(file, current, defaultImportIntent());
    // One row per tag the FILE carries.
    expect((diff.tagNames ?? []).length).toBe(file.tags?.length);
  });
});

describe('T8: applyImport reports the tags dimension (G-H)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  it('dimensions.tags is always present in the apply result (shape completeness)', async () => {
    const result = await service.applyImport(
      JSON.stringify(pkg({ tags: [portableTag('A')] })),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    // The shape must exist so consumers iterating DIMENSION_LABELS never find it
    // missing — the "5 dimensions, 4 reported" inconsistency D0 warns about.
    expect(result.result.dimensions.tags).toBeDefined();
    expect(typeof result.result.dimensions.tags.changed).toBe('number');
    expect(typeof result.result.dimensions.tags.failed).toBe('number');
  });
});