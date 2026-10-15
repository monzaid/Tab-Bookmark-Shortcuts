# F3 — Real Manual QA (rule-tags-iteration-plan)

Verdict: **APPROVE**
`Scenarios [21/21 task files pass] | Integration [3/3 chains] | Edge Cases [8 tested]`

All QA is agent-executed (ZERO human intervention). Evidence: this directory
(`_context-output/evidence/final-qa/`) plus the per-task files in
`_context-output/evidence/task-*.txt`.

## Per-scenario execution (re-run clean, fresh process)
Every task's named test file was re-run from a clean state after ALL tasks landed
(no cross-task contamination from build-up order):

| Task | Test file | Result |
|---|---|---|
| T1 | tests/unit/shared/tag-types-contract.test.ts | 10/10 |
| T3 | tests/unit/helpers/tag-fixtures.test.ts | 7/7 |
| T4 | tests/unit/shared/tags.test.ts | 32/32 |
| T5 | tests/unit/shared/tag-expression.test.ts | 21/21 |
| T6 | tests/integration/storage-repository-tags.test.ts | 6/6 |
| T7 | tests/unit/shared/tag-messages-contract.test.ts | 8/8 |
| T8 | tests/integration/import-fifth-dimension.test.ts | 6/6 |
| T9 | tests/integration/tag-service.test.ts + tag-service-boundary.test.ts | 10/10 + 6/6 |
| T10 | tests/integration/tag-import-decisions.test.ts | 5/5 |
| T11 | tests/unit/shared/export-self-consistency.test.ts | 8/8 |
| T12 | tests/unit/ui/tag-chip-input.test.tsx | 11/11 |
| T13 | rule-form-fields-tags.test.tsx + tag-tagging-entry.test.tsx | 6/6 + 2/2 |
| T14 | tests/unit/ui/settings-fifth-dimension.test.tsx | 6/6 |
| T15 | tests/ui-smoke/rules-tag-filter.test.tsx | 7/7 |
| T16 | tests/ui-smoke/tags-section.test.tsx | 7/7 |
| T17 | tests/ui-smoke/tag-import-export-panels.test.tsx | 5/5 |
| T18 | settings-class-css.test.ts + tag-structure-guard.test.ts | 8/8 + 15/15 |
| T19 | full three layers + field-chain-parity | 1507 pass |
| T20 | tests/integration/tag-roundtrip.test.ts | 6/6 |
| T21 | §7 + guardrail searches (read-only) | 5/5 + 6/6 |

## Integration (cross-task chains)
1. **chip expression → prune → batch**: `rules-tag-filter` drives the expression,
   `settings-fifth-dimension` asserts the prune's new dependency, and the batch bar
   is unchanged (rules-table 11/11). Verified.
2. **inline create → cancel → Tags page → delete → Undo**:
   `tag-tagging-entry` (create + cancel leaves the tag), `tags-section` (orphan
   visible, delete → Confirm(impact 2) → UndoBar(serial) → Undo restores entity +
   refs). Verified.
3. **export excludes a tag → dialog → import → default-appearance disclosure**:
   `tag-import-export-panels` (dialog renders the difference, two equal options;
   import card + A8 re-decision + S6 disclosure), `tag-roundtrip` (the end-to-end
   matrix including the same-name-different-colour cell). Verified.

## Edge cases (all asserted, not merely run)
- empty expression (C6, no naming)                                   PASS
- half-written expression (C6)                                       PASS
- deleted reference (C7, named via insert-time name)                 PASS
- orphan tag visible with count 0 (C3)                              PASS
- same name + different colour → ONE tag, machine colour survives    PASS
- second import of the same package → no duplicates (idempotence)    PASS
- **5000-deep nesting** → no `RangeError` (real construction, two forms: 5000 NOTs
  and 5000 parens)                                                   PASS
- 9 tags rejected / 33-char name rejected / 200 tags created without error PASS

## Layer discipline (respected)
- Service semantics (symmetry, idempotence, overwrite paths, cascade atomicity,
  S3) are asserted ONLY in the `integration` project — never in jsdom.
- jsdom (`ui-smoke` / `unit` UI) asserts STRUCTURE + copy + `aria` only — no canvas
  pixels, no layout geometry. Wrapping is asserted as a CSS PROPERTY (`flex-wrap`),
  and the collapsed Tags column as ABSENCE from the DOM.
- No scenario was left as "user manually tests".

## Build/type sanity re-checked at F3 time
typecheck 0; chrome/edge/firefox builds succeed.