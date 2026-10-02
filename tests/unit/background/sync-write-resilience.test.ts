import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import type { NormalizedWindow } from '@adapters/contract';

/**
 * Sync write resilience tests — retry, fallback, icon offloading.
 *
 * Rule writes use mutateSync (no version check).
 * Slot writes still use writeSync (versioned).
 * Both share the same serialized queue and fallback logic.
 */
describe('Sync write resilience — retry, fallback, icon offloading', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
  });

  describe('Fallback to local storage', () => {
    it('should fall back to local storage when sync persistently fails', async () => {
      const originalSet = adapter.storage.set;
      try {
        adapter.storage.set = async (area, items) => {
          if (area === 'sync') {
            throw new Error('Persistent storage failure');
          }
          return originalSet(area, items);
        };

        // Rule write falls back to local storage and succeeds
        const result = await service.createRule({
          urlMatch: { type: 'exact', value: 'https://example.com/fallback' },
          priority: 0,
        });
        expect(result.success).toBe(true);

        // Verify data was written to local fallback key
        const fallbackData = adapter.state.localStorage['syncStateFallback'] as { configVersion: number; rules: unknown[] } | undefined;
        expect(fallbackData).toBeDefined();
        expect(fallbackData!.rules).toHaveLength(1);
      } finally {
        adapter.storage.set = originalSet;
      }
    });

    it('should fall back to local for non-quota sync errors via writeSync', async () => {
      const originalSet = adapter.storage.set;
      try {
        adapter.storage.set = async (area, items) => {
          if (area === 'sync') {
            throw new Error('Network disconnected');
          }
          return originalSet(area, items);
        };

        // writeSync (slot path) also falls back
        const result = await repo.writeSync(0, (state) => state);
        expect(result.success).toBe(true);
      } finally {
        adapter.storage.set = originalSet;
      }
    });
  });

  describe('Quota error handling', () => {
    it('should throw on quota error (not silently swallow)', async () => {
      const originalSet = adapter.storage.set;
      try {
        adapter.storage.set = async (area, items) => {
          if (area === 'sync') {
            throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
          }
          return originalSet(area, items);
        };

        // Rule write throws on quota error
        await expect(service.createRule({
          urlMatch: { type: 'exact', value: 'https://example.com/quota' },
          priority: 0,
        })).rejects.toThrow(/quota/i);
      } finally {
        adapter.storage.set = originalSet;
      }
    });

    it('should return quota-specific message via writeSync', async () => {
      const originalSet = adapter.storage.set;
      try {
        adapter.storage.set = async (area, items) => {
          if (area === 'sync') {
            throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
          }
          return originalSet(area, items);
        };

        const result = await repo.writeSync(0, (state) => state);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.message.toLowerCase()).toContain('quota');
        }
      } finally {
        adapter.storage.set = originalSet;
      }
    });
  });

  describe('Large icon offloading to local storage', () => {
    it('should offload data URI icons >6KB to local storage and keep reference in sync', async () => {
      const largeDataUri = 'data:image/png;base64,' + 'A'.repeat(8000);

      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/large-icon' },
        priority: 0,
        favicon: { type: 'upload', value: largeDataUri },
      });

      expect(result.success).toBe(true);

      // The sync storage should NOT contain the full data URI
      const syncData = adapter.state.syncStorage['syncState'] as { rules: Array<{ favicon?: { value: string } }> };
      const savedRule = syncData.rules.find((r) => r.favicon?.value);
      if (savedRule?.favicon) {
        expect(savedRule.favicon.value.length).toBeLessThan(200);
        expect(savedRule.favicon.value).toContain('local-icon:');
      }

      // The local storage should contain the actual data URI
      const localKeys = Object.keys(adapter.state.localStorage);
      const iconKey = localKeys.find((k) => k.startsWith('icon:'));
      expect(iconKey).toBeDefined();
      expect(adapter.state.localStorage[iconKey!]).toBe(largeDataUri);
    });

    it('should resolve icon references when reading sync state', async () => {
      const largeDataUri = 'data:image/png;base64,' + 'B'.repeat(8000);

      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/resolve-test' },
        priority: 0,
        favicon: { type: 'upload', value: largeDataUri },
      });

      // getSyncState should return the resolved (full) data URI
      const sync = await repo.getSyncState();
      const rule = sync.rules.find((r) => r.urlMatch.value === 'https://example.com/resolve-test');
      expect(rule).toBeDefined();
      expect(rule!.favicon?.value).toBe(largeDataUri);
    });

    it('should NOT offload small icons (<6KB)', async () => {
      const smallDataUri = 'data:image/png;base64,' + 'C'.repeat(100);

      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/small-icon' },
        priority: 0,
        favicon: { type: 'upload', value: smallDataUri },
      });

      const syncData = adapter.state.syncStorage['syncState'] as { rules: Array<{ urlMatch: { value: string }; favicon?: { value: string } }> };
      const savedRule = syncData.rules.find((r) => r.urlMatch.value === 'https://example.com/small-icon');
      expect(savedRule?.favicon?.value).toBe(smallDataUri);
    });

    it('should NOT offload URL-based icons (http/https)', async () => {
      const urlIcon = 'https://example.com/favicon.ico';

      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/url-icon' },
        priority: 0,
        favicon: { type: 'url', value: urlIcon },
      });

      const syncData = adapter.state.syncStorage['syncState'] as { rules: Array<{ urlMatch: { value: string }; favicon?: { value: string } }> };
      const savedRule = syncData.rules.find((r) => r.urlMatch.value === 'https://example.com/url-icon');
      expect(savedRule?.favicon?.value).toBe(urlIcon);
    });
  });

  describe('Queue resilience after quota error', () => {
    it('should allow subsequent writes after a quota error is resolved', async () => {
      // First write succeeds
      const r1 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/a' },
        priority: 0,
      });
      expect(r1.success).toBe(true);

      // Quota error on next write
      const originalSet = adapter.storage.set;
      let shouldFail = true;
      adapter.storage.set = async (area, items) => {
        if (area === 'sync' && shouldFail) {
          throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        }
        return originalSet(area, items);
      };

      // Second write throws
      await expect(service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/b' },
        priority: 0,
      })).rejects.toThrow(/quota/i);

      // Fix the quota issue
      shouldFail = false;

      // Queue must still work
      const r3 = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/c' },
        priority: 0,
      });
      expect(r3.success).toBe(true);

      adapter.storage.set = originalSet;
    });
  });
});
