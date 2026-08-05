import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  urlsMatch,
  validateRegex,
  trialRunRegex,
  matchesUrl,
  sortCandidates,
  sortRulesByPriority,
  selectWinningRule,
  detectRuleConflict,
  isProtectedUrl,
  wildcardToRegex,
} from '@shared/url-utils';
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
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://a.com' }, mode: 'auto', priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'r2', urlMatch: { type: 'exact', value: 'https://b.com' }, mode: 'auto', priority: 10, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'r3', urlMatch: { type: 'exact', value: 'https://c.com' }, mode: 'auto', priority: 10, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' },
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
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://a.com' }, mode: 'auto', priority: 5, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'r2', urlMatch: { type: 'exact', value: 'https://a.com' }, mode: 'auto', priority: 10, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
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
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://example.com/page' }, mode: 'auto', priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'exact', value: 'HTTPS://EXAMPLE.COM/page#hash' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('block');
      expect(result.conflictingRuleId).toBe('r1');
    });

    it('should block identical regex patterns', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'regex', value: 'https://github\\.com/.*' }, mode: 'auto', priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'regex', value: 'https://github\\.com/.*' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('block');
    });

    it('should warn on uncertain regex overlap', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'regex', value: 'https://.*\\.com/.*' }, mode: 'auto', priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'regex', value: 'https://example\\.com/.*' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('warn');
    });

    it('should not block different exact URLs', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://example.com/a' }, mode: 'auto', priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'exact', value: 'https://example.com/b' };
      const result = detectRuleConflict(newMatch, existing);
      expect(result.level).toBe('none');
    });

    it('should exclude specified rule from conflict check', () => {
      const existing: PageRule[] = [
        { id: 'r1', urlMatch: { type: 'exact', value: 'https://example.com/page' }, mode: 'auto', priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const newMatch: UrlMatchDefinition = { type: 'exact', value: 'https://example.com/page' };
      const result = detectRuleConflict(newMatch, existing, 'r1');
      expect(result.level).toBe('none');
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
