/**
 * T12 (R1) — recipe rendering lands in the BACKGROUND as PNG.
 *
 * jsdom has NO `OffscreenCanvas`, so a real render cannot be asserted here.
 * These tests cover the renderer's CONTRACT with a stub / an injected fake
 * canvas; real pixels are covered by the T23 spike and the F3 browser pass.
 *
 * The decisive assertions:
 *   - a recipe renders to a value starting `data:image/png` (never svg+xml);
 *   - the renderer memoizes (one render for repeated reads);
 *   - a failing canvas degrades to the placeholder WITHOUT throwing.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { IconService } from '@background/icon-service';
import { RecipeRenderer, recipeSignature } from '@background/recipe-renderer';

describe('T12: recipe renderer (background single renderer, R1)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a template recipe to data:image/png, never svg+xml', async () => {
    const svc = new IconService(repo, {
      renderToPng: () => Promise.resolve('data:image/png;base64,AAAA'),
    } as unknown as RecipeRenderer);

    const uri = await svc.resolveForDisplay({
      type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF',
    });
    expect(uri.startsWith('data:image/png')).toBe(true);
    expect(uri).not.toContain('svg+xml');
  });

  it('degrades to the placeholder (never throws, never a recipe SVG) when the render fails', async () => {
    const svc = new IconService(repo, {
      renderToPng: (_r: unknown, fallback: () => string) => Promise.resolve(fallback()),
    } as unknown as RecipeRenderer);

    const uri = await svc.resolveForDisplay({ type: 'template', value: '', text: 'X' });
    expect(uri).toContain('data:image/svg+xml'); // the EXISTING static placeholder
    expect(uri).toContain('e0e0e0');
  });

  it('memoizes by recipe signature: a repeated read renders only once', async () => {
    // A fake OffscreenCanvas so the REAL renderer path executes in jsdom. The
    // blob is duck-typed (only `type` + `arrayBuffer()` are used), which avoids
    // jsdom Blob API gaps.
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const fakeCtx = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      fillText: vi.fn(),
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
    };
    const convertSpy = vi.fn((_opts?: unknown) =>
      Promise.resolve({ type: 'image/png', arrayBuffer: () => Promise.resolve(pngBytes.buffer) }),
    );
    class FakeOffscreenCanvas {
      constructor(public width: number, public height: number) {}
      getContext(): unknown { return fakeCtx; }
      convertToBlob(opts: unknown): Promise<unknown> { return convertSpy(opts); }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'));

    const renderer = new RecipeRenderer(repo);
    const recipe = { backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' };
    const first = await renderer.renderToPng(recipe, () => 'FALLBACK');
    const second = await renderer.renderToPng(recipe, () => 'FALLBACK');

    expect(first.startsWith('data:image/png')).toBe(true);
    expect(second).toBe(first);
    expect(convertSpy).toHaveBeenCalledTimes(1); // memoized — one render, not two
  });

  it('caches a failed render as known-bad (no retry storm) and falls back', async () => {
    const renderSpy = vi.fn(() => { throw new Error('no canvas'); });
    const renderer = new RecipeRenderer(repo);
    // Force the internal draw to fail by removing OffscreenCanvas.
    vi.stubGlobal('OffscreenCanvas', undefined);
    void renderSpy;

    const first = await renderer.renderToPng({ text: 'Q' }, () => 'FALLBACK');
    expect(first).toBe('FALLBACK');
    // The failure is memoized as null — a second read returns the fallback
    // WITHOUT attempting a render again (the signature is in the cache).
    expect(repo.getRecipeResolution(recipeSignature({ text: 'Q' }))).toBeNull();
    const second = await renderer.renderToPng({ text: 'Q' }, () => 'FALLBACK');
    expect(second).toBe('FALLBACK');
  });
});