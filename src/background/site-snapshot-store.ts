/**
 * Site snapshot store (A7 / C6 / Q14).
 *
 * Remembers the ORIGINAL page title / favicon so a `restore` directive can put
 * the site's own value back (Q6 "chain cleared → restore the original").
 *
 * Strictly sealed to `local`:
 * - never part of `sync`, export, import preview or diagnostics;
 * - stores ONLY `{ title, faviconHref }` — never the URL or any page content;
 * - read-only from the UI's perspective (`site` is never an editable tier).
 *
 * Lifecycle:
 * - captured lazily BEFORE the first rewrite (content script reports it);
 * - re-captured on every navigation (a stale snapshot would restore the
 *   PREVIOUS page's title);
 * - dropped when the chain no longer rewrites the tab, and when the tab closes
 *   (tabId reuse must not leak an unrelated page's value).
 */

import type { SiteSnapshotEntry } from '@shared/types';
import type { StorageRepository } from './storage-repository';

export interface CapturedSiteValue {
  title: string | null;
  faviconHref: string | null;
}

export class SiteSnapshotStore {
  constructor(private repo: StorageRepository) {}

  /** Read one tab's captured original value (undefined = not captured). */
  async get(tabId: number): Promise<SiteSnapshotEntry | undefined> {
    const local = await this.repo.getLocalState();
    return (local.siteSnapshot ?? []).find((s) => s.tabId === tabId);
  }

  /**
   * Lazily capture the site's original value the first time a rewrite is about
   * to reach the tab. A second call for the same tab is a no-op: `restore` must
   * target the value that existed BEFORE our first write, not the value our own
   * rewrite produced.
   */
  async capture(tabId: number, value: CapturedSiteValue): Promise<void> {
    const existing = await this.get(tabId);
    if (existing) return;
    await this.write(tabId, value);
  }

  /**
   * Re-capture after a navigation: the page (and therefore its original title /
   * favicon) may have changed, so the old snapshot must not survive.
   */
  async recapture(tabId: number, value: CapturedSiteValue): Promise<void> {
    await this.write(tabId, value);
  }

  /** Drop the snapshot once the chain no longer rewrites the tab. */
  async dropIfNoRewrite(tabId: number, stillRewrites: boolean): Promise<void> {
    if (stillRewrites) return;
    await this.drop(tabId);
  }

  /** Drop the snapshot when the tab closes (guards against tabId reuse). */
  async drop(tabId: number): Promise<void> {
    await this.repo.removeSiteSnapshot(tabId);
  }

  private async write(tabId: number, value: CapturedSiteValue): Promise<void> {
    await this.repo.setSiteSnapshot({
      tabId,
      title: value.title,
      faviconHref: value.faviconHref,
      capturedAt: new Date().toISOString(),
    });
  }
}