/**
 * T3 — shared form validation (E1 / E1-a / CT4-bis).
 *
 * The critical case is E1-a: a wildcard input must be CONVERTED before it is
 * validated, so a pattern the UI accepts is exactly the pattern the worker
 * stores. The RED case for the original defect is `*.example.com`.
 */
import { describe, it, expect } from 'vitest';
import {
  MESSAGES,
  normalizedRegexPattern,
  validateFieldEditors,
  validateRuleForm,
} from '@shared/form-validation';
import type { RuleFormInput } from '@shared/form-validation';
import { MAX_REGEX_LENGTH } from '@shared/url-utils';

function form(overrides: Partial<RuleFormInput>): RuleFormInput {
  return {
    matchType: 'exact',
    url: 'https://example.com/page',
    titleMode: 'use-chain',
    titleValue: '',
    iconMode: 'use-chain',
    iconValue: '',
    ...overrides,
  };
}

describe('form-validation — regex is converted BEFORE validation (fixes N7)', () => {
  it('accepts a wildcard pattern by converting it first', () => {
    const result = validateRuleForm(form({ matchType: 'regex', url: '*.example.com' }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    // If the raw (unconverted) string were validated, `new RegExp('*.example.com')`
    // would throw and this test would fail — that is the RED signal.
    expect(normalizedRegexPattern('*.example.com')).toBe('.*\\.example\\.com');
  });

  it('validates the SAME string that is stored', () => {
    const raw = 'https://*.example.com/*';
    const result = validateRuleForm(form({ matchType: 'regex', url: raw }));
    expect(result.valid).toBe(true);
    // The stored pattern is the converted one.
    expect(normalizedRegexPattern(raw)).toBe('https://.*\\.example\\.com/.*');
  });

  it('rejects a regex longer than the 500-character limit', () => {
    const result = validateRuleForm(form({ matchType: 'regex', url: 'a'.repeat(MAX_REGEX_LENGTH + 1) }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].severity).toBe('block');
    expect(result.errors[0].message).toContain(String(MAX_REGEX_LENGTH));
  });

  it('rejects a catastrophic-backtracking pattern', () => {
    const result = validateRuleForm(form({ matchType: 'regex', url: '(a+)+$' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].severity).toBe('block');
  });

  it('does NOT block a merely-broad pattern — it warns (E1-b)', () => {
    // E1-a means the CONVERTED pattern is what gets validated, so a bare `.*`
    // input becomes `\.*` and no longer reaches the broad-pattern list. A
    // backslash-bearing input is returned unchanged, which is the path that
    // still lands exactly on the `REGEX_RISK` warn tier.
    const result = validateRuleForm(form({ matchType: 'regex', url: '\\*' }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe('warn');
    expect(result.errors[0].field).toBe('matchUrl');
  });

  it('a wildcard-converted broad-ish pattern is not blocked', () => {
    const result = validateRuleForm(form({ matchType: 'regex', url: '*' }));
    expect(result.valid).toBe(true);
  });
});

describe('form-validation — exact URL parseability (E1-d / E5-c)', () => {
  it('accepts an absolute URL', () => {
    expect(validateRuleForm(form({ matchType: 'exact', url: 'https://example.com/page' })).valid).toBe(true);
  });

  it('rejects a non-URL string', () => {
    const result = validateRuleForm(form({ matchType: 'exact', url: 'example.com' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe(MESSAGES.fullUrl);
  });

  it('rejects an empty pattern', () => {
    const result = validateRuleForm(form({ matchType: 'exact', url: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe(MESSAGES.emptyMatchUrl);
  });
});

describe('form-validation — CT4-bis: declared-but-empty values block', () => {
  it('blocks a "set" title with no value', () => {
    const result = validateRuleForm(form({ titleMode: 'set', titleValue: '   ' }));
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.field === 'title');
    expect(issue?.message).toBe(MESSAGES.emptyTitle);
    expect(issue?.severity).toBe('block');
  });

  it('blocks an "url" icon with no value', () => {
    const result = validateRuleForm(form({ iconMode: 'url', iconValue: '  ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.field === 'icon')?.message).toBe(MESSAGES.emptyIconUrl);
  });

  it('blocks a "custom" icon with no rendered content', () => {
    const result = validateRuleForm(form({ iconMode: 'custom', iconValue: '', iconConfig: { dataUri: '' } }));
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.field === 'icon')?.message).toBe(MESSAGES.emptyIconCustom);
  });

  it('accepts a "use-chain" title and icon with no values', () => {
    const result = validateRuleForm(form({ titleMode: 'use-chain', iconMode: 'use-chain' }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('form-validation — favicon protocol allowlist (E1-c)', () => {
  it('rejects a javascript: icon URL', () => {
    const result = validateRuleForm(form({ iconMode: 'url', iconValue: 'javascript:alert(1)' }));
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.field === 'icon')?.message).toBe(MESSAGES.unsafeIcon);
  });

  it('accepts an https icon URL', () => {
    expect(validateRuleForm(form({ iconMode: 'url', iconValue: 'https://cdn/x.png' })).valid).toBe(true);
  });

  it('applies the same gate to a rendered custom icon data URI', () => {
    const result = validateRuleForm(
      form({ iconMode: 'custom', iconValue: '', iconConfig: { dataUri: 'data:image/svg+xml,<svg/>' } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.field === 'icon')?.message).toBe(MESSAGES.unsafeIcon);
  });

  it('accepts a bitmap data URI for a custom icon', () => {
    const result = validateRuleForm(
      form({ iconMode: 'custom', iconValue: '', iconConfig: { dataUri: 'data:image/png;base64,AAA' } }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('form-validation — Dashboard field editors (no Match URL)', () => {
  it('does not require a Match URL', () => {
    expect(validateFieldEditors({ titleMode: 'use-chain', titleValue: '', iconMode: 'use-chain', iconValue: '' }).valid).toBe(true);
  });

  it('still blocks a declared-but-empty title', () => {
    const result = validateFieldEditors({ titleMode: 'set', titleValue: '', iconMode: 'use-chain', iconValue: '' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('title');
  });
});