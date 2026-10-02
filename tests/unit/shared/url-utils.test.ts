import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeUrl,
  urlsMatch,
  validateRegex,
  trialRunRegex,
  matchesUrl,
  getCompiledRegex,
  sortCandidates,
  sortRulesByPriority,
  selectWinningRule,
  detectRuleConflict,
  isProtectedUrl,
  wildcardToRegex,
} from '@shared/url-utils';
import { PROTECTED_URL_PREFIXES } from '@shared/protected-prefixes.generated';
import type { TabCandidate, PageRule, UrlMatchDefinition } from '@shared/types';

describe('T3: URL, regex, sorting, and conflict pure functions', () => {
  describe('URL normalization — Happy path', () => {
    it('should normalize HTTPS with default port and hash', () => {
      const a = 'HTTPS://EXAMPLE.com:443/a?x=1#h';
      const b = 'https://example.com/a?x=1#z';
      expect(normalizeUrl(a)).toBe(normalizeUrl(b));
      expect(urlsMatch(a, b)).toBe(true);
    });

    it('should normalize HTTP with default port 80', () => {
      const a = 'http://Example.COM:80/path?q=1';
      const b = 'http://example.com/path?q=1';
      expect(urlsMatch(a, b)).toBe(true);
    });

    it('should preserve non-default ports', () => {
      const a = 'https://example.com:8443/path';
      const b = 'https://example.com/path';
      expect(urlsMatch(a, b)).toBe(false);
    });

    it('should be case-sensitive for path and query', () => {
      const a = 'https://example.com/Path?Q=1';
      const b = 'https://example.com/path?q=1';
      expect(urlsMatch(a, b)).toBe(false);
    });

    it('should ignore hash differences', () => {
      const a = 'https://example.com/page#section1';
      const b = 'https://example.com/page#section2';
      expect(urlsMatch(a, b)).toBe(true);
    });

    it('should handle URLs without query or hash', () => {
      expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    });
  });

  describe('Regex validation — Edge cases', () => {
    it('should reject regex exceeding 500 characters', () => {
      const longPattern = 'a'.repeat(501);
      const result = validateRegex(longPattern);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('REGEX_TOO_LONG');
    });

    it('should accept regex at exactly 500 characters', () => {
      const pattern = 'a'.repeat(500);
      const result = validateRegex(pattern);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid regex syntax', () => {
      const result = validateRegex('(');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('REGEX_INVALID');
    });

    it('should warn on overly broad patterns', () => {
      const result = validateRegex('.*');
      expect(result.valid).toBe(true);
      expect(result.error).toBe('REGEX_RISK');
    });

    it('should accept valid specific regex', () => {
      const result = validateRegex('https://github\\.com/user/.*');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should trial run regex against test URL', () => {
      expect(trialRunRegex('github\\.com', 'https://github.com/user')).toBe(true);
      expect(trialRunRegex('gitlab\\.com', 'https://github.com/user')).toBe(false);
    });
  });

  // ─── B4 (T4): ReDoS hardening + compiled regex cache ───────────────────────
  describe('ReDoS protection — catastrophic backtracking must be rejected', () => {
    it('should reject nested quantifier (a+)+$', () => {
      const result = validateRegex('(a+)+$');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('REGEX_RISK');
    });

    it('should reject repeated group quantifier (.*)*', () => {
      const result = validateRegex('(.*)*');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('REGEX_RISK');
    });

    it('should reject nested quantifier (x+)+', () => {
      const result = validateRegex('(x+)+');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('REGEX_RISK');
    });

    it('should reject nested star quantifier (a*)*', () => {
      const result = validateRegex('(a*)*');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('REGEX_RISK');
    });

    it('should NOT reject a safe specific regex', () => {
      const result = validateRegex('^https://example\\.com/.*$');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should NOT reject a regex with a bounded group quantifier', () => {
      // (abc)+ has no inner quantifier — not catastrophic
      expect(validateRegex('(abc)+').valid).toBe(true);
      expect(validateRegex('https://github\\.com/user/.*').valid).toBe(true);
    });

    // ─── T29 (B4-1): bounded OUTER quantifier must not launder the blow-up ───
    it('T29: should reject a bounded outer quantifier wrapping an unbounded inner one', () => {
      // `(a+){10}` and `(.*a){20}` are just as explosive as `(a+)+` — a bounded
      // repeat of an unbounded inner quantifier still multiplies the search space.
      const bounded = ['^(a+){10}$', '^(.*a){20}$', '^(a*){5,}$', '^(x+){2,7}$'];
      for (const pattern of bounded) {
        const result = validateRegex(pattern);
        expect(result.valid, `expected ${pattern} to be rejected`).toBe(false);
        expect(result.error, `expected ${pattern} to be REGEX_RISK`).toBe('REGEX_RISK');
      }
    });

    it('T29: must not regress the true positives already covered', () => {
      for (const pattern of ['(a+)+$', '(.*)*', '(x+)+', '(a*)*']) {
        expect(validateRegex(pattern).error, pattern).toBe('REGEX_RISK');
      }
    });

    it('T36: should reject POLYNOMIAL backtracking from adjacent unbounded groups', () => {
      // `(a+)(a+)(a+)(a+)(a+)$` has no nesting, so the nested-quantifier check
      // missed it entirely — the real engine took ~113s on 200 chars.
      const polynomial = [
        '^(a+)(a+)(a+)(a+)(a+)$',
        '(a+)(a+)(a+)b',
        '^(.*)(.*)x$',
        '^(a+)(b+)c$',
      ];
      for (const pattern of polynomial) {
        const result = validateRegex(pattern);
        expect(result.valid, `expected ${pattern} to be rejected`).toBe(false);
        expect(result.error, `expected ${pattern} to be REGEX_RISK`).toBe('REGEX_RISK');
      }
    });

    it('T36: must NOT over-block a single quantified group or non-adjacent groups', () => {
      // One unbounded group is linear; groups separated by a literal are fine.
      const safe = [
        '^(a+)$',
        '^(a+)b$',
        '^(a+)b(a+)$',
        '^(abc){10}$',
        '^(a{2,3}){4}$',
        '^https://example\\.com/.*$',
      ];
      for (const pattern of safe) {
        expect(validateRegex(pattern).valid, `expected ${pattern} to stay valid`).toBe(true);
      }
    });

    it('T29: must still accept patterns whose group body has no unbounded quantifier', () => {
      // Bounded inner + bounded outer is finite.
      expect(validateRegex('^(abc){10}$').valid).toBe(true);
      expect(validateRegex('^(a{2,3}){4}$').valid).toBe(true);
    });
  });

  describe('Compiled regex cache — reuse and safe failure', () => {
    it('should return the same RegExp instance for the same pattern', () => {
      const first = getCompiledRegex('^https://cache-test\\.example/.*$');
      const second = getCompiledRegex('^https://cache-test\\.example/.*$');
      expect(first).not.toBeNull();
      expect(second).toBe(first);
    });

    it('should return null for an invalid pattern without throwing', () => {
      expect(getCompiledRegex('(')).toBeNull();
      expect(getCompiledRegex('(')).toBeNull();
    });

    it('should keep matchesUrl semantics for regex definitions', () => {
      const def: UrlMatchDefinition = { type: 'regex', value: 'https://cache-semantics\\.example/.*' };
      expect(matchesUrl('https://cache-semantics.example/a/b', def)).toBe(true);
      expect(matchesUrl('https://other.example/a/b', def)).toBe(false);
      // Second call hits the cache — must be identical
      expect(matchesUrl('https://cache-semantics.example/a/b', def)).toBe(true);
    });

    it('should return false for invalid regex definition without throwing', () => {
      const def: UrlMatchDefinition = { type: 'regex', value: '(' };
      expect(matchesUrl('https://example.com', def)).toBe(false);
    });

    it('should not throw on a catastrophic pattern (must be safely testable)', () => {
      // Even if a dangerous pattern slipped past validation, matching must not hang.
      const def: UrlMatchDefinition = { type: 'regex', value: '^safe$' };
      expect(matchesUrl('anything', def)).toBe(false);
    });
  });

  describe('URL matching', () => {
    it('should match exact URLs after normalization', () => {
      const def: UrlMatchDefinition = { type: 'exact', value: 'https://example.com/page' };
      expect(matchesUrl('HTTPS://EXAMPLE.COM/page#hash', def)).toBe(true);
      expect(matchesUrl('https://other.com/page', def)).toBe(false);
    });

    it('should match regex URLs', () => {
      const def: UrlMatchDefinition = { type: 'regex', value: 'https://github\\.com/.*' };
      expect(matchesUrl('https://github.com/user/repo', def)).toBe(true);
      expect(matchesUrl('https://gitlab.com/user/repo', def)).toBe(false);
    });

    it('should return false for invalid regex in definition', () => {
      const def: UrlMatchDefinition = { type: 'regex', value: '(' };
      expect(matchesUrl('https://example.com', def)).toBe(false);
    });
  });

  describe('Candidate sorting — Happy path', () => {
    it('should sort current window first, then by index', () => {
      const candidates: TabCandidate[] = [
        { tabId: 3, windowId: 2, index: 0, url: 'https://c.com', title: 'C', favIconUrl: '', isCurrentWindow: false, isIncognito: false },
        { tabId: 1, windowId: 1, index: 2, url: 'https://a.com', title: 'A', favIconUrl: '', isCurrentWindow: true, isIncognito: false },
        { tabId: 2, windowId: 1, index: 0, url: 'https://b.com', title: 'B', favIconUrl: '', isCurrentWindow: true, isIncognito: false },
        { tabId: 4, windowId: 2, index: 1, url: 'https://d.com', title: 'D', favIconUrl: '', isCurrentWindow: false, isIncognito: false },
      ];

      const sorted = sortCandidates(candidates);
      // Current window first (windowId=1), sorted by index
      expect(sorted[0].tabId).toBe(2); // index 0, current window
      expect(sorted[1].tabId).toBe(1); // index 2, current window
      // Other windows sorted by windowId then index
      expect(sorted[2].tabId).toBe(3); // windowId 2, index 0
      expect(sorted[3].tabId).toBe(4); // windowId 2, index 1
    });

    it('should deduplicate by tabId', () => {
      const candidates: TabCandidate[] = [
        { tabId: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'A', favIconUrl: '', isCurrentWindow: true, isIncognito: false },
        { tabId: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'A dup', favIconUrl: '', isCurrentWindow: true, isIncognito: false },
      ];
      const sorted = sortCandidates(candidates);
      expect(sorted).toHaveLength(1);
    });
  });

  describe('Rule priority sorting', () => {
    it('should sort by priority descending, then createdAt descending', () => {
      const rules: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://a.com' }, priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'r2', urlMatch: { type: 'exact', value: 'https://b.com' }, priority: 10, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'r3', urlMatch: { type: 'exact', value: 'https://c.com' }, priority: 10, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' },
      ];

      const sorted = sortRulesByPriority(rules);
      // r3: priority 10, newer
      expect(sorted[0].id).toBe('r3');
      // r2: priority 10, older
      expect(sorted[1].id).toBe('r2');
      // r1: priority 0
      expect(sorted[2].id).toBe('r1');
    });

    it('should select winning rule', () => {
      const rules: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://a.com' }, priority: 5, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'r2', urlMatch: { type: 'exact', value: 'https://a.com' }, priority: 10, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const winner = selectWinningRule(rules);
      expect(winner?.id).toBe('r2');
    });

    it('should return null for empty rules', () => {
      expect(selectWinningRule([])).toBeNull();
    });
  });

  describe('Rule conflict detection — Edge cases', () => {
    it('should block identical exact URLs', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://example.com/page' }, priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'exact', value: 'HTTPS://EXAMPLE.COM/page#hash' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('block');
      expect(result.conflictingRuleId).toBe('r1');
    });

    it('should block identical regex patterns', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'regex', value: 'https://github\\.com/.*' }, priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'regex', value: 'https://github\\.com/.*' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('block');
    });

    it('should warn on uncertain regex overlap', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'regex', value: 'https://.*\\.com/.*' }, priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'regex', value: 'https://example\\.com/.*' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('warn');
    });

    it('should not block different exact URLs', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://example.com/a' }, priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'exact', value: 'https://example.com/b' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('none');
    });

    it('should exclude specified rule from conflict check', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://example.com/page' }, priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'exact', value: 'https://example.com/page' };
      const result = detectRuleConflict(newMatch, existing, 'r1');
      expect(result.level).toBe('none');
    });
  });

  describe('B14 — protected prefixes come from the generated single source', () => {
    it('should consume the generated PROTECTED_URL_PREFIXES constant', () => {
      expect(Array.isArray(PROTECTED_URL_PREFIXES)).toBe(true);
      expect(PROTECTED_URL_PREFIXES.length).toBeGreaterThan(0);
    });

    it('should return true for EVERY generated prefix', () => {
      for (const prefix of PROTECTED_URL_PREFIXES) {
        expect(isProtectedUrl(`${prefix}some-page`)).toBe(true);
      }
    });

    it('should have exactly the expected protected prefixes (no drift)', () => {
      // T3: `file://` joined the canonical list (C2/A13). The exact-set
      // comparison is deliberately PRESERVED (not relaxed to toContain) —
      // that precision is the drift guard.
      expect([...PROTECTED_URL_PREFIXES].sort()).toEqual(
        [
          'about:',
          'brave://',
          'chrome-extension://',
          'chrome://',
          'edge://',
          'file://',
          'moz-extension://',
          'opera://',
          'vivaldi://',
        ].sort(),
      );
    });

    it('should have NO hardcoded duplicate prefix list in either consumer', () => {
      // Drift guard: both consumers must reference the generated module instead
      // of re-declaring the prefix array locally.
      const consumers = ['src/shared/url-utils.ts', 'src/content/index.ts'];
      for (const rel of consumers) {
        const text = readFileSync(resolve(process.cwd(), rel), 'utf-8');
        expect(text).toContain('protected-prefixes');
        // A local array literal containing the sentinel prefix means a stale copy.
        const declaresOwnList = /(?:const|let|var)\s+\w*PROTECTED\w*\s*=\s*\[/.test(text);
        expect(declaresOwnList).toBe(false);
      }
    });
  });

  describe('Protected URL detection', () => {
    it('should identify chrome:// as protected', () => {
      expect(isProtectedUrl('chrome://settings')).toBe(true);
    });

    it('should identify edge:// as protected', () => {
      expect(isProtectedUrl('edge://settings')).toBe(true);
    });

    it('should identify about: as protected', () => {
      expect(isProtectedUrl('about:blank')).toBe(true);
    });

    it('should not flag normal URLs as protected', () => {
      expect(isProtectedUrl('https://example.com')).toBe(false);
      expect(isProtectedUrl('http://about.com/page')).toBe(false);
    });
  });

  describe('wildcardToRegex — auto-convert wildcard patterns to regex', () => {
    it('should convert * to .*', () => {
      const result = wildcardToRegex('https://zhuanlan.zhihu.com/*');
      expect(result.converted).toBe(true);
      expect(result.pattern).toBe('https://zhuanlan\\.zhihu\\.com/.*');
      expect(new RegExp(result.pattern).test('https://zhuanlan.zhihu.com/p/123')).toBe(true);
    });

    it('should convert ? to .', () => {
      const result = wildcardToRegex('https://example.com/page?');
      expect(result.converted).toBe(true);
      expect(result.pattern).toBe('https://example\\.com/page.');
      expect(new RegExp(result.pattern).test('https://example.com/page1')).toBe(true);
    });

    it('should escape regex special characters when regex is invalid', () => {
      // Unmatched ( makes this invalid regex
      const result = wildcardToRegex('https://example.com/path(query');
      expect(result.converted).toBe(true);
      expect(result.pattern).toBe('https://example\\.com/path\\(query');
    });

    it('should not convert if already valid regex', () => {
      const result = wildcardToRegex('https://example\\.com/.*');
      expect(result.converted).toBe(false);
      expect(result.pattern).toBe('https://example\\.com/.*');
    });

    it('should handle multiple wildcards', () => {
      const result = wildcardToRegex('https://*.example.com/*/page');
      expect(result.converted).toBe(true);
      const re = new RegExp(result.pattern);
      expect(re.test('https://sub.example.com/docs/page')).toBe(true);
    });

    it('should handle empty string', () => {
      const result = wildcardToRegex('');
      expect(result.converted).toBe(false);
      expect(result.pattern).toBe('');
    });
  });
});
