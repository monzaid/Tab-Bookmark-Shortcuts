/**
 * Undoing a rule deletion (档2).
 *
 * Rules were the only domain with a full CRUD surface and NO way back: a tag could
 * be undeleted, a rule could not. The restore has one property that everything else
 * depends on — it must put the SAME `id` back, because `tagIds` live ON the rule
 * record. A restore under a new id would produce a rule that looks right and is
 * referenced by nothing.
 *
 * The failure mode is asserted too: `repo.addRule` refuses a rule whose `urlMatch`
 * already exists (its duplicate check is by urlMatch, not by id), so a restore can
 * legitimately fail when the user recreated the rule. That must be REPORTED, not
 * silently reported as success.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import type { PageRule } from '@shared/types';

const RULE: PageRule = {
  id: 'rule-abc-123',
  urlMatch: { type: 'exact', value: 'https://example.com/page' },
  priority: 5,
  title: 'A rule',
  tagIds: ['tag-1', 'tag-2'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

describe('rule deletion is undoable', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
    await repo.addRule(structuredClone(RULE));
  });

  it('returns a snapshot of the deleted rule', async () => {
    const result = await service.deleteRule(RULE.id);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // The WHOLE record, `tagIds` and timestamps included.
    expect(result.snapshot.rule.id).toBe(RULE.id);
    expect(result.snapshot.rule.tagIds).toEqual(['tag-1', 'tag-2']);
    expect(result.snapshot.rule.createdAt).toBe(RULE.createdAt);
    // ...and it really is gone.
    expect((await repo.getSyncState()).rules).toHaveLength(0);
  });

  it('restores the rule under its ORIGINAL id, so tag references survive', async () => {
    const deleted = await service.deleteRule(RULE.id);
    if (!deleted.success) throw new Error('delete failed');

    const restored = await service.restoreRule(deleted.snapshot.rule);
    expect(restored.success).toBe(true);

    const rules = (await repo.getSyncState()).rules;
    expect(rules).toHaveLength(1);
    // The id is the assertion that matters: a new one would orphan `tagIds`.
    expect(rules[0].id).toBe(RULE.id);
    expect(rules[0].tagIds).toEqual(['tag-1', 'tag-2']);
    expect(rules[0].priority).toBe(5);
  });

  it('reports an existing rule instead of silently claiming a restore', async () => {
    const deleted = await service.deleteRule(RULE.id);
    if (!deleted.success) throw new Error('delete failed');

    // The user recreated a rule for the same URL in the meantime.
    await repo.addRule({ ...structuredClone(RULE), id: 'rule-replacement' });

    const restored = await service.restoreRule(deleted.snapshot.rule);
    expect(restored.success).toBe(false);
    if (restored.success) return;
    expect(restored.errorCode).toBe('ALREADY_EXISTS');
    // The message names the reason, because the UI shows it verbatim.
    expect(restored.message).toContain('already exists');
  });

  it('is idempotent: restoring a rule that is already back succeeds', async () => {
    const deleted = await service.deleteRule(RULE.id);
    if (!deleted.success) throw new Error('delete failed');

    await service.restoreRule(deleted.snapshot.rule);
    const again = await service.restoreRule(deleted.snapshot.rule);
    expect(again.success).toBe(true);
    expect((await repo.getSyncState()).rules).toHaveLength(1);
  });
});
