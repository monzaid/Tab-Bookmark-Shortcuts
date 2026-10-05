/**
 * T4 — icon value classification (export-side foundation).
 *
 * Export must re-identify what a stored icon value actually is, because
 * `getSyncState()` already dereferences offloaded icons to data URIs. The
 * classifier is the discriminant: URL stays a URL, a bare `local-icon:` ref is
 * a portable local-ref, an uploaded bitmap is a data-uri, and the retired
 * `[local:…]` wrapper is explicitly NOT a reference (C2 — it never matched
 * `startsWith('local-icon:')` and must never be produced or accepted again).
 */
import { describe, it, expect } from 'vitest';
import { classifyIconValue } from '@shared/icon-ref';

describe('T4: classifyIconValue', () => {
  it('classifies http(s) URLs as url', () => {
    expect(classifyIconValue('http://x/a.png')).toBe('url');
    expect(classifyIconValue('https://cdn.example.com/favicon.ico')).toBe('url');
  });

  it('classifies a bare local-icon: reference as local-ref', () => {
    expect(classifyIconValue('local-icon:icon:slot-3')).toBe('local-ref');
    expect(classifyIconValue('local-icon:icon:rule-1')).toBe('local-ref');
  });

  it('classifies the retired [local:…] wrapper as unknown (never a reference)', () => {
    expect(classifyIconValue('[local:local-icon:icon:slot-3]')).toBe('unknown');
    expect(classifyIconValue('[local:data:image/png;base64,AAA]')).toBe('unknown');
  });

  it('classifies data URIs as data-uri (uploaded bitmap)', () => {
    expect(classifyIconValue('data:image/png;base64,iVBORw0KGgo=')).toBe('data-uri');
    expect(classifyIconValue('data:image/webp;base64,AAAA')).toBe('data-uri');
  });

  it('classifies anything else as unknown', () => {
    expect(classifyIconValue('')).toBe('unknown');
    expect(classifyIconValue('just some text')).toBe('unknown');
    expect(classifyIconValue('ftp://x/a.png')).toBe('unknown');
  });
});