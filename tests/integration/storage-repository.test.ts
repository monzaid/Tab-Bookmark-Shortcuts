import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import type { SlotDefinition, RecoverySession, SlotBinding } from '@shared/types';

describe('T7: Storage repository, cache, versioned writes, cleanup', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
  });

  describe('Happy path — layered storage and cache', () => {
    it('should initialize with default states', async () => {
      const sync = await repo.getSyncState();
      const local = await repo.getLocalState();

      expect(sync.configVersion).toBe(0);
      expect(sync.globalStrategy).toBe('B');
      expect(sync.slots).toEqual([]);
      expect(sync.rules).toEqual([]);
      expect(local.bindings).toEqual([]);
      expect(local.lastSuccessSlotId).toBeNull();
    });

    it('should write slot config via single-write service and increment version', async () => {
      const slot: SlotDefinition = {
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: 'inherit',
        uiMarker: {},
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const result = await repo.saveSlot(slot, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.configVersion).toBe(1);
      }

      const sync = await repo.getSyncState();
      expect(sync.slots).toHaveLength(1);
      expect(sync.slots[0].id).toBe(1);
      expect(sync.configVersion).toBe(1);
    });

    it('should write local binding separately from sync', async () => {
      const binding: SlotBinding = {
        slotId: 1,
        tabId: 42,
        windowId: 1,
        boundAt: '2026-01-01T00:00:00Z',
      };

      await repo.setBinding(binding);

      const local = await repo.getLocalState();
      expect(local.bindings).toHaveLength(1);
      expect(local.bindings[0].tabId).toBe(42);

      // Sync state should be unchanged
      const sync = await repo.getSyncState();
      expect(sync.configVersion).toBe(0);
    });

    it('should invalidate cache on storage.onChanged and reload truth', async () => {
      // Write initial state
      await repo.setGlobalStrategy('A', 0);
      expect(repo.getConfigVersion()).toBe(1);

      // Simulate external change via storage event
      adapter.emitStorageChange(
        {
          syncState: {
            oldValue: undefined,
            newValue: {
              configVersion: 5,
              globalStrategy: 'C',
              slots: [],
              rules: [],
            },
          },
        },
        'sync'
      );

      // Cache should be updated
      const sync = await repo.getSyncState();
      expect(sync.configVersion).toBe(5);
      expect(sync.globalStrategy).toBe('C');
    });

    it('should persist and read back after re-hydration', async () => {
      const slot: SlotDefinition = {
        id: 3,
        urlMatch: { type: 'regex', value: 'https://github\\.com/.*' },
        strategy: 'B',
        uiMarker: { customTitle: 'GitHub' },
        titleSnapshot: 'GitHub',
        faviconSnapshot: 'https://github.com/favicon.ico',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      await repo.saveSlot(slot, 0);

      // Create new repo instance (simulates Worker restart)
      const repo2 = new StorageRepository(adapter);
      await repo2.initialize();

      const sync = await repo2.getSyncState();
      expect(sync.slots).toHaveLength(1);
      expect(sync.slots[0].uiMarker.customTitle).toBe('GitHub');
    });
  });

  describe('Error path — version conflict and cleanup', () => {
    it('should reject write with stale version (CONFIG_CONFLICT)', async () => {
      // First write succeeds: version 0 → 1
      await repo.setGlobalStrategy('A', 0);

      // Second write with stale version 0 should fail
      const result = await repo.setGlobalStrategy('C', 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('CONFIG_CONFLICT');
        expect(result.message).toContain('expected 0');
        expect(result.message).toContain('current is 1');
      }
    });

    it('should allow write with correct version after conflict', async () => {
      await repo.setGlobalStrategy('A', 0); // version → 1

      // Retry with correct version
      const result = await repo.setGlobalStrategy('C', 1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.configVersion).toBe(2);
      }
    });

    it('should clean expired recovery sessions on startup', async () => {
      const expiredSession: RecoverySession = {
        recoveryId: 'rec-expired',
        slotId: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2020-01-01T00:00:00Z',
        expiresAt: '2020-01-01T00:05:00Z', // Long expired
      };

      const validSession: RecoverySession = {
        recoveryId: 'rec-valid',
        slotId: 2,
        urlMatch: { type: 'exact', value: 'https://valid.com' },
        titleSnapshot: 'Valid',
        faviconSnapshot: '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min from now
      };

      await repo.addRecoverySession(expiredSession);
      await repo.addRecoverySession(validSession);

      const { removedSessions } = await repo.startupCleanup();
      expect(removedSessions).toBe(1);

      const local = await repo.getLocalState();
      expect(local.recoverySessions).toHaveLength(1);
      expect(local.recoverySessions[0].recoveryId).toBe('rec-valid');
    });

    it('should clean stale tabId bindings on startup', async () => {
      // Set up tabs: only tab 1 exists
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      const validBinding: SlotBinding = { slotId: 1, tabId: 1, windowId: 1, boundAt: '2026-01-01T00:00:00Z' };
      const staleBinding: SlotBinding = { slotId: 2, tabId: 999, windowId: 1, boundAt: '2026-01-01T00:00:00Z' };

      await repo.setBinding(validBinding);
      await repo.setBinding(staleBinding);

      const { removedBindings } = await repo.startupCleanup();
      expect(removedBindings).toBe(1);

      const local = await repo.getLocalState();
      expect(local.bindings).toHaveLength(1);
      expect(local.bindings[0].tabId).toBe(1);
    });

    it('B12: startupCleanup uses one bulk tabs.query instead of per-binding tabs.get', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 2, windowId: 1, index: 1, url: 'https://b.com', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      await repo.setBinding({ slotId: 1, tabId: 1, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setBinding({ slotId: 2, tabId: 2, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setBinding({ slotId: 3, tabId: 999, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setTabOverride({ tabId: 999, title: 'Gone', createdAt: '2026-01-01T00:00:00Z' });

      adapter.calls.length = 0;
      const { removedBindings } = await repo.startupCleanup();

      const tabGets = adapter.calls.filter((c) => c.method === 'tabs.get').length;
      const tabQueries = adapter.calls.filter((c) => c.method === 'tabs.query').length;
      expect(tabGets).toBe(0);
      expect(tabQueries).toBe(1);
      expect(removedBindings).toBe(1);

      const local = await repo.getLocalState();
      expect(local.bindings.map((b) => b.tabId).sort()).toEqual([1, 2]);
      expect(local.tabOverrides).toHaveLength(0);
    });

    it('B12: startupCleanup keeps all bindings when every tab still exists', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 2, windowId: 1, index: 1, url: 'https://b.com', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);
      await repo.setBinding({ slotId: 1, tabId: 1, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setBinding({ slotId: 2, tabId: 2, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });

      const { removedBindings } = await repo.startupCleanup();
      expect(removedBindings).toBe(0);

      const local = await repo.getLocalState();
      expect(local.bindings).toHaveLength(2);
    });

    it('should atomically clean binding and override on tab removed', async () => {
      const binding: SlotBinding = { slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' };
      await repo.setBinding(binding);
      await repo.setTabOverride({ tabId: 42, title: 'Custom', createdAt: '2026-01-01T00:00:00Z' });

      await repo.cleanupForRemovedTab(42);

      const local = await repo.getLocalState();
      expect(local.bindings).toHaveLength(0);
      expect(local.tabOverrides).toHaveLength(0);
    });

    it('B1: should keep writeLocal queue alive after a failed write', async () => {
      // Precondition: initialize() has hydrated the cache, so getLocalState() inside
      // writeLocal performs no IO. The first adapter call to consume `nextError` is
      // therefore adapter.storage.set — exactly the write we want to fail.
      const bindingA: SlotBinding = { slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' };
      const bindingB: SlotBinding = { slotId: 2, tabId: 43, windowId: 1, boundAt: '2026-01-01T00:00:00Z' };

      adapter.state.nextError = { code: 'BROWSER_API_ERROR', message: 'inject' };

      // First write must propagate the failure to the caller (not silently succeed)
      await expect(repo.setBinding(bindingA)).rejects.toThrow('inject');

      // Second write (no injection) must succeed — queue survived the rejection
      await expect(repo.setBinding(bindingB)).resolves.toBeUndefined();

      const local = await repo.getLocalState();
      expect(local.bindings.find((b) => b.slotId === 2)).toBeDefined();
      expect(local.bindings.find((b) => b.tabId === 43)).toBeDefined();
    });

    it('B1: should propagate the writeLocal error to the caller instead of swallowing it', async () => {
      adapter.state.nextError = { code: 'BROWSER_API_ERROR', message: 'inject-error' };

      let observed: unknown = null;
      try {
        await repo.setBinding({ slotId: 9, tabId: 99, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      } catch (e) {
        observed = e;
      }

      expect(observed).toBeInstanceOf(Error);
      expect((observed as Error).message).toBe('inject-error');
    });

    it('B6: mutators must not mutate a previously read local snapshot (immutability)', async () => {
      const before = await repo.getLocalState();
      const beforeCount = before.bindings.length;
      const beforeTabOverrides = before.tabOverrides.length;
      const beforeSessions = before.recoverySessions.length;

      await repo.setBinding({ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setTabOverride({ tabId: 42, title: 'Custom', createdAt: '2026-01-01T00:00:00Z' });
      await repo.addRecoverySession({
        recoveryId: 'rec-1',
        slotId: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      // The old snapshot object must be frozen — no in-place mutation
      expect(before.bindings).toHaveLength(beforeCount);
      expect(before.tabOverrides).toHaveLength(beforeTabOverrides);
      expect(before.recoverySessions).toHaveLength(beforeSessions);
    });

    it('B6: local cache must stay consistent with the underlying storage after mutators', async () => {
      await repo.setBinding({ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setTabOverride({ tabId: 42, title: 'Custom', createdAt: '2026-01-01T00:00:00Z' });
      await repo.setIconCache('icon-key', 'data:image/png;base64,AAAA');
      await repo.addDiagnostic({
        timestamp: '2026-01-01T00:00:00Z',
        errorCode: 'SUCCESS',
        browserType: 'chrome',
        operationType: 'save_slot',
      });

      const cached = await repo.getLocalState();
      const persisted = (await adapter.storage.get('local', 'localState')).localState as {
        bindings: unknown[];
        tabOverrides: unknown[];
        iconCache: Record<string, string>;
        diagnostics: unknown[];
      };

      expect(persisted).toBeDefined();
      expect(persisted.bindings).toHaveLength(cached.bindings.length);
      expect(persisted.tabOverrides).toHaveLength(cached.tabOverrides.length);
      expect(persisted.diagnostics).toHaveLength(cached.diagnostics.length);
      expect(persisted.iconCache).toEqual(cached.iconCache);
    });

    it('B7a: resolves an offloaded local-icon reference only once across getSyncState calls', async () => {
      // Seed sync state containing an offloaded icon reference, and the raw
      // local key it points at (resolveIconReferences reads storage directly).
      adapter.state.syncStorage['syncState'] = {
        configVersion: 1,
        globalStrategy: 'B',
        slots: [
          {
            id: 1,
            urlMatch: { type: 'exact', value: 'https://cached.example' },
            strategy: 'inherit',
            uiMarker: { icon: { type: 'url', value: 'local-icon:k1' } },
            titleSnapshot: 'Cached',
            faviconSnapshot: '',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        rules: [],
      };
      adapter.state.localStorage['k1'] = 'data:image/png;base64,AAA';

      const localRepo = new StorageRepository(adapter);
      await localRepo.initialize();

      const countStorageGets = () => adapter.calls.filter((c) => c.method === 'storage.get').length;

      adapter.calls.length = 0;
      const first = await localRepo.getSyncState();
      expect(first.slots[0].uiMarker.icon?.value).toBe('data:image/png;base64,AAA');
      const c1 = countStorageGets();
      expect(c1).toBeGreaterThan(0);

      // Second read must hit the resolution cache — zero additional IPC.
      adapter.calls.length = 0;
      const second = await localRepo.getSyncState();
      expect(second.slots[0].uiMarker.icon?.value).toBe('data:image/png;base64,AAA');
      expect(countStorageGets()).toBe(0);
    });

    it('B7a: invalidates the resolution cache when local storage changes', async () => {
      adapter.state.syncStorage['syncState'] = {
        configVersion: 1,
        globalStrategy: 'B',
        slots: [
          {
            id: 1,
            urlMatch: { type: 'exact', value: 'https://cached.example' },
            strategy: 'inherit',
            uiMarker: { icon: { type: 'url', value: 'local-icon:k2' } },
            titleSnapshot: 'Cached',
            faviconSnapshot: '',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        rules: [],
      };
      adapter.state.localStorage['k2'] = 'data:image/png;base64,OLD';

      const localRepo = new StorageRepository(adapter);
      await localRepo.initialize();

      expect((await localRepo.getSyncState()).slots[0].uiMarker.icon?.value).toBe('data:image/png;base64,OLD');

      // External write + change event → cache must be dropped (no stale value)
      adapter.state.localStorage['k2'] = 'data:image/png;base64,NEW';
      adapter.emitStorageChange(
        { k2: { oldValue: 'data:image/png;base64,OLD', newValue: 'data:image/png;base64,NEW' } },
        'local'
      );

      expect((await localRepo.getSyncState()).slots[0].uiMarker.icon?.value).toBe('data:image/png;base64,NEW');
    });

    it('should detect external change from another device', async () => {
      // Simulate external write that bypasses the listener (e.g., Worker was asleep)
      // Directly modify mock internal state without triggering onChanged
      adapter.state.syncStorage['syncState'] = {
        configVersion: 10,
        globalStrategy: 'A',
        slots: [],
        rules: [],
      };

      const result = await repo.checkExternalChange();
      expect(result.changed).toBe(true);
      expect(result.newVersion).toBe(10);
    });
  });
});
