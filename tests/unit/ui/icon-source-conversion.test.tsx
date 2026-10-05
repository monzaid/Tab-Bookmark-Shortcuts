/**
 * T7 — recipe persistence via a single `iconConfigToIconSource` converter.
 *
 * Before: all three write paths rendered the composite icon to a canvas data
 * URI and stored `{ type:'upload' }`, silently discarding the recipe
 * (background/text/text colour). C1 requires the recipe itself to persist, with
 * the rendered form used only as a display cache.
 */
import { describe, it, expect } from 'vitest';
import { iconConfigToIconSource, iconDraftToIconSource } from '@ui/shared/icon-source';

describe('T7: iconDraftToIconSource (editor draft → persisted IconSource)', () => {
  it('persists a custom recipe as type:template, never a rendered data URI', () => {
    const src = iconDraftToIconSource({
      mode: 'custom',
      value: 'data:image/png;base64,RENDERED_CACHE',
      iconConfig: { bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF' },
    });
    expect(src).toEqual({ type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' });
  });

  it('keeps a real upload as type:upload', () => {
    const src = iconDraftToIconSource({ mode: 'upload', value: 'data:image/png;base64,REAL' });
    expect(src).toEqual({ type: 'upload', value: 'data:image/png;base64,REAL' });
  });

  it('keeps a non-empty URL as type:url and trims it', () => {
    expect(iconDraftToIconSource({ mode: 'url', value: '  https://a.example/i.png  ' }))
      .toEqual({ type: 'url', value: 'https://a.example/i.png' });
  });

  it('maps a blank URL / blank upload / use-chain to null (clear the layer)', () => {
    expect(iconDraftToIconSource({ mode: 'url', value: '   ' })).toBeNull();
    expect(iconDraftToIconSource({ mode: 'upload', value: '' })).toBeNull();
    expect(iconDraftToIconSource({ mode: 'use-chain', value: '' })).toBeNull();
  });

  it('maps an empty custom recipe (no upload/bg/text) to null, not a fake template', () => {
    expect(iconDraftToIconSource({ mode: 'custom', value: '', iconConfig: {} })).toBeNull();
  });
});

describe('T7: iconConfigToIconSource', () => {
  it('persists a full recipe as type:template (not upload)', () => {
    const src = iconConfigToIconSource({ bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF' });
    expect(src.type).toBe('template');
    expect(src.backgroundColor).toBe('#2563EB');
    expect(src.text).toBe('A');
    expect(src.textColor).toBe('#FFFFFF');
    expect(src.value).not.toContain('data:');
  });

  it('keeps a real upload as type:upload (no false recipe)', () => {
    const src = iconConfigToIconSource({ dataUri: 'data:image/png;base64,AAAA' });
    expect(src.type).toBe('upload');
    expect(src.value).toBe('data:image/png;base64,AAAA');
  });

  it('does not emit an upload-shaped data URI for a recipe input', () => {
    const src = iconConfigToIconSource({ bgColor: '#000000', text: 'B' });
    const asUpload = src.type === 'upload' && typeof src.value === 'string' && src.value.startsWith('data:');
    expect(asUpload).toBe(false);
  });

  it('carries an absent textColor as undefined (no silent default filled)', () => {
    const src = iconConfigToIconSource({ bgColor: '#000000', text: 'C' });
    expect(src.textColor).toBeUndefined();
  });
});