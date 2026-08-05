/**
 * Tab-reuse logic for opening extension pages (Bug 1).
 *
 * Pure logic, no browser globals — callers supply the tab operations.
 * Matching is hash-insensitive: `settings/index.html#diagnostics` reuses an
 * already-open `settings/index.html` tab. When the target URL carries a hash
 * that differs from the open tab's current URL, a hash-only navigation is
 * performed (no full reload).
 */

/** Minimal tab operations needed to open-or-reuse a page. */
export interface PageOpenApi {
  queryAllTabs(): Promise<Array<{ id: number; url: string }>>;
  activateTab(tabId: number): Promise<void>;
  navigateTab(tabId: number, url: string): Promise<void>;
  createTab(url: string): Promise<void>;
}

/** Strip the hash/fragment from a URL (everything from the first '#'). */
export function stripHash(url: string): string {
  const idx = url.indexOf('#');
  return idx >= 0 ? url.slice(0, idx) : url;
}

/** Whether a URL carries a hash/fragment. */
export function hasHash(url: string): boolean {
  return url.includes('#');
}

/**
 * Open `url`, reusing an already-open tab when one shows the same base page
 * (hash-insensitive comparison). Only creates a new tab when nothing matches.
 */
export async function openOrReusePage(api: PageOpenApi, url: string): Promise<void> {
  const targetBase = stripHash(url);
  const tabs = await api.queryAllTabs();
  const existing = tabs.find((t) => t.url && stripHash(t.url) === targetBase);

  if (!existing) {
    await api.createTab(url);
    return;
  }

  await api.activateTab(existing.id);

  // Hash-only navigation when the target has a hash different from the tab's
  // current URL. Hash-only updates do not trigger a full page reload.
  if (hasHash(url) && existing.url !== url) {
    await api.navigateTab(existing.id, url);
  }
}
