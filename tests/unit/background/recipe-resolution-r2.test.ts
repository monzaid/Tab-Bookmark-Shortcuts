/**
 * R2 — recipe rendering lands at the READ boundary (`resolveIconReferences`).
 *
 * Why here and not `resolveForDisplay` (which R1 used): the chain is a
 * SYNCHRONOUS pure function over `value: string | null`, and `IconSource` is
 * stripped before it. So the recipe must be materialized to a `value` BEFORE the
 * chain runs — exactly what the pre-existing `local-icon:` dereferencing already
 * does at this same spot. Delivery and the UI both read `getSyncState()`, so one
 * render is shared by construction.
 *
 * Contract:
 *   - `value` becomes the PNG data URI;
 *   - `backgroundColor` / `text` / `textColor` are preserved (the UI must stay
 *     editable and the export must stay reproducible);
 *   - `type` stays `'template'` (the UI/export must still know it is a recipe);
 *   - rendering is memoized — one render serves repeated reads;
 *   - a failure NEVER yields SVG (the page gate drops it) — it leaves the value
 *     unset instead, so the chain reads `null` and the delivery restores.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RecipeRenderer } from '@background/recipe-renderer';
import type { IconSource, SlotDefinition, PageRule, SyncState } from '@shared/types';

const RECIPE: IconSource = {
  type: 'template',
  value: '',
  backgroundColor: '#2563EB',
  text: 'A',
  textColor: '#FFFFFF',
};

const PNG = 'data:image/png;base64,RECIPEPNG';

/** A renderer stub that returns a PNG for any recipe (jsdom has no canvas). */
function stubRenderer(fn: (r: { text?: string }) => Promise<string | undefined>): RecipeRenderer {
  return { renderForResolution: fn } as unknown as RecipeRenderer;
}

describe('R2: read-time recipe materialization', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  const slot = (id: number, icon: IconSource): SlotDefinition => ({
    id,
    urlMatch: { type: 'exact', value: `https://s${String(id)}/` },
    strategy: 'inherit',
    uiMarker: { icon },
    titleSnapshot: `S${String(id)}`,
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const rule = (favicon: IconSource): PageRule => ({
    id: 'rule-a',
    urlMatch: { type: 'exact', value: 'https://a.example/' },
    priority: 0,
    favicon,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  /** Seed the RAW sync store directly (bypasses writeSync's read-modify-write). */
  function seedRaw(sync: Partial<SyncState>): void {
    adapter.state.syncStorage['syncState'] = {
      configVersion: 0,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [],
      rules: [],
      ...sync,
    };
  }

  beforeEach(() => {
    adapter.reset();
    repo = new StorageRepository(adapter);
  });

  it('materializes a slot recipe into value, preserving fields and type', async () => {
    repo.setRecipeRenderer(stubRenderer(() => Promise.resolve(PNG)));
    seedRaw({ slots: [slot(3, RECIPE)] });
    await repo.initialize();

    const icon = (await repo.getSyncState()).slots[0].uiMarker.icon!;

    expect(icon.value).toBe(PNG);
    expect(icon.type).toBe('template'); // NOT rewritten
    expect(icon.backgroundColor).toBe('#2563EB');
    expect(icon.text).toBe('A');
    expect(icon.textColor).toBe('#FFFFFF');
  });

  it('materializes a rule recipe too', async () => {
    repo.setRecipeRenderer(stubRenderer(() => Promise.resolve(PNG)));
    seedRaw({ rules: [rule(RECIPE)] });
    await repo.initialize();

    const favicon = (await repo.getSyncState()).rules[0].favicon!;

    expect(favicon.value).toBe(PNG);
    expect(favicon.type).toBe('template');
    expect(favicon.textColor).toBe('#FFFFFF');
  });

  it('memoizes: repeated reads render only once (real renderer)', async () => {
    // Exercise the REAL memoization (it lives in RecipeRenderer, keyed through
    // the repository's iconResolutionCache), so a fake OffscreenCanvas is used
    // rather than a stubbed renderer — otherwise the cache is bypassed.
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const fakeCtx = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      fillText: vi.fn(),
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
    };
    const convertSpy = vi.fn((_opts?: unknown) =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(pngBytes.buffer) }),
    );
    class FakeOffscreenCanvas {
      constructor(public width: number, public height: number) {}
      getContext(): unknown { return fakeCtx; }
      convertToBlob(opts: unknown): Promise<unknown> { return convertSpy(opts); }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'));

    repo.setRecipeRenderer(new RecipeRenderer(repo));
    seedRaw({ slots: [slot(1, RECIPE)] });
    await repo.initialize();

    const first = (await repo.getSyncState()).slots[0].uiMarker.icon!.value;
    await repo.getSyncState();
    await repo.getSyncState();

    expect(first.startsWith('data:image/png')).toBe(true);
    expect(convertSpy).toHaveBeenCalledTimes(1); // one render, three reads

    vi.unstubAllGlobals();
  });

  it('a render failure leaves the value unset and NEVER emits SVG', async () => {
    repo.setRecipeRenderer(stubRenderer(() => Promise.resolve(undefined)));
    seedRaw({ slots: [slot(1, RECIPE)] });
    await repo.initialize();

    const icon = (await repo.getSyncState()).slots[0].uiMarker.icon!;

    // Unset (the chain's `asSet('')` → null → delivery `restore`), never SVG.
    expect(icon.value).toBe('');
    expect(icon.value).not.toContain('svg');
    // The recipe fields survive — the user can still see/edit what failed.
    expect(icon.backgroundColor).toBe('#2563EB');
    expect(icon.text).toBe('A');
    expect(icon.type).toBe('template');
  });

  it('a subsequent write must NOT persist the rendered value back into the recipe', async () => {
    // HAZARD: `writeSync`/`mutateSync` read `getSyncState()` (now rendered) and
    // persist that object back. If the render result is not stripped, the stored
    // truth silently becomes the PNG — re-importing the design's REJECTED
    // alternative ("store the recipe AND the first render"), which the spec
    // forbids precisely because the two can drift.
    repo.setRecipeRenderer(stubRenderer(() => Promise.resolve(PNG)));
    await repo.initialize();

    const recipeRule: PageRule = { ...rule(RECIPE), id: 'rule-1' };
    await repo.addRule(recipeRule);

    // A read in between materializes the PNG (as delivery/UI would trigger).
    expect((await repo.getSyncState()).rules[0].favicon!.value).toBe(PNG);

    // A second, unrelated write must not smuggle the PNG into the recipe's value.
    await repo.addRule({ ...rule(RECIPE), id: 'rule-2' });

    const raw = adapter.state.syncStorage['syncState'] as SyncState;
    const stored = raw.rules.find((r) => r.id === 'rule-1')!.favicon!;
    expect(stored.value).toBe(''); // the recipe value stays empty — recipe is the truth
    expect(stored.type).toBe('template');
    expect(stored.textColor).toBe('#FFFFFF');
  });

  it('does not disturb non-recipe icons', async () => {
    repo.setRecipeRenderer(stubRenderer(() => Promise.resolve(PNG)));
    seedRaw({ slots: [slot(1, { type: 'url', value: 'https://x.example/i.png' })] });
    await repo.initialize();

    const icon = (await repo.getSyncState()).slots[0].uiMarker.icon!;
    expect(icon.value).toBe('https://x.example/i.png');
  });
});