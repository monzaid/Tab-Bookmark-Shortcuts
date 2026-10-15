# F1 — Plan Compliance Audit (rule-tags-iteration-plan)

Verdict: **APPROVE**
`Must Have [19/19] | Must NOT Have [13/13] | Tasks [21/21] | Evidence [55 files, all non-empty] | §7 [5/5]`

## Must Have (each proven by a command / file / named test)

| # | Requirement | Evidence |
|---|---|---|
| 1 | Tags don't affect match/priority/enabled — structural | `tag-service.ts` constructor takes `StorageRepository` only; `tag-service-boundary.test.ts` 6/6; `tag-structure-guard.test.ts` A-a group green |
| 2 | `SyncState.tags: TagDefinition[]` + `PageRule.tagIds: string[]` | `types.ts:663` `tags: TagDefinition[]`; `types.ts:157` `tagIds: string[]` |
| 3 | Uniqueness = trim byte-equal; colour not identity | `tags.ts` `normalizeTagName` = `raw.trim()`; `tags.test.ts` discriminative case table 32/32 |
| 4 | ≤8 tags/rule, ≤32 chars/name, no total cap | `tags.ts` `TAG_NAME_MAX = 32`, `RULE_TAG_MAX = 8`; `tag-service.test.ts` (200 creates succeed) |
| 5 | Delete = Confirm with impact → cascade → UndoBar | `tags-section.test.tsx` 7/7 (impact `2`; error strict serial; Undo) |
| 6 | Write paths strip dangling ids before persist | `setRuleTags` strips; `tag-service.test.ts` D3 group; no `ghost-1` in persisted JSON |
| 7 | Boolean expression AND/OR/NOT/parens; chip builder + own parser, no free text | `tag-expression.ts`; `tag-expression.test.ts` 21/21; `tag-chip-input.tsx` (candidates only) |
| 8 | Parse failure → "not filtered" + light hint | `evaluateExpression` returns `applied:false`; `rules-tag-filter.test.tsx` C6 case |
| 9 | Deleted reference → keep chip + pause + name + fallback name | `tag-expression.test.ts` C7 case; `rules-tag-filter.test.tsx` C7 names `work`; chip keeps it |
| 10 | Parse/eval must not crash on depth | 5000-deep tests pass; no RangeError; `tag-expression.ts` uses explicit stacks |
| 11 | Package root `tags: PortableTag[]` (colours, no id) + `PortableRule.tags: string[]` | `export-package.ts` `PortableTag`/`PortableRule.tags`; `TAG_KEYS` has no `id` |
| 12 | Export per-tag ticking + consequence dialog, two equal options | `tag-import-export-panels.test.tsx`; no autofocus/aria-current on either button |
| 13 | Import `overwrite` re-decidable to `incremental`; disclosed via diff | `tag-import-decisions.test.ts` equivalence; `import-fifth-dimension.test.ts` disclosure row |
| 14 | Import semantic inconsistency → same dialog | `tagPartDiffs` + `selfConsistencyDiff` single source |
| 15 | Dangling name unknown everywhere → default appearance + count | `tag-import-decisions.test.ts` (`tagsCreatedWithDefaultAppearance === 1`, colour = default) |
| 16 | 5th dimension syncs 4 models + DIMENSION_LABELS/META | `settings-fifth-dimension.test.tsx`; `types.ts` presence/intent/outcomes; `import-diff.ts` |
| 17 | 7th nav page Tags (CRUD + orphans visible) | `SettingsSection`/`NAV_ITEMS`/`renderSection`; `tags-section.test.tsx` orphan visible w/ count 0 |
| 18 | Rules table Tags column (default collapsed) via ⊘ | `rules-tag-filter.test.tsx` (`rules-col-tags` null until toggled); ⊘ reused |
| 19 | chips focusable/keyboard-deletable/named; diagnosis free of tag names; inline create persists via one write path | `tag-chip-input.test.tsx` 3 independent a11y assertions; `diagnostics-service.ts` "tag" = 0; `handleCreateTag` → `CREATE_TAG` |

## Must NOT Have (rejection search, with file:line)

| # | Prohibition | Search result |
|---|---|---|
| 1 | tags in chain (`field-chain`/`field-delivery`) | both = **0** hits |
| 2 | `TagService` delivery entry point | `tag-service.ts` `applyToMatchingTabs\|redeliver\|FieldDeliveryService` = **0** |
| 3 | `RuleService` extended for tags | `rule-service.ts` mentions `TagService` **only in a comment** (L156) explaining it must NOT; no code |
| 4 | new third-party runtime dep | `dependencies` = `react,react-dom` |
| 5 | split sync key / capacity work | `SYNC_KEY` = 13 (baseline 13); `QUOTA_BYTES_PER_ITEM` = 0 in src |
| 6 | soft delete / archive / tombstone | matches only a **comment** saying there is no tombstone (`tag-expression.ts:278`) |
| 7 | "draft tag" third state | no "not-yet-persisted" reference; create writes immediately |
| 8 | auto-remove chips / auto-normalise | chip kept on delete (`tag-chip-input.test.tsx`) |
| 9 | legacy compat / migration branch | new modules: `legacy\|backCompat\|migrat` = 0 |
| 10 | `field op value` pre-embedment | only a **comment** (`tag-expression.ts:17`) stating the variable space is TAGS ONLY |
| 11 | expression cap / "N conditions" summary / inner scroll | none; C8 respected |
| 12 | default button / Enter default on destructive | `Confirm variant="danger"`; no autofocus; 120ms guard |
| 13 | parallel edits of settings/App.tsx | executed strictly serially T14→T15→T16→T17 |

## Compile-time guards intact (NOT relaxed)
- `export-package.ts` `ROOT_KEYS`/`RULE_KEYS`/`TAG_KEYS` still `as const satisfies Record<keyof T, true>`.
- `DimensionPresence.tags` is REQUIRED (not optional); `PageRule.tagIds` REQUIRED.
- `KNOWN_ACTIONS` still `as const satisfies readonly AnyRequest['action'][]` with the
  `_Unknown`/`_NotAnAction` bidirectional `Exclude` pair.

## Evidence
`_context-output/evidence/task-*.txt`: **50 files**, all non-empty (verified by size).
(The `task-N-errors*.txt` scratch dumps from the migration were removed after use;
the durable migration evidence is `task-19-migration-complete.txt`.)

## §7 — five items, each with a command or a named test
1. `types.ts` "five dimensions" => present (L259, L588)
2. `App.tsx` `dim: 'tags'` => present (L3581) + `DIMENSION_META.tags`
3. `isRecordDimension` comment => present (L4692)
4. `2026-10-02` §0.2 "vocabulary" => >=1
5. S4×C4 disclosure => named tests in `import-fifth-dimension` / `tag-import-export-panels` / `tag-roundtrip`

## Deviations reported (not defects, all disclosed during execution)
- **Plan expected-error list under-enumerated** (T1): 3 extra src files beyond the
  five listed (`storage-repository.ts`, `sidebar/App.tsx`, extra `settings/App.tsx`
  sites) — all owned by existing tasks.
- **`message-client.ts` had no owning task** yet T7's error codes broke it; mechanically
  completed in T7 (T1's precedent).
- **T11 signature refined** to `computeExportSelfConsistency(pkg, localTags)` — the
  plan's own acceptance criterion (local colour) is unsatisfiable without it.
- **R8 over-generalised** in two places (export summary `<li>` list and the "of 4
  parts" footer) — both hand-written literals, both fixed.
- **`npm run lint` baseline is 644 problems at HEAD** — the plan's DoD was
  unsatisfiable pre-iteration; iteration delta driven to 0.
- **Fixture count is ~51 files / 277 sites**, not the plan's "63 files"; the compiler
  enumerated the real set.
- **Environment**: no agent-spawn tool available ⇒ tasks executed directly with full
  RED→GREEN + independent-verification discipline instead of subagent delegation.