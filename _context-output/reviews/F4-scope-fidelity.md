# F4 — Scope Fidelity Check (rule-tags-iteration-plan)

Verdict: **APPROVE**
`Tasks [21/21 compliant] | Decisions [42 checked] | Contamination [CLEAN] | Unaccounted [2 disclosed, both mechanically required]`

## Spec ↔ implementation mapping (per task)

| Task | What-to-do (headline) | Where it landed |
|---|---|---|
| T1 | data model + package contract + 5th dimension | `types.ts` (TagDefinition/PageRule.tagIds/SyncState.tags/DimensionPresence.tags/intent/outcomes + `:259` 5-dim comment), `export-package.ts` (PortableTag/PortableRule.tags/ROOT_KEYS/RULE_KEYS/TAG_KEYS), `rule-service.ts` mechanical `tagIds: []` |
| T2 | §7-4 terminology + isRecordDimension comment | `2026-10-02-...-design.md` §0.2 (+5 rows), `settings/App.tsx` comment at L4692 (comment only) |
| T3 | fixtures + inventory | `tests/helpers/tag-fixtures.ts`, `task-3-fixture-inventory.txt` (51 files / 277 sites) |
| T4 | domain pure functions | `tags.ts` (15 functions) |
| T5 | expression engine | `tag-expression.ts` (iterative parse/eval) |
| T6 | storage primitives | `storage-repository.ts` (`getTags`, `mutateSyncTags`, lenient read) |
| T7 | message family + whitelist | `messages.ts` (4 req + 4 resp + restore), `worker-orchestrator.ts` KNOWN_ACTIONS, `message-client.ts` (mechanical) |
| T8 | 5th dimension through diff/apply | `import-diff.ts` (`presence.tags`, `tagPartDiffs`), `import-export-service.ts` (`dimensions.tags`) |
| T9 | TagService + routing | `tag-service.ts`, `worker-orchestrator.ts` 4 cases + assembly |
| T10 | import decisions | `import-export-service.ts` (`resolveImportedTags`, A8 predicate), `tag-service.ts` (default appearance consts) |
| T11 | export self-consistency | `export-package.ts` (`excludedTagNames` applied, `computeExportSelfConsistency`) |
| T12 | chip input | `tag-chip-input.tsx` + 9 CSS classes |
| T13 | shared form wiring | `rule-form-fields.tsx`, `rule-form-submit.ts`, `tag-selector.tsx` (new), `sidebar/App.tsx` (SET_RULE_TAGS order) |
| T14 | App.tsx 5th-dimension metadata + D-13 | `settings/App.tsx` (DIMENSION_LABELS/META/scope/summary/prune dep/expression input) |
| T15 | RulesSection filter + column | `settings/App.tsx` (C6/C7 notices, ⊘ toggle, Tags column, colSpan sync), CSS |
| T16 | TagsSection 7th page | `settings/App.tsx` (union/NAV_ITEMS/renderSection + TagsSection), `undo-bar.tsx` (`tag-delete` kind), `messages.ts`+`worker-orchestrator.ts` (RESTORE_TAG) |
| T17 | ImportExport panels | `settings/App.tsx` (per-tag list, export dialog, A8 entry, S6 disclosure), CSS |
| T18 | structural guards | `settings-class-css.test.ts` (family widened + case table), `tag-structure-guard.test.ts` (new) |
| T19 | fixture migration | 26 test files + 4 anchor realignments |
| T20 | end-to-end matrix | `tag-roundtrip.test.ts` |
| T21 | §7 + guardrails review | evidence only (read-only) |

## Design decisions — 42 checked (sampled by layer, all landed)
- **Goal/Scope**: pure-organisation tags (no behaviour via module boundary — proven
  by the A-a guard); 3 tagging entries (create/edit/Tags page); boolean expression
  with a chip builder; variables = tags only.
- **Constraint/Boundaries**: C1 global table + rule ids; C2 trim byte-equal, colour
  not identity; C3 8/32/unlimited; C4 cascade + impact; C5 UndoBar reuse; C6 "not
  filtered"; C7 keep chip + pause + name; C8 no depth crash; C9 no back-compat
  branch; D1 iterative; D2 insert-time name; D3 dangling strip; D4 no tag names in
  diagnostics.
- **Architecture**: A1 separate TagService + message family; A-a no delivery entry;
  A2/A-b pure shared modules; A3/A4 package inline names + root PortableTag (no id);
  A5 per-tag tick + two options; A6 rule stores ids; A7/A8/A9/A10 import side; A-g
  one mutator; A-h strip at TagService.
- **Detail/Interaction**: D0 5th dimension (4 models synced); D-a 7th page;
  D-b/D-f inline create persists; D-c default-collapsed column; D-d wrapping; D-e
  consequence copy + equal options; D-g red lines R1–R6.
- **6 retro revisions S1–S6**: colours on the entity; package carries entities;
  export-side self-consistency; dimension mode; 5th dimension; import-side default
  appearance — all present.

## Anti-creep check — nothing beyond the design
- No generic tag platform (no cross-system tag API; tags are a rule-organisation
  field).
- No expression-language expansion (`field op value` appears only in a comment
  stating it is deliberately absent).
- No capacity work / sync-key split (C0 unchanged).
- No soft delete / archive / third state (only a comment noting their absence).
- No batch-assignment entry (deferred by the design).
- No new runtime dependency.

## Must-NOT-Do compliance (per task) — all clean
Delegation aside, every task's "Must NOT do" was honoured. Highlights verified by
search: no tags in chain/delivery; no delivery symbol in TagService; no tag logic in
RuleService; no `as const` widening; no optional `tagIds`; no fixture edits outside
T19; no `@ts-expect-error` used as a migration escape hatch.

## Cross-task contamination
- `src/ui/settings/App.tsx`: touched ONLY by T2 (comment) and T14→T15→T16→T17 — the
  four were executed in that strict order (never concurrently), so the same-file
  serialization constraint held.
- `src/shared/export-package.ts`: touched by T1 and T11 (T11 only ADDS — the T1
  export shapes are unchanged; verified by `export-package-map` still passing).
- `src/shared/messages.ts`: touched by T7 and (necessarily) T16 for `RESTORE_TAG` —
  the plan's table said "T7 only", but the undo's restore path needs a message. This
  is an in-scope completion of the same protocol family (the alternative was a second
  write path, which C5/P3 forbids), disclosed here rather than hidden.
- `src/shared/types.ts`: T1, T7, T8, T10 — T7 then T8 executed in that order (the
  plan's Wave-2 serialization).

## Unaccounted changes — 2, both disclosed mechanical completions
1. `src/ui/shared/message-client.ts` — held the only exhaustive `Record<DomainErrorCode,
   string>` table in src/, which T7's mandated error codes broke. No task's Commit
   Files listed it; without the edit T14's "src/ 0 error" closure was impossible.
   Mechanically completed in T7 (copy only, no tag logic).
2. `src/ui/shared/tag-selector.tsx` (new) — a small multi-select control that T13's
   `RuleFormFields` renders. The plan named the entry point (`RuleFormFields`) but not
   the concrete selector component; it is the minimum implementation of "a tag control
   in the one shared field set".

Neither introduces behaviour or data the design did not call for.