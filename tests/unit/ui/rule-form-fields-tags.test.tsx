/**
 * T13 — the shared rule form gains a tag selector, and the draft passes tagIds
 * through WITHOUT re-implementing any domain rule.
 *
 * `RuleFormFields` is the ONE field set for every rule surface (sidebar create,
 * settings create, settings inline edit), so adding the control here is what
 * covers both entry points at once (G3/R23) — the assertions therefore check
 * BOTH variants rather than one component per surface.
 *
 * The pass-through is deliberately dumb (no trim, no dedupe, no dangling strip):
 * those live in `TagService` (P4/D3), and a second copy here would be a rule that
 * drifts.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RuleFormFields } from '@ui/shared/rule-form-fields';
import { normalizeRuleDraft } from '@ui/shared/rule-form-submit';
import type { FieldMode } from '@ui/shared/field-editor';
import { resolveFieldChain } from '@shared/field-chain';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';
import type { TagDefinition } from '@shared/types';

const tag = (id: string, name: string): TagDefinition => ({
  id, name, backgroundColor: '#3366cc', textColor: '#fff',
});

/** Mirrors `TagSelector`'s cap. */
const RULE_TAG_LIST_LIMIT = 10;

/** A real chain result — mirrors the existing `rule-form-fields.test.tsx` stub. */
function chainFor(field: 'title' | 'favicon' = 'title') {
  return resolveFieldChain(field, {
    sync: createDefaultSyncState(),
    local: createDefaultLocalState(),
    tabId: 1,
    tabUrl: 'https://example.com/',
  });
}

const useChain: FieldMode = { kind: 'use-chain' };

function renderForm(variant: 'create' | 'edit', tagIds?: string[]): void {
  render(
    <RuleFormFields
      variant={variant}
      value={{
        url: 'https://example.com/',
        matchType: 'exact',
        titleMode: useChain,
        iconMode: useChain,
        priority: 0,
        ...(tagIds ? { tagIds } : {}),
      }}
      onChange={vi.fn()}
      prefill={{ url: 'https://example.com/' }}
      chain={chainFor('title')}
      titleChain={chainFor('title')}
      iconChain={chainFor('favicon')}
      baselineTitle={{ mode: useChain }}
      baselineIcon={{ mode: useChain }}
      onResetTitleEdit={vi.fn()}
      onResetIconEdit={vi.fn()}
      onClearTitle={vi.fn()}
      onClearIcon={vi.fn()}
      submitMode={{ kind: 'immediate' }}
      availableTags={[tag('t1', 'work'), tag('t2', 'urgent')]}
      onCreateTag={() => Promise.resolve(null)}
    />,
  );
}

describe('T13: both variants render a tag control with an accessible name', () => {
  for (const variant of ['create', 'edit'] as const) {
    it(`${variant} variant shows the tag selector`, () => {
      renderForm(variant);
      expect(screen.getByRole('group', { name: /tags/i })).toBeDefined();
    });
  }

  it('edit variant can also CLEAR tags (the control is present in edit too)', () => {
    renderForm('edit', ['t1']);
    // The selected tag is shown as a selected/checked control.
    expect(screen.getByRole('checkbox', { name: 'work' })).toBeDefined();
  });
});

describe('T13: the tag list gained a search and a counted disclosure', () => {
  const many = (n: number): TagDefinition[] =>
    Array.from({ length: n }, (_, i) => tag(`t${String(i)}`, `tag-${String(i)}`));

  /** Returns the `onChange` spy, so a case can assert what the control SENT. */
  function renderWithTags(
    tags: TagDefinition[],
    selected: string[] = [],
    onChange: ReturnType<typeof vi.fn> = vi.fn(),
  ): ReturnType<typeof vi.fn> {
    render(
      <RuleFormFields
        variant="create"
        value={{
          url: 'https://example.com/',
          matchType: 'exact',
          titleMode: useChain,
          iconMode: useChain,
          priority: 0,
          tagIds: selected,
        }}
        onChange={onChange}
              prefill={{ url: 'https://example.com/' }}
              chain={chainFor('title')}
              titleChain={chainFor('title')}
              iconChain={chainFor('favicon')}
              baselineTitle={{ mode: useChain }}
              baselineIcon={{ mode: useChain }}
              onResetTitleEdit={vi.fn()}
              onResetIconEdit={vi.fn()}
              onClearTitle={vi.fn()}
              onClearIcon={vi.fn()}
              submitMode={{ kind: 'immediate' }}
              availableTags={tags}
              onCreateTag={() => Promise.resolve(null)}
            />,
          );
            return onChange;
          }

        it('filters the list by name', async () => {
    // The table has no cap (C3), so this list used to grow without limit and
    // finding one tag meant reading all of them.
    renderWithTags([tag('t1', 'work'), tag('t2', 'urgent'), tag('t3', 'later')]);
    const search = screen.getByLabelText('Search Tags');
    fireEvent.change(search, { target: { value: 'urg' } });
    expect(screen.getByRole('checkbox', { name: 'urgent' })).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: 'work' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'later' })).toBeNull();
  });

  it('a search that matches nothing offers the way OUT, not just a statement', () => {
    // A blank list with "no match" tells the user the obvious; the useful answer is
    // the create row, carrying the query they already typed. So the assertion is on
    // the ROW (and on it being seeded), not on a message.
    renderWithTags([tag('t1', 'work')]);
    fireEvent.change(screen.getByLabelText('Search Tags'), { target: { value: 'zzz' } });
    const add = screen.getByTestId('tag-selector-add');
    expect(add.textContent).toContain('zzz');

    fireEvent.click(add);
    // The query is carried into the name field, so the user does not retype it.
    expect(screen.getByLabelText('New tag name')).toHaveValue('zzz');
  });

  it('lists ten tags plus a disclosure that states the hidden count', () => {
    renderWithTags(many(24));
    expect(screen.getAllByRole('checkbox')).toHaveLength(RULE_TAG_LIST_LIMIT);
    const more = screen.getByRole('button', { name: /more/ });
    expect(more.textContent).toContain('+14');
  });

  it('the disclosure reveals the rest and collapses again', () => {
    renderWithTags(many(24));
    fireEvent.click(screen.getByRole('button', { name: /\+14 more/ }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(24);
    fireEvent.click(screen.getByRole('button', { name: /Show less/ }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(RULE_TAG_LIST_LIMIT);
  });

  it('a selected tag stays reachable even when the cap hides it', () => {
    // The defect this row exists for: with 24 tags, checking one that the first ten
    // do not include and then collapsing the disclosure left it selected but
    // INVISIBLE — no checked box on screen, so no way to uncheck it.
    renderWithTags(many(24), ['t23']);
    // The list is capped, so the row is NOT among the visible options...
    expect(screen.queryByRole('checkbox', { name: 'tag-23' })).toBeNull();
    // ...but it is reachable, as a removable pill.
    expect(screen.getByRole('button', { name: 'Remove tag-23' })).toBeDefined();
  });

  it('the pill removes a selection that the search would otherwise hide', () => {
    const onChange = renderWithTags([tag('t1', 'work'), tag('t2', 'urgent')], ['t1']);
    fireEvent.change(screen.getByLabelText('Search Tags'), { target: { value: 'urg' } });
    // `work` is filtered out of the LIST...
    expect(screen.queryByRole('checkbox', { name: 'work' })).toBeNull();
    // ...and still removable from the selected row.
    fireEvent.click(screen.getByRole('button', { name: 'Remove work' }));
    expect(onChange).toHaveBeenCalledWith({ tagIds: [] });
  });

  it('collapses to save space, keeping the selection visible', () => {
    // The space complaint: the tag field is tall, and a user who has finished
    // choosing should be able to fold it. Collapsing must NOT hide the selection —
    // that is the one fact the collapsed state still has to carry.
    renderWithTags([tag('t1', 'work'), tag('t2', 'urgent')], ['t1']);
    expect(screen.getByLabelText('Search Tags')).toBeDefined();

    fireEvent.click(screen.getByTestId('tag-selector-collapse'));
    // The list and its search are gone...
    expect(screen.queryByLabelText('Search Tags')).toBeNull();
    // ...and the selection is still there, still removable.
    expect(screen.getByRole('button', { name: 'Remove work' })).toBeDefined();

    fireEvent.click(screen.getByTestId('tag-selector-collapse'));
    expect(screen.getByLabelText('Search Tags')).toBeDefined();
  });

  it('collapsed with nothing selected says so rather than showing an empty gap', () => {
    renderWithTags([tag('t1', 'work')], []);
    fireEvent.click(screen.getByTestId('tag-selector-collapse'));
    expect(screen.getByText(/No tags selected/i)).toBeDefined();
  });

  it('the selected tags sit ABOVE the search box, not below the list', () => {
    // The placement request: the selection is the answer to "what does this rule
    // carry", so it reads first — above the search and the list that produce it.
    renderWithTags([tag('t1', 'work')], ['t1']);
    const selected = screen.getByRole('group', { name: 'Selected tags' });
    const search = screen.getByLabelText('Search Tags');
    // Asserted as DOCUMENT ORDER rather than geometry: jsdom has no layout, so a
    // position comparison would only ever be measuring zeroes. The field's own
    // children are the order under test.
    const field = selected.closest('fieldset') as HTMLElement;
    const ordered = [...field.querySelectorAll('.tbs-tag-selector__selected, [data-testid="tag-selector-search"]')];
    expect(ordered[0]).toBe(selected);
    expect(ordered[1]).toBe(search);
  });

  it('the create form confirms a successful create and reports a failed one', async () => {
    // Both directions, because "the fields emptied themselves" is the only signal
    // a success had without a cue.
    const ok = vi.fn().mockResolvedValue(tag('new', 'brand-new'));
    const { unmount } = render(
      <RuleFormFields
        variant="create"
        value={{ url: 'https://example.com/', matchType: 'exact', titleMode: useChain, iconMode: useChain, priority: 0 }}
        onChange={vi.fn()}
        prefill={{ url: 'https://example.com/' }}
        chain={chainFor('title')}
        titleChain={chainFor('title')}
        iconChain={chainFor('favicon')}
        baselineTitle={{ mode: useChain }}
        baselineIcon={{ mode: useChain }}
        onResetTitleEdit={vi.fn()}
        onResetIconEdit={vi.fn()}
        onClearTitle={vi.fn()}
        onClearIcon={vi.fn()}
        submitMode={{ kind: 'immediate' }}
        availableTags={[tag('t1', 'work')]}
        onCreateTag={ok as unknown as (a: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>}
      />,
    );
    fireEvent.click(screen.getByTestId('tag-selector-add'));
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'brand-new' } });
    fireEvent.click(screen.getByTestId('tag-selector-create'));
    // A `status` (polite), not an `alert` — nothing is expected of the user.
    expect(await screen.findByRole('status')).toHaveTextContent(/Added/);
    unmount();

    // Failure: the parent returns null, and the form must say so in place.
    const bad = vi.fn().mockResolvedValue(null);
    render(
      <RuleFormFields
        variant="create"
        value={{ url: 'https://example.com/', matchType: 'exact', titleMode: useChain, iconMode: useChain, priority: 0 }}
        onChange={vi.fn()}
        prefill={{ url: 'https://example.com/' }}
        chain={chainFor('title')}
        titleChain={chainFor('title')}
        iconChain={chainFor('favicon')}
        baselineTitle={{ mode: useChain }}
        baselineIcon={{ mode: useChain }}
        onResetTitleEdit={vi.fn()}
        onResetIconEdit={vi.fn()}
        onClearTitle={vi.fn()}
        onClearIcon={vi.fn()}
        submitMode={{ kind: 'immediate' }}
        availableTags={[tag('t1', 'work')]}
        onCreateTag={bad as unknown as (a: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>}
      />,
    );
    fireEvent.click(screen.getByTestId('tag-selector-add'));
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'dupe' } });
    fireEvent.click(screen.getByTestId('tag-selector-create'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be created/i);
  });

  it('the create form’s three actions are the SHARED button, in the Tags page variants', () => {
    // The reported inconsistency: the TagSelector's Auto/Cancel/Create were
    // hand-rolled with their own classes, so the same three actions looked different
    // here than on the Tags page. They are `Button` now — one variant per rank.
    renderWithTags([tag('t1', 'work')], []);
    fireEvent.click(screen.getByTestId('tag-selector-add'));

    const auto = screen.getByRole('button', { name: 'Auto text colour' });
    const cancel = screen.getByRole('button', { name: 'Cancel new tag' });
    const create = screen.getByTestId('tag-selector-create');

    // All three carry the shared button class...
    for (const b of [auto, cancel, create]) expect(b.className).toContain('tbs-btn');
    // ...and the one committing action is the ONLY primary (one primary per view).
    expect(create.className).toContain('tbs-btn--primary');
    expect(auto.className).toContain('tbs-btn--ghost');
    expect(cancel.className).toContain('tbs-btn--ghost');
    // The hand-rolled families are gone, so nothing can restyle these apart.
    for (const b of [auto, cancel, create]) {
      expect(b.className).not.toMatch(/tbs-tag-selector__(auto|cancel|create)/);
    }
  });

  it('says so when the table has NO tags at all (vs. a filtered-empty list)', () => {
    // The fix for "a blank field looks like a control that failed to load": the
    // table being empty is a fact worth stating, once. The Tags page says the same
    // thing for the same case, so this is one disclosure, not a new one.
    renderWithTags([], []);
    expect(screen.getByTestId('tag-selector-empty').textContent).toMatch(/No tags yet/i);
    // The way out sits on the same row: the sentence and the answer are read
    // together rather than one above the other.
    const list = screen.getByTestId('tag-selector-empty').closest('.tbs-tag-selector__list') as HTMLElement;
    expect(within(list).getByTestId('tag-selector-add')).toBeDefined();
  });

  it('a search that matches nothing does NOT get the "no tags" sentence', () => {
    // Different fact, different answer: the way out here is `+ New tag "<query>"`,
    // and claiming the table is empty would contradict the chips the user can see
    // after clearing the search.
    renderWithTags([tag('t1', 'work')], []);
    fireEvent.change(screen.getByLabelText('Search Tags'), { target: { value: 'zzz' } });
    expect(screen.queryByTestId('tag-selector-empty')).toBeNull();
  });

  it('the create row STAYS mounted while the form is open, reporting its state', () => {
    // It used to unmount while declaring a constant `aria-expanded={false}`, so the
    // control announced as "collapsed" disappeared the moment it was activated and
    // its expanded state was never conveyed.
    renderWithTags([tag('t1', 'work')], []);
    const add = screen.getByTestId('tag-selector-add');
    expect(add.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(add);
    const reopened = screen.getByTestId('tag-selector-add');
    expect(reopened.getAttribute('aria-expanded')).toBe('true');
    // A CLOSE affordance, in the place the form was opened from. Its name is not
    // "Cancel new tag" — the form's own Cancel carries that, and two controls with
    // one accessible name is an ambiguity.
    expect(reopened.textContent).toMatch(/Close/i);
    fireEvent.click(reopened);
    expect(screen.queryByRole('group', { name: 'New tag' })).toBeNull();
    expect(screen.getByTestId('tag-selector-add').getAttribute('aria-expanded')).toBe('false');
  });

  it('a narrow search is not capped by the disclosure state', () => {
    // The disclosure means "the rest of THIS list", so starting a new search
    // collapses it — otherwise "… +14 more" would sit over a 3-result list.
    renderWithTags(many(24));
    fireEvent.click(screen.getByRole('button', { name: /\+14 more/ }));
    fireEvent.change(screen.getByLabelText('Search Tags'), { target: { value: 'tag-1' } });
    expect(screen.queryByRole('button', { name: /Show less/ })).toBeNull();
  });
});

describe('T13: creating a tag in place offers name AND both colours', () => {
  function renderWithCreate(onCreateTag: (a: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>): void {
    render(
      <RuleFormFields
        variant="create"
        value={{
          url: 'https://example.com/',
          matchType: 'exact',
          titleMode: useChain,
          iconMode: useChain,
          priority: 0,
        }}
        onChange={vi.fn()}
        prefill={{ url: 'https://example.com/' }}
        chain={chainFor('title')}
        titleChain={chainFor('title')}
        iconChain={chainFor('favicon')}
        baselineTitle={{ mode: useChain }}
        baselineIcon={{ mode: useChain }}
        onResetTitleEdit={vi.fn()}
        onResetIconEdit={vi.fn()}
        onClearTitle={vi.fn()}
        onClearIcon={vi.fn()}
        submitMode={{ kind: 'immediate' }}
        availableTags={[tag('t1', 'work')]}
        onCreateTag={onCreateTag}
      />,
    );
  }

  it('the create form exposes a name and BOTH colours, and sends all three', async () => {
    // A tag IS a colour pair, so a create form offering only a name produced tags
    // that had to be re-opened on the Tags page to look like anything — even
    // though both surfaces go through the same `CREATE_TAG` write.
    const onCreateTag = vi.fn()
      .mockResolvedValue(tag('new', 'brand-new'));
    renderWithCreate(onCreateTag as unknown as (a: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>);

    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'brand-new' } });
    fireEvent.change(screen.getByLabelText('New tag background color'), { target: { value: '#112233' } });
    fireEvent.change(screen.getByLabelText('New tag text color'), { target: { value: '#aabbcc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreateTag).toHaveBeenCalledWith({
        name: 'brand-new', backgroundColor: '#112233', textColor: '#aabbcc',
      });
    });
  });

  it('PREVENTS creating without a name rather than reporting it afterwards', () => {
    // Prevention, not feedback: the name IS the tag's identity, and the field is
    // labelled right above the button — so an enabled Create on an empty name would
    // be an action that can only fail. `disabled` is also the state a screen reader
    // and a test can both read unambiguously.
    const onCreateTag = vi.fn().mockResolvedValue(null);
    renderWithCreate(onCreateTag as unknown as (a: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>);
    fireEvent.click(screen.getByTestId('tag-selector-add'));

    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(onCreateTag).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    // ...and it becomes available the moment there is a name.
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'brand-new' } });
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('the success notice clears once the user starts the next tag', async () => {
    // "Added “x”." describes the PREVIOUS tag. Typing is the signal that the user
    // has moved on, and leaving it up would describe something other than what is
    // in the fields — the state a user reads as "did my second one work?".
    // Typed at the `vi.fn` rather than asserted at the call site: the cast the other
    // cases use is reported as unnecessary here (the resolved value already fits),
    // and an annotation says the same thing without a lint exemption.
    const onCreateTag = vi.fn<(a: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>>()
      .mockResolvedValue(tag('new', 'brand-new'));
    renderWithCreate(onCreateTag);
    fireEvent.click(screen.getByTestId('tag-selector-add'));
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'brand-new' } });
    fireEvent.click(screen.getByTestId('tag-selector-create'));

    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'second' } });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('T13: tagIds pass through normalizeRuleDraft untouched (P4/D3)', () => {
  it('carries tagIds as given — no trim, no dedupe, no dangling strip', () => {
    const out = normalizeRuleDraft({
      url: 'https://example.com/',
      matchType: 'exact',
      titleMode: useChain,
      iconMode: useChain,
      priority: 0,
      tagIds: ['t2', 't1', 't2'],
    });
    // Verbatim, INCLUDING the duplicate: dedupe is `TagService`'s job.
    expect(out.tagIds).toEqual(['t2', 't1', 't2']);
  });

  it('omits tagIds when the draft has none (no empty-array placeholder)', () => {
    const out = normalizeRuleDraft({
      url: 'https://example.com/',
      matchType: 'exact',
      titleMode: useChain,
      iconMode: useChain,
      priority: 0,
    });
    expect(out.tagIds).toBeUndefined();
  });

  it('does NOT put tagIds into the rule payload fields (tags are a separate message)', () => {
    const out = normalizeRuleDraft({
      url: 'https://example.com/',
      matchType: 'exact',
      titleMode: useChain,
      iconMode: useChain,
      priority: 0,
      tagIds: ['t1'],
    });
    // The storable rule fields must not gain a tag field — A1: tags travel in
    // their own message so they cannot reach the delivery path (R5).
    expect(Object.keys(out)).not.toContain('tags');
    expect((out as { tagIds?: unknown }).tagIds).toEqual(['t1']);
  });
});