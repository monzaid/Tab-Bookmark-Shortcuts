/**
 * IconPreview — the ONE way an import/export panel shows an icon.
 *
 * The two panels see the same icon through two different shapes:
 *   - the EXPORT panel reads `SyncState` through `GET_STATE`, where the storage
 *     layer has already dereferenced every `local-icon:` reference into a real
 *     data URI (so a URL is directly displayable);
 *   - the IMPORT panel reads the PACKAGE, where an icon is a `PortableIcon` —
 *     a URL, a BARE `local-icon:` reference, or a recipe (three colour/text
 *     values, not a bitmap yet).
 *
 * Both must LOOK the same, so both are normalised into `IconPreviewSource` and
 * drawn by this component. The alternative — an `<img>` in one panel and a
 * canvas in the other — is how the same icon ends up looking like two icons.
 *
 * A `reference` that cannot be resolved is drawn as the same neutral placeholder
 * the "no icon" case uses. It is deliberately NOT an error: a reference is a
 * legitimate transfer form whose bitmap lives on the SOURCE machine, and the
 * import result already reports such icons as "needs re-selection".
 */

import { useMemo } from 'react';
import type { IconConfig } from '@ui/components/IconEditor';
import { renderIconToDataUri } from '@ui/components/IconEditor';

// ─── Normalised source ───────────────────────────────────────────────────────

export type IconPreviewSource =
  /** A URL or data URI — already an image. */
  | { kind: 'image'; value: string }
  /** A recipe (template icon): three values this module renders to a bitmap. */
  | { kind: 'recipe'; bgColor: string; text: string; textColor: string }
  /** A bare `local-icon:<key>` reference, resolvable only with outside help. */
  | { kind: 'reference'; key: string }
  /** Nothing to draw. */
  | { kind: 'none' };

/** The neutral placeholder glyph. Text, not colour alone (WCAG: never colour-only). */
const PLACEHOLDER = '◇';

export interface IconPreviewProps {
  source: IconPreviewSource;
  /** Rendered square size in px. Callers pass 16 to match the existing icon column. */
  size?: number;
  /**
   * Optional resolver for a `reference` source, supplied by the caller that
   * actually has the bitmaps (the export panel passes the dereferenced
   * `GET_STATE` values). Returning `undefined` means "unresolvable here".
   */
  resolveReference?: (key: string) => string | undefined;
  /** Accessible name. Icons are decorative next to a text label → `''` is fine. */
  alt?: string;
}

export function IconPreview({
  source,
  size = 16,
  resolveReference,
  alt = '',
}: IconPreviewProps) {
  /**
   * Recipe rendering is the expensive branch (canvas → PNG), so it is memoised
   * on the three colour/text values. `renderIconToDataUri` returns
   * `config.dataUri` unchanged for the image case, but that case never reaches
   * here.
   */
  const recipeUri = useMemo(() => {
    if (source.kind !== 'recipe') return null;
    const config: IconConfig = {
      bgColor: source.bgColor,
      text: source.text,
      textColor: source.textColor,
    };
    return renderIconToDataUri(config, size * 2);
  }, [source, size]);

  const imageUri =
    source.kind === 'image'
      ? source.value
      : source.kind === 'reference'
        ? resolveReference?.(source.key)
        : null;

  const uri = imageUri ?? recipeUri;

  if (!uri) {
    return (
      <span
        className="tbs-icon-preview tbs-icon-preview--empty"
        style={{ width: size, height: size }}
        aria-hidden="true"
        title="No icon"
      >
        {PLACEHOLDER}
      </span>
    );
  }

  return (
    <img
      className="tbs-icon-preview"
      src={uri}
      alt={alt}
      style={{ width: size, height: size }}
      // A broken URL must not leave a half-drawn image: fall back to the same
      // neutral glyph the empty case uses, so the row still reads as "no icon"
      // rather than as a rendering bug.
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

// ─── Builders (the two shapes the panels actually hold) ─────────────────────

/**
 * A `PortableIcon` (the package's carried form) as a preview source.
 *
 * A `local-ref` facet carries only the KEY, so nothing can be drawn from it
 * directly — the caller may still supply a resolver. `undefined` means "the
 * record sets no icon".
 */
export function previewFromPortable(icon: {
  kind: 'url' | 'local-ref' | 'recipe';
  url?: string;
  ref?: string;
  bgColor?: string;
  text?: string;
  textColor?: string;
} | undefined | null): IconPreviewSource {
  if (!icon) return { kind: 'none' };
  switch (icon.kind) {
    case 'url':
      return icon.url ? { kind: 'image', value: icon.url } : { kind: 'none' };
    case 'local-ref':
      return icon.ref ? { kind: 'reference', key: icon.ref } : { kind: 'none' };
    case 'recipe':
      return {
        kind: 'recipe',
        bgColor: icon.bgColor ?? '',
        text: icon.text ?? '',
        textColor: icon.textColor ?? '',
      };
  }
}

/**
 * A stored `IconSource` as a preview source — the EXPORT panel's case.
 *
 * The storage read path has already dereferenced a `local-icon:` reference into
 * a data URI and materialised a recipe's `value`, so:
 *   - `url`      → the URL itself;
 *   - `upload`   → the data URI (already resolved);
 *   - `template` → a recipe, rendered from its three values (the materialised
 *                  `value` is a derived bitmap and must NOT be displayed as if
 *                  it were the recipe — R2: derived values never become truth).
 */
export function previewFromIconSource(icon: {
  type: 'url' | 'upload' | 'template';
  value: string;
  backgroundColor?: string;
  text?: string;
  textColor?: string;
} | null | undefined): IconPreviewSource {
  if (!icon) return { kind: 'none' };
  if (icon.type === 'template') {
    return {
      kind: 'recipe',
      bgColor: icon.backgroundColor ?? '',
      text: icon.text ?? '',
      textColor: icon.textColor ?? '',
    };
  }
  return icon.value ? { kind: 'image', value: icon.value } : { kind: 'none' };
}

/**
 * An `ImportFieldValue` as a preview source — the diff-row case.
 *
 * `text` is not an icon (a title facet), so it yields `none`: the caller only
 * asks for a preview when it is drawing the `icon` facet.
 */
export function previewFromFieldValue(value: {
  kind: 'text' | 'url' | 'local-ref' | 'recipe';
  value?: string;
  key?: string;
  bgColor?: string;
  text?: string;
  textColor?: string;
} | null): IconPreviewSource {
  if (!value) return { kind: 'none' };
  switch (value.kind) {
    case 'url':
      return value.value ? { kind: 'image', value: value.value } : { kind: 'none' };
    case 'local-ref':
      return value.key ? { kind: 'reference', key: value.key } : { kind: 'none' };
    case 'recipe':
      return {
        kind: 'recipe',
        bgColor: value.bgColor ?? '',
        text: value.text ?? '',
        textColor: value.textColor ?? '',
      };
    case 'text':
      return { kind: 'none' };
  }
}