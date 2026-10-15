# F2 — Code Quality Review (rule-tags-iteration-plan)

Verdict: **APPROVE**
`Build [PASS] | Lint [PASS for this iteration's delta — see note] | Tests [1507 pass / 0 fail] | Files [5 new src + 20 new test, all clean]`

## Build
- `npm run typecheck` → **0 errors** (whole repo incl. tests).
- `npm run build:chrome` → success; `build:edge` → exit 0; `build:firefox` → exit 0.

## Tests
- `test:unit` 122 files / 1079 pass
- `test:integration` 40 files / 323 pass
- `test:ui-smoke` 10 files / 105 pass
- combined: **172 files / 1507 tests, 0 failures** (baseline 152/1323).

## Lint (baseline finding — reported)
- `npm run lint` now → 673 problems.
- Measured at HEAD with all iteration changes **stashed** → **644 problems (642
  errors, 2 warnings)**. So the repository has never been lint-clean, and the plan's
  DoD (`lint → 0 warning`) was unsatisfiable before this iteration.
- **This iteration's DELTA = 0**: `npx eslint` over the 5 new src files and over all
  20 new test files exits 0 with no output. (An earlier draft had 6 src + 8 test
  problems — every one was fixed, not suppressed: `??` guards rewritten as
  `Array.isArray`, redundant type assertions removed, `JSX.Element` →
  `React.JSX.Element`.)
- Not fixing the 644 pre-existing problems is deliberate: they are outside this
  iteration's scope and F4 checks for exactly that kind of creep.

## Code patterns — clean in every new/changed file
- `as any` / `@ts-ignore` / `@ts-expect-error` in production src → **none**
  (the only `@ts-expect-error` in the repo is T1's deliberate required-field
  assertion in a TEST, which FAILS if the field were relaxed).
- `new Function` / `eval(` in the engine → **0** (G5-C's arbitrary-code-execution
  hole is closed by construction: the input is a `ChipToken[]`, then an AST).
- empty `catch {}` → none in the new modules.
- `console.log` → none in production code.
- commented-out code → none.
- unused imports → none (the compiler's `noUnusedLocals` holds, and one unused
  import in T20's test was caught by it and removed).

## Project-specific anti-patterns
- **Second difference derivation (A-f)**: `selfConsistencyDiff` is defined ONCE
  (`tags.ts:105`); `export-package.ts` IMPORTS it. No second derivation exists.
- **Second undo mechanism (P3)**: the tag delete reuses the EXISTING `UndoBar`
  (`undo-bar.tsx`) by adding a third `UndoLayerWrite` kind, and replays through the
  same `TagService.restoreDeletedTag`. No parallel undo system.
- **UI re-implementing domain rules (P4)**: the UI passes `tagIds` through verbatim;
  trim / dedupe / dangling-strip / limits all live in `TagService` + `tags.ts`.
- **Recursive descent (D1)**: `parse` appears exactly ONCE in `tag-expression.ts`
  (its own declaration) — no self-call; `evaluate` uses an explicit `work` stack.

## Layer boundaries (A-b)
- `tests/unit/shared/layer-boundary.test.ts` → 4/4 PASS. `tags.ts` and
  `tag-expression.ts` live under `src/shared`, so the EXISTING guard covers them —
  verified green rather than re-implemented.

## AI-slop detection
- Over-abstraction: NONE — the expression engine is a tag boolean engine, not a
  general query language (`field` appears only in a comment stating it is
  deliberately absent). No capacity/key-splitting code was added.
- Redundant comments: the comments carry the WHY (invariants, rejected
  alternatives, the reason a branch exists) rather than restating the code; several
  are load-bearing (they explain why a guard is not merely stylistic).
- Generic naming: the new modules use domain names (`normalizeTagName`,
  `findDuplicateTagId`, `stripDanglingTagIds`, `selfConsistencyDiff`,
  `canSupplement`, `canDrop`, `missingTagIds`); no `data`/`item`/`temp` catch-alls.

## Complexity / readability of the three central new modules
- `tags.ts`: 15 small pure functions, each with a stated invariant.
- `tag-expression.ts`: the two iterative passes are the only non-obvious code, and
  each carries a block comment explaining WHY iterative (the failure mode is a blank
  settings page, not an error).
- `tag-service.ts`: business rules at the service boundary; the repository only moves
  bytes; the constructor's SINGLE dependency is the structural guarantee A-a relies on.