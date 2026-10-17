# Issues — undo-stack-and-slot-swap-plan (Wave 4)

## Shell: full `npx vitest run` exceeds the harness 10s window
- Symptom: the tool marks `npx vitest run` as a "watch command" and returns after ~10s
  without the summary; later output was truncated.
- Workaround used: launch a fully detached process
  `Start-Process cmd.exe /c "npx vitest run --reporter=basic > <log> 2>&1" -WindowStyle Hidden`,
  wait ~90s, then read the log tail. Result captured: 179 files / 1762 tests / 0 failed.
- `Get-Job` does NOT survive across tool calls (each shell is fresh) — do not rely on it.

## Lint: two new errors introduced, then fixed
- `slot-service.ts` default `deliver` field and the test's `setDelivery` callback both
  tripped `@typescript-eslint/require-await` (async arrow with no await). Fixed by returning
  `Promise.resolve(...)` instead of `async`. Post-fix: 0 new lint errors in changed ranges.
- All remaining eslint errors in the touched files are pre-existing (lines outside the
  added ranges: e.g. slot-service.ts:133/390/472/... and worker-orchestrator.test.ts:106/427/852).

## Notepad dir
- Established `_context-output/notepads/undo-stack-and-slot-swap-plan/` (this repo uses
  `_context-output/`, not `_context/`).
