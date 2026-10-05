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

import type {
  IconSource,
  PageRule,
  SlotDefinition,
  TabOverride,
} from '@shared/types';
import type { TierOwner } from '@shared/field-chain';
import type { IconConfig } from '@ui/components/IconEditor';
import type { IconFieldValue } from '@ui/shared/icon-field-editor';

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
    // FIX-C: dispatch on `type`, NEVER on the value's shape. A materialized
    // recipe's `value` is a `data:image/png` URI (R2/FIX-B), so a prefix guess
    // would misclassify it as an upload and destroy the recipe on re-save.
    return { bgColor: source.backgroundColor, text: source.text, textColor: source.textColor };
  }
  if (source.type === 'url') return { url: source.value };
  return {};
}

/**
 * FIX-C: the SINGLE source-aware reverse boundary.
 *
 * Every place that already holds an `IconSource` (a stored rule/slot/override
 * value) must seed the editor through THIS, not through a `data:`-prefix guess.
 * `IconFieldValue` has no `type`, so the guess can never recover a recipe.
 */
export function iconSourceToDraft(source: IconSource): IconFieldValue {
  switch (source.type) {
    case 'template':
      // `mode:'custom'` WITHOUT `dataUri` — that is what makes the round-trip
      // re-persist a recipe instead of an upload. `value` is only the display
      // cache and is never what the write path reads for a custom icon.
      return { mode: 'custom', value: source.value, iconConfig: iconSourceToIconConfig(source) };
    case 'upload':
      return { mode: 'upload', value: source.value };
    case 'url':
      return { mode: 'url', value: source.value };
  }
}

/**
 * FIX-A: the CANONICAL (persistable) form of an icon source.
 *
 * A source read through the repository may be MATERIALIZED — a recipe's `value`
 * is the rendered PNG (R2/FIX-B). That render is a display cache; the recipe
 * fields are the durable truth (C1). Anything that will be persisted or replayed
 * must normalize `template` back to `value:''`, otherwise the derived render
 * becomes the stored value.
 *
 * Deliberately a direct spread-and-clear: a `iconSourceToIconConfig` round-trip
 * would damage a `url` source (it has no config carrier).
 */
export function canonicalIconSource(source: IconSource): IconSource {
  if (source.type === 'template' && source.value !== '') {
    return { ...source, value: '' };
  }
  return source;
}

/** FIX-C: everything `iconSourceForOwner` may need to resolve an owner to a source. */
export interface OwnerSourceContext {
  slots?: ReadonlyArray<SlotDefinition>;
  rules?: ReadonlyArray<PageRule>;
  tabOverrides?: ReadonlyArray<TabOverride>;
}

/**
 * FIX-C: resolve a chain owner (or a dashboard row's kind+id) to the ACTUAL
 * stored `IconSource`, so a seeding surface can use the source-aware boundary
 * instead of guessing a mode from a materialized value.
 *
 * ONE implementation, reused by every seeding path — a per-surface copy would
 * drift, which is the whole class of defect this iteration is removing.
 */
export function iconSourceForOwner(
  owner: TierOwner | null | undefined,
  ctx: OwnerSourceContext,
): IconSource | null {
  if (!owner) return null;
  switch (owner.kind) {
    case 'override':
      return ctx.tabOverrides?.find((o) => o.tabId === owner.tabId)?.favicon ?? null;
    case 'slot':
      return ctx.slots?.find((s) => s.id === owner.slotId)?.uiMarker.icon ?? null;
    case 'rule':
      return ctx.rules?.find((r) => r.id === owner.ruleId)?.favicon ?? null;
    case 'site':
      return null;
  }
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