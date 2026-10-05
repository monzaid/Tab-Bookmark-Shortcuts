/**
 * Recipe renderer (T12 / R1) — the SINGLE renderer for `type:'template'` icons.
 *
 * A recipe (background colour + text/emoji + text colour) is the durable truth
 * for a template icon. It is persisted verbatim (T7); this module turns it into
 * the PNG the UI shows AND the content script delivers.
 *
 * Why background and not the UI (R1):
 *   - the delivery path never passes through a UI page (content scripts react to
 *     navigation events, when no UI exists);
 *   - `apply-fields.ts` runs in the PAGE context and only accepts a STRING, and
 *     its inline gate rejects `data:image/svg+xml`.
 *   So "render in the UI" can never make the page icon actually take effect.
 *
 * Platform: `OffscreenCanvas` is a real MV3 service-worker API (no new
 * dependency). The T23 spike confirmed ASCII / CJK / emoji fidelity inside a
 * real service worker, so the normal PNG path is used; the placeholder is kept
 * only as a safety net (unavailable canvas / draw error / convertToBlob reject).
 *
 * The fallback NEVER emits `data:image/svg+xml` — the delivery gate would drop
 * it — and never throws.
 */

import type { StorageRepository } from './storage-repository';

/** The drawing geometry the UI's `renderIconToDataUri` uses (IconEditor.tsx). */
const CANVAS_SIZE = 128;

/** `CacheStorage`-free memo key: distinct space from `local-icon:` references. */
export const RECIPE_CACHE_PREFIX = 'recipe:';

/** The recipe subset a template icon carries. */
export interface RecipeInput {
  backgroundColor?: string;
  text?: string;
  textColor?: string;
}

/** Default background when a recipe omits one (mirrors the UI's grey default). */
const DEFAULT_BG = '#9CA3AF';

/**
 * R2: the PNG-shaped placeholder used when a REAL recipe cannot be rendered.
 *
 * It MUST be a recipe (and therefore render to a PNG). A `data:image/svg+xml`
 * placeholder — notably `IconService.getPlaceholder()` — would be SILENTLY
 * DROPPED by the page-side gate (`apply-fields.ts` / `content/index.ts` only
 * allow bitmap data URIs), leaving the user unable to tell "no icon set" from
 * "rendering failed". Mirrors the existing grey `?` look so they stay visually
 * consistent.
 */
export const RECIPE_PLACEHOLDER: RecipeInput = {
  backgroundColor: '#e0e0e0',
  text: '?',
  textColor: '#999999',
};

/**
 * Auto text colour by background luminance (mirrors `IconEditor.autoTextColor`).
 * Kept local so the renderer carries no UI import (background must not depend on
 * `@ui/*`).
 */
export function autoTextColor(bgColor: string): string {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/** Stable memo key for a recipe (order-independent, no collisions with refs). */
export function recipeSignature(recipe: RecipeInput): string {
  return `${RECIPE_CACHE_PREFIX}${recipe.backgroundColor ?? ''}|${recipe.text ?? ''}|${recipe.textColor ?? ''}`;
}

/** Rounded-rect path (12px at 128 = the UI's 0.1875 * size ratio). */
function roundRectPath(
  ctx: OffscreenCanvasRenderingContext2D,
  size: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
}

/** Convert a blob to a `data:` URI without a FileReader (not in a worker). */
async function blobToDataUri(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  // `btoa` is available in the MV3 service worker global scope.
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Render a recipe to a `data:image/png` URI, memoized through the repository's
 * `iconResolutionCache` (shared with the `local-icon:` dereferencer).
 *
 * `renderFallback` is injected so the caller (IconService) owns the placeholder
 * and the renderer stays free of `IconService` (no cycle). It is used when the
 * canvas path is unavailable or throws.
 */
export class RecipeRenderer {
  constructor(private repo: StorageRepository) {}

  async renderToPng(
    recipe: RecipeInput,
    renderFallback: () => string,
  ): Promise<string> {
    const signature = recipeSignature(recipe);

    // Memoized: `undefined` = cold, `null` = known-bad, string = rendered PNG.
    const memo = this.repo.getRecipeResolution(signature);
    if (memo !== undefined) {
      return memo ?? renderFallback();
    }

    try {
      const rendered = await this.drawPng(recipe);
      this.repo.cacheRecipeResolution(signature, rendered);
      return rendered;
    } catch {
      // Degrade safely (T23 exit): remember the failure so hot reads do not
      // retry a broken canvas on every call, and never throw into the chain.
      this.repo.cacheRecipeResolution(signature, null);
      return renderFallback();
    }
  }

  /**
   * R2: render a recipe for the READ path (`resolveIconReferences`).
   *
   * ALWAYS returns a PNG data URI, or `undefined` when not even the PNG
   * placeholder can be produced (no `OffscreenCanvas` at all). It NEVER returns
   * an SVG: the page-side gate would drop it, so a failure must degrade to the
   * PNG placeholder — the caller treats `undefined` as "leave the value unset"
   * (the chain then reads `null` and the delivery falls back to `restore`).
   */
  async renderForResolution(recipe: RecipeInput): Promise<string | undefined> {
    const direct = await this.renderPngOrUndefined(recipe);
    if (direct) return direct;
    // The real recipe failed → the PNG placeholder (never an SVG).
    return this.renderPngOrUndefined(RECIPE_PLACEHOLDER);
  }

  /**
   * The memoized render, expressed as `string | undefined` instead of the
   * string-returning `renderToPng` (which needs a caller-owned fallback).
   */
  private async renderPngOrUndefined(recipe: RecipeInput): Promise<string | undefined> {
    const signature = recipeSignature(recipe);

    const memo = this.repo.getRecipeResolution(signature);
    if (memo !== undefined) return memo ?? undefined;

    try {
      const rendered = await this.drawPng(recipe);
      this.repo.cacheRecipeResolution(signature, rendered);
      return rendered;
    } catch {
      this.repo.cacheRecipeResolution(signature, null);
      return undefined;
    }
  }

  private async drawPng(recipe: RecipeInput): Promise<string> {
    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas unavailable');
    }

    const canvas = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');

    const radius = Math.round(CANVAS_SIZE * 0.1875); // 12px at 128
    roundRectPath(ctx, CANVAS_SIZE, radius);

    const bgColor = recipe.backgroundColor ?? DEFAULT_BG;
    ctx.fillStyle = bgColor;
    ctx.fill();

    const text = recipe.text ?? '';
    if (text) {
      const textColor = recipe.textColor ?? autoTextColor(bgColor);
      ctx.fillStyle = textColor;
      const fontSize = text.length > 2
        ? Math.round(CANVAS_SIZE * 0.3125)
        : Math.round(CANVAS_SIZE * 0.5);
      ctx.font = `${String(fontSize)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, CANVAS_SIZE / 2, CANVAS_SIZE / 2 + CANVAS_SIZE * 0.03);
    }

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blobToDataUri(blob);
  }
}