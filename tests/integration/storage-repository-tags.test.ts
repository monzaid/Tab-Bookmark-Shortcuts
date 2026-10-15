/**
 * T6 — tag storage primitives: `getTags` + `mutateSyncTags`, lenient read.
 *
 * The ATOMICITY assertion is the centre of this file, and it is expressed as an
 * INVARIANT ON THE INCREMENT, not as "something changed":
 * one `mutateSyncTags` call that removes an entity AND cleans N rule references
 * must raise `configVersion` by EXACTLY 1. +2 would mean the cascade was split
 * into two writes, which destroys the single-transaction basis that C5's
 * "atomic batch snapshot + undo" depends on.
 *
 * The lenient-read case pins P2: an old archive missing the new fields must be
 * TOLERATED (defaults filled), not rejected as corrupt. Import packages are the
 * only place strictness belongs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository, createDefaultSyncState } from '@background/storage-repository';
import type { TagDefinition } from '@shared/types';

const tag = (id: string, name: string): TagDefinition => ({
  id, name, backgroundColor: '#000', textColor: '#fff',
});

describe('T6: defaults and lenient read (P2)', () => {
  it('createDefaultSyncState() carries an empty tag table', () => {
    expect(createDefaultSyncState().tags).toEqual([]);
  });

  it('a legacy archive without tags/tagIds is filled in, not rejected', async () => {
    const adapter = createMockAdapter();
    // Written straight into the mock's sync area (bypasses our own writers) so
    // the read path sees an old shape: no `tags`, and a rule without `tagIds`.
    adapter.state.syncStorage['syncState'] = {
      configVersion: 1,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [],
      rules: [{
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://x/' },
        priority: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    };

    const repo = new StorageRepository(adapter);
    await repo.initialize();
    const state = await repo.getSyncState();

    expect(state.tags).toEqual([]);
    expect(state.rules[0]?.tagIds).toEqual([]);
  });
});

describe('T6: mutateSyncTags is ONE atomic transaction (A-g)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    // Seed: tags t1, t2 and three rules referencing them.
    await repo.mutateSyncTags((draft) => {
      draft.tags = [tag('t1', 'one'), tag('t2', 'two')];
      draft.rules = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'a' }, priority: 0, tagIds: ['t1'], createdAt: 'x', updatedAt: 'x' },
        { id: 'r2', urlMatch: { type: 'exact', value: 'b' }, priority: 0, tagIds: ['t1', 't2'], createdAt: 'x', updatedAt: 'x' },
        { id: 'r3', urlMatch: { type: 'exact', value: 'c' }, priority: 0, tagIds: ['t2'], createdAt: 'x', updatedAt: 'x' },
      ];
    });
  });

  it('entity removal + N reference cleanups raise configVersion by EXACTLY 1', async () => {
    const before = (await repo.getSyncState()).configVersion;

    await repo.mutateSyncTags((draft) => {
      draft.tags = draft.tags.filter((t) => t.id !== 't1');
      draft.rules.forEach((r) => { r.tagIds = r.tagIds.filter((id) => id !== 't1'); });
    });

    const after = await repo.getSyncState();
    expect(after.configVersion).toBe(before + 1);           // NOT +2: one write
    expect(after.tags.map((t) => t.id)).toEqual(['t2']);    // entity gone
    expect(after.rules.find((r) => r.id === 'r1')?.tagIds).toEqual([]);
    expect(after.rules.find((r) => r.id === 'r2')?.tagIds).toEqual(['t2']);
    expect(after.rules.find((r) => r.id === 'r3')?.tagIds).toEqual(['t2']);  // untouched
  });

  it('getTags() returns the live table', async () => {
    expect((await repo.getTags()).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('a caller mutating the returned array cannot corrupt internal state', async () => {
    const tags = await repo.getTags();
    tags.push(tag('ghost', 'ghost'));
    expect((await repo.getTags()).map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('T6: tag writes land in the SAME sync key (C0 guardrail)', () => {
  it('the tag table is persisted under the existing sync area, not a new key', async () => {
    const adapter = createMockAdapter();
    const repo = new StorageRepository(adapter);
    await repo.initialize();
    await repo.mutateSyncTags((draft) => {
      draft.tags = [tag('t1', 'one')];
    });

    // Exactly the keys the repository already used: `syncState` (and nothing
    // tag-shaped alongside it). A new key here would be the C0 "split the sync
    // key for capacity" change the design refused.
    expect(Object.keys(adapter.state.syncStorage)).toEqual(['syncState']);
    const persisted = adapter.state.syncStorage['syncState'] as { tags?: unknown[] };
    expect(persisted.tags).toEqual([tag('t1', 'one')]);
  });
});