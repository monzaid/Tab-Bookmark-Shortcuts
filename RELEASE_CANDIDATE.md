# Release Candidate — Tab Bookmark Shortcuts v1.0.0

> **Date**: 2026-07-14
> **Status**: Release Candidate (unsigned, loadable)
> **Scope**: Chrome 120+, Edge 120+, Firefox 121+

---

## Packages

| Browser | File | Manifest | Background |
|---------|------|----------|------------|
| Chrome  | `dist/packages/tab-bookmark-shortcuts-v1.0.0-chrome.zip` | MV3, 21 commands | service_worker |
| Edge    | `dist/packages/tab-bookmark-shortcuts-v1.0.0-edge.zip` | MV3, 21 commands | service_worker |
| Firefox | `dist/packages/tab-bookmark-shortcuts-v1.0.0-firefox.zip` | MV3, 21 commands | scripts (background.scripts) |

## Installation

### Chrome / Edge
1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable "Developer mode"
3. Click "Load unpacked" → select `dist/chrome/` (or `dist/edge/`)
4. Or: drag the ZIP file into the extensions page

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `dist/firefox/manifest.json`

## Permissions & Privacy

### Requested Permissions

| Permission | Purpose |
|-----------|---------|
| `tabs` | Query, activate, and track tabs across windows |
| `windows` | Focus windows for cross-window switching |
| `storage` | Persist sync config (slots, rules) and local state (bindings, cache) |
| `notifications` | Cross-window switch and recovery alerts |
| `commands` | 21 keyboard shortcut commands |
| `<all_urls>` (host) | Content script injection for page title/favicon rewrite |

### Data Boundaries

| Storage | Contains | Syncs? | Exports? |
|---------|----------|--------|----------|
| `storage.sync` | Slot definitions, URL/regex, strategies, rules, configVersion | ✅ Yes | ✅ Yes |
| `storage.local` | tabId bindings, cursors, recovery sessions, overrides, icon cache, diagnostics | ❌ No | ❌ No |

### Privacy Guarantees

- **No telemetry**: Zero data collection, upload, or external requests
- **No cross-browser**: Each browser instance operates independently
- **Diagnostics sanitized**: Only timestamp, error code, browser type, operation type — NO URLs, titles, or rule content
- **Icons local-only**: Data URIs stored in `storage.local`, never synced or exported
- **No page body access**: Content script only writes title/favicon, never reads DOM content
- **Protected pages**: Can switch to `chrome://`/`edge://`/`about:` but cannot rewrite them

## Known Limitations

1. **Unsigned packages**: Not submitted to Chrome Web Store / Edge Add-ons / AMO. Requires developer mode or temporary add-on loading.
2. **3 manual acceptance items pending**: Shortcut binding, incognito authorization toggle, and clean-profile verification require physical browser interaction.
3. **Icon compression**: Production would use OffscreenCanvas for WebP compression; current implementation stores data URIs directly.
4. **Firefox MV3**: Uses `background.scripts` (not service_worker). Minimum Firefox 121.

## Verification Summary

| Check | Result |
|-------|--------|
| `npm run lint` | ✅ 0 errors |
| `npm run typecheck` | ✅ 0 errors |
| `npm run test:unit` | ✅ 170+ tests passed |
| `npm run test:integration` | ✅ 70+ tests passed |
| Manifest validation (3 browsers) | ✅ All passed |
| Package generation (3 browsers) | ✅ All generated |
| Three-browser acceptance matrix | 32/35 AUTO✅, 3 PENDING |

## Release Checklist

- [x] 21 commands declared in all three manifests
- [x] Service Worker (Chrome/Edge) / background scripts (Firefox)
- [x] Content script at document_start
- [x] All React page entries (sidebar, settings, recovery, conflict-confirm)
- [x] No default_popup (sidebar is main entry)
- [x] sync/local storage separation enforced
- [x] No telemetry, no cloud upload, no cross-browser operations
- [x] Diagnostics sanitized (no URL/title/rule text)
- [x] Protected page boundary enforced
- [x] Incognito exclusion when unauthorized
- [x] Three-browser packages generated and validated
- [ ] Store signing/submission (out of scope — requires separate credentials)

## Evidence Index

| Evidence | Location |
|----------|----------|
| Toolchain verification | `evidence/task-1-toolchain.txt` |
| Contract tests | `tests/unit/shared/messages.test.ts` |
| Pure function tests | `tests/unit/shared/url-utils.test.ts` |
| Adapter tests | `tests/unit/adapters/adapter.test.ts` |
| Storage integration | `tests/integration/storage-repository.test.ts` |
| Slot service integration | `tests/integration/slot-service.test.ts` |
| Recovery integration | `tests/integration/recovery-service.test.ts` |
| Rule service tests | `tests/unit/background/rule-service.test.ts` |
| Content script tests | `tests/unit/content/content-script.test.ts` |
| Icon service tests | `tests/unit/background/icon-service.test.ts` |
| Import/export integration | `tests/integration/import-export-service.test.ts` |
| Diagnostics integration | `tests/integration/diagnostics-service.test.ts` |
| Worker orchestrator integration | `tests/integration/worker-orchestrator.test.ts` |
| Message client tests | `tests/unit/ui/message-client.test.ts` |
| Sidebar adapter integration | `tests/integration/sidebar-adapter.test.ts` |
| Full integration suite | `tests/integration/full-suite.test.ts` |
| UI component tests | `tests/unit/ui/*.test.tsx` |
| Acceptance matrix | `tests/manual/three-browser-acceptance.md` |
| Packages | `dist/packages/*.zip` |
