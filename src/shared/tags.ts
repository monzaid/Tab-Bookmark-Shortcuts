/**
 * Tag domain functions — the SINGLE definition of tag identity, limits,
 * dangling-reference stripping and self-consistency (A-f).
 *
 * Pure module: no React, no `chrome`, no `@ui`/`@background` import. `src/shared`
 * is the layer that both the worker and the UI may read, so the `layer-boundary`
 * guard requires this file stay host-free — which is also why the rules live
 * here rather than in `TagService`: the importer, the exporter and the UI all
 * need them, and duplicating them is how two answers to "is this the same tag?"
 * start to disagree.
 *
 * What is deliberately NOT here: creating or persisting a tag. That is
 * `TagService`'s job (A1/A-h); this module only decides.
 */
import type { PageRule, TagDefinition } from './types';
import type { PortableRule, PortableTag } from './export-package';

/** C3: a tag name may be at most 32 characters (measured AFTER trimming). */
export const TAG_NAME_MAX = 32;

/** C3: a rule may carry at most 8 DISTINCT tags. There is NO cap on the table. */
export const RULE_TAG_MAX = 8;

/**
 * How many tags a picker lists before the rest go behind a disclosure.
 *
 * ONE definition for the two pickers that show this table (`TagSelector`'s list and
 * the expression filter's candidate tray). They had a private constant each with
 * the same value and the same copied argument — ten is where a list stops being
 * scannable — which left two numbers to drift apart while both claiming to be "the
 * point where this table becomes a wall".
 *
 * Lives here rather than in a UI module because the judgement is about the TAG
 * TABLE (how many of these a person can scan), not about either surface.
 */
export const TAG_LIST_DISPLAY_LIMIT = 10;

/**
 * C2: the ONE normalisation. Trim the ends; that is ALL.
 *
 * Not lowercased, inner whitespace not collapsed: `Work` and `work` are
 * different tags, and `in  progress` and `in progress` are too. Every place
 * that compares names must go through this so the rule cannot be half-applied.
 */
export function normalizeTagName(raw: string): string {
  return raw.trim();
}

/**
 * The id of the live tag that `name` would collide with, or `null`.
 *
 * `excludeId` lets a RENAME check itself: renaming `work` to `work` must not be
 * reported as a duplicate of the tag being renamed (C2).
 *
 * Colour is intentionally irrelevant: two `work` tags are the same tag whatever
 * their colours (S1/I4).
 */
export function findDuplicateTagId(
  tags: TagDefinition[],
  name: string,
  excludeId?: string,
): string | null {
  const normalized = normalizeTagName(name);
  for (const tag of tags) {
    if (tag.id === excludeId) continue;
    if (normalizeTagName(tag.name) === normalized) return tag.id;
  }
  return null;
}

/** C3: a non-empty name of at most `TAG_NAME_MAX` characters, after trimming. */
export function isTagNameValid(name: string): boolean {
  const normalized = normalizeTagName(name);
  return normalized.length > 0 && normalized.length <= TAG_NAME_MAX;
}

/**
 * C1: the colour formats a tag appearance may be stored in — `#RGB` or `#RRGGBB`.
 *
 * Validated rather than trusted because the appearance reaches the RENDERER as a
 * CSS value: `backgroundColor` is applied as an inline style, so an unchecked
 * string is an injection point into the page's CSS, and a malformed one is a tag
 * that renders invisibly with no error anywhere.
 *
 * BOTH standard hex forms are accepted, and neither is rewritten at this layer.
 * The stored corpus already contains the shorthand (`#fff` is what the existing
 * fixtures and the import defaults carry), so rejecting it would leave a tag the
 * user cannot edit without also changing a colour they were happy with. What
 * this check is FOR is "is this a well-formed, safe CSS colour", not "is it in
 * one house spelling" — and canonicalising here would rewrite the appearance of
 * every edited tag that happened to use the short form, which is a change to the
 * data made by an edit the user did not ask for.
 *
 * Relative luminance is deliberately NOT constrained. A low-contrast pair is a
 * legibility problem the user can see and fix in the same form, whereas a floor
 * here would silently rewrite a choice they made (and `#FFFFFF` on `#FFFFFF` is
 * a valid pair to hold mid-edit before they pick the other half).
 */
export function isTagColorValid(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/**
 * C3: does this rule's tag list fit the per-rule cap?
 *
 * Measured on DISTINCT ids: a list holding the same id nine times is one tag,
 * not nine. (Idempotence also means a double-add cannot smuggle a rule over.)
 */
export function isRuleTagIdsValid(tagIds: string[]): boolean {
  return new Set(tagIds).size <= RULE_TAG_MAX;
}

/**
 * D3/I2: drop ids with no live definition, KEEPING the original order.
 *
 * Order preservation is not cosmetic: if this shuffled, every write would
 * reorder `tagIds` and produce a spurious "changed" signal on a no-op save.
 */
export function stripDanglingTagIds(tagIds: string[], tags: TagDefinition[]): string[] {
  const live = new Set(tags.map((t) => t.id));
  return tagIds.filter((id) => live.has(id));
}

/** Ids -> live names, in `tagIds` order (export inlines names, A3). */
export function resolveRuleTagNames(tagIds: string[], tags: TagDefinition[]): string[] {
  const nameById = new Map(tags.map((t) => [t.id, t.name]));
  return tagIds
    .map((id) => nameById.get(id))
    .filter((name): name is string => name !== undefined);
}

/** Every name any rule references — the input side of the difference (S3). */
export function collectRuleTagNames(rules: PortableRule[]): string[] {
  // `?? []`: a hand-written fixture may omit `tags`; the function must degrade to
  // "this rule names no tags", not throw (the same defensive stance the other
  // readers take for a field the type declares as required).
  return [...new Set(rules.flatMap((rule) => (Array.isArray(rule.tags) ? rule.tags : [])))];
}

/**
 * A3/A5/A-f: names the rules reference that the vocabulary does NOT define.
 *
 * Sorted and de-duplicated so the result is a stable value: the export dialog's
 * text and BOTH of its options are rendered from this one array, which is what
 * keeps the wording from drifting away from the decision (D-e). A second
 * derivation anywhere would be the bug this function exists to prevent.
 */
export function selfConsistencyDiff(rules: PortableRule[], vocabulary: PortableTag[]): string[] {
  const known = new Set(vocabulary.map((v) => v.name));
  const missing = collectRuleTagNames(rules).filter((name) => !known.has(name));
  return missing.sort();
}

/**
 * A-e: names -> LOCAL ids, reusing an existing tag when the name matches.
 *
 * Returns `{ resolved, missing }` rather than a plain array because the CALLER
 * must decide what a miss means: the importer creates it with a default
 * appearance and reports the count (A10/S6). Silently creating here would hide
 * that decision from the only layer that can disclose it.
 *
 * Matching is C2 trim-equal and case-sensitive; the local tag (and therefore
 * its colour) wins on a hit.
 */
export function resolveTagIdsByName(
  names: string[],
  tags: TagDefinition[],
): { resolved: string[]; missing: string[] } {
  const normalized = tags.map((t) => ({ id: t.id, key: normalizeTagName(t.name) }));
  const resolved: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const key = normalizeTagName(name);
    const hit = normalized.find((t) => t.key === key);
    if (hit) resolved.push(hit.id);
    else missing.push(name);
  }
  return { resolved, missing };
}

/** C3: tags no rule references, in table order (the Tags page shows these). */
export function findOrphanTagIds(tags: TagDefinition[], rules: PageRule[]): string[] {
  const referenced = new Set(rules.flatMap((r) => r.tagIds));
  return tags.filter((t) => !referenced.has(t.id)).map((t) => t.id);
}

/** C4: how many RULES reference this tag — the Confirm dialog's impact number. */
export function countTagReferences(tagId: string, rules: PageRule[]): number {
  return rules.filter((r) => r.tagIds.includes(tagId)).length;
}