import { describe, it, expect } from 'vitest';
import { PROTECTED_URL_PREFIXES } from '@shared/protected-prefixes.generated';
import { isProtectedUrl } from '@shared/url-utils';

/**
 * T3: `file://` must be part of the canonical protected-prefix list so that the
 * recovery window's "Open URL" path (C2 fix, T6) intercepts local-file URLs.
 * Source of truth: scripts/gen-protected-prefixes.mjs (regenerated, never
 * hand-edited).
 */
describe('T3: file:// is a canonical protected prefix', () => {
  it('PROTECTED_URL_PREFIXES contains file://', () => {
    expect(PROTECTED_URL_PREFIXES).toContain('file://');
  });

  it('isProtectedUrl recognises file:// URLs', () => {
    expect(isProtectedUrl('file:///etc/passwd')).toBe(true);
  });

  it('negative control: an ordinary https URL stays unprotected', () => {
    expect(isProtectedUrl('https://example.com')).toBe(false);
  });

  it('negative control: a chrome-extension URL stays protected', () => {
    expect(isProtectedUrl('chrome-extension://abcdef/page.html')).toBe(true);
  });
});