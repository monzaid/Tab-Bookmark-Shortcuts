/**
 * T5 — SiteSnapshotStore (A7/C6/Q14): strictly-sealed local store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { SiteSnapshotStore } from '@background/site-snapshot-store';

describe('T5: SiteSnapshotStore', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let store: SiteSnapshotStore;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    store = new SiteSnapshotStore(repo);
  });

  it('captures a tab value and reads it back', async () => {
    await store.capture(7, { title: 'A', faviconHref: 'https://a/f.ico' });
    const entry = await store.get(7);
    expect(entry?.title).toBe('A');
    expect(entry?.faviconHref).toBe('https://a/f.ico');
  });

  it('does not overwrite an existing capture (lazy-once)', async () => {
    await store.capture(7, { title: 'Original', faviconHref: null });
    await store.capture(7, { title: 'Our Rewrite', faviconHref: null });
    expect((await store.get(7))?.title).toBe('Original');
  });

  it('re-captures on navigation (recapture overwrites)', async () => {
    await store.capture(7, { title: 'A', faviconHref: 'https://a/f.ico' });
    await store.recapture(7, { title: 'B', faviconHref: null });
    const entry = await store.get(7);
    expect(entry?.title).toBe('B');
    expect(entry?.faviconHref).toBeNull();
  });

  it('drops the snapshot when the chain no longer rewrites', async () => {
    await store.capture(7, { title: 'A', faviconHref: null });
    await store.dropIfNoRewrite(7, false);
    expect(await store.get(7)).toBeUndefined();
  });

  it('keeps the snapshot when the chain still rewrites', async () => {
    await store.capture(7, { title: 'A', faviconHref: null });
    await store.dropIfNoRewrite(7, true);
    expect((await store.get(7))?.title).toBe('A');
  });

  it('drops the snapshot when the tab closes (guards tabId reuse)', async () => {
    await store.capture(7, { title: 'A', faviconHref: null });
    await store.drop(7);
    expect(await store.get(7)).toBeUndefined();
  });

  it('is strictly sealed: site snapshot never enters the export payload', async () => {
    await store.capture(7, { title: 'Secret Page Title', faviconHref: 'https://a/f.ico' });

    const sync = await repo.getSyncState();
    expect(JSON.stringify(sync)).not.toContain('siteSnapshot');
    expect(JSON.stringify(sync)).not.toContain('Secret Page Title');
  });

  it('stores only { title, faviconHref } — never the URL or page content', async () => {
    await store.capture(7, { title: 'A', faviconHref: null });
    const local = await repo.getLocalState();
    const entry = (local.siteSnapshot ?? []).find((s) => s.tabId === 7)!;
    expect(Object.keys(entry).sort()).toEqual(['capturedAt', 'faviconHref', 'tabId', 'title']);
  });

  it('drops the snapshot when the tab is removed (cleanupForRemovedTab)', async () => {
    adapter.setTabs([]);
    await store.capture(7, { title: 'A', faviconHref: null });
    await repo.cleanupForRemovedTab(7);
    expect(await store.get(7)).toBeUndefined();
  });
});