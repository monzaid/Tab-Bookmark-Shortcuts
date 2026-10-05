/**
 * T2 — IconSource.textColor + import intent / diff types.
 *
 * C1 requires a recipe to carry its text colour, but `IconSource` had no
 * `textColor` field (the editor config did). `type: 'template'` was never
 * produced before either — it becomes the recipe carrier.
 *
 * `ImportIntent` (A1/A4) is what makes "the server can fully recompute" true:
 * one mode per dimension (default `incremental`) plus a SPARSE set of per-record
 * overrides.
 */
import { describe, it, expect } from 'vitest';
import type { IconSource } from '@shared/types';
import { defaultImportIntent } from '@shared/types';

describe('T2: IconSource.textColor + import intent types', () => {
  it('allows a template IconSource to carry a full recipe (bg/text/textColor)', () => {
    const src: IconSource = {
      type: 'template',
      value: '',
      backgroundColor: '#2563EB',
      text: 'A',
      textColor: '#FFFFFF',
    };
    expect(src.textColor).toBe('#FFFFFF');
    expect(src.backgroundColor).toBe('#2563EB');
    expect(src.text).toBe('A');
  });

  it('keeps textColor optional (absent is a valid recipe)', () => {
    const src: IconSource = { type: 'template', value: '', backgroundColor: '#000', text: 'B' };
    expect(src.textColor).toBeUndefined();
  });

  it('defaultImportIntent() defaults every dimension to incremental', () => {
    const intent = defaultImportIntent();
    expect(intent.dimensionModes).toEqual({
      slots: 'incremental',
      rules: 'incremental',
      settings: 'incremental',
      shortcuts: 'incremental',
    });
  });

  it('defaultImportIntent() leaves recordOverrides sparse (undefined)', () => {
    const intent = defaultImportIntent();
    expect(intent.recordOverrides).toBeUndefined();
  });
});