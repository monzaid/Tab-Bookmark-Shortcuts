/**
 * FIX-C — the reverse boundaries must be SOURCE-AWARE, never prefix-guessing.
 *
 * The editor models (`FieldMode` / `IconFieldValue`) carry no `type`, so the
 * legacy `toIconFieldValue` can only guess from a `data:` prefix. A materialized
 * recipe's `value` IS a `data:image/png` URI (R2/FIX-B), so prefix-guessing
 * classified a recipe as a real UPLOAD — and an open-editor → Apply round-trip
 * then PERSISTED it as `type:'upload'`, destroying the recipe (C1: the recipe is
 * the single durable truth; the render is only a display cache).
 *
 * These functions are the source-aware boundary: given the actual `IconSource`,
 * dispatch on `type` and NEVER infer from the value.
 */
import { describe, it, expect } from 'vitest';
import { canonicalIconSource, iconSourceForOwner, iconSourceToIconConfig, iconSourceToDraft } from '@ui/shared/icon-source';
import { fromIconFieldValue } from '@ui/shared/icon-mode-adapter';
import { resolveDraftFavicon } from '@ui/shared/rule-form-submit';
import type { IconSource } from '@shared/types';

const RECIPE: IconSource = {
  type: 'template',
  value: '', // the DURABLE form (R2/FIX-B keep the render out of storage)
  backgroundColor: '#2563EB',
  text: 'A',
  textColor: '#FFFFFF',
};

// The same recipe as it arrives from a READ boundary (value materialized).
const RECIPE_MATERIALIZED: IconSource = { ...RECIPE, value: 'data:image/png;base64,AAAA' };

describe('FIX-C: iconSourceToIconConfig', () => {
  it('maps a recipe to the composer config, never to dataUri', () => {
    expect(iconSourceToIconConfig(RECIPE)).toEqual({
      bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF',
    });
  });

  it('a MATERIALIZED recipe is still a recipe (not an upload)', () => {
    const config = iconSourceToIconConfig(RECIPE_MATERIALIZED);
    expect(config).toEqual({ bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF' });
    expect(config.dataUri).toBeUndefined(); // the whole point
  });

  it('maps an upload to dataUri', () => {
    expect(iconSourceToIconConfig({ type: 'upload', value: 'data:image/png;base64,UP' }))
      .toEqual({ dataUri: 'data:image/png;base64,UP' });
  });

  it('gives a URL source no config (it is carried by `iconSourceToDraft`, not a config field)', () => {
    // A url has no composer config; the REAL carrier is `iconSourceToDraft`'s
    // `mode:'url'` branch (asserted below). Adding a config `url` field would be
    // a field with no writer and no reader.
    expect(iconSourceToIconConfig({ type: 'url', value: 'https://x.example/i.png' })).toEqual({});
  });
});

describe('FIX-C: iconSourceToDraft', () => {
  it('a recipe becomes mode:custom WITHOUT dataUri (so it re-persists as a recipe)', () => {
    const draft = iconSourceToDraft(RECIPE_MATERIALIZED);
    expect(draft.mode).toBe('custom');
    expect(draft.iconConfig).toEqual({ bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF' });
    expect(draft.iconConfig?.dataUri).toBeUndefined();
  });

  it('an upload becomes mode:upload', () => {
    expect(iconSourceToDraft({ type: 'upload', value: 'data:image/png;base64,UP' }))
      .toEqual({ mode: 'upload', value: 'data:image/png;base64,UP' });
  });

  it('a URL becomes mode:url (the real carrier for a url source)', () => {
    expect(iconSourceToDraft({ type: 'url', value: 'https://x.example/i.png' }))
      .toEqual({ mode: 'url', value: 'https://x.example/i.png' });
  });

  it('a MATERIALIZED recipe is still a recipe through iconSourceToDraft', () => {
    const draft = iconSourceToDraft(RECIPE_MATERIALIZED);
    expect(draft.mode).toBe('custom');
    expect(draft.iconConfig).toEqual({ bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF' });
  });
});

describe('FIX-C: seed → apply round-trip preserves the recipe (the defect this closes)', () => {
  it('a materialized recipe re-persists as {type:"template", value:""} — never an upload', () => {
    // seed (what the editor opens with)
    const draft = iconSourceToDraft(RECIPE_MATERIALIZED);
    // editor → draft model → the SHARED save converter
    const { mode, iconConfig } = fromIconFieldValue(draft);
    const persisted = resolveDraftFavicon({ iconMode: mode, iconConfig });

    expect(persisted).toEqual(RECIPE); // type/value/fields ALL intact
    expect(persisted!.type).toBe('template');
    expect(persisted!.value).toBe('');
    expect(persisted!.value).not.toContain('data:'); // the render did not leak
  });

  it('the OLD prefix-guessing seed would have produced an upload (control)', () => {
    // Reproduce the removed logic to show what the fix prevented: the
    // materialized value classified as a custom/upload with a dataUri.
    const oldSeed = { mode: 'custom' as const, value: RECIPE_MATERIALIZED.value, iconConfig: { dataUri: RECIPE_MATERIALIZED.value } };
    const persisted = resolveDraftFavicon({ iconMode: { kind: 'set', value: '' }, iconConfig: oldSeed.iconConfig });
    expect(persisted!.type).toBe('upload'); // the regression the fix removes
  });
});

describe('FIX-C (i): `Use chain` of a recipe RECORD stays a recipe', () => {
  // The exact composition the "apply a chain record" sites run: the record's
  // owner resolves to the STORED source, which is canonicalized (its value may
  // be a materialized render) and then seeded source-aware.
  const ctx = {
    rules: [{ id: 'rule-1', favicon: RECIPE_MATERIALIZED }],
    slots: [{ id: 3, uiMarker: { icon: RECIPE_MATERIALIZED } }],
    tabOverrides: [{ tabId: 9, favicon: RECIPE_MATERIALIZED }],
  };

  it.each([
    ['rule', { kind: 'rule', ruleId: 'rule-1' } as const],
    ['slot', { kind: 'slot', slotId: 3 } as const],
    ['override', { kind: 'override', tabId: 9 } as const],
  ])('an applied %s record seeds a recipe draft, not an upload', (_label, owner) => {
    const source = iconSourceForOwner(owner, ctx as never);
    expect(source).not.toBeNull();

    const draft = iconSourceToDraft(canonicalIconSource(source!));
    expect(draft.mode).toBe('custom');
    expect(draft.iconConfig).toEqual({ bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF' });
    expect(draft.iconConfig?.dataUri).toBeUndefined(); // never an upload
  });

  it('a `site` owner has no stored source (falls back to the value shape)', () => {
    expect(iconSourceForOwner({ kind: 'site' }, ctx as never)).toBeNull();
  });
});