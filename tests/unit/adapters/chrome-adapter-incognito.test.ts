/**
 * B5 (T7): `incognito.isAllowed()` must be decided by a persisted user
 * authorization flag, NOT by the manifest key.
 *
 * Why this file exists: `mock-adapter.ts`'s `isAllowed()` returns
 * `state.incognitoAllowed` directly and never reads the manifest or storage,
 * so asserting against the mock would silently pass regardless of the fix.
 * These tests stub the global `chrome` object and exercise the REAL
 * `createChromeAdapter(...)` implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChromeAdapter } from '@adapters/chrome-adapter';

type StorageGet = (area: string, keys?: string | string[] | Record<string, unknown>) => Promise<Record<string, unknown>>;

function stubChrome(localGet: StorageGet, manifestIncognito?: string): void {
  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: () => ({ version: '1.0.0', manifest_version: 3, incognito: manifestIncognito }),
      getURL: (path: string) => `chrome-extension://test-id/${path}`,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      local: { get: localGet },
      sync: { get: async () => ({}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
}

describe('B5 — chrome-adapter incognito.isAllowed() uses the persisted user flag', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('fail-closed by default', () => {
    beforeEach(() => {
      stubChrome(async () => ({}));
    });

    it('should return false when no authorization flag is stored', async () => {
      const adapter = createChromeAdapter('chrome');
      await expect(adapter.incognito.isAllowed()).resolves.toBe(false);
    });

    it('should return false even when the manifest does NOT declare not_allowed', async () => {
      // Regression guard: the OLD implementation returned
      // `manifest.incognito !== 'not_allowed'`, i.e. `true` here.
      vi.unstubAllGlobals();
      stubChrome(async () => ({}), undefined);

      const adapter = createChromeAdapter('chrome');
      await expect(adapter.incognito.isAllowed()).resolves.toBe(false);
    });

    it('should return false when the storage read throws', async () => {
      vi.unstubAllGlobals();
      stubChrome(async () => {
        throw new Error('storage unavailable');
      });

      const adapter = createChromeAdapter('chrome');
      await expect(adapter.incognito.isAllowed()).resolves.toBe(false);
    });
  });

  describe('granted by the persisted flag', () => {
    it('should return true when incognitoAuthorized is true', async () => {
      stubChrome(async () => ({ incognitoAuthorized: true }));

      const adapter = createChromeAdapter('chrome');
      await expect(adapter.incognito.isAllowed()).resolves.toBe(true);
    });

    it('should return false when incognitoAuthorized is explicitly false', async () => {
      vi.unstubAllGlobals();
      stubChrome(async () => ({ incognitoAuthorized: false }));

      const adapter = createChromeAdapter('chrome');
      await expect(adapter.incognito.isAllowed()).resolves.toBe(false);
    });

    it('should ignore a non-boolean flag value (fail-closed)', async () => {
      vi.unstubAllGlobals();
      stubChrome(async () => ({ incognitoAuthorized: 'yes' }));

      const adapter = createChromeAdapter('chrome');
      await expect(adapter.incognito.isAllowed()).resolves.toBe(false);
    });
  });
});