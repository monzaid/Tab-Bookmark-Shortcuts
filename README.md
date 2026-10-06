# Tab Bookmark Shortcuts

A Manifest V3 WebExtension for **Chrome**, **Edge**, and **Firefox** that lets you save, switch, and organize tabs across windows with 10 configurable keyboard shortcuts — plus per-page title/favicon rewriting with rules and slot-bound overrides.

![manifest](https://img.shields.io/badge/Manifest-V3-blue)
![Browsers](https://img.shields.io/badge/Chrome%2FEdge%2FFirefox-supported-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

- **10 bookmark slots** — save the current tab to a slot and switch back to it with a single shortcut.
- **21 keyboard commands** (`save-slot-N`, `switch-slot-N`, and a global `next match`).
- **Cross-window switching** — slot tabs are found and activated across all your windows.
- **Per-page rewriting** — rewrite a tab's **title** and **favicon** via:
  - **Page rules** (exact URL or regex) applied to all matching tabs.
  - **Current-page overrides** and **slot-bound overrides** (highest priority, applied only to the bound tab).
  - Deterministic priority chain: **current page > slot (bound tab only) > rule > original**.
- **Recovery sessions** — when a saved tab is gone, a recovery window helps you reopen or re-save it (5-minute TTL).
- **Sidebar (Side Panel)** — the main UI: slots list, current-page editing, rule creation, and quick actions.
- **Settings page** — manage slots, page rules, global strategy, a data dashboard, import/export, and diagnostics.
- **Data Dashboard** — view and edit/reset every title & icon you've set via the current page and slot objects.
- **No telemetry, no cloud, no cross-browser operations** — everything runs locally.

---

## 📦 Installation

### Chrome / Edge
1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the built `dist/chrome/` (or `dist/edge/`) directory.
4. Alternatively, drag `dist/packages/*.zip` into the extensions page.

### Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist/firefox/manifest.json`.

> The packages are **unsigned**; they require developer mode / temporary add-on loading. They are not submitted to the Chrome Web Store, Edge Add-ons, or AMO.

---

## 🚀 Development

### Prerequisites
- **Node.js >= 20** (LTS)
- **npm >= 10**

### Setup & run

```bash
npm ci
npm run dev          # Vite dev server
```

### Quality commands

```bash
npm run lint              # ESLint (0-warnings policy)
npm run typecheck         # TypeScript strict check
npm run test:unit         # Vitest unit tests
npm run test:integration  # Vitest integration tests
npm run test:ui-smoke     # Controlled UI smoke tests
npm run coverage          # Coverage report
```

---

## 🏗️ Build

```bash
npm run build:chrome      # Chrome MV3 package
npm run build:edge        # Edge MV3 package
npm run build:firefox     # Firefox MV3 package
```

**Output:**
- `dist/<browser>/` — unpacked extension (loadable candidate)
- `dist/packages/*.zip` — packaged archives

Each build runs TypeScript type checking, a Vite multi-entry build, manifest deep-merge + validation, and packaging.

---

## 📁 Project Structure

```
src/
  shared/       — Domain models, error codes, message contracts, pure functions
  adapters/     — Browser abstraction layer (chrome/firefox differences isolated)
  background/   — MV3 Service Worker (orchestrator, slots, rules, storage, recovery)
  content/      — document_start content script (title/favicon rewrite + SPA nav)
  ui/
    sidebar/              — Side Panel (main entry)
    settings/             — Settings page (+ Data Dashboard)
    recovery/             — Recovery window
manifests/        — Base + browser-specific manifest overlays
scripts/          — Build / merge / validate / package scripts
tests/
  unit/           — Unit tests
  integration/    — Integration tests
  ui-smoke/       — UI smoke tests
  manual/         — Three-browser acceptance matrix
```

---

## 🧠 Architecture

- **Browser differences are confined** to `src/adapters/`, `manifests/`, and the build scripts.
- **Business logic and UI never reference `chrome`/`browser` globals directly** — everything goes through the adapter layer.
- **Storage split:**
  - `storage.sync` — slot definitions, URL/regex rules, global strategy, config version.
  - `storage.local` — tabId bindings, navigation cursors, recovery sessions, temporary overrides, icon cache, diagnostics.
- **Page rewrite priority chain** (strict): `current page > slot (bound tab only) > rule > original`.
- **Field-level overrides** — title and favicon are resolved independently, so clearing one never clears the other.
- **Robust field delivery** — rewrites are applied via `scripting.executeScript` (works on already-open tabs), with a content-script `sendMessage` fallback.

---

## 🔐 Permissions & Privacy

| Permission | Purpose |
|------------|---------|
| `tabs` | Query, activate, and track tabs across windows |
| `windows` | Focus windows for cross-window switching |
| `storage` | Persist sync config and local state |
| `notifications` | Cross-window switch and recovery alerts |
| `commands` | 21 keyboard shortcut commands |
| `scripting` | Apply title/favicon rewrites to any tab |
| `<all_urls>` (host) | Content script injection for page rewrite |

**Privacy guarantees:**
- No telemetry, no data collection, no external requests.
- No cross-browser operations — each browser instance is independent.
- Content script only writes title/favicon; it never reads page content.
- Protected pages (`chrome://`, `edge://`, `about:`) can be switched to but never rewritten.
- Diagnostics are sanitized (no URLs, titles, or rule content).

---

## 👥 Contributing

1. Fork the repository.
2. Create a feature branch.
3. Run the quality gates (`npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`) and keep them green.
4. Open a pull request.

---

## 📄 License

MIT