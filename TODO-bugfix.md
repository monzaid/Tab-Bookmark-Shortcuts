# TODO — Bug Fix: Rule Delivery + Regex Matching + Persistence

## Deliver
- [x] New robust delivery (executeScript primary + sendMessage fallback)
- [x] Regex consistency (stored value is valid regex everywhere + shared matchesUrl)
- [x] Persistence across refresh
- [x] Add scripting permission to all manifests
- [x] Verify: tests, typecheck, builds, lint

## RED (failing tests)
- [x] integration test: rule apply uses scripting.executeScript for ALL matching tabs
- [x] integration test: tabs.onUpdated re-applies via executeScript
- [x] integration test: regex (converted from wildcard) matches multiple tabs + applies
- [x] integration test: fallback to sendMessage when executeScript throws
- [x] unit test: sidebar display uses shared matchesUrl for regex rule
- [x] Update existing tests that assert sendMessage-only delivery

## GREEN (implementation)
- [x] Add applyFieldsToTab helper (executeScript primary + sendMessage fallback)
- [x] Use it in reapplyToMatchingTabs
- [x] Use it in handleContentNavigation
- [x] Use it in setTabOverride / applyToTab
- [x] Sidebar: use shared matchesUrl; fix slot->global + slot URL regex conversion
- [x] Add scripting to manifests (base/chrome/edge/firefox)

## REFACTOR
- [x] Clean up, remove unused matchUrlSimple
- [x] Lint + typecheck + build + full tests

## Real-browser deliverability gap (sw-tdd-agent pass)
### Root cause
`applyRewriteInPage` (in `src/background/apply-fields.ts`) dropped the favicon
permanently when `document.head` was null at execution time (document_start /
fresh tab). It did `if (!head) return;` with NO retry/deferral. The title always
landed (title does not depend on head), but the favicon silently never appeared
in the tab — even though the sidebar "current page"/"slot" objects showed the
correct rule value. This is exactly the inconsistency reported in manual
acceptance (failures 1 & 2). Mock tests only assert `executeScript` was CALLED,
so they never caught it.

### Fix
`src/background/apply-fields.ts`: wrapped favicon insertion in `applyFavicon()`
and added a short retry loop (setInterval every 50ms, up to 2s) that re-applies
once `document.head` becomes available. Mirrors the content script's existing
`pendingFavicon` deferral but is self-contained for the executeScript path.

### Tests added
`tests/integration/rule-delivery-real-dom.test.ts` (6 tests) — NEW tests that
ACTUALLY run the injected function against a real jsdom DOM (not just assert the
call):
1. Real DOM delivery sets title + swaps favicon.
2. Favicon lands even when `document.head` is null at start (RED before fix).
3. Exact rule delivers to ALL matching tabs (not one).
4. tabs.onUpdated re-delivers after refresh.
5. Regex (wildcard-converted) matches and delivers to all matching tabs.
6. computeFields resolves an offloaded `local-icon:` favicon to a real data URI.

`computeFields` already resolves `local-icon:` refs via `getSyncState()`, so the
favicon VALUE reaching `link.href` is a real data URI — confirmed by test 6.