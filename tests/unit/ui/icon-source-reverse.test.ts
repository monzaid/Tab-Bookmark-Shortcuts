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
import { iconSourceToIconConfig, iconSourceToDraft } from '@ui/shared/icon-source';
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

  it('maps a URL (the previously missing branch)', () => {
    // v1 had no `url` branch and silently returned {} — a url icon reopened blank.
    expect(iconSourceToIconConfig({ type: 'url', value: 'https://x.example/i.png' }))
      .toEqual({ url: 'https://x.example/i.png' });
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

  it('a URL becomes mode:url', () => {
    expect(iconSourceToDraft({ type: 'url', value: 'https://x.example/i.png' }))
      .toEqual({ mode: 'url', value: 'https://x.example/i.png' });
  });
});