# Learnings — rule-tags-iteration-plan

## Repo facts (verified pre-execution, not assumed)
- Windows / PowerShell 5.1 shell. `rg` NOT guaranteed available ⇒ use `Select-String` / `Get-ChildItem | Select-String`. `Select-String` has NO `-Recurse`; use `Get-ChildItem -Recurse -File | Select-String`.
- Typecheck baseline = **0 errors GREEN** (before T1).
- `package.json` dependencies = `react` + `react-dom` (exactly 2) — C0 guardrail baseline.
- `SYNC_KEY` in `src/background/storage-repository.ts` = **13** occurrences (lines 37,217,226,230,267,269,270,410,430,453,800,1249,1250) — C0 baseline.
- `QUOTA_BYTES_PER_ITEM` in `src/` = 0 occurrences.
- Test files: **152** (*.test.ts|*.test.tsx). Three vitest projects: unit / integration / ui-smoke (all jsdom).
- `tests/helpers/` has only `strip-comments.ts`.
- Evidence dir `_context-output/evidence/` did NOT exist ⇒ created.
- Notepad dir: `_context-output/notepads/rule-tags-iteration-plan/` (repo has no `_context/`; P8 uses `_context-output/`).

## Plan reference spot-checks (all confirmed present)
- types.ts:223 "four dimensions are FIXED (D5)" ⇒ T1 edits to 5.
- types.ts DimensionPresence(422) 4 required keys; PageRule(113) no tagIds; SyncState(529) no tags.
- export-package.ts ROOT/SLOT/SETTINGS/RULE_KEYS `as const satisfies Record<keyof T,true>` + PACKAGE_FIELD_ALLOWLIST derived via Object.keys (139-168).
- worker-orchestrator.ts KNOWN_ACTIONS(53-104) `as const satisfies readonly AnyRequest['action'][]` + `_Unknown`/`_NotAnAction` guard(111-114).
- rule-service.ts:147-156 `createRule` PageRule literal — T1 mechanical `tagIds: []` site. rg "tag"/"tagIds" there = 0 hits.
- App.tsx: SettingsSection(53), NAV_ITEMS(214), dimensionCount(2709), DIMENSION_LABELS(2998), DIMENSION_META(3011), isRecordDimension(4090), filteredRules+D13 prune(1024-1046).
- import-diff.ts presence(141) 4 keys, applyIntent(680).

## Shell/permission notes
- PowerShell emits CLIXML noise on stderr for `Select-String`/module loading — harmless, ignore.
- `npm run typecheck 2>&1 | grep "error TS" | grep -c "src/"` in plan is bash-style; PowerShell equivalent:
  `npm run typecheck 2>&1 | Select-String "error TS" | Select-String "src/" | Measure-Object -Line`