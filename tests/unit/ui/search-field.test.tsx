/**
 * The ONE search box — the behaviours a shared class could not have fixed.
 *
 * The classes were already shared (`tbs-shared-search`) and the boxes had still
 * drifted: one rendered 12px instead of 13px, the clear affordance was whatever the
 * user's browser drew, and the keyboard focus ring had been suppressed by the
 * mouse-focus rule. Those are structural and stateful, so they are asserted here
 * rather than left to the class-name guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchField } from '@ui/shared/search-field';

const base = {
  placeholder: 'Search tags...',
  ariaLabel: 'Search tags',
};

describe('SearchField — the clear affordance is OURS, not the browser’s', () => {
  it('offers no clear button while there is nothing to clear', () => {
    // A permanently visible ✕ is an affordance for an action that does nothing.
    render(<SearchField {...base} value="" onChange={vi.fn()} testId="s" />);
    expect(screen.queryByTestId('s-clear')).toBeNull();
  });

  it('shows a LABELLED clear button once there is a query, and clears on click', () => {
    const onChange = vi.fn();
    render(<SearchField {...base} value="work" onChange={onChange} testId="s" />);

    const clear = screen.getByTestId('s-clear');
    // Labelled: an icon-only control needs an accessible name, and it names WHICH
    // search it clears (several can be on screen at once).
    expect(clear.getAttribute('aria-label')).toBe('Clear search tags');
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('the clear button is type="button", so it cannot submit a surrounding form', () => {
    // Inside a form a bare `<button>` submits — clearing the search would also save
    // the form, which is the kind of bug that only shows up in the real surface.
    render(<SearchField {...base} value="work" onChange={vi.fn()} testId="s" />);
    expect(screen.getByTestId('s-clear').getAttribute('type')).toBe('button');
  });

  it('the icon is an SVG, not a glyph (so its weight and size are controllable)', () => {
    render(<SearchField {...base} value="work" onChange={vi.fn()} testId="s" />);
    const svg = screen.getByTestId('s-clear').querySelector('svg');
    expect(svg).not.toBeNull();
    // Decorative: the button's `aria-label` is the accessible name.
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not offer to clear a DISABLED field', () => {
    render(<SearchField {...base} value="work" onChange={vi.fn()} disabled testId="s" />);
    expect(screen.queryByTestId('s-clear')).toBeNull();
  });
});

describe('SearchField — one control, one shape', () => {
  it('carries the shared input class so every box shares one skin', () => {
    render(<SearchField {...base} value="" onChange={vi.fn()} testId="s" />);
    const input = screen.getByTestId('s');
    expect(input.className).toContain('tbs-shared-search');
    // ...and is wrapped by the element that positions the clear button.
    expect(input.parentElement?.className).toContain('tbs-search-field');
  });

  it('is a search input with the given label and placeholder, controlled by the caller', () => {
    const onChange = vi.fn();
    render(<SearchField {...base} value="abc" onChange={onChange} testId="s" />);
    const input = screen.getByLabelText('Search tags') as HTMLInputElement;
    expect(input.type).toBe('search');
    expect(input.value).toBe('abc');
    expect(input.getAttribute('placeholder')).toBe('Search tags...');
    fireEvent.change(input, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledWith('abcd');
  });

  it('passes a toolbar class through to the WRAPPER, not the input', () => {
    // Toolbars size the wrapper (the flex item); putting their class on the input
    // would fight the input's own `flex: 1`.
    render(<SearchField {...base} value="" onChange={vi.fn()} className="custom-toolbar-x" testId="s" />);
    expect(screen.getByTestId('s').parentElement?.className).toContain('custom-toolbar-x');
    expect(screen.getByTestId('s').className).not.toContain('custom-toolbar-x');
  });
});
