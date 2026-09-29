/**
 * URL normalization, regex validation, candidate sorting, and rule conflict detection.
 * Pure functions — no browser API dependencies.
 */

import type { UrlMatchDefinition, TabCandidate, PageRule } from './types';
import { PROTECTED_URL_PREFIXES } from './protected-prefixes.generated';

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

/** Upper bound on the compiled-regex cache to prevent unbounded growth (B4/B13 spirit). */
const REGEX_CACHE_MAX = 500;

/**
 * Module-level compiled-regex cache.
 * Value `null` records a compile failure so invalid patterns are not re-compiled.
 * Insertion order is used for FIFO eviction once `REGEX_CACHE_MAX` is exceeded.
 */
const compiledRegexCache = new Map<string, RegExp | null>();

/**
 * Compile (and cache) a RegExp for a pattern.
 * Returns `null` for invalid patterns instead of throwing, so callers can fail safely.
 */
export function getCompiledRegex(pattern: string): RegExp | null {
  const cached = compiledRegexCache.get(pattern);
  if (cached !== undefined) {
    return cached;
  }

  let compiled: RegExp | null;
  try {
    compiled = new RegExp(pattern);
  } catch {
    compiled = null;
  }

  if (compiledRegexCache.size >= REGEX_CACHE_MAX) {
    const oldest = compiledRegexCache.keys().next().value;
    if (oldest !== undefined) {
      compiledRegexCache.delete(oldest);
    }
  }
  compiledRegexCache.set(pattern, compiled);
  return compiled;
}

export interface RegexValidationResult {
  valid: boolean;
  error?: 'REGEX_TOO_LONG' | 'REGEX_INVALID' | 'REGEX_RISK';
  message?: string;
}

/**
 * Track the potential for nested/adjacent unbounded quantifiers inside a group.
 * Returns true when a quantifier inside `body` can repeat characters that an
 * outer unbounded quantifier also repeats (catastrophic backtracking shape).
 */
function hasNestedUnboundedQuantifier(body: string): boolean {
  let inClass = false;
  let hasUnboundedInner = false;
  let hasAlternation = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '*' || ch === '+') {
      hasUnboundedInner = true;
      continue;
    }
    if (ch === '{') {
      const close = body.indexOf('}', i);
      if (close > i && /^\{\d+,\s*\}$/.test(body.slice(i, close + 1))) {
        hasUnboundedInner = true;
      }
      continue;
    }
    if (ch === '|') {
      hasAlternation = true;
    }
  }

  return hasUnboundedInner || hasAlternation;
}

/**
 * Ignore `(?...)` group prefixes: `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>`.
 * Returns the pattern index of the first character after the prefix.
 */
function skipGroupPrefix(pattern: string, openIdx: number): number {
  if (pattern[openIdx + 1] !== '?') return openIdx + 1;
  const next = pattern[openIdx + 2];
  if (next === '<') {
    // Lookbehind (?<= (?<! or named group (?<name>
    const after = pattern[openIdx + 3];
    if (after === '=' || after === '!') return openIdx + 4;
    const close = pattern.indexOf('>', openIdx + 3);
    return close > 0 ? close + 1 : openIdx + 1;
  }
  return openIdx + 3; // (?: ( ?= (?!
}

/**
 * T36 (B4-4): detect POLYNOMIAL backtracking from adjacent unbounded groups.
 *
 * `(a+)(a+)(a+)(a+)(a+)$` has no nesting at all, so the nested-quantifier check
 * below returned false while a real engine took ~113s on a 200-character input.
 * Two or more *sibling* groups that are each followed by an unbounded quantifier
 * and sit directly next to each other (nothing consuming a character between
 * them) multiply the same search space.
 *
 * Deliberately conservative: only sibling adjacency counts, so a literal between
 * the groups (`(a+)b(a+)`) or a single quantified group (`(a+)`) stays legal.
 */
function hasAdjacentUnboundedGroups(pattern: string): boolean {
  const groups: Array<{ open: number; end: number; unbounded: boolean }> = [];
  const stack: number[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      stack.push(i);
      continue;
    }
    if (ch !== ')') continue;

    const open = stack.pop();
    if (open === undefined) continue;

    // Trailing quantifier directly after the group.
    let end = i + 1;
    let trailingUnbounded = false;
    const q = pattern[end];
    if (q === '*' || q === '+') {
      trailingUnbounded = true;
      end += 1;
    } else if (q === '{') {
      const close = pattern.indexOf('}', end + 1);
      if (close > end) {
        const spec = pattern.slice(end + 1, close);
        if (/^\d+,\s*$/.test(spec)) trailingUnbounded = true; // {n,} — open-ended
        if (/^\d+(\s*,\s*\d*)?$/.test(spec)) end = close + 1; // consume any {..}
      }
    }
    // Lazy / possessive modifier does not make a blow-up safe.
    if (trailingUnbounded && (pattern[end] === '?' || pattern[end] === '+')) end += 1;

    // A group is "variable" when it can consume an unbounded amount — either its
    // own body holds an unbounded quantifier (`(a+)(a+)`) or the whole group is
    // repeated without a bound (`(ab)+`).
    const body = pattern.slice(skipGroupPrefix(pattern, open), i);
    const variable = trailingUnbounded || hasNestedUnboundedQuantifier(body);

    groups.push({ open, end, unbounded: variable });
  }

  groups.sort((a, b) => a.open - b.open);
  for (let i = 1; i < groups.length; i++) {
    const prev = groups[i - 1];
    const cur = groups[i];
    // Sibling adjacency: the previous group ends exactly where the next begins
    // and both are variable-width. A literal between them breaks the chain.
    if (prev.unbounded && cur.unbounded && prev.end === cur.open) return true;
  }

  return false;
}

/**
 * Statically detect catastrophic backtracking shapes without executing the regex:
 * yields true for `(a+)+`, `(.*)*`, `(x+)+`, `(a*)*`, `(.+)+`-style patterns.
 * Detection is structural (group body contains an unbounded quantifier and the
 * group itself is followed by an unbounded quantifier).
 */
export function hasCatastrophicBacktracking(pattern: string): boolean {
  const groupStack: number[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      groupStack.push(skipGroupPrefix(pattern, i));
      continue;
    }
    if (ch === ')') {
      const bodyStart = groupStack.pop();
      if (bodyStart === undefined) continue;
      const body = pattern.slice(bodyStart, i);
      if (!hasNestedUnboundedQuantifier(body)) continue;
      // Outer quantifier immediately following the group.
      //
      // T29 (B4-1): ANY outer quantifier is dangerous here, not just the
      // unbounded ones. `(a+){10}` and `(.*a){20}` multiply the inner search
      // space just as badly as `(a+)+` (measured 33s / 94s against adversarial
      // input), so a bounded `{n}` / `{n,m}` must not launder the blow-up.
      // A bounded outer is only safe when the body has no unbounded quantifier.
      const outer = pattern[i + 1];
      if (outer === '*' || outer === '+') return true;
      if (outer === '{') {
        const close = pattern.indexOf('}', i + 1);
        if (close > i && /^\{\d+(\s*,\s*\d*)?\}$/.test(pattern.slice(i + 1, close + 1))) return true;
      }
    }
  }

  // T36: nested detection above covers `(a+)+`; this covers the polynomial
  // sibling form `(a+)(a+)…` that has no nesting to find.
  return hasAdjacentUnboundedGroups(pattern);
}

/**
 * Validate a regex pattern:
 * - Max 500 characters
 * - Must be valid JS RegExp
 * - REJECT catastrophic backtracking shapes (nested unbounded quantifiers)
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

  // Reject tier: catastrophic backtracking (ReDoS) — static structural detection only.
  if (hasCatastrophicBacktracking(pattern)) {
    return {
      valid: false,
      error: 'REGEX_RISK',
      message: 'This pattern can cause catastrophic backtracking (nested quantifiers) and was rejected.',
    };
  }

  // Warn tier: very broad patterns (allowed, but flagged).
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
  // regex — compiled through the bounded cache; invalid patterns yield null → false
  const re = getCompiledRegex(definition.value);
  return re ? re.test(tabUrl) : false;
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

// ─── Favicon Protocol Allowlist (B9) ─────────────────────────────────────────

/**
 * Bitmap-only `data:` sub-types permitted for favicons.
 *
 * `image/svg+xml` is deliberately EXCLUDED: SVG can carry `<script>` and event
 * handlers (`onload=`), so it is a script-execution vector rather than a plain
 * image. Everything else is a raster format.
 */
const SAFE_DATA_IMAGE_SUBTYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
];

/** Protocols permitted for a favicon value (closed set — never widened). */
const SAFE_FAVICON_PROTOCOLS = ['http:', 'https:'];

/**
 * Single source of truth for "may this value be written to `link.href`?" (B9).
 *
 * Allowed:
 * - `http:` / `https:` — remote favicons. These are rendered by the PAGE as its
 *   own resource, the extension makes no network call for them, and existing
 *   delivery-path tests assert they pass through unchanged.
 * - `data:` limited to bitmap image sub-types.
 *
 * Rejected: `javascript:` (XSS), `file:` (local-file probing), `blob:`,
 * `data:text/html` (same-origin script execution), `data:image/svg+xml`
 * (script-capable), `ftp:`, and anything unrecognized/empty.
 *
 * Comparison is case-insensitive and tolerates leading whitespace/control chars.
 */
export function isSafeFaviconProtocol(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;

  // Strip any leading ASCII control characters that could smuggle a protocol.
  const normalized = trimmed.replace(/^[\u0000-\u0020]+/, '');
  if (!normalized) return false;

  if (SAFE_FAVICON_PROTOCOLS.some((p) => normalized.startsWith(p))) {
    return true;
  }

  if (normalized.startsWith('data:')) {
    // data:<mediatype>[;params],<payload>
    const body = normalized.slice('data:'.length);
    const comma = body.indexOf(',');
    const meta = comma >= 0 ? body.slice(0, comma) : body;
    const mediaType = meta.split(';')[0].trim();
    return SAFE_DATA_IMAGE_SUBTYPES.includes(mediaType);
  }

  return false;
}

/**
 * Check if a URL is a protected internal page.
 * Protected pages can be slot targets (switch) but NOT rule targets (rewrite).
 *
 * B14: the prefix list lives in the generated single source (shared with the
 * content script) — never re-declare it here.
 */
export function isProtectedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PROTECTED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
