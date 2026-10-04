/**
 * InlineEditorShell — the shared row-level expandable editor chrome.
 *
 * IMP-4 decided that the Data Dashboard `Edit` panel is "the same shape as
 * `InlineRuleEditor`" (inline in the row, several rows open at once, non-modal).
 * Until now that shape existed as two hand-copied `<tr><td colSpan><div
 * class="tbs-settings__rule-form" role="form">` blocks that could drift apart —
 * they used different `colSpan` values and only one wired the error node.
 *
 * This component owns ONLY the outer chrome (row, panel, heading, grid, action
 * bar, Escape-to-collapse). The fields inside stay the caller's choice, so
 * Rules can drop in `RuleFormFields` while the Dashboard composes two
 * `FieldEditor`s.
 *
 * Non-modal on purpose: `role="form"` + `aria-label`, never `aria-modal`, so an
 * inline editor never steals the focus boundary from the page (4d).
 */

import type { ReactNode } from 'react';

export interface InlineEditorShellProps {
  /** Number of table columns the panel spans (Rules 7, Dashboard 5). */
  colSpan: number;
  /** Heading text, e.g. `Edit Rule` / `Edit Slot 3`. */
  title: string;
  /** Accessible name of the form, e.g. `Edit rule r1`. */
  ariaLabel: string;
  /** Form-level error; rendered as a `role="alert"` line above the fields. */
  error?: string | null;
  /** Class for the error line (kept per-surface until the inline red is unified). */
  errorClassName?: string;
  /** Field content. */
  children: ReactNode;
  /** Buttons rendered right-aligned in the action bar. */
  actions: ReactNode;
  /**
   * Wrap the fields in the two-column grid.
   *
   * Defaults to FALSE: the common case is a single self-laying-out field set
   * (`RuleFormFields`), and wrapping one child in a 2-track grid squeezed it
   * into half the panel width — the layout defect this flag now prevents.
   * Opt in only when the caller really is pairing two sibling fields.
   */
  grid?: boolean;
  /** Collapse the editor (D-16 / IMP-15: Escape cancels the row). */
  onEscape?: () => void;
}

export function InlineEditorShell({
  colSpan,
  title,
  ariaLabel,
  error,
  errorClassName = 'tbs-settings__rule-form-error',
  children,
  actions,
  grid = false,
  onEscape,
}: InlineEditorShellProps) {
  return (
    <tr
      className="tbs-settings__inline-editor-row"
      {...(onEscape
        ? { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onEscape(); } } }
        : {})}
    >
      <td colSpan={colSpan}>
        <div className="tbs-settings__rule-form" role="form" aria-label={ariaLabel}>
          <h3>{title}</h3>
          {error && <p className={errorClassName} role="alert">{error}</p>}
          {grid ? <div className="tbs-settings__rule-form-grid">{children}</div> : children}
          <div className="tbs-settings__rule-form-actions">{actions}</div>
        </div>
      </td>
    </tr>
  );
}