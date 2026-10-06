/**
 * Adapter between the two icon value models in the codebase.
 *
 * `FieldEditor` speaks the compact `FieldMode` model (`set | use-chain`) plus a
 * separate `iconConfig`, because that is what the rule/dashboard drafts already
 * store. `IconFieldEditor` speaks the richer `IconFieldValue` model, because a
 * standalone icon picker must distinguish Icon URL / Upload / Custom Icon.
 *
 * Converting in ONE place keeps the two representations from drifting: the
 * "Custom Icon renders to a data URI" rule and the "upload IS a data URI" rule
 * are decided here and nowhere else.
 */

import type { FieldMode } from './field-editor';
import type { IconConfig } from '@ui/components/IconEditor';
import type { IconFieldValue } from './icon-field-editor';

/** `FieldMode` + `iconConfig` → the standalone picker's value. */
export function toIconFieldValue(mode: FieldMode, iconConfig?: IconConfig): IconFieldValue {
  if (mode.kind === 'use-chain') return { mode: 'use-chain', value: '' };
  // A composite config means the Custom Icon tab produced this value; a plain
  // string is either the Icon URL text or a raw `data:` upload.
  //
  // ⚠️ Any config ⇒ `custom`, including an upload's `{ dataUri }`. So a draft
  // seeded from an UPLOAD source displays the Custom tab while persisting as
  // `type:'upload'` (the config is what `resolveDraftFavicon` keys off). That
  // view/storage split is a known cosmetic imperfection in the dual-model
  // editor; the STORAGE type is the contract, and tests assert that, not the tab.
  if (iconConfig) return { mode: 'custom', value: mode.value, iconConfig };
  if (mode.value.startsWith('data:')) return { mode: 'upload', value: mode.value };
  return { mode: 'url', value: mode.value };
}

/** The standalone picker's value → `FieldMode` + `iconConfig`. */
export function fromIconFieldValue(value: IconFieldValue): { mode: FieldMode; iconConfig?: IconConfig } {
  switch (value.mode) {
    case 'use-chain':
      return { mode: { kind: 'use-chain' } };
    case 'url':
      return { mode: { kind: 'set', value: value.value } };
    case 'upload':
      // An upload is already a data URI; it is carried as the set value so the
      // save path stores it verbatim.
      return { mode: { kind: 'set', value: value.value } };
    case 'custom':
      return {
        mode: { kind: 'set', value: value.iconConfig?.dataUri ?? value.value },
        ...(value.iconConfig ? { iconConfig: value.iconConfig } : {}),
      };
  }
}