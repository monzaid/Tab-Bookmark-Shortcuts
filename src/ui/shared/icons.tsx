/**
 * The app's icon set — ONE module, stroke-consistent, font-independent.
 *
 * ─── Why SVGs rather than glyphs ─────────────────────────────────────────────
 *
 * These actions used to be emoji (`✏️`, `🗑️`) and box-drawing characters (`↪`, `↺`).
 * A glyph is rendered by whatever font the platform supplies, which made three
 * things impossible:
 *
 *   - a CONSISTENT WEIGHT. The pencil, the bin and the arrow came from different
 *     emoji sets with their own stroke weights and optical sizes, so a row of them
 *     read as three unrelated pictures rather than one vocabulary;
 *   - CONTROLLABLE SIZE. `font-size` was the only lever, and it scales the em box
 *     rather than the drawing, so the glyph sat off-centre in its button;
 *   - A SHARED COLOUR RULE. `currentColor` is what lets an icon inherit the
 *     button's own state colour (hover, danger, disabled) without a second rule
 *     per state — which is how the danger bin stayed red on hover while its
 *     neighbour went grey.
 *
 * ─── The rules this set holds to ─────────────────────────────────────────────
 *
 *   - a 24-unit `viewBox`, drawn on whole-ish coordinates, so a single `size` prop
 *     scales cleanly at 14/16/18 without sub-pixel blur;
 *   - `stroke-width: 2` on every icon, `strokeLinecap="round"`, no fills — one
 *     drawing style, so combining them never looks accidental;
 *   - `stroke="currentColor"`, so colour comes from CSS and never from the icon;
 *   - `aria-hidden` on every icon: the accessible name belongs to the BUTTON
 *     (`aria-label`), and a decorative glyph that announces itself makes a screen
 *     reader say the label twice.
 *
 * The set is deliberately small — only what the app actually draws. An icon added
 * "in case" is an icon nobody has checked at 14px.
 */
import type React from 'react';
import { Tooltip } from './components';

export interface IconProps {
  /** Rendered size in px. Default 16, which is what the row actions use. */
  size?: number;
  className?: string;
}

/** Shared wrapper so every icon gets the same viewBox, stroke and a11y treatment. */
function Icon({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...(className !== undefined ? { className } : {})}
    >
      {children}
    </svg>
  );
}

/** Edit — a pencil. */
export function PencilIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

/** Delete — a bin, with the lid stated so it does not read as a generic box. */
export function TrashIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

/**
 * Go to — an arrow leaving a box.
 *
 * The old glyph was `↪`, which is a TYPOGRAPHIC return symbol: even readers who
 * recognise it cannot tell whether it means "go there" or "send here". The drawing
 * shows the destination explicitly (a corner bracket with an arrow leaving it).
 */
export function GoToIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </Icon>
  );
}

/** Reset — a counter-clockwise arrow, the universal "restore" mark. */
export function ResetIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </Icon>
  );
}

/**
 * An ICON-ONLY action button with its label on hover.
 *
 * ─── Why this exists rather than a bare `<Button>` per call site ─────────────
 *
 * An icon-only control has no visible text, so its meaning has to come from
 * somewhere. Four call sites per table × three tables is enough repetition that
 * each one would have drifted: one would carry a `title`, another an `aria-label`
 * only, a third a tooltip that does not appear on keyboard focus. This is the same
 * reasoning as `SearchField` — the SHAPE is what has to be shared, not just the
 * styling.
 *
 * ─── Both hover AND keyboard focus, and why `title` is not enough ────────────
 *
 * The requirement is a label on hover. `title` would satisfy that literally, but it
 * is unusable as the only affordance: it waits ~1s, cannot be styled, and does not
 * appear at all when the control is reached by KEYBOARD — which is exactly the user
 * who cannot see the icon's shape well enough to guess. So the shared `Tooltip` is
 * used (it shows on `:hover` and `:focus-within`), and:
 *
 *   - `aria-label` is REQUIRED and is the accessible name — the label a screen
 *     reader announces, and the string the tests address the button by;
 *   - the tooltip carries the SAME string, so the sighted label and the announced
 *     one cannot disagree;
 *   - `title` is additionally set, for the browsers where a native tooltip is the
 *     hit area a user's muscle memory reaches for. It is redundant with the styled
 *     one rather than load-bearing.
 */
export function IconAction({
  label,
  onClick,
  children,
  disabled = false,
  danger = false,
  tooltipPosition = 'top',
  testId,
  expanded,
}: {
  /** The action's name. Used as the accessible name AND the visible tooltip. */
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** Renders in the danger colour — for actions that remove something. */
  danger?: boolean;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
  testId?: string;
  /**
   * For a control that OPENS something: the state of what it opens.
   *
   * Passed through rather than dropped, and that is the whole reason it is a prop:
   * the buttons this replaces carried `aria-expanded`, and an icon-only control
   * loses its text label AND its state at once if the attribute is forgotten — a
   * screen reader would announce "Edit rule r1, button" with no way to tell whether
   * the editor is already open. `undefined` (the default) omits the attribute
   * entirely, which is correct for an action that opens nothing.
   */
  expanded?: boolean;
}): React.JSX.Element {
  return (
    <Tooltip content={label} position={tooltipPosition}>
      <button
        type="button"
        className={`tbs-icon-action${danger ? ' tbs-icon-action--danger' : ''}`}
        aria-label={label}
        title={label}
        disabled={disabled}
        {...(expanded !== undefined ? { 'aria-expanded': expanded } : {})}
        {...(testId !== undefined ? { 'data-testid': testId } : {})}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
