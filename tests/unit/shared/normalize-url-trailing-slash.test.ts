/**
 * T2 / RK-2 — `normalizeUrl` trailing-slash equivalence, with a BEFORE/AFTER
 * comparison against the HEAD `a3d6ab3` implementation.
 *
 * RISK (RK-2): treating a trailing slash as equivalent WIDENS the published
 * match surface — an `exact` rule for `https://a.com/page` will now also match
 * `https://a.com/page/`. This file pins the change by asserting that the ONLY
 * difference between the old and new implementations is exactly "a non-root
 * trailing slash was removed"; nothing else (query order, casing, hash, port,
 * root path) moved.
 *
 * The old implementation is inlined here (a verbatim copy of the HEAD version)
 * so the comparison is self-contained and the production code stays untouched.
 */
import { describe, it, expect } from 'vitest';
import { normalizeUrl, urlsMatch } from '@shared/url-utils';

/** Verbatim copy of `normalizeUrl` at HEAD `a3d6ab3` (pre-E5-a behaviour). */
function normalizeUrlBeforeTrailingSlash(raw: string): string {
  try {
    const url = new URL(raw);
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const port = url.port;
    if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
      url.port = '';
    }
    const path = url.pathname;
    const query = url.search;
    const portStr = url.port ? `:${url.port}` : '';
    return `${protocol}//${host}${portStr}${path}${query}`;
  } catch {
    return raw;
  }
}

/** The single intended delta between the two implementations. */
function expectedNewValue(oldValue: string): string {
  // Remove exactly one trailing slash from a non-root path of the normalized
  // output (the normalized output always has an origin + path).
  const match = /^([a-z]+:\/\/[^/]*)(\/.*)$/.exec(oldValue);
  if (!match) return oldValue;
  const [, origin, pathAndQuery] = match;
  const qIdx = pathAndQuery.indexOf('?');
  const path = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery;
  const rest = qIdx >= 0 ? pathAndQuery.slice(qIdx) : '';
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return `${origin}${trimmed}${rest}`;
}

const INPUTS = [
  'https://a.com/page/',
  'https://a.com/page',
  'https://a.com/page//',
  'https://a.com/',
  'https://a.com',
  'https://a.com/page/?x=1',
  'https://a.com/page?x=1',
  'https://a.com/page/?b=2&a=1',
  'https://a.com/page/#frag',
  'HTTPS://A.COM:443/Page/',
  'http://a.com:80/page/',
  'https://a.com/a/b/c/',
  'not a url',
  '',
];

describe('T2: normalizeUrl trailing slash equivalence', () => {
  it('treats a non-root trailing slash as equivalent', () => {
    expect(normalizeUrl('https://a.com/page/')).toBe(normalizeUrl('https://a.com/page'));
  });

  it('still honours the query string order', () => {
    expect(normalizeUrl('https://a.com/page/?x=1')).toBe(normalizeUrl('https://a.com/page?x=1'));
    expect(normalizeUrl('https://a.com/page/?b=2&a=1')).toBe('https://a.com/page?b=2&a=1');
  });

  it('keeps the root path stable at "/" (E5-a, never de-slashed)', () => {
    expect(normalizeUrl('https://a.com')).toBe('https://a.com/');
    expect(normalizeUrl('https://a.com/')).toBe('https://a.com/');
  });

  it('removes only ONE trailing slash', () => {
    expect(normalizeUrl('https://a.com/page//')).toBe('https://a.com/page/');
  });

  it('ignores the hash', () => {
    expect(normalizeUrl('https://a.com/page/#frag')).toBe('https://a.com/page');
  });

  it('still lowercases host and drops the default port', () => {
    expect(normalizeUrl('HTTPS://A.COM:443/Page/')).toBe('https://a.com/Page');
    expect(normalizeUrl('http://a.com:80/page/')).toBe('http://a.com/page');
  });

  it('returns an invalid URL unchanged', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
    expect(normalizeUrl('')).toBe('');
  });

  describe('before/after comparison (RK-2 — the delta is exactly trailing slash)', () => {
    for (const input of INPUTS) {
      it(`delta is exact for ${JSON.stringify(input)}`, () => {
        const before = normalizeUrlBeforeTrailingSlash(input);
        const after = normalizeUrl(input);
        expect(after).toBe(expectedNewValue(before));
      });
    }
  });

  it('widens exact matching for a non-root path (the published-semantics change)', () => {
    // BEFORE: these did NOT match. AFTER: they do. This is the single accepted
    // widening — the assertion documents it rather than hiding it.
    expect(normalizeUrlBeforeTrailingSlash('https://a.com/page/')).not.toBe(
      normalizeUrlBeforeTrailingSlash('https://a.com/page'),
    );
    expect(urlsMatch('https://a.com/page/', 'https://a.com/page')).toBe(true);
  });

  it('does not widen the root path', () => {
    expect(urlsMatch('https://a.com', 'https://a.com/')).toBe(true);
    expect(normalizeUrl('https://a.com') === 'https://a.com').toBe(false);
  });
});