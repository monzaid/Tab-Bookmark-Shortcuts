/**
 * The icon set and the icon-only action button (P6).
 *
 * Two things are asserted, and they fail for different reasons:
 *
 *  1. the DRAWINGS are one vocabulary — same viewBox, same stroke, no fill, and
 *     `currentColor`. A glyph (`✏️`, `🗑️`, `↪`) could not guarantee any of these,
 *     which is why the set exists;
 *  2. an ICON-ONLY control still says what it does — on hover, on keyboard focus,
 *     and to a screen reader. The row actions lost their visible text, so this is
 *     the only thing standing between "a drawing" and "a guess".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  IconAction,
  PencilIcon,
  TrashIcon,
  GoToIcon,
  ResetIcon,
} from '@ui/shared/icons';

const ALL = [
  ['PencilIcon', PencilIcon],
  ['TrashIcon', TrashIcon],
  ['GoToIcon', GoToIcon],
  ['ResetIcon', ResetIcon],
] as const;

describe('the icon set is ONE drawing style', () => {
  it.each(ALL)('%s: 24-viewBox, stroke 2, no fill, currentColor', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // One viewBox for the whole set: a single `size` prop then scales every icon
    // identically, which is what `stroke-width` needs to stay optically even.
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('stroke-linecap')).toBe('round');
    // No fill: a filled glyph beside a stroked one reads as a different family.
    expect(svg?.getAttribute('fill')).toBe('none');
  });

  it.each(ALL)('%s: is decorative, and the button carries the name', (_name, Icon) => {
    // `aria-hidden` + `focusable="false"`: the accessible name belongs to the
    // BUTTON. A drawing that announced itself would make a screen reader read the
    // label twice, and in IE/Edge legacy a focusable SVG is its own tab stop.
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  });

  it('takes its size from the prop, so one icon serves both row heights', () => {
    // `font-size` could not do this for a glyph: it scales the em box, not the
    // drawing, so the mark sat off-centre at every size but the font's own.
    const { container } = render(<ResetIcon size={14} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('14');
    expect(svg?.getAttribute('height')).toBe('14');
  });
});

describe('IconAction — an icon-only button that still says what it does', () => {
  it('carries the label as BOTH the accessible name and the tooltip', () => {
    render(
      <IconAction label="Delete rule Alpha" onClick={vi.fn()}>
        <TrashIcon />
      </IconAction>,
    );
    // The accessible name is what a screen reader announces and what the tests
    // address the control by.
    const button = screen.getByRole('button', { name: 'Delete rule Alpha' });
    // ...and the SAME string is the hover label, so the two cannot disagree.
    expect(screen.getByRole('tooltip').textContent).toBe('Delete rule Alpha');
    // `title` is redundant with the styled tooltip rather than load-bearing — it
    // covers the native-tooltip habit for users who reach for it.
    expect(button.getAttribute('title')).toBe('Delete rule Alpha');
  });

  it('the tooltip is wired to the button with aria-describedby', () => {
    // Being reachable by hover is not enough: without this association a screen
    // reader user gets the name but never the description.
    render(
      <IconAction label="Reset sorting" onClick={vi.fn()}>
        <ResetIcon />
      </IconAction>,
    );
    const button = screen.getByRole('button', { name: 'Reset sorting' });
    const describedBy = button.closest('.tbs-tooltip-wrapper')?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(screen.getByRole('tooltip').getAttribute('id')).toBe(describedBy);
  });

  it('is a real button that fires once per click, disabled or not', () => {
    const onClick = vi.fn();
    const { unmount } = render(
      <IconAction label="Edit work" onClick={onClick}>
        <PencilIcon />
      </IconAction>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit work' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();

    // A disabled control must not act — and must be announced as disabled, which
    // is the one thing an icon cannot show.
    const disabledClick = vi.fn();
    render(
      <IconAction label="Remove this tag" onClick={disabledClick} disabled>
        <TrashIcon />
      </IconAction>,
    );
    const disabled = screen.getByRole('button', { name: 'Remove this tag' });
    expect(disabled).toBeDisabled();
    fireEvent.click(disabled);
    expect(disabledClick).not.toHaveBeenCalled();
  });

  it('does NOT claim an expanded state unless given one', () => {
    // The attribute has to be absent, not `false`: an action that opens nothing is
    // not "collapsed", and `aria-expanded="false"` would announce a disclosure the
    // control does not have.
    const { unmount } = render(
      <IconAction label="Delete work" onClick={vi.fn()}>
        <TrashIcon />
      </IconAction>,
    );
    expect(screen.getByRole('button', { name: 'Delete work' })).not.toHaveAttribute('aria-expanded');
    unmount();

    // ...and when it IS a disclosure, the state is reported and follows the prop —
    // the button that opens the inline editor is the case that needs this.
    render(
      <IconAction label="Edit work" onClick={vi.fn()} expanded>
        <PencilIcon />
      </IconAction>,
    );
    expect(screen.getByRole('button', { name: 'Edit work' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks a destructive action as danger, so the colour comes from CSS', () => {
    // `currentColor` on the SVG is what lets this work: with an emoji the bin kept
    // its own colours and could not be tinted by the button's state.
    render(
      <IconAction label="Delete work" danger onClick={vi.fn()}>
        <TrashIcon />
      </IconAction>,
    );
    expect(screen.getByRole('button', { name: 'Delete work' }).className).toContain('tbs-icon-action--danger');
  });
});
