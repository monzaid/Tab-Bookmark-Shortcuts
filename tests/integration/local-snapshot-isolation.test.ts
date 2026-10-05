/**
 * B6 — a `getLocalState()` snapshot must not share mutable state with the cache.
 *
 * `getLocalState()` shallow-copies the cache, so the ARRAYS it returns are the
 * cache's own arrays. Any in-place edit of a snapshot (or of the object handed
 * to `writeLocal`'s updater) would silently corrupt `localCache`. These tests
 * assert the property, not the implementation: mutate the returned arrays and
 * prove the next read is unaffected.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import type { SlotBinding } from '@shared/types';

describe('B6: getLocalState snapshots do not share mutable arrays with the cache', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
  });

  it('mutating the returned tabOverrides does not leak into the cache', async () => {
    const snap = await repo.getLocalState();
    snap.tabOverrides.push({ tabId: 999, createdAt: '2026-01-01T00:00:00.000Z' });

    const again = await repo.getLocalState();
    expect(again.tabOverrides.some((o) => o.tabId === 999)).toBe(false);
  });

  it('mutating the returned bindings does not leak into the cache', async () => {
    const binding: SlotBinding = {
      slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z',
    };
    await repo.setBinding(binding);

    const snap = await repo.getLocalState();
    snap.bindings.push({ ...binding, slotId: 9, tabId: 999 });

    const again = await repo.getLocalState();
    expect(again.bindings.some((b) => b.tabId === 999)).toBe(false);
    expect(again.bindings).toHaveLength(1);
  });
});