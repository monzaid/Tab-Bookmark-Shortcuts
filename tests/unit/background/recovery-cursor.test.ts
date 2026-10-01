import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RecoveryService } from '@background/recovery-service';
import type { NormalizedWindow, NormalizedTab } from '@adapters/contract';
import type { RecoverySession } from '@shared/types';

/**
 * T6: the Prev/Next cursor (DT1/DT2/DT5).
 * - Browsing never consumes the session or closes the window.
 * - The cursor is tabId-anchored and wraps around the ring.
 * - First browse anchors on the active tab's neighbour when it is a candidate.
 */
describe('T6: recovery Prev/Next cursor', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RecoveryService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  const tab = (id: number, index: number, active = false): NormalizedTab => ({
    id,
    windowId: 1,
    index,
    url: 'https://example.com/page',
    title: 'T' + String(id),
    favIconUrl: '',
    active,
    incognito: false,
    status: 'complete',
  });

  const session = (over?: Partial<RecoverySession>): RecoverySession => {
    const now = new Date();
    return {
      recoveryId: 'rec-1',
      slotId: 1,
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      titleSnapshot: 'Example',
      faviconSnapshot: '',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      windowId: -1,
      candidateCursor: null,
      ...over,
    };
  };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RecoveryService(adapter, repo);
  });

  it('steps forward and wraps around the candidate ring', async () => {
    // Explicit cursor: start at candidate 10, then 11, then wrap back to 10.
    await repo.addRecoverySession(session({ candidateCursor: 12 }));
    adapter.setTabs([tab(10, 0), tab(11, 1), tab(12, 2)]);

    const r1 = await service.nextMatch('rec-1', false);
    expect(r1.success && r1.outcome.type === 'switched' ? r1.outcome.tabId : null).toBe(10);

    const r2 = await service.nextMatch('rec-1', false);
    expect(r2.success && r2.outcome.type === 'switched' ? r2.outcome.tabId : null).toBe(11);

    const r3 = await service.nextMatch('rec-1', false);
    expect(r3.success && r3.outcome.type === 'switched' ? r3.outcome.tabId : null).toBe(12);
  });

  it('steps backward', async () => {
    await repo.addRecoverySession(session({ candidateCursor: 10 }));
    adapter.setTabs([tab(10, 0), tab(11, 1), tab(12, 2)]);

    const r = await service.prevMatch('rec-1', false);
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(12);
  });

  it('first browse anchors on the active tab neighbour when it is a candidate', async () => {
    await repo.addRecoverySession(session());
    adapter.setTabs([tab(10, 0), tab(11, 1, true), tab(12, 2)]);

    // Cursor is null → anchor on the active tab (11) and step forward to 12.
    const r = await service.nextMatch('rec-1', false);
    expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(12);
  });

  it('keeping the session alive across three consecutive clicks', async () => {
    await repo.addRecoverySession(session({ candidateCursor: 12 }));
    adapter.setTabs([tab(10, 0), tab(11, 1), tab(12, 2)]);

    await service.nextMatch('rec-1', false);
    await service.nextMatch('rec-1', false);
    await service.nextMatch('rec-1', false);

    const local = await repo.getLocalState();
    expect(local.recoverySessions).toHaveLength(1);
    expect(local.recoverySessions[0].candidateCursor).toBe(12);
  });
});