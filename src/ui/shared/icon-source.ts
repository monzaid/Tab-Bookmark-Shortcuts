/**
 * Icon config → persisted `IconSource` conversion (T7 / C1).
 *
 * All icon-editing surfaces used to render the composite icon to a canvas data
 * URI and store `{ type: 'upload', value: dataUri }`, which discarded the recipe
 * (background / text / text colour) — the rendered pixels became the only truth.
 *
 * C1/A6 flip that: the RECIPE is the durable truth (`type: 'template'`), and the
 * rendered form is only a display cache. A real user upload stays `upload`.
 */

import type { IconSource } from '@shared/types';
import type { IconConfig } from '@ui/components/IconEditor';

/**
 * Single converter used by every write path (sidebar / rule form / settings).
 *
 * - a real upload (`config.dataUri`) → `{ type: 'upload', value }`;
 * - otherwise a recipe → `{ type: 'template', backgroundColor, text, textColor }`.
 *
 * The recipe branch deliberately does NOT call `renderIconToDataUri` — rendering
 * is the background's job (R1: `OffscreenCanvas` → PNG, single renderer), not a
 * UI persistence concern.
 */
export function iconConfigToIconSource(config: IconConfig): IconSource {
  if (config.dataUri) {
    return { type: 'upload', value: config.dataUri };
  }

  return {
    type: 'template',
    value: '',
    backgroundColor: config.bgColor,
    text: config.text,
    textColor: config.textColor,
  };
}

/**
 * Reverse: a persisted `IconSource` → the editor's `IconConfig` view model, so an
 * existing recipe reopens with its background/text/colour intact.
 */
export function iconSourceToIconConfig(source: IconSource | null | undefined): IconConfig {
  if (!source) return {};
  if (source.type === 'upload') return { dataUri: source.value };
  if (source.type === 'template') {
    return { bgColor: source.backgroundColor, text: source.text, textColor: source.textColor };
  }
  return {};
}

/**
 * The draft-level view model produced by `IconFieldEditor` (T7).
 *
 * `iconConfig` carries the recipe/upload; `value` is only a display cache (the
 * rendered data URI), never the persisted truth.
 */
export interface IconDraftValue {
  mode: 'url' | 'upload' | 'custom' | 'use-chain';
  value: string;
  iconConfig?: IconConfig;
}

/**
 * Map an editor draft to the `IconSource` to persist (T7 / C1).
 *
 * Returns `null` for "clear this layer" (blank URL, blank upload, or `use-chain`)
 * — the write path reads `null` as "remove the icon so the chain falls through".
 * A non-empty URL stays a `url`; an upload stays `upload`; a custom icon persists
 * the RECIPE as `type:'template'` (never a rendered data URI) unless it is a real
 * upload, in which case `iconConfigToIconSource` keeps it as `upload`.
 */
export function iconDraftToIconSource(draft: IconDraftValue): IconSource | null {
  if (draft.mode === 'url') {
    const url = draft.value.trim();
    return url ? { type: 'url', value: url } : null;
  }
  if (draft.mode === 'upload') {
    return draft.value ? { type: 'upload', value: draft.value } : null;
  }
  if (draft.mode === 'custom') {
    const config = draft.iconConfig;
    if (!config) return null;
    const source = iconConfigToIconSource(config);
    // An empty recipe (no upload, no background, no text) is not a real icon.
    if (source.type === 'upload') return source;
    if (source.backgroundColor !== undefined || (source.text ?? '') !== '') return source;
    return null;
  }
  return null;
}