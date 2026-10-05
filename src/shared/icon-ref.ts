/**
 * Icon reference helpers — export-side value classification.
 *
 * `getSyncState()` dereferences offloaded icons to data URIs on every read
 * (storage-repository `resolveIconReferences`). Export therefore has to
 * re-identify what a stored value actually is before it can be carried in a
 * portable package (C2: "dereference + bare-send").
 */

/** The single reference prefix the storage layer understands (`ICON_REF_PREFIX`). */
export const LOCAL_ICON_REF_PREFIX = 'local-icon:';

/**
 * What a stored icon value actually is.
 *
 * - `url`       — an `http(s)` URL, carried as-is in the package.
 * - `local-ref` — a BARE `local-icon:<key>` reference (portable; the consumer
 *                 decides whether it resolves or is "missing").
 * - `data-uri`  — an uploaded bitmap (the dereferenced form of a local-ref).
 * - `unknown`   — anything else, including the retired `[local:…]` wrapper.
 */
export type IconValueKind = 'url' | 'local-ref' | 'data-uri' | 'unknown';

/**
 * Classify a raw stored icon value.
 *
 * The `[local:…]` wrapper is deliberately `unknown`: it never matched
 * `startsWith('local-icon:')`, so it could never resolve — treating it as a
 * reference would produce a "fake resolution". The wrapper is not produced
 * anymore (no back-compat, G1) and must not be accepted.
 */
export function classifyIconValue(rawValue: string): IconValueKind {
  if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) return 'url';
  if (rawValue.startsWith(LOCAL_ICON_REF_PREFIX)) return 'local-ref';
  if (rawValue.startsWith('data:')) return 'data-uri';
  return 'unknown';
}