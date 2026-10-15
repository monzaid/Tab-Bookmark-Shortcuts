/**
 * TagService — the ONE writer of the tag table and of a rule's tag references
 * (A1/A-a/A-g/A-h).
 *
 * WHAT THIS CLASS IS NOT: it holds NO re-apply entry point. Its constructor
 * takes a `StorageRepository` and nothing else — no browser adapter, no
 * field-application service, no `RuleService`. That is deliberate and
 * load-bearing: the invariant "tags never affect a rule's behaviour" is
 * guaranteed by this boundary rather than by callers remembering not to ask, so
 * there is literally no symbol here capable of triggering a re-application.
 * (The structural test `tag-service-boundary.test.ts` pins it; a comment is not
 * enough — see A-a.)
 *
 * Business rules live here; the repository only moves bytes (P4). Limits,
 * trim-dedupe, the cascade and dangling-strip all read the SAME domain functions
 * in `src/shared/tags.ts` the UI and the importer use, so there is one answer to
 * "is this the same tag" and one to "which id is dangling".
 *
 * Every mutation goes through `repo.mutateSyncTags`, and a cascade is written in
 * ONE call so the entity change and every reference clean-up land in a single
 * transaction — which is what makes the undo snapshot a coherent thing to take
 * (A-g).
 */
import type { StorageRepository } from './storage-repository';
// The default appearance is OWNED by the shared layer (see `export-package.ts`):
// the import PREVIEW needs the same numbers the WRITE uses, and a preview that
// promised a different colour than the write produced would be worse than no
// preview. Re-exported below so existing importers of this module are unchanged.
import { DEFAULT_TAG_BACKGROUND, DEFAULT_TAG_TEXT_COLOR } from '@shared/export-package';
import type { TagDefinition, SyncState, DomainErrorCode } from '@shared/types';
import {
  normalizeTagName,
  findDuplicateTagId,
  isTagNameValid,
  isTagColorValid,
  isRuleTagIdsValid,
  stripDanglingTagIds,
  countTagReferences,
  TAG_NAME_MAX,
  RULE_TAG_MAX,
} from '@shared/tags';

/** The payload the UI hands to `UndoBar` so a delete can be replayed (P3/C5). */
export interface TagDeleteSnapshot {
  tag: TagDefinition;
  /** The rule references as they were, so restoring is a faithful batch replay. */
  refs: Array<{ ruleId: string; tagIds: string[] }>;
}

export type TagResult =
  | { success: true; tag: TagDefinition }
  | { success: false; errorCode: DomainErrorCode; message: string };

export type DeleteTagResult =
  | { success: true; affectedRuleCount: number; snapshot: TagDeleteSnapshot }
  | { success: false; errorCode: DomainErrorCode; message: string };

export type SetRuleTagsResult =
  | { success: true; tagIds: string[] }
  | { success: false; errorCode: DomainErrorCode; message: string };

/** A fresh id for a tag. Local to the install; never travels in a package (A4). */
function newTagId(): string {
  return `tag-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A10/S6: the appearance a tag gets when a name has to be created and NOTHING
 * defines its colours.
 *
 * This is the import side's reality: a rule may reference a name its own package
 * vocabulary never defined, and the target machine has never seen it. There is
 * then no colour to carry — the design records this as a deliberate asymmetry
 * (§6), so a fixed default is the honest answer rather than guessing. The import
 * result reports how many tags this happened to, so it is disclosed, not hidden.
 */
export { DEFAULT_TAG_BACKGROUND, DEFAULT_TAG_TEXT_COLOR };

export class TagService {
  constructor(private repo: StorageRepository) {}

  /** C4: the number the delete confirmation states ("will be removed from N rules"). */
  async countAffectedRules(tagId: string): Promise<number> {
    const sync = await this.repo.getSyncState();
    return countTagReferences(tagId, sync.rules);
  }

  /**
   * Create a tag (C2/C3).
   *
   * Validation runs on a snapshot BEFORE the write, so an obviously-invalid create
   * never opens a transaction and the user gets a fast answer. That snapshot is a
   * COURTESY, though, not the guard: the AUTHORITATIVE duplicate check runs INSIDE
   * the write, against the state the write actually has.
   *
   * Why it has to be inside (the reported defect): reads and writes are both async,
   * so a handler invoked more than once — a double dispatch, a retried message, a
   * form submitted twice — produced concurrent calls that ALL passed the outside
   * check and ALL appended, creating several tags with one name from one click. The
   * read-modify-write is only atomic as a whole; checking the precondition in a
   * separate round trip is what made duplicates possible. `mutateSyncTags` runs its
   * mutator inside the serialized write queue on a fresh clone, so a check placed
   * there sees every earlier append and cannot be raced.
   *
   * A refused duplicate returns no tag, and nothing is written: the mutator flags it
   * and leaves the draft untouched, so the version does not move for a no-op.
   */
  async createTag(input: { name: string; backgroundColor: string; textColor: string }): Promise<TagResult> {
    const name = normalizeTagName(input.name);
    if (!isTagNameValid(name)) {
      return {
        success: false,
        errorCode: 'TAG_NAME_TOO_LONG',
        message: `Tag names must be 1-${String(TAG_NAME_MAX)} characters.`,
      };
    }

    // Fast path: refuse a name that is already taken, without a write.
    const existing = await this.repo.getTags();
    if (findDuplicateTagId(existing, name) !== null) {
      return { success: false, errorCode: 'TAG_NAME_DUPLICATE', message: 'A tag with this name already exists.' };
    }

    const tag: TagDefinition = {
      id: newTagId(),
      name,
      backgroundColor: input.backgroundColor,
      textColor: input.textColor,
    };
    // The verdict of the in-write check, read after the write completes (the
    // mutator is synchronous, so this flag is settled by the time `await` returns).
    let created = false;
    await this.repo.mutateSyncTags((draft) => {
      if (findDuplicateTagId(draft.tags, name) !== null) return; // lost a race
      draft.tags = [...draft.tags, tag];
      created = true;
    });
    if (!created) {
      return { success: false, errorCode: 'TAG_NAME_DUPLICATE', message: 'A tag with this name already exists.' };
    }
    return { success: true, tag };
  }

  /**
   * Edit a tag's name and appearance (C1/C2).
   *
   * The id is untouched, which is the entire point of storing ids: every
   * referencing rule follows the new name with no write to any rule (that
   * invariance is asserted directly). The same holds for the colours — nothing
   * outside the tag table copies them, so an edit cannot ripple.
   *
   * All three fields are written in ONE `mutateSyncTags` call even when only one
   * changed, because the caller's form submits one decision: splitting it would
   * let a name land while the colours failed, and there would then be no single
   * stored value to report as "what your edit produced".
   *
   * Validation runs BEFORE the write (the `createTag` order), so a rejected edit
   * never opens a transaction.
   */
  async updateTag(
    tagId: string,
    rawName: string,
    backgroundColor: string,
    textColor: string,
  ): Promise<TagResult> {
    const name = normalizeTagName(rawName);
    if (!isTagNameValid(name)) {
      return {
        success: false,
        errorCode: 'TAG_NAME_TOO_LONG',
        message: `Tag names must be 1-${String(TAG_NAME_MAX)} characters.`,
      };
    }
    // Guarded on the EDIT path as well as on create: the value is applied as an
    // inline CSS colour, so storing an unvalidated string would let any writer
    // put arbitrary text into the page's styles (see `isTagColorValid`).
    if (!isTagColorValid(backgroundColor) || !isTagColorValid(textColor)) {
      return {
        success: false,
        errorCode: 'TAG_COLOR_INVALID',
        message: 'Tag colours must be six-digit hex values, like #3366CC.',
      };
    }

    const existing = await this.repo.getTags();
    if (!existing.some((t) => t.id === tagId)) {
      return { success: false, errorCode: 'TAG_NOT_FOUND', message: 'Tag not found.' };
    }
    // `excludeId` so editing a tag without touching its name is not a duplicate.
    const duplicateId = findDuplicateTagId(existing, name, tagId);
    if (duplicateId !== null) {
      return { success: false, errorCode: 'TAG_NAME_DUPLICATE', message: 'A tag with this name already exists.' };
    }

    await this.repo.mutateSyncTags((draft) => {
      const tag = draft.tags.find((t) => t.id === tagId);
      if (!tag) return;
      tag.name = name;
      tag.backgroundColor = backgroundColor;
      tag.textColor = textColor;
    });
    return { success: true, tag: { ...(existing.find((t) => t.id === tagId) as TagDefinition), name, backgroundColor, textColor } };
  }

  /**
   * Delete a tag and strip it from every rule, in ONE write (C4/C5/A-g).
   *
   * Returns the affected count (for the confirmation) and a snapshot the UI can
   * hand to the existing `UndoBar`. The snapshot records each touched rule's
   * FULL previous `tagIds`, not just "remove id X", so replaying it restores the
   * exact prior state even if other edits happened in between.
   */
  async deleteTag(tagId: string): Promise<DeleteTagResult> {
    const sync = await this.repo.getSyncState();
    const tag = sync.tags.find((t) => t.id === tagId);
    if (!tag) {
      return { success: false, errorCode: 'TAG_NOT_FOUND', message: 'Tag not found.' };
    }

    const refs = sync.rules
      .filter((r) => r.tagIds.includes(tagId))
      .map((r) => ({ ruleId: r.id, tagIds: [...r.tagIds] }));
    const snapshot: TagDeleteSnapshot = { tag: { ...tag }, refs };

    await this.repo.mutateSyncTags((draft) => {
      draft.tags = draft.tags.filter((t) => t.id !== tagId);
      draft.rules.forEach((r) => {
        if (r.tagIds.includes(tagId)) r.tagIds = stripDanglingTagIds(r.tagIds, draft.tags);
      });
    });

    return { success: true, affectedRuleCount: refs.length, snapshot };
  }

  /**
   * Undo a delete (C5/P3) — one write restores the entity and every reference.
   *
   * Delegates the reference repair to `stripDanglingTagIds` against the
   * RESTORED table, rather than writing the snapshot's ids verbatim: if some
   * other tag was deleted in the meantime, replaying blindly would reintroduce a
   * dangling id. Re-deriving keeps the I2 invariant true across the undo too.
   */
  async restoreDeletedTag(snapshot: TagDeleteSnapshot): Promise<{ success: true } | { success: false; errorCode: DomainErrorCode; message: string }> {
    await this.repo.mutateSyncTags((draft) => {
      if (!draft.tags.some((t) => t.id === snapshot.tag.id)) {
        draft.tags = [...draft.tags, { ...snapshot.tag }];
      }
      for (const ref of snapshot.refs) {
        const rule = draft.rules.find((r) => r.id === ref.ruleId);
        if (!rule) continue;
        // Replay the snapshot's list IN ITS ORIGINAL ORDER (that is the state
        // being restored), then append any tag the rule gained after the delete
        // so an intervening edit is not silently discarded. Dedupe, then strip
        // against the RESTORED table — if some other tag was deleted meanwhile,
        // replaying it verbatim would reintroduce a dangling id (I2).
        const replayed = [...new Set([...ref.tagIds, ...rule.tagIds])];
        rule.tagIds = stripDanglingTagIds(replayed, draft.tags);
      }
    });
    return { success: true };
  }

  /**
   * A-e/A10/S6: resolve IMPORTED names to local ids, creating what is missing.
   *
   * Runs on the in-memory `final` state BEFORE it is written, so the whole
   * import (records + tags + references) lands in the same version-bound write
   * the service already performs — no second write window.
   *
   * The two appearance rules are the whole point, and they differ ON PURPOSE:
   *   - a name the file's VOCABULARY defines carries the FILE's colours (A4) —
   *     that is the only way appearance travels at all;
   *   - a name the file references but never defines ("dangling") has no colours
   *     anywhere, so it gets the DEFAULT appearance (A10), and the count is
   *     returned so the caller can DISCLOSE it (S6).
   * A name the machine already knows keeps its ID (no duplicate is made — A-e's reuse
   * rule, which is about IDENTITY), and takes the FILE's colours when the file's
   * vocabulary defines it: the appearance is what a shared vocabulary transfers, so a
   * name the file merely REFERENCES leaves the existing tag untouched.
   *
   * Returns the number of default-appearance creations.
   */
  resolveImportedTags(
    final: SyncState,
    vocabulary: Array<{ name: string; backgroundColor: string; textColor: string }>,
    namesByRuleId: ReadonlyMap<string, string[]>,
  ): number {
    let createdWithDefaultAppearance = 0;

    /**
     * Every name the import must leave defined, and what defines its appearance.
     *
     * TWO sources, and the FIRST is the one that was missing:
     *
     *   1. the file's VOCABULARY (`pkg.tags`) — carried as a whole (D0), so a tag
     *      the file ships is part of the import whether or not a rule happens to
     *      reference it. The vocabulary is the thing the dimension exists to
     *      transfer; a tag nobody has tagged anything with is the common case, not
     *      an edge one.
     *   2. names a CARRIED rule references. These may be "dangling" — the file
     *      named a tag it never defined — and get the default appearance (A10/S6).
     *
     * Reading only (2) meant an export of a vocabulary created NOTHING on the
     * target: the tags table stayed empty while the import reported success, which
     * is exactly the silent no-op this pass exists to prevent. Collected into ONE
     * map first, so a name both sides mention is created once, with the file's
     * colours (A4).
     *
     * `null` = referenced but never defined ⇒ default appearance.
     */
    const wanted = new Map<string, { name: string; backgroundColor: string; textColor: string } | null>();
    for (const v of vocabulary) wanted.set(normalizeTagName(v.name), v);
    for (const names of namesByRuleId.values()) {
      // Defensive: a hand-written fixture (or an older package literal) may omit
      // `tags`. The tolerant reader governs what a FILE may contain, but the
      // resolution pass is also reached from tests, so it must not assume the
      // field rather than crash on it.
      for (const name of Array.isArray(names) ? names : []) {
        const key = normalizeTagName(name);
        if (!wanted.has(key)) wanted.set(key, null);
      }
    }

    for (const [key, defined] of wanted) {
      const existingId = findDuplicateTagId(final.tags, key);
      if (existingId !== null) {
        // A-e (as revised): the tag is REUSED by name — no duplicate is created —
        // and the FILE's appearance is applied to it.
        //
        // `defined` is what decides: only the file's VOCABULARY carries colours. A
        // name the file merely REFERENCES has no appearance anywhere, so it must
        // leave the existing tag looking as it did (recolouring it to the default
        // grey would be inventing a change the file never asked for).
        if (defined) {
          final.tags = final.tags.map((t) => (t.id === existingId
            ? { ...t, backgroundColor: defined.backgroundColor, textColor: defined.textColor }
            : t));
        }
        continue;
      }
      if (defined) {
        // The file's vocabulary defines it, so its colours travel with it (A4).
        final.tags = [...final.tags, {
          id: newTagId(),
          name: defined.name,
          backgroundColor: defined.backgroundColor,
          textColor: defined.textColor,
        }];
      } else {
        // A10/S6: nothing defines this name's appearance.
        final.tags = [...final.tags, {
          id: newTagId(),
          name: key,
          backgroundColor: DEFAULT_TAG_BACKGROUND,
          textColor: DEFAULT_TAG_TEXT_COLOR,
        }];
        createdWithDefaultAppearance += 1;
      }
    }

    // 2. Rewrite each CARRIED rule's references to local ids (A-e). Only rules
    //    the file carried are touched, so an untouched rule keeps its own tags.
    for (const [ruleId, names] of namesByRuleId) {
      const rule = final.rules.find((r) => r.id === ruleId);
      if (!rule) continue;
      const resolved: string[] = [];
      for (const name of Array.isArray(names) ? names : []) {
        const id = findDuplicateTagId(final.tags, name);
        if (id !== null && !resolved.includes(id)) resolved.push(id);
      }
      rule.tagIds = resolved;
    }

    return createdWithDefaultAppearance;
  }

  /**
   * Set a rule's tags (D3/A-h).
   *
   * Two things this method must NOT do, both structural:
   *   - it must not go through `RuleService.updateRule`, because that path ends
   *     in a rule re-application and would make tagging a behaviour change (R5);
   *   - it must not persist an id with no live definition, so the list is
   *     stripped here — the LAST point before storage, since `RuleService` does
   *     not know the tag table exists (A1).
   */
  async setRuleTags(ruleId: string, tagIds: string[]): Promise<SetRuleTagsResult> {
    const sync = await this.repo.getSyncState();
    if (!sync.rules.some((r) => r.id === ruleId)) {
      return { success: false, errorCode: 'RULE_NOT_FOUND', message: 'Rule not found.' };
    }

    const unique = [...new Set(tagIds)];
    if (!isRuleTagIdsValid(unique)) {
      return {
        success: false,
        errorCode: 'RULE_TAG_LIMIT_EXCEEDED',
        message: `A rule can carry at most ${String(RULE_TAG_MAX)} tags.`,
      };
    }

    let finalIds: string[] = [];
    await this.repo.mutateSyncTags((draft: SyncState) => {
      const rule = draft.rules.find((r) => r.id === ruleId);
      if (!rule) return;
      finalIds = stripDanglingTagIds(unique, draft.tags);
      rule.tagIds = finalIds;
    });
    return { success: true, tagIds: finalIds };
  }
}