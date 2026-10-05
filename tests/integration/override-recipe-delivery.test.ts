/**
 * FIX-B — a `local.tabOverrides` recipe must reach the chain as a PNG.
 *
 * The R2 materialization only walked the SYNC records (`rules` / `slots`), but a
 * `tabOverride` lives in LOCAL (`getLocalState()`), and it is the HIGHEST
 * priority tier in the chain. So an override recipe kept `value:''` →
 * `asSetFavicon('')` → `null` → the delivery fell back to `restore` and the
 * current page's icon never changed — the most common "Custom Icon" path.
 *
 * The fix mirrors R2 exactly, on the local read boundary: materialize at read
 * time using the SAME `RecipeRenderer`, and apply the SAME strip invariant so a
 * derived render can never become the durable truth (`writeLocal` re-reads
 * through `getLocalState()` and persists the object it gets).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { FieldDeliveryService } from '@background/field-delivery-service';
import { resolveFieldChain } from '@shared/field-chain';
import type { RecipeRenderer } from '@background/recipe-renderer';
import type { IconSource, LocalState, TabOverride } from '@shared/types';
import type { FieldApplyMessage } from '@shared/messages';

const RECIPE: IconSource = {
  type: 'template',
  value: '',
  backgroundColor: '#2563EB',
  text: 'A',
  textColor: '#FFFFFF',
};
const PNG = 'data:image/png;base64,OVERRIDEPNG';

const override = (tabId: number, favicon: IconSource): TabOverride => ({
  tabId,
  favicon,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('FIX-B: an override recipe is materialized before the chain', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    repo.setRecipeRenderer({
      renderForResolution: () => Promise.resolve(PNG),
    } as unknown as RecipeRenderer);
    await repo.initialize();
  });

  /** Seed the RAW local store, then re-hydrate (the cache was primed empty). */
  async function seedOverride(o: TabOverride): Promise<void> {
    adapter.state.localStorage['localState'] = {
      bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [],
      recoverySnapshots: [], tabOverrides: [o], iconCache: {}, diagnostics: [],
    } satisfies LocalState;
    await repo.hydrate();
  }

  it('the chain resolves an OVERRIDE recipe to data:image/png', async () => {
    await seedOverride(override(7, RECIPE));

    const local = await repo.getLocalState();
    const sync = await repo.getSyncState();
    const chain = resolveFieldChain('favicon', { sync, local, tabId: 7, tabUrl: 'https://example.com/' });

    expect(chain.winner.source).toBe('override');
    expect(chain.winner.value).toBe(PNG);
    expect(chain.winner.value).not.toContain('svg');
  });

  it('the delivery service pushes a `set` directive carrying the PNG', async () => {
    await seedOverride(override(7, RECIPE));
    adapter.setTabs([
      { id: 7, windowId: 1, index: 0, url: 'https://example.com/', title: 'T', favIconUrl: '', active: true, incognito: false, status: 'complete' },
    ]);

    const delivery = new FieldDeliveryService(adapter, repo);
    await delivery.recomputeAndRedeliver([7]);

    const applied = adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage' && c.args[0] === 7)
      .map((c) => c.args[1] as FieldApplyMessage)
      .filter((m) => m?.type === 'FIELD_APPLY');

    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0].favicon).toEqual({ kind: 'set', value: PNG });
  });

  it('the PERSISTED LocalState override keeps an EMPTY value (never the render)', async () => {
    await seedOverride(override(7, RECIPE));

    // A read materializes (as delivery/UI would trigger)...
    expect((await repo.getLocalState()).tabOverrides[0].favicon!.value).toBe(PNG);

    // ...then an unrelated local write must NOT smuggle the render into storage.
    await repo.setSiteSnapshot({
      tabId: 99, title: null, faviconHref: null, capturedAt: '2026-01-01T00:00:00.000Z',
    });

    const raw = adapter.state.localStorage['localState'] as LocalState;
    const stored = raw.tabOverrides.find((o) => o.tabId === 7)!;
    expect(stored.favicon!.value).toBe('');
    expect(stored.favicon!.type).toBe('template');
    expect(stored.favicon!.backgroundColor).toBe('#2563EB');
    expect(stored.favicon!.text).toBe('A');
    expect(stored.favicon!.textColor).toBe('#FFFFFF');
  });

  it('a failed render leaves the override unset (never SVG), recipe fields intact', async () => {
    repo.setRecipeRenderer({
      renderForResolution: () => Promise.resolve(undefined),
    } as unknown as RecipeRenderer);
    await seedOverride(override(7, RECIPE));

    const local = await repo.getLocalState();
    const chain = resolveFieldChain('favicon', {
      sync: await repo.getSyncState(), local, tabId: 7, tabUrl: 'https://example.com/',
    });

    // '' → asSetFavicon → null → the chain falls through (delivery restores).
    expect(chain.winner.value).toBeNull();
    expect(local.tabOverrides[0].favicon!.type).toBe('template');
    expect(local.tabOverrides[0].favicon!.textColor).toBe('#FFFFFF');
  });
});