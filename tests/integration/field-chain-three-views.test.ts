/**
 * T20 — SC1: the three views and the actual delivery agree.
 *
 * The construction guarantee is that `field-chain` is the ONLY chain, so the
 * value the UI would display and the value the background delivers come from the
 * same call. This suite asserts that end-to-end (upgrading the old
 * `sidebar-slot-tier-display` lock-step test).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { FieldDeliveryService } from '@background/field-delivery-service';
import { resolveFieldChain } from '@shared/field-chain';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { FieldApplyMessage } from '@shared/messages';

const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

function tab(id: number, url: string): NormalizedTab {
  return { id, windowId: 1, index: id, url, title: 'Site', favIconUrl: '', active: false, incognito: false, status: 'complete' };
}

describe('T20: three views = delivered value (SC1)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let delivery: FieldDeliveryService;

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([win]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    delivery = new FieldDeliveryService(adapter, repo);
  });

  function lastApply(tabId: number): FieldApplyMessage | undefined {
    const msgs = adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage' && c.args[0] === tabId)
      .map((c) => c.args[1] as FieldApplyMessage)
      .filter((m) => m.type === 'FIELD_APPLY');
    return msgs[msgs.length - 1];
  }

  it('the UI chain winner equals the delivered directive (override = null, slot = S, rule = R)', async () => {
    adapter.setTabs([tab(7, 'https://a.com/page')]);
    const saved = await repo.saveSlot({
      id: 5,
      urlMatch: { type: 'exact', value: 'https://a.com/page' },
      strategy: 'inherit',
      uiMarker: { customTitle: 'Slot S' },
      titleSnapshot: 'Slot S',
      faviconSnapshot: '',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }, 0);
    expect(saved.success).toBe(true);
    await repo.setBinding({ slotId: 5, tabId: 7, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
    await repo.addRule({
      id: 'r1',
      urlMatch: { type: 'exact', value: 'https://a.com/page' },
      priority: 0,
      title: 'Rule R',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const local = await repo.getLocalState();
    // The UI would compute the winner from the SAME shared function.
    const uiWinner = resolveFieldChain('title', { sync: await repo.getSyncState(), local, tabId: 7, tabUrl: 'https://a.com/page' });

    await delivery.recomputeAndRedeliver([7]);
    const delivered = lastApply(7);

    expect(uiWinner.winner.value).toBe('Slot S');
    expect(uiWinner.winner.source).toBe('slot');
    expect(delivered?.title).toEqual({ kind: 'set', value: uiWinner.winner.value });
  });

  it('title and icon are independent chains (changing one does not move the other)', async () => {
    adapter.setTabs([tab(7, 'https://a.com/page')]);
    await repo.addRule({
      id: 'r1',
      urlMatch: { type: 'exact', value: 'https://a.com/page' },
      priority: 0,
      title: 'Only Title',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const local = await repo.getLocalState();
    const sync = await repo.getSyncState();
    const title = resolveFieldChain('title', { sync, local, tabId: 7, tabUrl: 'https://a.com/page' });
    const favicon = resolveFieldChain('favicon', { sync, local, tabId: 7, tabUrl: 'https://a.com/page' });

    expect(title.winner.value).toBe('Only Title');
    // The favicon chain sees nothing for this rule.
    expect(favicon.winner.value).toBeNull();
    expect(favicon.winner.source).toBe('site');
  });
});