/**
 * T12 —the chip expression input: keyboard reachability, inline creation, the
 * insert-time-name fallback, and the wrapping STRUCTURE.
 *
 * jsdom has no layout engine, so nothing here measures geometry. The wrapping
 * requirement (D-d: the box grows instead of truncating) is asserted as a
 * PROPERTY of the stylesheet (`flex-wrap`), the same "assert structure, not
 * geometry" discipline the class guard uses —measuring a height in jsdom would
 * be a test that passes for the wrong reason.
 *
 * The accessibility assertions are three SEPARATE claims (name / focusable /
 * keyboard-deletable) because they fail for different reasons: a chip can have a
 * label and still not be removable, and an undetectable failure is not a guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type React from 'react';
import { TagExpressionInput } from '@ui/shared/tag-chip-input';
import type { ChipToken } from '@shared/tag-expression';
import type { TagDefinition } from '@shared/types';

/** Mirrors the component's cap; asserted rather than re-spelled in each test. */
const CANDIDATE_LIMIT = 10;

/** Mirrors the component's popup page size. */
const IME_PAGE_SIZE = 8;

const tag = (id: string, name: string): TagDefinition => ({
  id, name, backgroundColor: '#3366cc', textColor: '#ffffff',
});

const chip = (id: string, nameAtInsert: string): ChipToken => ({
  kind: 'tag', tagId: id, nameAtInsert, backgroundColorAtInsert: '#3366cc',
});
const op = (o: 'AND' | 'OR' | 'NOT'): ChipToken => ({ kind: 'op', op: o });

/**
 * Where the caret currently sits, read from its position in the DOM.
 *
 * Module-level because two describes need it (the caret keys and the pointer
 * gestures), and a per-describe copy is how the two would come to disagree.
 */
function caretIndex(): number {
  const slots = Array.from(document.querySelectorAll('.tbs-tag-chip-input__chips > *'));
  return slots.findIndex((el) => el.classList.contains('tbs-tag-chip-input__caret')
    || (el as HTMLElement).querySelector('.tbs-tag-chip-input__caret') !== null);
}

function Harness(props: {
  initial: ChipToken[];
  tags: TagDefinition[];
  onCreateTag?: (name: string) => Promise<TagDefinition | null>;
}): React.JSX.Element {
  const [chips, setChips] = useState<ChipToken[]>(props.initial);
  return (
    <TagExpressionInput
      chips={chips}
      onChange={setChips}
      availableTags={props.tags}
      onCreateTag={props.onCreateTag ?? (() => Promise.resolve(null))}
    />
  );
}

describe('T12: R6 —every chip is named, focusable and keyboard-deletable', () => {
  it('has an accessible name containing the tag name', () => {
    render(<Harness initial={[chip('a', 'work')]} tags={[tag('a', 'work')]} />);
    expect(screen.getByRole('button', { name: 'Tag: work' })).toBeDefined();
  });

  it('is focusable', () => {
    render(<Harness initial={[chip('a', 'work')]} tags={[tag('a', 'work')]} />);
    const el = screen.getByRole('button', { name: 'Tag: work' });
    el.focus();
    expect(document.activeElement).toBe(el);
  });

  it('Backspace on a focused chip removes exactly that chip', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput
        chips={[chip('a', 'work'), op('AND'), chip('b', 'urgent')]}
        onChange={onChange}
        availableTags={[tag('a', 'work'), tag('b', 'urgent')]}
        onCreateTag={() => Promise.resolve(null)}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Tag: work' }), { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ChipToken[];
    expect(next).toHaveLength(2);
    expect(next.some((c) => c.kind === 'tag' && c.tagId === 'a')).toBe(false);
  });
});

describe('T12: D2/C7 —a deleted tag keeps its chip and shows the insert-time name', () => {
  it('renders the fallback name when the live table lacks the id, and does NOT remove the chip', () => {
    render(<Harness initial={[chip('gone', 'deprecated')]} tags={[]} />);
    // Shown by its insert-time name, and still present —C7-A: no auto-removal,
    // the user edits the expression, we never silently prune a chip.
    // The label span is the one place the display name appears as text (the
    // candidate list is empty: the live table has no tags at all).
    expect(screen.getByRole('button', { name: 'Tag: deprecated' })).toBeDefined();
    expect(screen.getByText('deprecated')).toBeDefined();
  });

  it('follows a rename: the live name is shown when the id is alive', () => {
    render(<Harness initial={[chip('a', 'old-name')]} tags={[tag('a', 'renamed')]} />);
    expect(screen.getByRole('button', { name: 'Tag: renamed' })).toBeDefined();
  });
});

describe('T12: D-b —inline creation from the candidate field', () => {
  it('offers a create row when the typed text matches no tag', () => {
    render(<Harness initial={[]} tags={[tag('a', 'work')]} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'brand-new' } });
    // The BUTTON, not any text: the group heading echoes the CANDIDATE search,
    // and a bare text match would be ambiguous between the offer and the label of
    // the list the offer sits in.
    expect(screen.getByRole('button', { name: /Create tag "brand-new"/ })).toBeDefined();
  });

  it('Enter calls onCreateTag with the typed name and selects the created chip', async () => {
    const onCreateTag = vi.fn<(name: string) => Promise<TagDefinition | null>>()
      .mockResolvedValue(tag('new-id', 'brand-new'));
    render(<Harness initial={[]} tags={[]} onCreateTag={onCreateTag} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'brand-new' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    expect(onCreateTag).toHaveBeenCalledWith('brand-new');
    // After the awaited create resolves, the new chip is present and selected.
    expect(await screen.findByRole('button', { name: 'Tag: brand-new' })).toBeDefined();
  });

  it('does NOT offer creation for a name that already exists', () => {
    render(<Harness initial={[]} tags={[tag('a', 'work')]} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'work' } });
    // The existing tag is offered as a candidate instead of a create row.
    expect(screen.queryByText(/Create tag/)).toBeNull();
  });
});

describe('T12: D-d —the container is a WRAPPING multi-line container (structure, not geometry)', () => {
  it('the chip-input rules declare flex-wrap', () => {
    // Read the stylesheet the component's classes live in; asserting the
    // PROPERTY FAMILY keeps a valid rewrite (wrap vs wrap-reverse spelling) green.
    const css = readFileSync('src/ui/styles/settings.css', 'utf8');
    const block = css.slice(css.indexOf('.tbs-tag-chip-input'));
    expect(/flex-wrap\s*:/.test(block)).toBe(true);
  });

  it('does not truncate: no overflow-hidden / text-overflow on the chip input', () => {
    const css = readFileSync('src/ui/styles/settings.css', 'utf8');
    const block = css.slice(css.indexOf('.tbs-tag-chip-input'), css.indexOf('.tbs-tag-chip-input') + 600);
    expect(/text-overflow\s*:\s*ellipsis/.test(block)).toBe(false);
  });
});

describe('T12: operators and parens are chips too (G5)', () => {
  it('renders an operator chip with an accessible name', () => {
    render(<Harness initial={[chip('a', 'work'), op('AND')]} tags={[tag('a', 'work')]} />);
    expect(screen.getByRole('button', { name: 'Operator: AND' })).toBeDefined();
  });

  it('the operator chip is actually VISIBLE —it does not inherit an invisible pair', () => {
    // The bug this pins: the shared chip rule hard-coded `color: #fff`, and only
    // a TAG chip is given a background. So `AND` rendered as white-on-white and
    // the operator position showed no text at all. Visibility is asserted as the
    // pair of facts that made it invisible —a class that supplies a background
    // and does NOT set a white text colour —because jsdom resolves no cascade.
    const { container } = render(<Harness initial={[op('AND')]} tags={[]} />);
    const opChip = container.querySelector('.tbs-tag-chip--operator');
    expect(opChip).not.toBeNull();
    expect(opChip?.textContent).toContain('AND');
    // No inline colour was pushed onto it, so the stylesheet's pair applies.
    expect((opChip as HTMLElement).style.color).toBe('');
    const css = readFileSync('src/ui/styles/settings.css', 'utf8');
    const base = css.slice(css.indexOf('.tbs-tag-chip {'), css.indexOf('.tbs-tag-chip--operator'));
    // The base rule must no longer hard-code white: that is what hid the operators.
    expect(base).not.toMatch(/color:\s*#fff/i);
    const opBlock = css.slice(css.indexOf('.tbs-tag-chip--operator'));
    expect(opBlock).toMatch(/color:\s*var\(--color-text-secondary/);
    expect(opBlock).toMatch(/background:/);
  });

  it('a TAG chip still carries its own colours (the fix did not flatten the tags)', () => {
    const { container } = render(
      <Harness initial={[chip('a', 'work')]} tags={[tag('a', 'work')]} />,
    );
    const el = container.querySelector('.tbs-tag-chip') as HTMLElement;
    expect(el.style.backgroundColor).toBe('rgb(51, 102, 204)');
    // The text colour comes from the LIVE tag, so a chip shows the appearance the
    // user set on the Tags page rather than a house default.
    expect(el.style.color).toBe('rgb(255, 255, 255)');
  });

  it('a DELETED tag falls back to a readable text colour, not white', () => {
    // No live tag => no stored text colour, and the chip must not become
    // invisible on a light remembered background.
    const light = { ...chip('gone', 'deprecated'), backgroundColorAtInsert: '#FFFF00' } as ChipToken;
    const { container } = render(<Harness initial={[light]} tags={[]} />);
    const el = container.querySelector('.tbs-tag-chip') as HTMLElement;
    expect(el.style.backgroundColor).toBe('rgb(255, 255, 0)');
    // autoTextColor picks black for a light background.
    expect(el.style.color).toBe('rgb(0, 0, 0)');
  });
});

describe('2.2 —the candidate list caps at 10 with a counted disclosure', () => {
  const manyTags = (n: number): TagDefinition[] =>
    Array.from({ length: n }, (_, i) => tag(`t${String(i)}`, `tag-${String(i)}`));

  it('shows ten tags plus a disclosure that STATES the hidden count', () => {
    // The table has no cap (C3), so a fifty-tag install rendered fifty buttons and
    // buried the operators. A bare "— would leave the user unsure whether the tag
    // they want is behind it, which is the question the control exists to answer.
    render(<Harness initial={[]} tags={manyTags(25)} />);
    expect(screen.getAllByRole('button', { name: /^Add tag-/ })).toHaveLength(CANDIDATE_LIMIT);
    const more = screen.getByRole('button', { name: 'Show all 25 tags' });
    expect(more.textContent).toContain('+15');
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('the disclosure reveals the rest and can collapse again', () => {
    render(<Harness initial={[]} tags={manyTags(25)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 25 tags' }));
    expect(screen.getAllByRole('button', { name: /^Add tag-/ })).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer tags' }));
    expect(screen.getAllByRole('button', { name: /^Add tag-/ })).toHaveLength(CANDIDATE_LIMIT);
  });

  it('no disclosure when everything fits', () => {
    render(<Harness initial={[]} tags={manyTags(4)} />);
    expect(screen.getAllByRole('button', { name: /^Add tag-/ })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('typing in the CANDIDATE search filters the candidates (25 tags -> the matching ones)', () => {
    // The candidate section has its OWN search. Using the expression buffer here
    // would be the wrong box: it is a different act (writing an expression, not
    // browsing the vocabulary).
    render(<Harness initial={[]} tags={manyTags(25)} />);
    fireEvent.change(screen.getByTestId('tag-candidate-search'), { target: { value: 'tag-1' } });
    // tag-1, tag-10..tag-19 —substrings, all still matched.
    const names = screen.getAllByRole('button', { name: /^Add tag-/ }).map((b) => b.textContent);
    expect(names).toContain('tag-1');
    expect(names).toContain('tag-17');
    expect(names).not.toContain('tag-2');
  });

  it('the two searches are INDEPENDENT (browsing does not narrow the expression)', () => {
    render(<Harness initial={[]} tags={manyTags(25)} />);
    const expression = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(expression, { target: { value: 'typed-expression' } });
    // ...the browse box still shows everything.
    expect(screen.getAllByRole('button', { name: /^Add tag-/ })).toHaveLength(CANDIDATE_LIMIT);
    // And narrowing the browse box leaves the expression buffer alone.
    fireEvent.change(screen.getByTestId('tag-candidate-search'), { target: { value: 'tag-17' } });
    expect(expression.value).toBe('typed-expression');
    expect(screen.getAllByRole('button', { name: /^Add tag-/ })).toHaveLength(1);
  });
});

describe('2.3 —the insertion point: arrow keys, Home/End, Backspace and Delete', () => {
  const three = [chip('a', 'one'), op('AND'), chip('b', 'two')];
  const tags = [tag('a', 'one'), tag('b', 'two')];

  it('starts at the end and moves LEFT with ArrowLeft', () => {
    render(<Harness initial={three} tags={tags} />);
    // `chips.length` = 3, so the caret is after the last chip.
    expect(caretIndex()).toBe(3);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowLeft' });
    expect(caretIndex()).toBe(2);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowLeft' });
    expect(caretIndex()).toBe(1);
  });

  it('Home and End jump to either end', () => {
    render(<Harness initial={three} tags={tags} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Home' });
    expect(caretIndex()).toBe(0);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'End' });
    expect(caretIndex()).toBe(3);
  });

  it('an insert lands AT the caret, not always at the end', () => {
    // The whole point of the caret: correcting the middle of an expression must
    // be an edit, not a rebuild.
    const onChange = vi.fn();
    render(
      <TagExpressionInput
        chips={three}
        onChange={onChange}
        availableTags={tags}
        onCreateTag={() => Promise.resolve(null)}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: 'Add OR' }));

    const next = onChange.mock.calls[0][0] as ChipToken[];
    expect(next).toHaveLength(4);
    // Prepended, not appended.
    expect(next[0]).toEqual({ kind: 'op', op: 'OR' });
    expect(next[1]).toEqual(three[0]);
  });

  it('Backspace removes the chip to the LEFT of the caret', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    // Caret at the end => Backspace takes the last chip (`two`).
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' });
    const next = onChange.mock.calls[0][0] as ChipToken[];
    expect(next).toHaveLength(2);
    expect(next.some((c) => c.kind === 'tag' && c.tagId === 'b')).toBe(false);
  });

  it('Delete removes the chip to the RIGHT of the caret', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Home' });
    // Caret at 0 => Delete takes the FIRST chip (`one`), not the last.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Delete' });
    const next = onChange.mock.calls[0][0] as ChipToken[];
    expect(next).toHaveLength(2);
    expect(next.some((c) => c.kind === 'tag' && c.tagId === 'a')).toBe(false);
    expect(next.some((c) => c.kind === 'tag' && c.tagId === 'b')).toBe(true);
  });

  it('the delete keys do NOT fire while there is text to edit', () => {
    // With a query in the box the keys belong to the TEXT. A chip vanishing while
    // the user is editing a word is the classic token-input bug.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wo' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the caret follows the chips when one is removed before it', () => {
    // Otherwise the insertion point would silently slide past an unrelated chip.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Home' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowRight' }); // caret = 1
    fireEvent.click(screen.getByRole('button', { name: 'Remove one' }));   // removes index 0
    // Still the SAME GAP, which is now at index 0: the boundary that sat before
    // `AND` did not move, but one chip ahead of it was removed, so its absolute
    // index shifted left by one. Leaving the index alone would have silently
    // moved the insertion point PAST `AND`.
    expect(caretIndex()).toBe(0);
  });

  it('clicking a chip selects it and does NOT move the caret', () => {
    // Selecting and positioning are separate gestures: a chip is a THING, a gap is
    // a PLACE. Moving the insertion point as a side effect of selection left the
    // user asking where their cursor had gone.
    render(<Harness initial={three} tags={tags} />);
    expect(caretIndex()).toBe(3); // the end, where it starts
    fireEvent.click(screen.getByRole('button', { name: 'Tag: two' }));
    expect(caretIndex()).toBe(3); // unchanged
    expect(screen.getByRole('button', { name: 'Tag: two' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a caret move takes FOCUS, so the next move needs no second click', () => {
    // The reported friction: two presses of `←` moved the caret once, because the
    // first press relocated the insertion point but left focus where it was, and
    // the second press then had nowhere to be handled from.
    render(<Harness initial={three} tags={tags} />);
    const before = screen.getByRole('combobox');
    fireEvent.keyDown(before, { key: 'ArrowLeft' });
    expect(caretIndex()).toBe(2);

    // The field is a DIFFERENT DOM node now — it is rendered inside the slot for
    // the caret's gap, so moving the caret unmounts one input and mounts another.
    // That replacement is exactly why a synchronous `focus()` did not stick, and
    // why the next press used to land nowhere.
    const after = screen.getByRole('combobox');
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);

    // ...and the next press works WITHOUT re-clicking, which is the whole point.
    fireEvent.keyDown(after, { key: 'ArrowLeft' });
    expect(caretIndex()).toBe(1);
  });

  it('the keys work without the field holding focus (the container owns them)', () => {
    // The regression this pins: the first cut bound the keys to the `<input>`,
    // which does not hold focus after clicking a candidate or a chip —so the
    // arrow keys did nothing in exactly the situations a caret exists for. The
    // handler is on the CONTAINER now and the event bubbles from the field.
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' })); // focus moves off the field
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'End' });
    expect(caretIndex()).toBe(3);
  });

  it('clicking the GAP between two chips puts the caret there', () => {
    // A caret implies "you can point at a position", which had no mouse answer:
    // the gaps between chips were inert.
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByTestId('chip-gap-2'));
    expect(caretIndex()).toBe(2);
  });

  it('clicking the trailing gap moves the caret to the end', () => {
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByTestId('chip-gap-0'));
    expect(caretIndex()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Move the cursor to the end' }));
    expect(caretIndex()).toBe(3);
  });

  it('the caret rule declares a BLINK (an unblinking rule is a divider)', () => {
    render(<Harness initial={three} tags={tags} />);
    expect(document.querySelector('.tbs-tag-chip-input__caret')).not.toBeNull();
    const css = readFileSync('src/ui/styles/settings.css', 'utf8');
    const block = css.slice(css.indexOf('.tbs-tag-chip-input__caret'), css.indexOf('@keyframes tbs-caret-blink'));
    expect(block).toMatch(/animation:\s*tbs-caret-blink/);
    // ...and the blink must not HIDE the caret under reduced motion.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('tbs-caret-blink')));
    expect(reduced).toMatch(/\.tbs-tag-chip-input__caret\s*\{[^}]*opacity:\s*1/);
  });
});

describe('the keyboard composition popup (the "input method" window)', () => {
  const three = [chip('a', 'one'), op('AND'), chip('b', 'two')];
  const tags = [tag('a', 'one'), tag('b', 'two'), tag('c', 'urgent')];

  const field = (): HTMLElement => screen.getByRole('combobox');
  const items = (): HTMLElement[] =>
    screen.queryAllByRole('option').map((el) => el as HTMLElement);

  it('is a COMBOBOX whose popup opens on typing', () => {
    // The field was a plain textbox with no keyboard path to a candidate at all,
    // so the control was point-and-click only. `combobox` is what tells a screen
    // reader there is a list attached to what it is typing into.
    render(<Harness initial={[]} tags={tags} />);
    const el = field();
    expect(el.getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(el, { target: { value: 'ur' } });
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('tag-ime-popup')).toBeDefined();
  });

  it('offers matching TAGS, matching OPERATORS and a create row —all three kinds', () => {
    // The three things a tag expression is made of, so typing alone can build
    // one rather than only filtering a list.
    render(<Harness initial={[]} tags={tags} />);
    fireEvent.change(field(), { target: { value: 'o' } });
    const labels = items().map((el) => el.textContent ?? '');
    // `one` (a tag containing "o"), `OR` (an operator starting with it), and the
    // create row for the literal buffer.
    expect(labels.some((l) => l.includes('one'))).toBe(true);
    expect(labels.some((l) => l.includes('OR'))).toBe(true);
    expect(labels.some((l) => l.includes('Create tag'))).toBe(true);
  });

  it('does NOT open on an empty buffer (typing is what opens it)', () => {
    // Opening on focus would drop a list over the rows below before the user has
    // asked for anything, and the operators are already permanently on screen in
    // the tray. The popup is for TYPING; the tray is for browsing.
    render(<Harness initial={[]} tags={tags} />);
    expect(screen.queryByTestId('tag-ime-popup')).toBeNull();
    fireEvent.focus(field());
    expect(screen.queryByTestId('tag-ime-popup')).toBeNull();
    // ...and clearing the buffer takes the popup away again.
    fireEvent.change(field(), { target: { value: 'ur' } });
    expect(screen.getByTestId('tag-ime-popup')).toBeDefined();
    fireEvent.change(field(), { target: { value: '' } });
    expect(screen.queryByTestId('tag-ime-popup')).toBeNull();
  });

  it('Enter commits the top candidate into a chip and clears the buffer', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={[]} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.change(field(), { target: { value: 'ur' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    const next = onChange.mock.calls[0][0] as ChipToken[];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: 'tag', tagId: 'c' });
    // The buffer is spent, and the popup closes with it.
    expect((field() as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('tag-ime-popup')).toBeNull();
  });

  it('↑↑walk the candidates and Enter commits the HIGHLIGHTED one', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={[]} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.change(field(), { target: { value: 'o' } });
    const all = items();
    expect(all.length).toBeGreaterThan(1);
    // Nothing is highlighted initially, so Enter would take the first row.
    expect(all[0].getAttribute('aria-selected')).toBe('false');

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(items()[0].getAttribute('aria-selected')).toBe('true');
    // The highlight is EXPOSED as the field's active descendant, which is how a
    // screen reader is told which option the arrows are on.
    expect(field().getAttribute('aria-activedescendant')).toBe(items()[0].id);

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    const second = items()[1];
    expect(second.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field(), { key: 'Enter' });
    const next = onChange.mock.calls[0][0] as ChipToken[];
    // The second row's own text decided what was committed.
    const secondLabel = second.textContent ?? '';
    if (secondLabel.includes('OR')) {
      expect(next[0]).toMatchObject({ kind: 'op', op: 'OR' });
    } else {
      expect(next[0].kind).toBe('tag');
    }
  });

  it('↑wraps to the top rather than stopping, so the list is a cycle', () => {
    render(<Harness initial={[]} tags={tags} />);
    fireEvent.change(field(), { target: { value: 'o' } });
    // Starting from -1 (nothing highlighted) the sequence is -1, 0, 1, —n-1, then 0.
    // So `n` presses land on the LAST row and one more wraps to the first —which
    // asserts both ends of the cycle rather than only that it did not stop.
    const count = items().length;
    for (let i = 0; i < count; i += 1) fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(items()[count - 1].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(items()[0].getAttribute('aria-selected')).toBe('true');

    // ↑from the first row wraps to the last, so neither direction is a dead end.
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(items()[count - 1].getAttribute('aria-selected')).toBe('true');
  });

  it('Escape abandons the COMPOSITION, not the expression', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.change(field(), { target: { value: 'ur' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect((field() as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('tag-ime-popup')).toBeNull();
    // The chips are untouched: Escape is about the word being typed.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('typing an OPERATOR name commits an operator chip, not a tag', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={[]} onChange={onChange} availableTags={[]} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.change(field(), { target: { value: 'AND' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect((onChange.mock.calls[0][0] as ChipToken[])[0]).toMatchObject({ kind: 'op', op: 'AND' });
  });

  it('clicking a popup row commits it WITHOUT losing the popup to the blur', () => {
    // `mousedown` + `preventDefault`, not `click`: a click moves focus out of the
    // field first, which closes the popup before the click lands.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={[]} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.change(field(), { target: { value: 'urgent' } });
    const row = items().find((el) => (el.textContent ?? '').includes('urgent'));
    expect(row).toBeDefined();
    fireEvent.mouseDown(row as HTMLElement);
    expect((onChange.mock.calls[0][0] as ChipToken[])[0]).toMatchObject({ kind: 'tag', tagId: 'c' });
  });

  it('the create row commits through the parent’ writer', async () => {
    const onCreateTag = vi.fn().mockResolvedValue(tag('new', 'brand-new'));
    render(
      <TagExpressionInput
        chips={[]}
        onChange={vi.fn()}
        availableTags={[]}
        onCreateTag={onCreateTag as unknown as (name: string) => Promise<TagDefinition | null>}
      />,
    );
    fireEvent.change(field(), { target: { value: 'brand-new' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => { expect(onCreateTag).toHaveBeenCalledWith('brand-new'); });
  });
});

describe('the popup is anchored AT THE CARET, not at the control', () => {
  const three = [chip('a', 'one'), op('AND'), chip('b', 'two')];
  const tags = [tag('a', 'one'), tag('b', 'two')];

  it('follows the insertion point through the expression', () => {
    // The caret is moved by CLICKING A GAP, not with Home/arrow keys: with text in
    // the buffer those keys belong to the TEXT (that rule is asserted separately),
    // so they are not the gesture that relocates the chip insertion point while a
    // composition is open.
    // "In the expression, below the caret" —the anchor is the caret's own gap
    // index, so the popup follows the insertion point (and would follow it onto
    // the wrapped line the caret is actually on).
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByTestId('chip-gap-1'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } });
    expect(screen.getByTestId('tag-ime-popup').getAttribute('data-anchor-testid')).toBe('chip-gap-1');

    // Placing the caret elsewhere makes the popup follow it.
    fireEvent.click(screen.getByTestId('chip-gap-3'));
    expect(screen.getByTestId('tag-ime-popup').getAttribute('data-anchor-testid')).toBe('chip-gap-3');
  });

  it('the anchored gap element actually EXISTS (the anchor is not dangling)', () => {
    // A data attribute naming an element that is not rendered would be an anchor
    // in name only —and the popup cannot be positioned against nothing.
    render(<Harness initial={three} tags={tags} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } });
    const anchor = screen.getByTestId('tag-ime-popup').getAttribute('data-anchor-testid') ?? '';
    expect(screen.getByTestId(anchor)).toBeDefined();
  });

  it('the popup is INSIDE the slot at the caret, not a child of the whole control', () => {
    // This is what makes it a menu AT the caret with a sensible, fixed width: the
    // containing block is the caret's own box on the line. Rendered as a child of
    // the control it would span the control and sit under the whole sub-component,
    // which is exactly the reported complaint.
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByTestId('chip-gap-1'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } });
    const popup = screen.getByTestId('tag-ime-popup');
    const slot = screen.getByTestId('chip-gap-1').closest('.tbs-tag-chip-input__slot');
    expect(slot).not.toBeNull();
    expect(slot?.contains(popup)).toBe(true);
    // ...and NOT a direct child of the field row / control.
    expect(popup.parentElement?.className).not.toContain('tbs-tag-chip-input__chips');
  });

  it('at the END of the expression the popup is inside a slot too, not the chip flow', () => {
    // The reported bug: with the caret after the last chip the popup was a direct
    // child of the chip FLOW, so its containing block was that whole flow — the
    // popup rendered below the entire sub-component instead of under the caret.
    render(<Harness initial={three} tags={tags} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } });
    const popup = screen.getByTestId('tag-ime-popup');
    // Its parent is a slot (the positioning context), NOT the flow itself.
    expect(popup.parentElement?.className).toContain('tbs-tag-chip-input__slot');
    expect(popup.parentElement?.className).not.toContain('tbs-tag-chip-input__chips');
    expect(document.querySelector('.tbs-tag-chip-input__chips')?.contains(popup)).toBe(true);
  });

  it('the field at the end shares that slot, so the popup is under the field', () => {
    render(<Harness initial={three} tags={tags} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } });
    // Caret starts at the end (index 3).
    const slot = screen.getByTestId('chip-slot-3');
    expect(slot.querySelector('.tbs-tag-chip-input__field')).not.toBeNull();
    expect(slot.contains(screen.getByTestId('tag-ime-popup'))).toBe(true);
  });
});

describe('the insertion point is a POSITION in the expression, not always its end', () => {
  const three = [chip('a', 'one'), op('AND'), chip('b', 'two')];
  const tags = [tag('a', 'one'), tag('b', 'two')];

  it('the field is rendered at the caret: mid-expression when the caret is there', () => {
    // The bug: the field was rendered once, after every chip, so the text caret
    // could only ever sit at the END — "type in the middle of the expression" was
    // unreachable no matter where the insertion point was moved to.
    render(<Harness initial={three} tags={tags} />);
    const fieldAt = (): Element | null => document.querySelector('.tbs-tag-chip-input__field');

    // Default caret is the end, and the field follows the last chip.
    expect(fieldAt()).not.toBeNull();

    // Move the insertion point before the SECOND chip...
    fireEvent.click(screen.getByTestId('chip-gap-1'));
    // ...and the field is now between `one` and `AND`, not after `two`.
    const chips = Array.from(document.querySelectorAll('.tbs-tag-chip-input__chips > *'));
    const fieldIndex = chips.findIndex((el) => el.querySelector('.tbs-tag-chip-input__field') !== null);
    const chipAt = (i: number): string =>
      chips[i].querySelector('.tbs-tag-chip__label')?.textContent ?? '';
    expect(fieldIndex).toBeGreaterThanOrEqual(0);
    // The element just before the field's slot is the first chip.
    expect(chipAt(fieldIndex - 1)).toBe('one');
  });

  it('typing at that position inserts the chip THERE, not at the end', () => {
    // The field's position IS the insertion point, so this is the observable
    // consequence — and the one a user would notice.
    const onChange = vi.fn<(next: ChipToken[]) => void>();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.click(screen.getByTestId('chip-gap-1'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(4);
    // It landed at index 1 — between `one` and the operator `AND`.
    expect(next[0]).toMatchObject({ kind: 'tag', tagId: 'a' });
    expect(next[1]).toMatchObject({ kind: 'tag' });
    expect(next[2]).toMatchObject({ kind: 'op', op: 'AND' });
  });

  it('the field survives a commit whose chip has not arrived yet', () => {
    // `insertAt` advances the caret in the same tick as it asks the parent for the
    // chip, so the caret briefly points one past the end. Reading the raw index
    // rendered NO field in that window — focus and typing silently dead.
    const onChange = vi.fn<(next: ChipToken[]) => void>();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    // The parent ignored the change, so `chips` did NOT grow.
    expect(onChange).toHaveBeenCalled();
    expect(document.querySelector('.tbs-tag-chip-input__field')).not.toBeNull();
  });
});

describe('the popup pages when there are more candidates than fit (- and =)', () => {
  /** 20 tags whose names all match `tag`, so the popup is long. */
  const many = Array.from({ length: 20 }, (_, i) => tag(`t${String(i)}`, `tag-${String(i).padStart(2, '0')}`));
  const pageCount = Math.ceil(20 / IME_PAGE_SIZE);

  it('shows one page, states "1 / N", and names the keys', () => {
    render(<Harness initial={[]} tags={many} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tag' } });
    // A page of rows, not all twenty.
    expect(screen.getAllByRole('option')).toHaveLength(IME_PAGE_SIZE);
    const pager = screen.getByTestId('tag-ime-pager');
    expect(pager.textContent).toContain(`1 / ${String(pageCount)}`);
    // The keys are stated: a shortcut nobody is told about is one nobody has.
    expect(pager.textContent).toContain('- =');
  });

  it('= goes forward, - goes back, and the rows change with the page', () => {
    render(<Harness initial={[]} tags={many} />);
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'tag' } });
    const firstPage = screen.getAllByRole('option').map((o) => o.textContent);

    fireEvent.keyDown(field, { key: '=' });
    const secondPage = screen.getAllByRole('option').map((o) => o.textContent);
    expect(screen.getByTestId('tag-ime-pager').textContent).toContain('2 /');
    // A DIFFERENT page, and still a full one.
    expect(secondPage).not.toEqual(firstPage);
    expect(secondPage).toHaveLength(IME_PAGE_SIZE);

    fireEvent.keyDown(field, { key: '-' });
    expect(screen.getByTestId('tag-ime-pager').textContent).toContain('1 /');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(firstPage);
  });

  it('the page cursor does not run off either end', () => {
    render(<Harness initial={[]} tags={many} />);
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'tag' } });
    // Backwards from the first page stays on the first page.
    fireEvent.keyDown(field, { key: '-' });
    expect(screen.getByTestId('tag-ime-pager').textContent).toContain('1 /');
    // ...and forwards past the last page stays on the last.
    for (let i = 0; i < pageCount + 2; i += 1) fireEvent.keyDown(field, { key: '=' });
    expect(screen.getByTestId('tag-ime-pager').textContent).toContain(`${String(pageCount)} /`);
  });

  it('turning the page CLEARS the highlight (it indexes a page, not the list)', () => {
    render(<Harness initial={[]} tags={many} />);
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'tag' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field, { key: '=' });
    // Nothing is highlighted on the new page: the old index pointed at a row the
    // user has not seen.
    expect(screen.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('editing the buffer returns to page one', () => {
    // Otherwise a narrower result set would open on a page that no longer exists.
    render(<Harness initial={[]} tags={many} />);
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'tag' } });
    fireEvent.keyDown(field, { key: '=' });
    expect(screen.getByTestId('tag-ime-pager').textContent).toContain('2 /');
    fireEvent.change(field, { target: { value: 'tag-1' } });
    expect(screen.getByTestId('tag-ime-pager').textContent).toContain('1 /');
  });

  it('no pager when everything fits on one page', () => {
    render(<Harness initial={[]} tags={[tag('a', 'work')]} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wo' } });
    expect(screen.queryByTestId('tag-ime-pager')).toBeNull();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('Enter commits from the page the user is LOOKING at', () => {
    // The bug a page-blind Enter would have: nothing highlighted on page 2 would
    // otherwise commit page 1's first row while the user reads page 2.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={[]} onChange={onChange} availableTags={many} onCreateTag={() => Promise.resolve(null)} />,
    );
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'tag' } });
    const pageOneFirst = screen.getAllByRole('option')[0].textContent;
    fireEvent.keyDown(field, { key: '=' });
    const pageTwoFirst = screen.getAllByRole('option')[0].textContent;
    expect(pageTwoFirst).not.toBe(pageOneFirst);

    fireEvent.keyDown(field, { key: 'Enter' });
    const committed = (onChange.mock.calls[0][0] as ChipToken[])[0];
    expect(committed.kind).toBe('tag');
    // It committed the row page TWO shows first, not page one's.
    expect((committed as { tagId: string }).tagId).toBe(many[IME_PAGE_SIZE].id);
  });
});

describe('the candidate tray is collapsible (the keyboard no longer needs it)', () => {
  const tags = [tag('a', 'one'), tag('b', 'two')];

  it('starts OPEN, so the primary action is still one click', () => {
    render(<Harness initial={[]} tags={tags} />);
    const toggle = screen.getByRole('button', { name: /Hide candidates/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Add one' })).toBeDefined();
  });

  it('collapses and re-opens on the toggle', () => {
    render(<Harness initial={[]} tags={tags} />);
    fireEvent.click(screen.getByRole('button', { name: /Hide candidates/ }));
    // The region is `hidden`, and its contents are gone from the tree.
    expect(screen.getByRole('button', { name: /Show candidates/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Tag candidates' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show candidates/ }));
    expect(screen.getByRole('region', { name: 'Tag candidates' })).toBeDefined();
  });

  it('a collapsed tray does not stop the popup from working', () => {
    // The whole point: once typing can build the expression, the tray is a
    // convenience rather than a prerequisite.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={[]} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Hide candidates/ }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'one' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect((onChange.mock.calls[0][0] as ChipToken[])[0]).toMatchObject({ kind: 'tag', tagId: 'a' });
  });

  it('the collapse state is asserted in the stylesheet, not only in the DOM', () => {
    // `display: flex` outranks the browser's `[hidden] { display: none }`, so
    // without the guard the collapsed tray would stay visible.
    const css = readFileSync('src/ui/styles/settings.css', 'utf8');
    expect(css).toMatch(/\.tbs-tag-chip-input__tray\[hidden\]\s*\{[^}]*display:\s*none/);
    // ...and the popup floats, so it cannot push the page around on each keystroke.
    const ime = css.slice(css.indexOf('.tbs-tag-chip-input__ime {'));
    expect(ime).toMatch(/position:\s*absolute/);
  });
});

describe('the redesign’ structural claims', () => {
  const three = [chip('a', 'one'), op('AND'), chip('b', 'two')];
  const tags = [tag('a', 'one'), tag('b', 'two')];

  it('is a LABELLED control, not a placeholder-only field', () => {
    // The placeholder is not a label: it disappears the moment the first chip is
    // added, i.e. exactly when someone returning may have forgotten what the box
    // does. Every other field on these pages has a visible name.
    render(<Harness initial={three} tags={tags} />);
    const group = screen.getByRole('group', { name: 'Filter by tags' });
    expect(group).toBeDefined();
    // The label is real text on screen, not just an accessible name.
    expect(screen.getByText('Filter by tags')).toBeDefined();
    // ...and there is exactly ONE textbox: the field inside, never the container.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('still reaches the primary action in ONE click (the tray is not collapsed)', () => {
    // The first attempt at the height complaint hid the candidates behind a
    // group switch, which added a click to adding a tag. Two headed sections keep
    // the clarity without that cost.
    render(<Harness initial={[]} tags={tags} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one' }));
    expect(screen.getByRole('button', { name: 'Tag: one' })).toBeDefined();
  });

  it('separates the tags from the grammar, each with its own heading', () => {
    render(<Harness initial={[]} tags={tags} />);
    expect(screen.getByRole('region', { name: 'Tag candidates' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Operators' })).toBeDefined();
    // Both visible at once, so neither group is behind a click.
    expect(screen.getByRole('button', { name: 'Add one' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add AND' })).toBeDefined();
  });

  it('names the active search so the filtered list explains itself', () => {
    render(<Harness initial={[]} tags={[tag('a', 'work')]} />);
    fireEvent.change(screen.getByTestId('tag-candidate-search'), { target: { value: 'zzz' } });
    expect(screen.getByText(/Matching/)).toBeDefined();
    expect(screen.getByText(/No tags match/)).toBeDefined();
  });

  it('the tag search sits INSIDE the tags section, not under the expression label', () => {
    // The placement complaint: a search box directly under `Filter by tags` reads
    // as filtering the EXPRESSION. It belongs to the candidates it narrows.
    render(<Harness initial={[]} tags={[tag('a', 'work')]} />);
    const section = screen.getByRole('region', { name: 'Tag candidates' });
    expect(within(section).getByTestId('tag-candidate-search')).toBeDefined();
    // ...and NOT inside the expression field row.
    const fieldRow = document.querySelector('.tbs-tag-chip-input__field-row') as HTMLElement;
    expect(within(fieldRow).queryByTestId('tag-candidate-search')).toBeNull();
  });

  it('shows a candidate in the tag’ OWN colour (what you add is what you see)', () => {
    render(<Harness initial={[]} tags={tags} />);
    const swatch = document.querySelector('.tbs-tag-chip-input__candidate-swatch') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(51, 102, 204)');
    // Decorative: the name beside it carries the meaning, so the swatch is not
    // announced twice.
    expect(swatch.getAttribute('aria-hidden')).toBe('true');
  });

  it('states the gesture set, so multi-select is not folklore', () => {
    render(<Harness initial={three} tags={tags} />);
    const hint = screen.getByText(/Ctrl-click or Shift-click/);
    expect(hint.textContent).toMatch(/drag to reorder/);
    // Only once there is something to operate on.
    expect(hint.textContent).toMatch(/Backspace/);
  });

  it('reserves the batch row so a selection does not shift the layout', () => {
    // Content Jumping: a bar that appears/disappears moves every row below it.
    const { container } = render(<Harness initial={three} tags={tags} />);
    expect(container.querySelector('.tbs-tag-chip-input__selection')).not.toBeNull();
    // The row is present with no selection, and carries no label until it has
    // content (an empty named group is noise in the accessibility tree).
    expect(screen.queryByRole('group', { name: 'Selected chips' })).toBeNull();
    const css = readFileSync('src/ui/styles/settings.css', 'utf8');
    const block = css.slice(css.indexOf('.tbs-tag-chip-input__selection'));
    expect(block).toMatch(/min-height:\s*\d/);
  });

  it('gives the whole control a focus ring (the field inside is the target)', () => {
    const css = readFileSync('src/ui/styles/settings.css', 'utf8');
    const block = css.slice(css.indexOf('.tbs-tag-chip-input:focus-within'));
    expect(block).toMatch(/box-shadow:/);
  });
});

describe('2.3 —selection: click / Ctrl-click / Shift-click, and the batch action', () => {
  const three = [chip('a', 'one'), op('AND'), chip('b', 'two')];
  const tags = [tag('a', 'one'), tag('b', 'two')];

  // `queryAllByRole`, not `getAllByRole`: the latter THROWS when nothing matches,
// and "nothing is selected" is one of the states this helper has to report.
  const pressedNames = (): string[] =>
    screen.queryAllByRole('button', { pressed: true }).map((b) => b.getAttribute('aria-label') ?? '');

  it('a plain click replaces the selection with that one chip', () => {
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    expect(pressedNames()).toEqual(['Tag: one']);
    fireEvent.click(screen.getByRole('button', { name: 'Operator: AND' }));
    expect(pressedNames()).toEqual(['Operator: AND']);
  });

  it('Ctrl-click toggles a chip into and out of the selection', () => {
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tag: two' }), { ctrlKey: true });
    expect(pressedNames().sort()).toEqual(['Tag: one', 'Tag: two']);
    fireEvent.click(screen.getByRole('button', { name: 'Tag: two' }), { ctrlKey: true });
    expect(pressedNames()).toEqual(['Tag: one']);
  });

  it('Shift-click extends from the anchor, in either direction', () => {
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tag: two' }), { shiftKey: true });
    expect(pressedNames().sort()).toEqual(['Operator: AND', 'Tag: one', 'Tag: two']);

    // ...and backwards from the same anchor.
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Operator: AND' }), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    expect(pressedNames()).toEqual(['Tag: one']);
  });

  it('the batch Remove appears only with a selection and removes exactly those chips', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    // No selection => no batch affordance (a permanently visible button that does
    // nothing most of the time is the kind of control this codebase avoids).
    expect(screen.queryByRole('group', { name: 'Selected chips' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tag: two' }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2' }));

    const next = onChange.mock.calls[0][0] as ChipToken[];
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({ kind: 'op', op: 'AND' });
  });

  it('a delete key removes the whole SELECTION, not just the neighbour', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tag: two' }), { ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Delete' });
    expect((onChange.mock.calls[0][0] as ChipToken[])).toHaveLength(1);
  });

  it('clicking a GAP clears the selection (a caret is not a selection)', () => {
    render(<Harness initial={three} tags={tags} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    expect(pressedNames()).toHaveLength(1);
    fireEvent.click(screen.getByTestId('chip-gap-3'));
    expect(pressedNames()).toHaveLength(0);
  });
});

describe('2.3 —drag to reorder, and the marquee', () => {
  const three = [chip('a', 'one'), op('AND'), chip('b', 'two')];
  const tags = [tag('a', 'one'), tag('b', 'two')];

  /**
   * Drag `fromName` and drop it in a GAP, returning the write.
   *
   * The gap is addressed by index, and the drop lands on that gap's element. That
   * element sits exactly at its insertion point, so this drives the REAL handler
   * (`dropAtGap`) without reimplementing the pointer-to-gap hit test —which is
   * the coordinate maths jsdom cannot do (every rectangle is zeroed).
   *
   * Gap `0` is the start of the expression and gap `chips.length` is the end.
   */
  function dragChipToGap(
    fromName: string,
    gap: number,
    onChange: ReturnType<typeof vi.fn>,
  ): ChipToken[] {
    const from = screen.getByRole('button', { name: fromName });
    const to = screen.getByTestId(`chip-gap-${String(gap)}`);
    const data = new Map<string, string>();
    const transfer = {
      setData: (k: string, v: string) => { data.set(k, v); },
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(from, { dataTransfer: transfer });
    fireEvent.dragOver(to, { dataTransfer: transfer });
    fireEvent.drop(to, { dataTransfer: transfer });
    return onChange.mock.calls[0][0] as ChipToken[];
  }

  it('dragging a chip into a gap moves it there', () => {
    // The move is an ARRAY MOVE, so it can neither lose nor duplicate a token —
    // which a naive "insert then delete by index" gets wrong.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    const next = dragChipToGap('Tag: two', 0, onChange);
    expect(next).toHaveLength(3);
    // `two` moved from index 2 to the START.
    expect(next[0]).toEqual(three[2]);
    expect(next[1]).toEqual(three[0]);
    expect(next[2]).toEqual(three[1]);
  });

  it('a chip can be dragged to the END of the expression', () => {
    // The requirement this closes: the trailing gap is the only surface that
    // means "the end", because every chip beside it means "before me". Without a
    // droppable trailing gap, dragging something to the end had nowhere to land.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    // `one` (index 0) to the end => last.
    const next = dragChipToGap('Tag: one', 3, onChange);
    expect(next).toEqual([three[1], three[2], three[0]]);
  });

  it('a chip can be dragged to the BEGINNING of the expression', () => {
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    const next = dragChipToGap('Tag: two', 0, onChange);
    expect(next[0]).toEqual(three[2]);
  });

  it('dragging a SELECTED chip carries the whole selection to the END', () => {
    // Dragging part of a selection moves all of it (the file-manager rule). The
    // block keeps its relative order, and the COUNT is unchanged —which is what
    // catches a per-chip loop that drops or duplicates when the range being moved
    // overlaps the destination.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    // Select `one` and `AND` (indices 0 and 1), then drag the block to the end.
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Operator: AND' }), { ctrlKey: true });

    const next = dragChipToGap('Tag: one', 3, onChange);
    expect(next).toHaveLength(3);
    // The whole block went to the end, in its original order.
    expect(next).toEqual([three[2], three[0], three[1]]);
  });

  it('dragging a block back onto itself is a no-op, not a shuffle', () => {
    // Dropping a contiguous run into its own gap is "put it back" —and the
    // primitive has to say so rather than rebuilding an identical array.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Operator: AND' }), { ctrlKey: true });
    dragChipToGap('Tag: one', 0, onChange); // gap 0 is where the block already is
    expect(onChange.mock.calls[0][0]).toEqual(three);
  });

  it('dragging an UNSELECTED chip moves only that chip', () => {
    // The other half of the rule: being next to a selection is not being in it.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' })); // selects index 0
    const next = dragChipToGap('Tag: two', 0, onChange);              // drags index 2 only
    expect(next).toEqual([three[2], three[0], three[1]]);
    // ...and the dragged chip is now the selection (it was a plain drag of one).
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('the DROP INDICATOR marks the gap, and the trailing gap can be marked', () => {
    // The indicator lives on the gap element, so it can show the two positions
    // that have no chip on one side of them —which the old chip-level indicator
    // structurally could not.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    const endGap = screen.getByTestId('chip-gap-3');
    const data = new Map<string, string>();
    const transfer = {
      setData: (k: string, v: string) => { data.set(k, v); },
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Tag: one' }), { dataTransfer: transfer });
    fireEvent.dragOver(endGap, { dataTransfer: transfer });
    expect(endGap.className).toMatch(/slot-gap--drop/);
    // The start gap is markable too, so both ends of the expression are visible
    // drop locations.
    const startGap = screen.getByTestId('chip-gap-0');
    fireEvent.dragOver(startGap, { dataTransfer: transfer });
    expect(startGap.className).toMatch(/slot-gap--drop/);
  });

  it('a drag payload from OUTSIDE the control is refused, not exploded', () => {
    // `JSON.parse` throws on a plain text drag, so the handler has to survive one
    // rather than taking the whole expression down with it.
    const onChange = vi.fn();
    render(
      <TagExpressionInput chips={three} onChange={onChange} availableTags={tags} onCreateTag={() => Promise.resolve(null)} />,
    );
    const to = screen.getByRole('button', { name: 'Tag: one' });
    const transfer = {
      setData: () => {},
      getData: () => 'https://example.com/',
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.drop(to, { dataTransfer: transfer });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the marquee element exists only while a sweep is in progress', () => {
    render(<Harness initial={three} tags={tags} />);
    const flow = document.querySelector('.tbs-tag-chip-input__chips') as HTMLElement;
    expect(screen.queryByTestId('chip-marquee')).toBeNull();

    // A press on the FLOW's own background is what starts a sweep.
    fireEvent.mouseDown(flow, { button: 0, clientX: 5, clientY: 5 });
    expect(screen.getByTestId('chip-marquee')).not.toBeNull();
    fireEvent.mouseUp(flow);
    expect(screen.queryByTestId('chip-marquee')).toBeNull();
  });

  it('a CLICK on empty space (no sweep) puts the caret there', () => {
    // The gap buttons are only 6px wide, so the obvious gesture —clicking the
    // empty space before the first chip or after the last one —landed on the
    // flow's background, which started a sweep and moved nothing. A press that
    // never travels means "a position", not "a range".
    render(<Harness initial={three} tags={tags} />);
    const flow = document.querySelector('.tbs-tag-chip-input__chips') as HTMLElement;
    // jsdom reports zeroed rectangles, so the nearest-chip lookup finds nothing
    // and the caret lands at the end —which is exactly the "click after the
    // expression" case, and it is DETERMINISTIC rather than accidental.
    fireEvent.mouseDown(flow, { button: 0, clientX: 400, clientY: 4 });
    fireEvent.mouseUp(flow, { button: 0, clientX: 400, clientY: 4 });
    expect(caretIndex()).toBe(3);
    // ...and it did not leave a marquee behind.
    expect(screen.queryByTestId('chip-marquee')).toBeNull();
  });

  it('a click on empty space also clears the selection', () => {
    render(<Harness initial={three} tags={tags} />);
    const flow = document.querySelector('.tbs-tag-chip-input__chips') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Tag: one' }));
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(1);
    fireEvent.mouseDown(flow, { button: 0, clientX: 400, clientY: 4 });
    fireEvent.mouseUp(flow, { button: 0, clientX: 400, clientY: 4 });
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('a SWEEP still selects a range and does not move the caret', () => {
    // The other half: once the pointer travels, it is a range, so the caret must
    // stay put and the marquee must have existed.
    render(<Harness initial={three} tags={tags} />);
    const flow = document.querySelector('.tbs-tag-chip-input__chips') as HTMLElement;
    fireEvent.mouseDown(flow, { button: 0, clientX: 2, clientY: 2 });
    fireEvent.mouseMove(flow, { clientX: 90, clientY: 40 });
    expect(screen.getByTestId('chip-marquee')).not.toBeNull();
    fireEvent.mouseUp(flow, { button: 0, clientX: 90, clientY: 40 });
    expect(screen.queryByTestId('chip-marquee')).toBeNull();
    // The caret was not hijacked by the sweep.
    expect(caretIndex()).toBe(3);
  });

  it('a press that lands on a CHIP does not start a sweep', () => {
    // Otherwise the sweep would swallow the chip click that selects it.
    render(<Harness initial={three} tags={tags} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Tag: one' }), { button: 0, clientX: 5, clientY: 5 });
    expect(screen.queryByTestId('chip-marquee')).toBeNull();
  });
});
