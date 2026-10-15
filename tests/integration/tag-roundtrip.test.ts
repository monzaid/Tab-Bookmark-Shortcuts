/**
 * T20 — end-to-end tag round-trip: symmetry, idempotence, the overwrite paths,
 * and the export-side self-consistency after a cascade.
 *
 * This is the matrix design §5 asks for at the INTEGRATION layer:
 *   3 target-machine states  x  3 operations  =  9 cells, all asserted.
 *
 * The "same name, different colour" cell is the one that matters most: A-e's match
 * is trim-equal by NAME, so a naive "create if absent" implementation would leave
 * TWO `work` tags on that machine — a direct C2/I4 violation. Asserting that the
 * count does NOT grow is the way to catch it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { IconService } from '@background/icon-service';
import { TagService } from '@background/tag-service';
import {
  computeExportSelfConsistency,
  DEFAULT_TAG_BACKGROUND,
  DEFAULT_TAG_TEXT_COLOR,
} from '@shared/export-package';
import { selfConsistencyDiff } from '@shared/tags';
import { defaultImportIntent } from '@shared/types';
import type { SyncState, TagDefinition, ImportIntent } from '@shared/types';

const adapter = createMockAdapter();
let repo: StorageRepository;
let service: ImportExportService;
let tagService: TagService;

const tag = (id: string, name: string, bg: string): TagDefinition => ({
  id, name, backgroundColor: bg, textColor: '#ffffff',
});

const rule = (id: string, tagIds: string[]) => ({
  id,
  urlMatch: { type: 'exact' as const, value: `https://${id}/` },
  priority: 0,
  tagIds,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

async function seed(tags: TagDefinition[], rules: Array<ReturnType<typeof rule>>): Promise<void> {
  await repo.mutateSyncTags((d: SyncState) => {
    d.tags = tags;
    d.rules = rules;
  });
}

async function exportNow(scope = { slots: false, rules: true, tags: true }): Promise<string> {
  const res = await service.exportPackage(scope);
  if (!res.success) throw new Error('export failed');
  return res.package;
}

/** Import a package string onto the CURRENT machine. */
async function importNow(file: string, intent: ImportIntent = defaultImportIntent()) {
  return service.applyImport(file, intent, repo.getConfigVersion());
}

beforeEach(async () => {
  adapter.reset();
  repo = new StorageRepository(adapter);
  await repo.initialize();
  service = new ImportExportService(repo, new IconService(repo));
  tagService = new TagService(repo);
});

describe('T20: a VOCABULARY tag nothing references still arrives', () => {
  /**
   * The defect this pins: `resolveImportedTags` iterated only the names the
   * carried RULES referenced, so a tag the file's vocabulary defined but no rule
   * used was silently dropped — the import reported success and the tags table
   * stayed unchanged. Exporting the tags dimension exists precisely to transfer
   * the vocabulary, and an unreferenced tag is the ordinary case, not an edge one
   * (a user defines a label before tagging anything with it).
   */
  it('creates tags the file defines even when no rule names them', async () => {
    await seed(
      [tag('solo', 'solo', '#00AA00'), tag('w', 'work', '#FF0000')],
      // The rule references ONLY `work`, so `solo` travels as pure vocabulary.
      [rule('r1', ['w'])],
    );
    const file = await exportNow();

    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));

    const result = await importNow(file);
    expect(result.success).toBe(true);

    const tags = await repo.getTags();
    expect(tags.map((t) => t.name).sort()).toEqual(['solo', 'work']);
    expect(tags.find((t) => t.name === 'solo')?.backgroundColor).toBe('#00AA00');
  });

  it('a file whose vocabulary is EMPTY creates the tag with the DEFAULT appearance', async () => {
    // #5's real shape: the colours are missing because the FILE has no `tags`
    // node at all — that is what "Include them" was supposed to ship and did not
    // (#1). The write is correct given such a file: `resolveImportedTags` has no
    // colour source and uses the default, and DISCLOSES the count so the user is
    // told rather than left to notice grey tags later.
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));

    // A package carrying one rule that names a tag, with NO vocabulary — the
    // exact file the broken "include them" produced.
    const file = JSON.stringify({
      schemaVersion: 1,
      generator: { name: 'test', version: '1' },
      exportedAt: '2026-10-11T00:00:00.000Z',
      scope: { rules: true },
      rules: [{
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a/' },
        priority: 0,
        title: 'A',
        tags: ['work'],
      }],
    });
    const result = await importNow(file);
    expect(result.success).toBe(true);
    const tags = await repo.getTags();
    expect(tags.map((t) => t.name)).toEqual(['work']);
    // The default pair, from the ONE shared definition.
    expect(tags[0].backgroundColor).toBe(DEFAULT_TAG_BACKGROUND);
    expect(tags[0].textColor).toBe(DEFAULT_TAG_TEXT_COLOR);
    // ...and it is not silent: the count is reported for disclosure (on the
    // APPLY result, which is what the result panel reads).
    expect(result.success && result.result.tagsCreatedWithDefaultAppearance).toBe(1);
  });

  it('"leave them out" drops the reference, so no tag is invented', async () => {
    // The A-f/D-e answer on the IMPORT side: the file references a tag it does not
    // define, and the user chose not to have it invented. The reference goes; the
    // RULE stays (the choice costs a label, never a record).
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));

    const file = JSON.stringify({
      schemaVersion: 1,
      generator: { name: 'test', version: '1' },
      exportedAt: '2026-10-11T00:00:00.000Z',
      scope: { rules: true },
      rules: [{
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a/' },
        priority: 0,
        title: 'A',
        tags: ['ghost'],
      }],
    });

    const result = await service.applyImport(
      file,
      { ...defaultImportIntent(), stripOrphanTagNames: true },
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    // No tag at all: nothing was defined, and the user declined the invention.
    expect(await repo.getTags()).toEqual([]);
    // The rule DID land, with an empty tag list.
    const rules = (await repo.getSyncState()).rules;
    expect(rules.map((r) => r.id)).toEqual(['r1']);
    expect(rules[0].tagIds).toEqual([]);
    // ...and nothing is reported as default-appearance, because nothing was created.
    expect(result.success && result.result.tagsCreatedWithDefaultAppearance).toBeUndefined();
  });

  it('"leave them out" drops EVERY tag reference in the file, including resolvable ones', async () => {
    // The user's answer was about the FILE's tags as a whole ("include them or leave
    // them out"), so nothing from this file is attached. Scoping it to only the
    // unresolvable names left the rule still carrying a tag, which reads as the
    // answer having been ignored — the reported symptom.
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    await repo.mutateSyncTags((d: SyncState) => {
      d.tags = [tag('local', 'work', '#123456')];
      d.rules = [];
    });
    service = new ImportExportService(repo, new IconService(repo));

    const file = JSON.stringify({
      schemaVersion: 1,
      generator: { name: 'test', version: '1' },
      exportedAt: '2026-10-11T00:00:00.000Z',
      scope: { rules: true },
      rules: [{
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a/' },
        priority: 0,
        title: 'A',
        tags: ['work'],
      }],
    });

    const result = await service.applyImport(
      file,
      { ...defaultImportIntent(), stripOrphanTagNames: true },
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    const rules = (await repo.getSyncState()).rules;
    // No reference from the file — and the local tag itself is untouched (it is
    // still there, it just is not attached to the imported rule).
    expect(rules[0].tagIds).toEqual([]);
    expect((await repo.getTags()).map((t) => t.name)).toEqual(['work']);
  });

  it('a vocabulary of ONLY unreferenced tags still lands (rules not carried)', async () => {
    await seed([tag('solo', 'solo', '#123456')], []);
    // Tags alone: no rules in the package at all, so the referenced-names path
    // contributes nothing and the vocabulary is the entire payload.
    const file = await exportNow({ slots: false, rules: false, tags: true });

    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));

    const result = await importNow(file);
    expect(result.success).toBe(true);
    const tags = await repo.getTags();
    expect(tags.map((t) => t.name)).toEqual(['solo']);
  });
});

describe('T20: symmetry — export then import reproduces names and colours', () => {
  it('source → EMPTY machine: tags arrive with their names and colours intact', async () => {
    await seed(
      [tag('w', 'work', '#FF0000'), tag('u', 'urgent', '#0000FF')],
      [rule('r1', ['w', 'u'])],
    );
    const file = await exportNow();

    // A fresh machine.
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));

    const result = await importNow(file);
    expect(result.success).toBe(true);

    const tags = await repo.getTags();
    expect(tags.map((t) => t.name).sort()).toEqual(['urgent', 'work']);
    expect(tags.find((t) => t.name === 'work')?.backgroundColor).toBe('#FF0000');
    expect(tags.find((t) => t.name === 'urgent')?.backgroundColor).toBe('#0000FF');

    // The rule's references resolved to the two local ids.
    const imported = (await repo.getSyncState()).rules.find((r) => r.id === 'r1');
    expect(imported?.tagIds).toHaveLength(2);
  });

  it('is IDEMPOTENT: importing the same package twice adds nothing', async () => {
    await seed([tag('w', 'work', '#FF0000')], [rule('r1', ['w'])]);
    const file = await exportNow();

    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));

    await importNow(file);
    const afterFirst = (await repo.getTags()).map((t) => t.name).sort();
    await importNow(file);
    const afterSecond = (await repo.getTags()).map((t) => t.name).sort();

    expect(afterFirst).toEqual(['work']);
    expect(afterSecond).toEqual(['work']);  // no duplicate
  });

  it('SAME NAME DIFFERENT COLOUR: reuses the local tag, creating no second, and APPLIES the file colour', async () => {
    // A-e as revised: reuse is by NAME (so no duplicate — I4 still holds), and the
    // appearance is what the import brings. The earlier rule ("the machine's colour
    // always survives") was withdrawn: it made a shared vocabulary unable to carry
    // its own appearance, which is the one thing the dimension exists to transfer.
    await seed([tag('w', 'work', '#FF0000')], [rule('r1', ['w'])]);
    const file = await exportNow();

    // Target machine already has `work` but GREEN.
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
    await seed([tag('local', 'work', '#00FF00')], []);

    await importNow(file);

    const tags = await repo.getTags();
    // Exactly ONE `work` — reused, not duplicated...
    expect(tags.filter((t) => t.name === 'work')).toHaveLength(1);
    // ...at the SAME local id (so every existing reference still resolves), and
    // carrying the file's colour.
    expect(tags.find((t) => t.name === 'work')?.id).toBe('local');
    expect(tags.find((t) => t.name === 'work')?.backgroundColor).toBe('#FF0000');
  });

  it('a name the file only REFERENCES does not recolour an existing tag', async () => {
    // The asymmetry that remains: with no vocabulary entry there is no appearance
    // anywhere, so applying one would be inventing a change the file never asked
    // for. The tag keeps its colours and is still attached to the rule.
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
    await seed([tag('local', 'work', '#00FF00')], []);

    const file = JSON.stringify({
      schemaVersion: 1,
      generator: { name: 'test', version: '1' },
      exportedAt: '2026-10-11T00:00:00.000Z',
      scope: { rules: true },
      rules: [{
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a/' },
        priority: 0,
        title: 'A',
        tags: ['work'],
      }],
    });
    const result = await service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);

    const tags = await repo.getTags();
    expect(tags[0].backgroundColor).toBe('#00FF00');
    // ...and the reference resolved to it, so the rule is tagged.
    expect((await repo.getSyncState()).rules[0].tagIds).toEqual(['local']);
  });
});

describe('T20: the overwrite paths, end to end (A7/A8)', () => {
  async function targetWithExtra(): Promise<string> {
    await seed([tag('w', 'work', '#FF0000')], [rule('r1', ['w'])]);
    const file = await exportNow();
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
    // Target has work AND an extra `other` the file does not carry.
    await seed([tag('w2', 'work', '#111111'), tag('o', 'other', '#222222')], []);
    return file;
  }

  it('overwrite + cascade DELETES the file-missing tag', async () => {
    const file = await targetWithExtra();
    const base = defaultImportIntent();
    const intent: ImportIntent = {
      ...base,
      dimensionModes: { ...base.dimensionModes, rules: 'overwrite', tags: 'overwrite' },
      tagOverwriteResolution: 'cascade',
    };
    const result = await importNow(file, intent);
    expect(result.success).toBe(true);
    expect((await repo.getTags()).map((t) => t.name).sort()).toEqual(['work']);
  });

  it('overwrite + to-incremental KEEPS the file-missing tag', async () => {
    const file = await targetWithExtra();
    const base = defaultImportIntent();
    const intent: ImportIntent = {
      ...base,
      dimensionModes: { ...base.dimensionModes, rules: 'overwrite', tags: 'overwrite' },
      tagOverwriteResolution: 'to-incremental',
    };
    const result = await importNow(file, intent);
    expect(result.success).toBe(true);
    expect((await repo.getTags()).map((t) => t.name).sort()).toEqual(['other', 'work']);
  });
});

describe('T20: cascade atomicity, then S3 (the exported package is always self-consistent)', () => {
  it('after deleting a referenced tag, the export has an EMPTY difference', async () => {
    await seed(
      [tag('w', 'work', '#FF0000'), tag('u', 'urgent', '#0000FF')],
      [rule('r1', ['w', 'u']), rule('r2', ['u'])],
    );

    const before = (await repo.getSyncState()).configVersion;
    const del = await tagService.deleteTag('u');
    expect(del.success).toBe(true);
    if (!del.success) return;

    // A-g: ONE write (the entity and both references together).
    expect((await repo.getSyncState()).configVersion).toBe(before + 1);
    // I2: no rule references the deleted id.
    const rules = (await repo.getSyncState()).rules;
    for (const r of rules) expect(r.tagIds).not.toContain('u');

    // S3: the package produced afterwards is self-consistent.
    const file = await exportNow();
    const pkg = JSON.parse(file) as { rules?: unknown; tags?: unknown };
    expect(selfConsistencyDiff(
      (pkg.rules ?? []) as Parameters<typeof selfConsistencyDiff>[0],
      (pkg.tags ?? []) as Parameters<typeof selfConsistencyDiff>[1],
    )).toEqual([]);

    const sc = computeExportSelfConsistency(
      JSON.parse(file) as Parameters<typeof computeExportSelfConsistency>[0],
      await repo.getTags(),
    );
    expect(sc.diff).toEqual([]);
  });
});