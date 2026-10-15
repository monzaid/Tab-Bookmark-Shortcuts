/**
 * SearchField — the ONE search box.
 *
 * ─── Why this exists as a component ──────────────────────────────────────────
 *
 * Seven search boxes were built by hand from a shared CLASS, which unified only
 * their skin. Everything around the skin had already drifted:
 *
 *   - font size: 13px in base.css, but the candidate tray overrode it to 12px via
 *     its own modifier class — so one box in the app rendered smaller than the rest
 *     for no reason a user could see;
 *   - the native clear affordance: `type="search"` draws a ✕ that is absent in
 *     Firefox, an unstyled glyph in Chrome, and inconsistent in size — three
 *     appearances for one control, and no way to style it;
 *   - the keyboard focus ring: `:focus { outline: none }` (for the mouse-focus
 *     border) also suppressed the global `:focus-visible` ring, so a keyboard user
 *     tabbing into a search box saw only a faint border change. That is the ring
 *     the accessibility rules require, silently dropped by a rule meant to refine
 *     the MOUSE state;
 *   - the placeholder and the label were written per site, so the wording varied.
 *
 * A shared class cannot fix any of those, because they are not skin: they are
 * structure (the clear button needs an element and a reserved gutter) and state
 * (the two focus rules must be authored together). So the box becomes a component,
 * and the class it uses is an implementation detail of the component rather than a
 * convention each site has to remember.
 *
 * ─── What it deliberately does NOT do ────────────────────────────────────────
 *
 * No debouncing, no filtering, no state of its own: `value` and `onChange` are the
 * caller's, because every list here filters differently (names, titles, URLs) and
 * a component that guessed would have to be configured back out of its guess. It
 * is a labelled text input with a clear button — one responsibility.
 */
import type React from 'react';

export interface SearchFieldProps {
  /** The current query. Controlled — the caller owns the filtering. */
  value: string;
  /** Called with the next query (typing, or clearing). */
  onChange: (next: string) => void;
  /**
   * The accessible name. Required: a placeholder is not a label (it disappears as
   * soon as the user types, and screen readers treat it as a description).
   */
  ariaLabel: string;
  /** The hint inside the field. Says WHAT is searched, not "Search...". */
  placeholder: string;
  /**
   * Placed on the INPUT rather than the wrapper, so a test that addresses the
   * field still reaches the thing it types into.
   */
  testId?: string;
  disabled?: boolean;
  /** Extra classes for the WRAPPER, for a toolbar that needs to size it. */
  className?: string;
}

export function SearchField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  testId,
  disabled = false,
  className,
}: SearchFieldProps): React.JSX.Element {
  const hasValue = value !== '';
  return (
    <span className={`tbs-search-field${className !== undefined ? ` ${className}` : ''}`}>
      <input
        type="search"
        className="tbs-shared-search"
        {...(testId !== undefined ? { 'data-testid': testId } : {})}
        placeholder={placeholder}
        value={value}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => { onChange(e.currentTarget.value); }}
      />
      {/*
        The clear control, rendered only when there is something to clear — a
        permanently visible ✕ on an empty box is an affordance for an action that
        does nothing, which is the dead-control class this codebase removes.

        `type="button"`: inside a form, a bare `<button>` submits, so clearing the
        search would also save the form.
      */}
      {hasValue && !disabled && (
        <button
          type="button"
          className="tbs-search-field__clear"
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          {...(testId !== undefined ? { 'data-testid': `${testId}-clear` } : {})}
          onClick={() => { onChange(''); }}
        >
          {/* An SVG rather than a `×` character: a glyph's weight and baseline come
              from the font, so it renders differently across platforms and cannot be
              sized with the icon tokens. Stroke is 2px to match the app's other
              icons. */}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="M2 2 L10 10 M10 2 L2 10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
