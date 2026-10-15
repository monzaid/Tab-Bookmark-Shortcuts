/**
 * T9 — `TagService`: limits, trim-dedupe, cascading delete (atomic), dangling strip.
 *
 * The assertions are on INVARIANTS:
 *   - a cascade delete raises `configVersion` by EXACTLY 1 (A-g — the undo
 *     snapshot's atomicity depends on it);
 *   - a persisted `tagIds` never contains an id absent from the live table
 *     (D3/I2 — a dangling id would render as an unknown tag forever);
 *   - a rename leaves every referencing rule's `tagIds` byte-identical
 *     (C1 — ids are stable, that is the whole reason rules store ids).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { TagService } from '@background/tag-service';

const adapter = createMockAdapter();
let repo: StorageRepository;
let svc: TagService;

const rule = (id: string, tagIds: string[]) => ({
  id, urlMatch: { type: 'exact' as const, value: `https://${id}/` }, priority: 0,
  tagIds, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

describe('T9: createTag is race-safe (one click must not create N tags)', () => {
  /**
   * The reported defect: one create produced SEVERAL tags with the same name.
   *
   * `createTag` validated against a snapshot read OUTSIDE the write, and the
   * mutator appended unconditionally — so any two calls overlapping in time could
   * BOTH pass the duplicate check and both append. The comment claimed the write
   * re-read inside the mutator; it did not. The service's own docblock asserts the
   * invariant this test pins ("two concurrent creates cannot both pass a stale
   * duplicate check").
   */
  it('two CONCURRENT creates of one name produce exactly ONE tag', async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    svc = new TagService(repo);

    const [a, b] = await Promise.all([
      svc.createTag({ name: '123', backgroundColor: '#111', textColor: '#fff' }),
      svc.createTag({ name: '123', backgroundColor: '#222', textColor: '#fff' }),
    ]);

    // Exactly one is accepted, and the other is refused as a duplicate.
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
    const tags = await repo.getTags();
    expect(tags.filter((t) => t.name === '123')).toHaveLength(1);
  });

  it('THREE concurrent creates still leave one tag (the reported "several")', async () => {
    // The user's case was more than two, which is what a triple-invoked handler
    // produces. The invariant is the same one, stated at the size that was seen.
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    svc = new TagService(repo);

    const results = await Promise.all([
      svc.createTag({ name: '123', backgroundColor: '#111', textColor: '#fff' }),
      svc.createTag({ name: '123', backgroundColor: '#111', textColor: '#fff' }),
      svc.createTag({ name: '123', backgroundColor: '#111', textColor: '#fff' }),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await repo.getTags()).filter((t) => t.name === '123')).toHaveLength(1);
  });
});

describe('T9: TagService business rules', () => {
  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    svc = new TagService(repo);
    // Seed two tags and three rules referencing them.
    await repo.mutateSyncTags((d) => {
      d.tags = [
        { id: 't1', name: 'work', backgroundColor: '#f00', textColor: '#fff' },
        { id: 't2', name: 'urgent', backgroundColor: '#00f', textColor: '#fff' },
      ];
      d.rules = [rule('r1', ['t1']), rule('r2', ['t1', 't2']), rule('r3', ['t2'])];
    });
  });

  describe('C2: trim-equal dedupe, case-sensitive', () => {
    it('rejects a name that trims to an existing one', async () => {
      const r = await svc.createTag({ name: ' work ', backgroundColor: '#000', textColor: '#fff' });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.errorCode).toBe('TAG_NAME_DUPLICATE');
    });

    it('accepts a name differing only by case', async () => {
      const r = await svc.createTag({ name: 'Work', backgroundColor: '#000', textColor: '#fff' });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.tag.name).toBe('Work');   // stored trimmed, case preserved
    });
  });

  describe('C3: limits', () => {
    it('rejects a name longer than 32 chars', async () => {
      const r = await svc.createTag({ name: 'a'.repeat(33), backgroundColor: '#000', textColor: '#fff' });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.errorCode).toBe('TAG_NAME_TOO_LONG');
    });

    it('rejects 9 tag ids on a rule', async () => {
      const r = await svc.setRuleTags('r1', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.errorCode).toBe('RULE_TAG_LIMIT_EXCEEDED');
    });

    it('has NO cap on the total number of tags (C3)', async () => {
      for (let i = 0; i < 200; i += 1) {
        const r = await svc.createTag({ name: `bulk-${String(i)}`, backgroundColor: '#000', textColor: '#fff' });
        expect(r.success).toBe(true);
      }
      expect((await repo.getTags()).length).toBe(202); // 2 seeded + 200
    });
  });

  describe('C4/C5/A-g: cascading delete is one atomic write and is undoable', () => {
    it('reports the affected rule count (the Confirm number)', async () => {
      const n = await svc.countAffectedRules('t1');
      expect(n).toBe(2);  // r1 and r2
    });

    it('one deleteTag => configVersion EXACTLY +1 and every reference cleaned', async () => {
      const before = (await repo.getSyncState()).configVersion;
      const del = await svc.deleteTag('t1');
      expect(del.success).toBe(true);
      if (!del.success) return;
      expect(del.affectedRuleCount).toBe(2);

      const after = await repo.getSyncState();
      expect(after.configVersion).toBe(before + 1);
      expect(after.tags.map((t) => t.id)).toEqual(['t2']);
      expect(after.rules.find((r) => r.id === 'r1')?.tagIds).toEqual([]);
      expect(after.rules.find((r) => r.id === 'r2')?.tagIds).toEqual(['t2']);
    });

    it('restoreDeletedTag puts the entity AND its references back in one write', async () => {
      const del = await svc.deleteTag('t1');
      expect(del.success).toBe(true);
      if (!del.success) return;

      const restore = await svc.restoreDeletedTag(del.snapshot);
      expect(restore.success).toBe(true);

      const state = await repo.getSyncState();
      expect(state.tags.find((t) => t.id === 't1')?.name).toBe('work');
      expect(state.rules.find((r) => r.id === 'r1')?.tagIds).toEqual(['t1']);
      expect(state.rules.find((r) => r.id === 'r2')?.tagIds).toEqual(['t1', 't2']);
    });
  });

  describe('C1: an edit keeps the id stable, so references do not move', () => {
    it('writes the name AND both colours in one call, all three persisted', async () => {
      // The whole reason `UPDATE_TAG` exists: one form submits one decision, and
      // all three fields are in the SAME write — so there is no state where the
      // name landed but the colours did not.
      const r = await svc.updateTag('t1', 'renamed', '#112233', '#aabbcc');
      expect(r.success).toBe(true);
      if (!r.success) return;
      // The RESULT carries the new values, so the caller can render them without
      // a second read (and cannot show a stale colour after a successful edit).
      expect(r.tag).toMatchObject({ id: 't1', name: 'renamed', backgroundColor: '#112233', textColor: '#aabbcc' });

      const stored = (await repo.getTags()).find((t) => t.id === 't1');
      expect(stored).toMatchObject({ name: 'renamed', backgroundColor: '#112233', textColor: '#aabbcc' });
    });

    it('rejects a malformed colour and writes NOTHING (the value becomes CSS)', async () => {
      // Rejected before the transaction opens (the `createTag` order), so a bad
      // appearance cannot land half-applied.
      const r = await svc.updateTag('t1', 'renamed', 'red', '#fff');
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.errorCode).toBe('TAG_COLOR_INVALID');

      const stored = (await repo.getTags()).find((t) => t.id === 't1');
      expect(stored).toMatchObject({ name: 'work', backgroundColor: '#f00' });
    });

    it('rejects a duplicate name but keeps the colours unchanged', async () => {
      // Editing t1 into t2's name must fail on the NAME, not silently rename and
      // recolour. `excludeId` is what makes "save without touching the name" legal.
      const dup = await svc.updateTag('t1', 'urgent', '#112233', '#aabbcc');
      expect(dup.success).toBe(false);
      if (dup.success) return;
      expect(dup.errorCode).toBe('TAG_NAME_DUPLICATE');
      const unchanged = (await repo.getTags()).find((t) => t.id === 't1');
      expect(unchanged).toMatchObject({ name: 'work', backgroundColor: '#f00' });

      // ...and re-saving a tag under its OWN name with new colours is legal.
      const same = await svc.updateTag('t1', 'work', '#112233', '#aabbcc');
      expect(same.success).toBe(true);
    });

    it('a rename leaves every referencing tagIds unchanged', async () => {
      const before = await repo.getSyncState();
      const r = await svc.updateTag('t1', 'renamed', '#3366cc', '#fff');
      expect(r.success).toBe(true);

      const after = await repo.getSyncState();
      expect(after.rules.find((x) => x.id === 'r1')?.tagIds).toEqual(
        before.rules.find((x) => x.id === 'r1')?.tagIds,
      );
      expect(after.rules.find((x) => x.id === 'r2')?.tagIds).toEqual(
        before.rules.find((x) => x.id === 'r2')?.tagIds,
      );
      expect(after.tags.find((t) => t.id === 't1')?.name).toBe('renamed');
    });
  });

  describe('D3/A-h: write paths strip dangling ids before persisting', () => {
    it('persists only live ids, in input order', async () => {
      const r = await svc.setRuleTags('r1', ['t2', 'ghost-1', 't1']);
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.tagIds).toEqual(['t2', 't1']);

      const state = await repo.getSyncState();
      const stored = state.rules.find((x) => x.id === 'r1')?.tagIds;
      expect(stored).toEqual(['t2', 't1']);
      // The dangling id is nowhere in the persisted state.
      expect(JSON.stringify(state)).not.toContain('ghost-1');
    });
  });
});