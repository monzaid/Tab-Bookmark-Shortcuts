/**
 * T3 — central tag fixtures.
 *
 * Every default lives HERE and nowhere else. T19 migrates ~63 test files onto
 * the required `tagIds` / `tags` fields; if each file inlined its own literal,
 * a single contract change would mean 63 hand-edits and the drift would be
 * invisible. One factory, one default, one place to fix.
 *
 * Style follows the existing `pkgFile` / `portableSlot` / `storedSlot` helpers
 * in `tests/integration/import-export-service.test.ts`: a `(over = {})` factory
 * whose base is spelled out in full so a reader sees the whole shape at once.
 */
import type { PageRule, SyncState, TagDefinition } from '@shared/types';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';

let counter = 0;

/** Deterministic per-call id so fixtures stay assertion-friendly. */
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

export function makeTagDefinition(over: Partial<TagDefinition> = {}): TagDefinition {
  return {
    id: nextId('tag'),
    name: 'work',
    backgroundColor: '#3366cc',
    textColor: '#ffffff',
    ...over,
  };
}

/**
 * A `PageRule` with `tagIds` DEFAULTED TO `[]` (P1).
 *
 * Empty array, never `undefined`: the field is required, so a fixture that
 * omitted it would not compile — and a fixture that spread `undefined` in
 * would defeat the point of migrating at all.
 */
export function makeTaggedRule(over: Partial<PageRule> = {}): PageRule {
  return {
    id: nextId('rule'),
    urlMatch: { type: 'exact', value: 'https://example.com/' },
    priority: 0,
    enabled: true,
    tagIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeSyncStateWithTags(
  tags: TagDefinition[] = [],
  over: Partial<SyncState> = {},
): SyncState {
  return {
    configVersion: 0,
    matchSettings: DEFAULT_MATCH_SETTINGS,
    switchDirection: 'next',
    autoBindGlobal: true,
    slots: [],
    rules: [],
    tags,
    ...over,
  };
}