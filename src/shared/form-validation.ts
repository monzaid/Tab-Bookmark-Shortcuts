/**
 * Shared form validation (E1 / E1-a / CT4-bis).
 *
 * A single pure module that reuses the background validation primitives, so the
 * UI and the worker can never disagree about whether an input is acceptable —
 * the specific defect it fixes is "the form says the pattern is valid but the
 * save is rejected" (① N7).
 *
 * E1-a is the critical ordering rule: a regex-tab input is validated AFTER
 * `wildcardToRegex` conversion, so the string that is validated is EXACTLY the
 * string that is persisted.
 */

import {
  isSafeFaviconProtocol,
  validateRegex,
  wildcardToRegex,
} from './url-utils';

export type RuleFormField = 'matchUrl' | 'title' | 'icon';

export type Severity = 'block' | 'warn';

export interface ValidationIssue {
  field: RuleFormField;
  message: string;
  severity: Severity;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

export interface RuleFormInput {
  matchType: 'exact' | 'regex';
  url: string;
  titleMode: 'set' | 'use-chain';
  titleValue: string;
  iconMode: 'url' | 'custom' | 'use-chain';
  iconValue: string;
  /** Rendered data URI for a custom icon (already contains the `data:` prefix). */
  iconConfig?: { dataUri?: string; bgColor?: string; text?: string; textColor?: string };
}

export interface FieldEditorsInput {
  titleMode: 'set' | 'use-chain';
  titleValue: string;
  iconMode: 'url' | 'custom' | 'use-chain';
  iconValue: string;
  iconConfig?: { dataUri?: string; bgColor?: string; text?: string; textColor?: string };
}

/** E2-c: the single conflict copy both surfaces share. */
export const RULE_CONFLICT_MESSAGE = 'A rule with the same URL already exists';

export const MESSAGES = {
  emptyTitle: 'Enter a title, or choose Use chain',
  emptyIconUrl: 'Enter an icon URL, or choose Custom Icon / Use chain',
  emptyIconCustom: 'Pick colors and text, or choose Icon URL / Use chain',
  emptyMatchUrl: 'Enter a URL pattern',
  fullUrl: 'Enter a full URL (https://…)',
  invalidRegex: 'Enter a valid regular expression',
  unsafeIcon: 'Unsupported favicon protocol. Use http(s) or a data: image.',
} as const;

/** Whether `raw` (an `exact` value) is parseable as an absolute URL. */
function isParseableUrl(raw: string): boolean {
  try {
    new URL(raw.trim());
    return true;
  } catch {
    return false;
  }
}

/** Validate the Match URL field. Returns issues (possibly empty). */
function validateMatchUrl(matchType: 'exact' | 'regex', url: string): ValidationIssue[] {
  const trimmed = url.trim();
  if (!trimmed) {
    return [{ field: 'matchUrl', message: MESSAGES.emptyMatchUrl, severity: 'block' }];
  }

  if (matchType === 'regex') {
    // E1-a: convert FIRST, then validate — the validated string is the stored one.
    const converted = wildcardToRegex(trimmed).pattern;
    const result = validateRegex(converted);
    if (!result.valid) {
      return [
        {
          field: 'matchUrl',
          message: result.error === 'REGEX_TOO_LONG' ? result.message ?? MESSAGES.invalidRegex : MESSAGES.invalidRegex,
          severity: 'block',
        },
      ];
    }
    // E1-b: the "too broad" warning does not block the save.
    if (result.error === 'REGEX_RISK') {
      return [{ field: 'matchUrl', message: result.message ?? '', severity: 'warn' }];
    }
    return [];
  }

  // E1-d / E5-c: an `exact` value must be a parseable absolute URL. `normalizeUrl`
  // returns its input verbatim when `new URL()` throws, so string equality alone
  // is not sufficient — parseability must be checked explicitly.
  if (!isParseableUrl(trimmed)) {
    return [{ field: 'matchUrl', message: MESSAGES.fullUrl, severity: 'block' }];
  }
  return [];
}

/** Resolve the value a custom icon config would render to. */
function customIconValue(iconConfig?: { dataUri?: string }): string {
  return iconConfig?.dataUri ?? '';
}

/**
 * Is this a REAL composite icon? The SAME judgement `resolveDraftFavicon`
 * persists with: a rendered `dataUri`, OR actual recipe content. Without the
 * second half a recipe (which has no `dataUri` — its fields are the truth, C1)
 * would be judged empty and blocked, even though it persists as a template.
 */
function hasCompositeIconContent(iconConfig?: { dataUri?: string; bgColor?: string; text?: string; textColor?: string }): boolean {
  if (customIconValue(iconConfig).trim()) return true;
  return iconConfig !== undefined && (iconConfig.bgColor !== undefined || (iconConfig.text ?? '') !== '');
}

/** Validate the icon field shared by both surfaces. */
function validateIcon(
  iconMode: 'url' | 'custom' | 'use-chain',
  iconValue: string,
  iconConfig?: { dataUri?: string; bgColor?: string; text?: string; textColor?: string },
): ValidationIssue[] {
  if (iconMode === 'use-chain') return [];

  if (iconMode === 'url') {
    const trimmed = iconValue.trim();
    if (!trimmed) {
      return [{ field: 'icon', message: MESSAGES.emptyIconUrl, severity: 'block' }];
    }
    if (!isSafeFaviconProtocol(trimmed)) {
      return [{ field: 'icon', message: MESSAGES.unsafeIcon, severity: 'block' }];
    }
    return [];
  }

  // custom
  const rendered = customIconValue(iconConfig);
  if (!hasCompositeIconContent(iconConfig)) {
    return [{ field: 'icon', message: MESSAGES.emptyIconCustom, severity: 'block' }];
  }
  // Only a RENDERED composite has a URI to vet. A recipe carries no `dataUri`
  // (its fields are the truth, C1), so it has nothing to check here — running
  // the protocol gate on '' would block every recipe as "unsafe".
  if (rendered.trim() && !isSafeFaviconProtocol(rendered)) {
    return [{ field: 'icon', message: MESSAGES.unsafeIcon, severity: 'block' }];
  }
  return [];
}

/** Validate the title field shared by both surfaces. */
function validateTitle(mode: 'set' | 'use-chain', value: string): ValidationIssue[] {
  if (mode === 'use-chain') return [];
  if (!value.trim()) {
    return [{ field: 'title', message: MESSAGES.emptyTitle, severity: 'block' }];
  }
  return [];
}

function toResult(issues: ValidationIssue[]): ValidationResult {
  return { valid: !issues.some((i) => i.severity === 'block'), errors: issues };
}

/**
 * Validate the full rule form (sidebar create modal / settings rule editors).
 */
export function validateRuleForm(input: RuleFormInput): ValidationResult {
  const issues: ValidationIssue[] = [
    ...validateMatchUrl(input.matchType, input.url),
    ...validateTitle(input.titleMode, input.titleValue),
    ...validateIcon(input.iconMode, input.iconValue, input.iconConfig),
  ];
  return toResult(issues);
}

/**
 * Validate the Dashboard field editors (no Match URL field on that surface).
 */
export function validateFieldEditors(input: FieldEditorsInput): ValidationResult {
  const issues: ValidationIssue[] = [
    ...validateTitle(input.titleMode, input.titleValue),
    ...validateIcon(input.iconMode, input.iconValue, input.iconConfig),
  ];
  return toResult(issues);
}

/** Convenience: the stored (converted) regex for a raw regex-tab input. */
export function normalizedRegexPattern(raw: string): string {
  return wildcardToRegex(raw.trim()).pattern;
}

