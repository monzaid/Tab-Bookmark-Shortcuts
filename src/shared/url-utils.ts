/**
 * URL normalization, regex validation, candidate sorting, and rule conflict detection.
 * Pure functions — no browser API dependencies.
 */

import type { UrlMatchDefinition, TabCandidate, PageRule } from './types';

// ─── URL Normalization ───────────────────────────────────────────────────────

/**
 * Normalize a URL for exact comparison:
 * - Ignore hash/fragment
 * - Lowercase hostname
 * - Remove default ports (80 for http, 443 for https)
 * - Path and query remain strict (case-sensitive)
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);

    // Lowercase protocol and host
    const protocol = url.protocol.toLowerCase();
    let host = url.hostname.toLowerCase();

    // Remove default ports
    const port = url.port;
    if (
      (protocol === 'http:' && port === '80') ||
      (protocol === 'https:' && port === '443')
    ) {
      url.port = '';
    }

    // Reconstruct without hash
    const path = url.pathname;
    const query = url.search; // includes '?' if present
    const portStr = url.port ? `:${url.port}` : '';

    return `${protocol}//${host}${portStr}${path}${query}`;
  } catch {
    // If URL is invalid, return as-is (caller should validate separately)
    return raw;
  }
}

/**
 * Compare two URLs for exact match after normalization.
 */
export function urlsMatch(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

// ─── Regex Validation ────────────────────────────────────────────────────────

export const MAX_REGEX_LENGTH = 500;

export interface RegexValidationResult {
  valid: boolean;
  error?: 'REGEX_TOO_LONG' | 'REGEX_INVALID' | 'REGEX_RISK';
  message?: string;
}

/**
 * Validate a regex pattern:
 * - Max 500 characters
 * - Must be valid JS RegExp
 * - Risk warning for patterns that could match too broadly
 */
export function validateRegex(pattern: string): RegexValidationResult {
  if (pattern.length > MAX_REGEX_LENGTH) {
    return {
      valid: false,
      error: 'REGEX_TOO_LONG',
      message: `Regex exceeds ${MAX_REGEX_LENGTH} character limit (${pattern.length} chars)`,
    };
  }

  try {
    new RegExp(pattern);
  } catch (e) {
    return {
      valid: false,
      error: 'REGEX_INVALID',
      message: e instanceof Error ? e.message : 'Invalid regex syntax',
    };
  }

  // Risk check: very broad patterns
  const riskPatterns = [
    /^.\*$/,        // matches everything
    /^.\+$/,        // matches everything non-empty
    /^\(\?\:.\*\)$/, // (?:.*)
  ];
  for (const rp of riskPatterns) {
    if (rp.test(pattern)) {
      return {
        valid: true,
        error: 'REGEX_RISK',
        message: 'This pattern may match all URLs. Consider narrowing it.',
      };
    }
  }

  return { valid: true };
}

/**
 * Test a regex against a representative URL (trial run).
 */
export function trialRunRegex(pattern: string, testUrl: string): boolean {
  try {
    const re = new RegExp(pattern);
    return re.test(testUrl);
  } catch {
    return false;
  }
}

// ─── Wildcard to Regex Conversion ───────────────────────────────────────────

export interface WildcardConversionResult {
  /** The regex pattern (either original if valid, or converted) */
  pattern: string;
  /** Whether a conversion was performed */
  converted: boolean;
}

/**
 * Convert a wildcard-style pattern to a valid regex.
 * Detection heuristic: if the input contains unescaped * or ? and no backslash
 * escapes (indicating it's NOT an intentional regex), treat as wildcard.
 * If already a valid regex with escape sequences, return unchanged.
 */
export function wildcardToRegex(input: string): WildcardConversionResult {
  if (!input) return { pattern: '', converted: false };

  // If it contains backslash escapes, it's likely intentional regex — no conversion
  if (input.includes('\\')) {
    return { pattern: input, converted: false };
  }

  // If it contains * or ? (wildcard indicators) and no escapes, convert
  if (input.includes('*') || input.includes('?')) {
    const escaped = input
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return { pattern: escaped, converted: true };
  }

  // No wildcards — check if valid regex as-is
  try {
    new RegExp(input);
    return { pattern: input, converted: false };
  } catch {
    // Invalid regex without wildcards — escape special chars
    const escaped = input.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return { pattern: escaped, converted: true };
  }
}

// ─── URL Matching ────────────────────────────────────────────────────────────

/**
 * Check if a tab URL matches a URL match definition.
 */
export function matchesUrl(tabUrl: string, definition: UrlMatchDefinition): boolean {
  if (definition.type === 'exact') {
    return urlsMatch(tabUrl, definition.value);
  }
  // regex
  try {
    const re = new RegExp(definition.value);
    return re.test(tabUrl);
  } catch {
    return false;
  }
}

// ─── Candidate Sorting ───────────────────────────────────────────────────────

/**
 * Sort candidates:
 * 1. Current window first
 * 2. Within same window: by tab index ascending (left to right)
 * 3. Other windows: by windowId ascending, then index ascending
 * Each tab appears at most once.
 */
export function sortCandidates(candidates: TabCandidate[]): TabCandidate[] {
  const seen = new Set<number>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.tabId)) return false;
    seen.add(c.tabId);
    return true;
  });

  return unique.sort((a, b) => {
    // Current window first
    if (a.isCurrentWindow && !b.isCurrentWindow) return -1;
    if (!a.isCurrentWindow && b.isCurrentWindow) return 1;

    // Same window: by index
    if (a.windowId === b.windowId) return a.index - b.index;

    // Different windows: current window group already handled,
    // sort other windows by windowId then index
    if (a.isCurrentWindow) return -1;
    if (b.isCurrentWindow) return 1;
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    return a.index - b.index;
  });
}

// ─── Rule Priority Sorting ───────────────────────────────────────────────────

/**
 * Sort rules by priority descending, then createdAt descending.
 * Returns the winning rule for a given URL (first match after sort).
 */
export function sortRulesByPriority(rules: PageRule[]): PageRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // createdAt descending (newer first)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Find the winning rule for a URL from a list of matching rules.
 */
export function selectWinningRule(matchingRules: PageRule[]): PageRule | null {
  if (matchingRules.length === 0) return null;
  return sortRulesByPriority(matchingRules)[0];
}

// ─── Rule Conflict Detection ─────────────────────────────────────────────────

export type ConflictLevel = 'none' | 'block' | 'warn';

export interface ConflictResult {
  level: ConflictLevel;
  message?: string;
  conflictingRuleId?: string;
}

/**
 * Detect conflicts between a new/updated rule and existing rules.
 * Conservative classification:
 * - BLOCK: Same exact URL match (identical normalized URLs)
 * - BLOCK: Identical regex patterns
 * - WARN: Possible regex overlap (cannot definitively determine non-intersection)
 * - NONE: Different exact URLs, or clearly non-overlapping patterns
 *
 * Does NOT implement a complete regex intersection algorithm.
 */
export function detectRuleConflict(
  newRule: UrlMatchDefinition,
  existingRules: PageRule[],
  excludeRuleId?: string,
): ConflictResult {
  for (const existing of existingRules) {
    if (excludeRuleId && existing.id === excludeRuleId) continue;

    // Both exact: compare normalized URLs
    if (newRule.type === 'exact' && existing.urlMatch.type === 'exact') {
      if (urlsMatch(newRule.value, existing.urlMatch.value)) {
        return {
          level: 'block',
          message: 'A rule with the same URL already exists',
          conflictingRuleId: existing.id,
        };
      }
      continue;
    }

    // Both regex: check identical patterns
    if (newRule.type === 'regex' && existing.urlMatch.type === 'regex') {
      if (newRule.value === existing.urlMatch.value) {
        return {
          level: 'block',
          message: 'A rule with the same regex pattern already exists',
          conflictingRuleId: existing.id,
        };
      }
      // Cannot determine non-intersection → warn
      return {
        level: 'warn',
        message: 'These regex patterns may overlap. Cannot definitively determine non-intersection.',
        conflictingRuleId: existing.id,
      };
    }

    // Mixed: exact vs regex — check if exact URL matches the regex
    if (newRule.type === 'exact' && existing.urlMatch.type === 'regex') {
      try {
        const re = new RegExp(existing.urlMatch.value);
        if (re.test(newRule.value)) {
          return {
            level: 'warn',
            message: 'The exact URL may be matched by an existing regex rule',
            conflictingRuleId: existing.id,
          };
        }
      } catch {
        // Invalid existing regex — skip
      }
      continue;
    }

    if (newRule.type === 'regex' && existing.urlMatch.type === 'exact') {
      try {
        const re = new RegExp(newRule.value);
        if (re.test(existing.urlMatch.value)) {
          return {
            level: 'warn',
            message: 'The regex may match an existing exact URL rule',
            conflictingRuleId: existing.id,
          };
        }
      } catch {
        // Invalid new regex — will be caught by validation
      }
      continue;
    }
  }

  return { level: 'none' };
}

// ─── Protected URL Detection ─────────────────────────────────────────────────

const PROTECTED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'moz-extension://',
  'brave://',
  'opera://',
  'vivaldi://',
];

/**
 * Check if a URL is a protected internal page.
 * Protected pages can be slot targets (switch) but NOT rule targets (rewrite).
 */
export function isProtectedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PROTECTED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
