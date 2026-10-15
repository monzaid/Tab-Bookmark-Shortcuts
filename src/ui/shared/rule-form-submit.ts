/**
 * rule-form-submit — the single implementation of "turn a rule draft into a
 * validated, storable payload".
 *
 * Before this module the same three steps were re-typed in four handlers:
 *   sidebar `CreateRuleModal.handleSave`, settings `RulesSection.handleSaveRule`,
 *   settings `InlineRuleEditor.handleSave`, settings `DashboardSection.applyDraft`.
 * They agreed today only by hand-copying, so a fix to one (e.g. E1-a's
 * "validate AFTER wildcard conversion") could silently miss the others.
 *
 * Both functions are PURE except for `renderIconToDataUri` (which needs a
 * canvas). They never touch storage, React or the background — the caller keeps
 * ownership of the request, its error copy and its toasts.
 */

import { normalizedRegexPattern, validateRuleForm } from '@shared/form-validation';
import type { RuleFormInput, ValidationResult } from '@shared/form-validation';
import type { IconConfig } from '@ui/components/IconEditor';
import type { IconSource } from '@shared/types';
import { iconConfigToIconSource } from './icon-source';
import type { FieldMode } from './field-editor';

/** A rule form's in-memory values. Shared by create and edit surfaces. */
export interface RuleDraftValue {
  url: string;
  matchType: 'exact' | 'regex';
  titleMode: FieldMode;
  iconMode: FieldMode;
  iconConfig?: IconConfig;
  priority: number;
  enabled?: boolean;
  /**
   * The rule's tags as a FORM DRAFT (G3).
   *
   * Carried through `normalizeRuleDraft` verbatim — NO trim, NO dedupe, NO
   * dangling strip. Those are `TagService`'s rules (P4/D3/A-h): re-implementing
   * them here would create a second answer to "which tags does this rule have",
   * and the two would drift. The UI's job is to pass what the user picked.
   */
  tagIds?: string[];
}

/**
 * Map a draft onto the shared validator's input shape.
 *
 * Kept in one place so `RuleFormFields` (inline preview) and the submit path
 * cannot describe the same draft two different ways.
 */
export function toValidationInput(value: RuleDraftValue): RuleFormInput {
  return {
    matchType: value.matchType,
    url: value.url,
    titleMode: value.titleMode.kind === 'set' ? 'set' : 'use-chain',
    titleValue: value.titleMode.kind === 'set' ? value.titleMode.value : '',
    // A draft carrying an icon CONFIG is a composite icon (upload data URI or
// recipe), not a URL: mapping it to 'url' sent an empty value to the URL
// validator and blocked the save outright ("Enter an icon URL…") — and for an
// upload's `{kind:'set', value:''}` that made the whole draft unsaveable.
    iconMode: value.iconMode.kind === 'set' ? (value.iconConfig ? 'custom' : 'url') : 'use-chain',
    iconValue: value.iconMode.kind === 'set' ? value.iconMode.value : '',
    // Pass the config through UNCHANGED. Narrowing it to `dataUri` dropped a
// recipe's fields (bgColor/text/textColor), so the validator saw an empty
// "rendered" value and blocked an otherwise-valid recipe draft.
    ...(value.iconConfig ? { iconConfig: value.iconConfig } : {}),
  };
}

/** Validate a draft with the ONE shared validator (E1/E1-a). */
export function validateRuleDraft(value: RuleDraftValue): ValidationResult {
  return validateRuleForm(toValidationInput(value));
}

/** The storable subset of a rule, ready to spread into a message payload. */
export interface NormalizedRuleFields {
  url: string;
  priority: number;
  title?: string;
  favicon?: IconSource;
  enabled?: boolean;
  /**
   * NOT part of the `CREATE_RULE` / `UPDATE_RULE` payload.
   *
   * Tags travel in `SET_RULE_TAGS` (A1), and this field exists only so the
   * CALLER can send that second message AFTER the rule is saved — the ORDER
   * matters, because `SET_RULE_TAGS` needs a real `ruleId` to point at. Spreading
   * this object straight into a rule request would put tags on the delivery path
   * (R5), so it is a sibling of the payload, never inside it.
   */
  tagIds?: string[];
}

/** Clamp a priority into the persisted range. */
export function clampPriority(priority: number): number {
  return Math.max(-100, Math.min(100, priority));
}

/**
 * The stored favicon for a draft, or `undefined` when the icon dimension is
 * "use chain" (DT11: unset, never an empty-string placeholder).
 *
 * A custom icon config (upload data URI OR recipe) wins over the URL text,
 * mirroring the mutually-exclusive modes of `FieldEditor`. C1: a recipe is
 * persisted as `type:'template'` rather than being rendered to an upload.
 *
 * Takes only the icon fields so the Data Dashboard draft (which shares the same
 * two fields) can reuse it (T7: one converter, no hand-copied drift).
 */
export function resolveDraftFavicon(
  value: Pick<RuleDraftValue, 'iconMode' | 'iconConfig'>,
): IconSource | undefined {
  if (value.iconMode.kind !== 'set') return undefined;

  const config = value.iconConfig;
  if (config) {
    const source = iconConfigToIconSource(config);
    // A real upload, or a recipe with actual content, wins. An empty recipe is
    // not a real icon — fall through to the URL text.
    if (source.type === 'upload') return source;
    if (source.backgroundColor !== undefined || (source.text ?? '') !== '') return source;
  }

  const url = value.iconMode.value.trim();
  if (url) return { type: 'url', value: url };
  return undefined;
}

/**
 * Normalise a draft into the fields written to storage.
 *
 * E1-a ordering is honoured: a regex input is converted FIRST, so the string
 * that was validated is exactly the string that gets persisted.
 */
export function normalizeRuleDraft(value: RuleDraftValue): NormalizedRuleFields {
  const url = value.matchType === 'regex' ? normalizedRegexPattern(value.url) : value.url.trim();
  const title = value.titleMode.kind === 'set' ? (value.titleMode.value.trim() || undefined) : undefined;

  return {
    url,
    priority: clampPriority(value.priority),
    ...(title !== undefined ? { title } : {}),
    favicon: resolveDraftFavicon(value),
    ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
    // Passed through VERBATIM (see `RuleDraftValue.tagIds`): normalising here
    // would duplicate `TagService`'s rules. Carried as a sibling of the payload,
    // for the caller's follow-up `SET_RULE_TAGS` — never spread into a rule
    // request.
    ...(value.tagIds !== undefined ? { tagIds: value.tagIds } : {}),
  };
}