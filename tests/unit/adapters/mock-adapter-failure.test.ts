/**
 * T0 — directed + persistent storage failure injection for the mock adapter.
 *
 * The compensation path for cross-area writes (T11/T16) can only be exercised
 * if a test can make ONE area/key fail while every other write still succeeds.
 * The pre-existing `nextError` is a single global one-shot, which cannot express
 * "sync.set fails but local.set succeeds" — hence this dedicated mechanism.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter, type MockAdapter } from '@adapters/mock-adapter';
import { AdapterError } from '@adapters/contract';

describe('T0: directed + persistent storage failure injection', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    adapter.reset();
  });

  describe('failNextStorageSet(area, key?) — one-shot', () => {
    it('rejects the first set for the given area, then succeeds', async () => {
      adapter.failNextStorageSet('sync');

      await expect(adapter.storage.set('sync', { syncState: { configVersion: 1 } })).rejects.toThrow(
        AdapterError,
      );
      await expect(adapter.storage.set('sync', { syncState: { configVersion: 2 } })).resolves.toBeUndefined();
      expect(adapter.state.syncStorage.syncState).toEqual({ configVersion: 2 });
    });
  });

  describe('failStorageSet(area, key?) — persistent + key-directed', () => {
    it('persistently fails only the targeted key, leaving other keys writable', async () => {
      adapter.failStorageSet('local', 'icon:slot-3');

      await expect(adapter.storage.set('local', { 'icon:slot-3': 'X' })).rejects.toThrow(AdapterError);
      await expect(adapter.storage.set('local', { 'icon:slot-9': 'Y' })).resolves.toBeUndefined();

      expect(adapter.state.localStorage['icon:slot-9']).toBe('Y');
      expect('icon:slot-3' in adapter.state.localStorage).toBe(false);
    });

    it('fails repeatedly (persistent) until cleared', async () => {
      adapter.failStorageSet('sync');

      await expect(adapter.storage.set('sync', { a: 1 })).rejects.toThrow();
      await expect(adapter.storage.set('sync', { a: 2 })).rejects.toThrow();
      expect('a' in adapter.state.syncStorage).toBe(false);

      adapter.clearStorageFailures();
      await expect(adapter.storage.set('sync', { a: 3 })).resolves.toBeUndefined();
      expect(adapter.state.syncStorage.a).toBe(3);
    });

    it('only targets the named area (local failure never blocks sync)', async () => {
      adapter.failStorageSet('local', 'icon:slot-1');

      await expect(adapter.storage.set('local', { 'icon:slot-1': 'X' })).rejects.toThrow();
      await expect(adapter.storage.set('sync', { syncState: {} })).resolves.toBeUndefined();
    });
  });

  describe('clean failure — no state pollution, no onChanged broadcast', () => {
    it('throws before writing the store or notifying listeners', async () => {
      let changed = 0;
      adapter.storage.onChanged(() => { changed += 1; });

      adapter.failNextStorageSet('sync');

      await expect(
        adapter.storage.set('sync', { syncState: { configVersion: 99 } }),
      ).rejects.toThrow();

      expect(changed).toBe(0);
      expect('syncState' in adapter.state.syncStorage).toBe(false);
    });
  });

  describe('orthogonality with the existing nextError', () => {
    it('reset() clears injected storage failures', async () => {
      adapter.failStorageSet('sync');
      await expect(adapter.storage.set('sync', { a: 1 })).rejects.toThrow();

      adapter.reset();

      await expect(adapter.storage.set('sync', { a: 2 })).resolves.toBeUndefined();
      expect(adapter.state.syncStorage.a).toBe(2);
    });

    it('does not disturb the legacy nextError semantics', async () => {
      adapter.state.nextError = { code: 'BROWSER_API_ERROR', message: 'legacy' };
      await expect(adapter.storage.set('sync', { a: 1 })).rejects.toThrow('legacy');
      // One-shot: the second call succeeds.
      await expect(adapter.storage.set('sync', { a: 1 })).resolves.toBeUndefined();
    });
  });
});