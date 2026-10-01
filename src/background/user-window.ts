/**
 * The user's browsing window — the single source of truth for "current window".
 *
 * `chrome.windows.getCurrent()` inside a MV3 service worker returns the MOST
 * RECENTLY FOCUSED window. That is our own recovery popup (created with
 * `type: 'popup', focused: true`) whenever it is focused — NOT the window the
 * user is browsing in. Building the position ring or deciding "is this a
 * cross-window switch" from that value is wrong:
 *
 * - the position ring must be the user's tab strip, not the popup's single tab;
 * - focusing a target must not be mis-read as a cross-window jump.
 *
 * This helper returns the window the user is actually browsing in, skipping any
 * extension-owned `type: 'popup'` window. It is pure orchestration over the
 * adapter — no storage, no caching, no side effects.
 */

import type { BrowserAdapter, NormalizedWindow } from '@adapters/contract';

/**
 * Resolve the user's browsing window.
 *
 * 1. `getCurrent()` is returned unchanged when it is not an extension popup.
 * 2. Otherwise the focused non-popup window wins (getAll order).
 * 3. Else the first non-popup window wins.
 * 4. Else the original `getCurrent()` value is returned (popup-only edge case).
 */
export async function resolveUserWindow(adapter: BrowserAdapter): Promise<NormalizedWindow> {
  const current = await adapter.windows.getCurrent();
  if (current.type !== 'popup') return current;

  const all = await adapter.windows.getAll();
  const userWindows = all.filter((win) => win.type !== 'popup');
  const focusedUserWindow = userWindows.find((win) => win.focused);
  if (focusedUserWindow) return focusedUserWindow;

  // `.at(0)` (not `[0]`) so an empty list is a real `undefined` branch here.
  const firstUserWindow = userWindows.at(0);
  return firstUserWindow ?? current;
}