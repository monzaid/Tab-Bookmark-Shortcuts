/**
 * T16 — the Tags management page: orphan visibility, the SEQUENTIAL destructive
 * flow, and the undo closure.
 *
 * Three invariants, each of which fails for its own reason:
 *
 *  1. C3 — a tag no rule references is VISIBLE with a count of 0. Hiding orphans
 *     would let them accumulate unseen, which is why "must be visible" is a
 *     requirement rather than a nicety.
 *
 *  2. C5/R3 — `Confirm` closes, THEN the write happens, THEN `UndoBar` appears.
 *     The order is asserted as absence during the confirm phase: if both were on
 *     screen together, the user could undo something they had not yet done (and
 *     R3's serial rule exists because that is what the earlier Clear dialog got
 *     wrong).
 *
 *  3. C4 — the confirmation states the IMPACT ("will be removed from N rules"),
 *     and the number equals the rules actually stripped.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';
import type { TagDefinition } from '@shared/types';

let stateTags: TagDefinition[] = [];
let deleteCalls: Array<{ tagId: string }> = [];

const RULES = [
  { id: 'r1', urlMatch: { type: 'exact', value: 'https://a/' }, priority: 0, title: 'A', enabled: true, tagIds: ['t1'], createdAt: 'x', updatedAt: 'x' },
  { id: 'r2', urlMatch: { type: 'exact', value: 'https://b/' }, priority: 0, title: 'B', enabled: true, tagIds: ['t1'], createdAt: 'x', updatedAt: 'x' },
];

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string; payload?: Record<string, unknown> }) => {
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: RULES, tags: stateTags },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  if (msg.action === 'DELETE_TAG') {
    deleteCalls.push({ tagId: String(msg.payload?.tagId) });
    // The service also strips the tag from the rules; mimic the observable part.
    stateTags = stateTags.filter((t) => t.id !== msg.payload?.tagId);
    return {
      result: { success: true, affectedRuleCount: 2 },
      snapshot: {
        tag: { id: String(msg.payload?.tagId), name: 'work', backgroundColor: '#3366cc', textColor: '#fff' },
        refs: [{ ruleId: 'r1', tagIds: ['t1'] }, { ruleId: 'r2', tagIds: ['t1'] }],
      },
    };
  }
  if (msg.action === 'CREATE_TAG') {
    return { result: { success: true, tag: { id: 'new', name: String(msg.payload?.name), backgroundColor: '#000', textColor: '#fff' } } };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

/**
 * The messages that reached the worker, TYPED.
 *
 * `mock.calls` is `any[][]`, so reading `call[0].action` at each assertion is an
 * unsafe-member-access error fifteen times over — and, worse, a typo in a
 * property name would silently compare `undefined` to `undefined` and pass. One
 * narrowing here gives every assertion a real shape to read.
 */
type SentMessage = { action: string; payload?: Record<string, unknown> };
const sent = (): SentMessage[] =>
  mockSendMessage.mock.calls.map((c) => c[0] as SentMessage);

const sentWithAction = (action: string): SentMessage | undefined =>
  sent().find((m) => m.action === action);

/**
 * Every undo bar currently on screen, in stack order.
 *
 * U1 makes the bars stackable, so a bare `getByRole('button', {name:/^Undo$/i})`
 * throws "multiple elements" as soon as a test produces two undoable actions —
 * and, worse, a bare `getAllByRole` would let a test that means "exactly one
 * action" pass while several are stacked. This helper keeps each call site able
 * to state its intended COUNT, which is the property that actually matters.
 */
const undoBars = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.tbs-undo-bar'));

async function openTags(): Promise<void> {
  render(<SettingsApp />);
  await waitFor(() => { expect(screen.getByRole('navigation')).toBeInTheDocument(); });
  fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
  await waitFor(() => { expect(screen.getByTestId('tags-section')).toBeInTheDocument(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteCalls = [];
  stateTags = [
    { id: 't1', name: 'work', backgroundColor: '#3366cc', textColor: '#fff' },
    { id: 'orphan', name: 'unused-tag', backgroundColor: '#999', textColor: '#fff' },
  ];
});

describe('T16: C3 — an orphan tag is visible with a reference count of 0', () => {
  /**
   * The count now rides the Show control, because it is what the panel behind it
   * contains. Read it from that control rather than by bare text: `0` alone is
   * ambiguous on a page that also holds a priority column and checkboxes, and a
   * `getByText('0')` would pass on any stray zero.
   */
  const showLabel = (testId: string): string =>
    within(screen.getByTestId(testId)).getByRole('button', { name: /Show items using/ }).textContent;

  it('shows the tag no rule references, with count 0', async () => {
    await openTags();
    expect(screen.getByTestId('tag-row-orphan')).toBeInTheDocument();
    // C3: an orphan must be LEGIBLE as an orphan — the zero is stated, not implied
    // by an absence.
    expect(showLabel('tag-row-orphan')).toContain('0');
  });

  it('shows the referenced tag with its actual count (2)', async () => {
    await openTags();
    expect(showLabel('tag-row-t1')).toContain('2');
    // ...and not the orphan's number, so the two rows are not reporting one count.
    expect(showLabel('tag-row-t1')).not.toBe(showLabel('tag-row-orphan'));
  });
});

describe('T16: C4/C5 — delete is destructive, states its impact, and is undoable', () => {
  it('confirm states the affected rule count, and UndoBar is NOT present during confirm', async () => {
    await openTags();
    fireEvent.click(within(screen.getByTestId('tag-row-t1')).getByRole('button', { name: /Delete/i }));

    // C4: the dialog names the impact number.
    const dialog = await screen.findByRole('dialog', { name: /delete tag/i });
    expect(dialog.textContent).toContain('2');

    // C5/R3: STRICTLY serial — no undo affordance while the confirm is up.
    expect(screen.queryByRole('button', { name: /^Undo$/i })).toBeNull();
  });

  it('confirming performs the delete, then the UndoBar appears (serial order)', async () => {
    await openTags();
    fireEvent.click(within(screen.getByTestId('tag-row-t1')).getByRole('button', { name: /Delete/i }));
    const dialog = await screen.findByRole('dialog', { name: /delete tag/i });

    // The shared `Confirm` has a ~120ms misclick guard (CT3-b4) so the keystroke
// that opens it cannot also activate the confirm button. Wait past it — this is
// real behaviour being respected, not a test workaround.
    await new Promise((r) => setTimeout(r, 160));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => { expect(deleteCalls).toHaveLength(1); });
    expect(deleteCalls[0].tagId).toBe('t1');
    // The undo affordance appears only AFTER the write, and this ONE delete is
    // exactly ONE undoable action. `undoBars()` + a length check is STRONGER than
    // the old singular query: it still requires the bar, and it now also pins the
    // count (U1 lets several bars stack, so "a `Undo` button exists" no longer
    // implies "one action was recorded").
    await waitFor(() => { expect(undoBars()).toHaveLength(1); });
    expect(within(undoBars()[0]).getByRole('button', { name: /^Undo$/i })).toBeInTheDocument();
  });

  it('the delete confirm button is danger-variant and Enter does not trigger it', async () => {
    await openTags();
    fireEvent.click(within(screen.getByTestId('tag-row-t1')).getByRole('button', { name: /Delete/i }));
    const dialog = await screen.findByRole('dialog', { name: /delete tag/i });
    const confirmBtn = within(dialog).getByRole('button', { name: /^Delete$/i });
    // R4: a destructive action has no default button — it must not be reachable
    // by a stray Enter. The shared `Confirm` renders danger styling + a
    // misclick guard; assert the variant class rather than pixels.
    expect(confirmBtn.className).toMatch(/danger/i);
  });
});

describe('T16: the Tags table supports BULK delete (the rules table interaction)', () => {
  /** Select a row by its checkbox — the control the bulk bar is driven from. */
  const selectTag = (id: string): void => {
    fireEvent.click(within(screen.getByTestId(`tag-row-${id}`)).getByRole('checkbox'));
  };

  it('the bulk bar appears only once something is selected', async () => {
    await openTags();
    // Nothing selected: no destructive affordance is on screen at all.
    expect(screen.queryByTestId('tags-batch-delete')).toBeNull();

    selectTag('t1');
    const bar = await screen.findByRole('toolbar', { name: 'Batch operations' });
    // It states HOW MANY, which is what the user is about to act on.
    expect(bar.textContent).toContain('1 selected');
  });

  it('deletes EVERY selected tag, one DELETE_TAG each, and reports the count', async () => {
    await openTags();
    selectTag('t1');
    selectTag('orphan');
    fireEvent.click(screen.getByTestId('tags-batch-delete'));

    const dialog = await screen.findByRole('dialog', { name: /delete 2 selected tags/i });
    // C4 at batch scale: the message states the TOTAL impact across the selection
    // (2 rules for t1, 0 for the orphan), not a generic "are you sure".
    expect(dialog.textContent).toContain('2 rules');
    // ...and names them, because a bulk delete is where the user cannot see the
    // rows they are about to lose.
    expect(dialog.textContent).toContain('work');
    expect(dialog.textContent).toContain('unused-tag');

    await new Promise((r) => setTimeout(r, 160)); // the Confirm misclick guard
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => { expect(deleteCalls).toHaveLength(2); });
    expect(deleteCalls.map((c) => c.tagId).sort()).toEqual(['orphan', 't1']);
    // The selection is cleared and the rows are gone.
    await waitFor(() => { expect(screen.queryByTestId('tags-batch-delete')).toBeNull(); });
    expect(screen.queryByTestId('tag-row-t1')).toBeNull();
  });

  it('ONE Undo restores the WHOLE batch (not just the last tag)', async () => {
    // The reason the snapshots are collected: the `UndoBar` replays a LIST of
    // `tag-delete` writes, so a batch is one undoable action. Restoring only the
    // last tag would leave the other deletions permanent with no affordance left.
    await openTags();
    selectTag('t1');
    selectTag('orphan');
    fireEvent.click(screen.getByTestId('tags-batch-delete'));
    const dialog = await screen.findByRole('dialog', { name: /delete 2 selected tags/i });
    await new Promise((r) => setTimeout(r, 160));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    // ONE batch ⇒ ONE bar (not N). The count is now asserted explicitly, which the
    // old singular query could not express once several bars may stack (U1).
    await waitFor(() => { expect(undoBars()).toHaveLength(1); });
    const bar = undoBars()[0];
    // The bar states the batch size, so "what will undo" is answered before the click.
    expect(bar.textContent).toContain('2');
    fireEvent.click(within(bar).getByRole('button', { name: /^Undo$/i }));

    // TWO restore calls — one per deleted tag, i.e. the whole batch.
    await waitFor(() => {
      expect(sent().filter((m) => m.action === 'RESTORE_TAG')).toHaveLength(2);
    });
  });

  it('a partial failure is reported, and only the restored ones are undoable', async () => {
    // D-12: a batch that half-succeeds must say so rather than claim success. The
    // undo is built from the snapshots that came BACK, so it cannot offer to
    // restore a tag that is still present.
    const base = mockSendMessage.getMockImplementation();
    mockSendMessage.mockImplementation((msg: { action: string; payload?: Record<string, unknown> }) => {
      if (msg.action === 'DELETE_TAG' && msg.payload?.tagId === 'orphan') {
        return { result: { success: false, errorCode: 'INTERNAL_ERROR', message: 'nope' } };
      }
      return base ? (base(msg) as unknown) : { result: { success: true } };
    });
    await openTags();
    selectTag('t1');
    selectTag('orphan');
    fireEvent.click(screen.getByTestId('tags-batch-delete'));
    const dialog = await screen.findByRole('dialog', { name: /delete 2 selected tags/i });
    await new Promise((r) => setTimeout(r, 160));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    // The toast reports both numbers instead of a bare success.
    await waitFor(() => { expect(screen.getByText(/Deleted 1 of 2/)).toBeInTheDocument(); });
    // Only ONE bar is offered — there is one successful deletion to undo. Asserted
    // as an exact count: "an Undo button exists" is weaker now that bars stack (U1),
    // and a second bar here would mean the failed deletion was offered for undo.
    await waitFor(() => { expect(undoBars()).toHaveLength(1); });
    fireEvent.click(within(undoBars()[0]).getByRole('button', { name: /^Undo$/i }));
    await waitFor(() => {
      expect(sent().filter((m) => m.action === 'RESTORE_TAG')).toHaveLength(1);
    });
  });

  it('reports a partial failure by NAME and keeps the failed rows selected', async () => {
    // The defect: a partly-failed batch cleared the selection and reported only a
    // count, leaving the user to hunt for which rows survived among a list that may
    // since have been re-sorted or filtered. The failed rows stay selected, so the
    // answer is on screen and the retry is the same button.
    const base = mockSendMessage.getMockImplementation();
    mockSendMessage.mockImplementation((msg: { action: string; payload?: Record<string, unknown> }) => {
      if (msg.action === 'DELETE_TAG' && msg.payload?.tagId === 'orphan') {
        return { result: { success: false, errorCode: 'INTERNAL_ERROR', message: 'nope' } };
      }
      return base ? (base(msg) as unknown) : { result: { success: true } };
    });
    await openTags();
    selectTag('t1');
    selectTag('orphan');
    fireEvent.click(screen.getByTestId('tags-batch-delete'));
    const dialog = await screen.findByRole('dialog', { name: /delete 2 selected tags/i });
    await new Promise((r) => setTimeout(r, 160));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    // Named, not just counted — read from the TOAST, not by a bare text query: the
    // tag's name is also in its own chip on the row behind it, so `getByText` finds
    // both and the assertion fails on ambiguity rather than on the claim.
    await waitFor(() => {
      expect(document.querySelector('.tbs-toast')?.textContent).toMatch(/unused-tag/);
    });
    // Still selected: the bar states 1, and the retry targets exactly that row.
    const bar = await screen.findByRole('toolbar', { name: 'Batch operations' });
    expect(bar.textContent).toContain('1 selected');
    expect(within(screen.getByTestId('tag-row-orphan')).getByRole('checkbox')).toBeChecked();
  });

  it('a search that hides a selected row DROPS it from the selection (D-13)', async () => {
    // Otherwise a bulk delete would remove rows the user cannot see — the same rule
    // the table already applied to its own selection state.
    await openTags();
    selectTag('orphan');
    fireEvent.change(screen.getByLabelText('Search tags'), { target: { value: 'work' } });
    await waitFor(() => { expect(screen.queryByTestId('tags-batch-delete')).toBeNull(); });
  });
});

describe('T16: editing keeps references (C1)', () => {
  it('removing a tag from a rule is UNDOABLE, like every other tag write', async () => {
    // The missing rung on the protection ladder: deleting a TAG was confirmed and
    // undoable, while removing its last reference from a rule was neither — the one
    // irreversible tag operation in the app.
    await openTags();
    fireEvent.click(within(screen.getByTestId('tag-row-t1')).getByRole('button', { name: /Show items using/ }));
    const panel = await screen.findByTestId('tag-associations-t1');
    const ruleRow = within(panel).getByTestId('tag-assoc-row-t1-r1');
    fireEvent.click(within(ruleRow).getByRole('button', { name: /Remove this tag from rule/ }));

    // The write is the FULL set minus that tag...
    await waitFor(() => { expect(sentWithAction('SET_RULE_TAGS')).toBeDefined(); });
    // ...and an undo appears, whose replay restores the PREVIOUS set (the exact
    // inverse of the unlink). Scoped + count-checked rather than left as a bare
    // singular query: it must be THIS unlink's bar, and there must be exactly one
    // (U1 lets bars stack, so a singular query is both ambiguous and weaker).
    await waitFor(() => { expect(undoBars()).toHaveLength(1); });
    fireEvent.click(within(undoBars()[0]).getByRole('button', { name: /^Undo$/i }));
    await waitFor(() => {
      const restores = sent().filter((m) => m.action === 'SET_RULE_TAGS');
      expect(restores[restores.length - 1]?.payload).toEqual({ ruleId: 'r1', tagIds: ['t1'] });
    });
  });

  it('says it is LOADING before claiming the table is empty', async () => {
    // `tags` starts as `[]`, which is also what an empty table looks like — so the
    // first frame used to tell every user "No tags yet", including one with fifty.
    // The empty state is a claim about the machine and may not precede its answer.
    //
    // The deferred `GET_STATE` is REPLACED (not suppressed) so this test cannot leak
    // a permanently-pending mock into the cases that follow: it resolves on the
    // first call and then restores the real implementation.
    const base = mockSendMessage.getMockImplementation();
    /**
     * Held only AFTER the app has booted.
     *
     * The settings app gates its whole content behind its own mount-time read, so
     * holding from the start would leave the Tags section unrendered and there would
     * be no loading frame to observe — the section's read is the one under test, and
     * it only happens once the page is up.
     */
    const hold: { on: boolean; resolvers: Array<() => void> } = { on: false, resolvers: [] };
    mockSendMessage.mockImplementation((msg: { action: string; payload?: Record<string, unknown> }) => {
      if (msg.action === 'GET_STATE' && hold.on) {
        return new Promise((resolve) => {
          hold.resolvers.push(() => { resolve(base ? (base(msg) as unknown) : { result: { success: true } }); });
        });
      }
      return base ? (base(msg) as unknown) : { result: { success: true } };
    });

    try {
      render(<SettingsApp />);
      await waitFor(() => { expect(screen.getByRole('navigation')).toBeInTheDocument(); });

      hold.on = true;
      fireEvent.click(screen.getByRole('button', { name: 'Tags' }));

      // While the read is out, loading is stated and the empty claim is NOT made.
      expect(await screen.findByTestId('tags-loading')).toBeInTheDocument();
      expect(screen.queryByText(/No tags yet/i)).toBeNull();

      // ...and once the read lands, the real table replaces it.
      hold.on = false;
      for (const release of hold.resolvers) release();
      await waitFor(() => { expect(screen.getByTestId('tag-row-t1')).toBeInTheDocument(); });
      expect(screen.queryByTestId('tags-loading')).toBeNull();
    } finally {
      hold.on = false;
      for (const release of hold.resolvers) release();
      if (base) mockSendMessage.mockImplementation(base);
    }
  });

  it('has an edit control whose effect leaves the reference count unchanged', async () => {
    await openTags();
    // The row exposes the three actions the list promises.
    const row = screen.getByTestId('tag-row-t1');
    expect(within(row).getByRole('button', { name: /Show items using/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('editing a tag writes name AND both colours in ONE message, count unchanged', async () => {
    // C1: the id is untouched, so nothing that references the tag moves. The
    // three fields travel together — one form, one decision, one write — which is
    // why `UPDATE_TAG` replaced `RENAME_TAG`.
    await openTags();
    const row = screen.getByTestId('tag-row-t1');
    expect(within(row).getByRole('button', { name: /Show items using/ }).textContent).toContain('2');

    fireEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    const form = await screen.findByRole('form', { name: 'Edit work' });
    fireEvent.change(within(form).getByLabelText('Edit work name'), { target: { value: 'renamed' } });
    fireEvent.change(within(form).getByLabelText('Edit work background color'), { target: { value: '#112233' } });
    fireEvent.change(within(form).getByLabelText('Edit work text color'), { target: { value: '#aabbcc' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save Tag' }));

    await waitFor(() => { expect(sentWithAction('UPDATE_TAG')).toBeDefined(); });
    expect(sentWithAction('UPDATE_TAG')?.payload).toEqual({
      tagId: 't1', name: 'renamed', backgroundColor: '#112233', textColor: '#aabbcc',
    });
    // The old action is GONE, not merely unused — a second action writing the
    // same fields is what was removed.
    expect(sentWithAction('RENAME_TAG')).toBeUndefined();
  });
});

describe('T16: the tag list is a table with search, sortable Name and reset', () => {
  it('renders the column layout the list promises: select / Tag / Actions', async () => {
    await openTags();
    const table = screen.getByRole('table', { name: 'Tags' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    // The three columns, in order. Header text carries the sort glyph, so the
    // assertion is on the leading word rather than equality.
    expect(headers).toHaveLength(3);
    expect(headers[1]).toMatch(/^Tag/);
    expect(headers[2]).toMatch(/^Actions/);
    // The select column's header is the select-all box.
    expect(within(table).getByLabelText('Select all tags')).toBeInTheDocument();
  });

  it('the row icon is the tag itself — name in its own text colour on its own background', async () => {
    // 1.4 asks the icon column to BE the appearance (name + text colour +
    // background colour). It is not a description of the pair; it is the pair, so
    // a wrong colour is visible rather than merely mis-reported.
    await openTags();
    const chip = within(screen.getByTestId('tag-row-t1')).getByText('work');
    expect(chip.style.backgroundColor).toBe('rgb(51, 102, 204)');
    expect(chip.style.color).toBe('rgb(255, 255, 255)');
  });

  it('search narrows by name, and a no-match search says so', async () => {
    await openTags();
    fireEvent.change(screen.getByLabelText('Search tags'), { target: { value: 'unused' } });
    await waitFor(() => {
      expect(screen.getByTestId('tag-row-orphan')).toBeInTheDocument();
      expect(screen.queryByTestId('tag-row-t1')).toBeNull();
    });

    fireEvent.change(screen.getByLabelText('Search tags'), { target: { value: 'zzz-nothing' } });
    await waitFor(() => { expect(screen.getByText(/No .*match|Nothing matches|No results/i)).toBeInTheDocument(); });
  });

  it('sorting by Name toggles asc → desc → unsorted, and reset returns to table order', async () => {
    await openTags();
    const names = (): string[] =>
      screen.getAllByTestId(/^tag-row-/).map((r) => r.getAttribute('data-testid')?.replace('tag-row-', '') ?? '');

    // Table order first (the fixture's order), which is NOT either sort order:
    // 'unused-tag' < 'work' alphabetically, so asc must reorder it.
    expect(names()).toEqual(['t1', 'orphan']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    await waitFor(() => { expect(names()).toEqual(['orphan', 't1']); }); // 'unused-tag' < 'work'

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    await waitFor(() => { expect(names()).toEqual(['t1', 'orphan']); });

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    await waitFor(() => { expect(names()).toEqual(['t1', 'orphan']); }); // third click unsorts

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset sorting' }));
    await waitFor(() => { expect(names()).toEqual(['t1', 'orphan']); });
  });

  it('selecting tags is pruned to what is visible (a hidden row is not selected)', async () => {
    // The D-13 rule the rules table already follows: "what you see is what you
    // operate on". Otherwise a bulk action would act on a row a search hid.
    await openTags();
    fireEvent.click(screen.getByLabelText('Select all tags'));
    await waitFor(() => { expect(screen.getByLabelText('Select tag work')).toBeChecked(); });

    fireEvent.change(screen.getByLabelText('Search tags'), { target: { value: 'unused' } });
    await waitFor(() => { expect(screen.queryByTestId('tag-row-t1')).toBeNull(); });
    fireEvent.change(screen.getByLabelText('Search tags'), { target: { value: '' } });
    // The row that was hidden while it was selected came back UNSELECTED.
    await waitFor(() => { expect(screen.getByLabelText('Select tag work')).not.toBeChecked(); });
  });
});

describe('T16: several tags can be edited at the same time', () => {
  const editButtons = (): HTMLElement[] => screen.getAllByRole('button', { name: /^Edit / });

  it('opening a second Edit does NOT close the first', async () => {
    // The first cut held ONE open form, so comparing or batch-tweaking two tags
    // meant open/close/open. The rules table already allows multiple open row
    // editors, so this matches it rather than introducing a second convention.
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Edit work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit unused-tag' }));

    expect(await screen.findByRole('form', { name: 'Edit work' })).toBeInTheDocument();
    expect(await screen.findByRole('form', { name: 'Edit unused-tag' })).toBeInTheDocument();
    // ...and the FIRST one was not silently dismissed by the second click.
    expect(screen.getAllByRole('form')).toHaveLength(2);
    // Both rows report their own expanded state.
    expect(screen.getByRole('button', { name: 'Edit work' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Edit unused-tag' })).toHaveAttribute('aria-expanded', 'true');
    expect(editButtons().length).toBe(2);
  });

  it('saving ONE form leaves the other open and untouched', async () => {
    // The reason the open-set is keyed by id: a save must close the row it
    // belongs to and nothing else. Closing "the" form would dismiss a second
    // edit the user never submitted.
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Edit work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit unused-tag' }));

    const work = await screen.findByRole('form', { name: 'Edit work' });
    fireEvent.change(within(work).getByLabelText('Edit work name'), { target: { value: 'renamed' } });
    fireEvent.click(within(work).getByRole('button', { name: 'Save Tag' }));

    await waitFor(() => { expect(sentWithAction('UPDATE_TAG')).toBeDefined(); });
    // work's form is gone; the other tag's is still there.
    await waitFor(() => { expect(screen.queryByRole('form', { name: 'Edit work' })).toBeNull(); });
    expect(screen.getByRole('form', { name: 'Edit unused-tag' })).toBeInTheDocument();
    // Exactly one write went out — the untouched form sent nothing.
    expect(sent().filter((m) => m.action === 'UPDATE_TAG')).toHaveLength(1);
  });

  it('Cancel closes only its own form', async () => {
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Edit work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit unused-tag' }));

    const orphan = await screen.findByRole('form', { name: 'Edit unused-tag' });
    fireEvent.click(within(orphan).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => { expect(screen.queryByRole('form', { name: 'Edit unused-tag' })).toBeNull(); });
    expect(screen.getByRole('form', { name: 'Edit work' })).toBeInTheDocument();
  });

  it('opening a Show panel does not dismiss an open Edit form (independent panels)', async () => {
    // If the panels shared one slot, clicking Show would close an Edit form the
    // button never mentions — an action with an invisible side effect on another
    // row. Two independent open-sets keep each toggle local to its own row.
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Edit work' }));
    expect(await screen.findByRole('form', { name: 'Edit work' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show items using unused-tag' }));
    expect(await screen.findByTestId('tag-associations-orphan')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Edit work' })).toBeInTheDocument();
  });
});

describe('T16: + New Tag opens a form that edits name AND both colours', () => {
  it('the button is labelled + New Tag and reveals the form', async () => {
    await openTags();
    // 1.3: the control is named for what it makes, and opens a sub-component
    // rather than being an inline text box.
    expect(screen.queryByRole('form', { name: 'New Tag' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ New Tag' }));
    expect(await screen.findByRole('form', { name: 'New Tag' })).toBeInTheDocument();
  });

  it('creates with the CHOSEN colours rather than a default the user must then edit', async () => {
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: '+ New Tag' }));
    const form = await screen.findByRole('form', { name: 'New Tag' });
    fireEvent.change(within(form).getByLabelText('New Tag name'), { target: { value: 'urgent' } });
    fireEvent.change(within(form).getByLabelText('New Tag background color'), { target: { value: '#112233' } });
    fireEvent.change(within(form).getByLabelText('New Tag text color'), { target: { value: '#aabbcc' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create Tag' }));

    await waitFor(() => { expect(sentWithAction('CREATE_TAG')).toBeDefined(); });
    expect(sentWithAction('CREATE_TAG')?.payload).toEqual({ name: 'urgent', backgroundColor: '#112233', textColor: '#aabbcc' });
  });

  it('refuses an empty name in the form, without sending a write', async () => {
    // The name is the tag's identity; a nameless tag cannot be referred to. The
    // guard is local so the user is told before a round trip, and the SERVICE
    // still validates (the UI is not the boundary).
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: '+ New Tag' }));
    const form = await screen.findByRole('form', { name: 'New Tag' });
    const create = within(form).getByRole('button', { name: 'Create Tag' });
    expect(create).toBeDisabled();
    expect(sentWithAction('CREATE_TAG')).toBeUndefined();
  });
});

describe('T16/1.4: the Show panel lists the items using a tag', () => {
  it('opens under the row with a Rules tab and the linked rules', async () => {
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Show items using work' }));

    const panel = await screen.findByTestId('tag-associations-t1');
    // 1.4: the tab strip is present with the rule dimension (today's only one).
    expect(within(panel).getByRole('tab', { name: /Rules/ })).toBeInTheDocument();
    // Both rules carry t1 in the fixture.
    expect(within(panel).getByTestId('tag-assoc-row-t1-r1')).toBeInTheDocument();
    expect(within(panel).getByTestId('tag-assoc-row-t1-r2')).toBeInTheDocument();
  });

  it('an orphan tag says so instead of showing an empty box', async () => {
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Show items using unused-tag' }));
    const panel = await screen.findByTestId('tag-associations-orphan');
    // C3: "nothing uses this" is the fact the panel exists to report.
    expect(within(panel).getByText(/No rules use this tag/i)).toBeInTheDocument();
  });

  it('the linked list has the promised columns and a working search', async () => {
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Show items using work' }));
    const panel = await screen.findByTestId('tag-associations-t1');
    const table = within(panel).getByRole('table', { name: 'Rules using this tag' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent.trim());
    expect(headers[0]).toBe('Icon');
    expect(headers[1]).toMatch(/^Title/);
    expect(headers[2]).toBe('URL Pattern');
    expect(headers[3]).toBe('Priority');
    expect(headers[4]).toMatch(/^Actions/);

    fireEvent.change(within(panel).getByLabelText('Search linked rules'), { target: { value: 'https://b/' } });
    await waitFor(() => {
      expect(within(panel).queryByTestId('tag-assoc-row-t1-r1')).toBeNull();
      expect(within(panel).getByTestId('tag-assoc-row-t1-r2')).toBeInTheDocument();
    });
  });

  it('Delete removes the tag from THAT rule only, never the tag itself', async () => {
    // The distinction the panel exists to make safe: from inside "which rules use
    // this tag", the destructive verb means "stop using it here" — a global
    // `DELETE_TAG` would be a far larger act than the row's button implies.
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Show items using work' }));
    const panel = await screen.findByTestId('tag-associations-t1');
    const row = within(panel).getByTestId('tag-assoc-row-t1-r1');
    fireEvent.click(within(row).getByRole('button', { name: /Remove this tag from rule/ }));

    await waitFor(() => { expect(sentWithAction('SET_RULE_TAGS')).toBeDefined(); });
    // r1 carried ONLY t1, so removing it leaves the rule with no tags.
    expect(sentWithAction('SET_RULE_TAGS')?.payload).toEqual({ ruleId: 'r1', tagIds: [] });
    // ...and the TAG itself survives: this action unlinks, it does not delete.
    expect(deleteCalls.some((c) => c.tagId === 't1')).toBe(false);
  });

  it('Redirect leaves the Tags page and focuses that rule (the app’s one jump)', async () => {
    // 1.4's redirect: switch to Page Rewrite Rules AND highlight the row, reusing
    // the shared jump visual language rather than a second reveal mechanism.
    await openTags();
    fireEvent.click(screen.getByRole('button', { name: 'Show items using work' }));
    const panel = await screen.findByTestId('tag-associations-t1');
    const row = within(panel).getByTestId('tag-assoc-row-t1-r2');
    fireEvent.click(within(row).getByRole('button', { name: /Go to rule/ }));

    // The Rules page is what we land on...
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Page Rewrite Rules' })).toBeInTheDocument();
    });
    // ...and the target row is the element the jump highlights.
    await waitFor(() => {
      const target = screen.getByTestId('rule-row-r2');
      expect(target.className).toMatch(/tbs-row-highlight|jump/i);
    });
  });
});

describe('T16: the section is reachable from navigation (7th page)', () => {
  it('a Tags nav button exists and opens the section', async () => {
    render(<SettingsApp />);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Tags' })).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    await waitFor(() => { expect(screen.getByTestId('tags-section')).toBeInTheDocument(); });
  });
});

describe('T9 (U1/U4): every tag write shares ONE undo stack', () => {
  /**
   * The user-visible promise of the stack (U1): two undoable writes give TWO
   * bars, and each bar's Undo replays ITS OWN writes — not the newest action.
   * Before the shared stack, the second write overwrote the first (A7), so this
   * could not be observed at all.
   */
  it('a single delete and an unlink give TWO bars; the first replays only its own write', async () => {
    // Self-contained: an earlier bulk-delete case replaces `mockSendMessage` to
    // make `orphan`'s DELETE_TAG FAIL and does not restore it (that suite's
    // existing convention), so this test installs exactly the responses it needs
    // rather than inheriting a mock whose behaviour it did not choose.
    const base = mockSendMessage.getMockImplementation();
    mockSendMessage.mockImplementation((msg: { action: string; payload?: Record<string, unknown> }) => {
      if (msg.action === 'DELETE_TAG') {
        deleteCalls.push({ tagId: String(msg.payload?.tagId) });
        stateTags = stateTags.filter((t) => t.id !== msg.payload?.tagId);
        return {
          result: { success: true, affectedRuleCount: 1 },
          snapshot: {
            tag: { id: String(msg.payload?.tagId), name: 'unused-tag', backgroundColor: '#999', textColor: '#fff' },
            refs: [{ ruleId: 'r1', tagIds: ['t1'] }],
          },
        };
      }
      return base ? (base(msg) as unknown) : { result: { success: true } };
    });

    await openTags();

    // 1) Delete tag `orphan` (single delete → one `tag-delete` write).
    fireEvent.click(
      within(screen.getByTestId('tag-row-orphan')).getByRole('button', { name: /Delete/i }),
    );
    const dialog = await screen.findByRole('dialog', { name: /delete tag/i });
    await new Promise((r) => setTimeout(r, 160)); // Confirm misclick guard (CT3-b4)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }));
    await waitFor(() => { expect(deleteCalls).toHaveLength(1); });

    // 2) Unlink tag `t1` from rule r1 (→ one `rule-tags` write).
    fireEvent.click(within(screen.getByTestId('tag-row-t1')).getByRole('button', { name: /Show items using/ }));
    const panel = await screen.findByTestId('tag-associations-t1');
    fireEvent.click(
      within(within(panel).getByTestId('tag-assoc-row-t1-r1')).getByRole('button', { name: /Remove this tag from rule/ }),
    );
    await waitFor(() => { expect(sentWithAction('SET_RULE_TAGS')).toBeDefined(); });

    // TWO bars — not one overwriting the other (this is the whole change).
    const undoButtons = await screen.findAllByRole('button', { name: /^Undo$/i });
    expect(undoButtons).toHaveLength(2);

    // Click the FIRST bar (the delete) — it must replay `RESTORE_TAG` ONLY.
    // The unlink's `SET_RULE_TAGS` count must not grow from this click.
    const beforeClick = sent().filter((m) => m.action === 'SET_RULE_TAGS').length;
    const restoresBefore = sent().filter((m) => m.action === 'RESTORE_TAG').length;
    fireEvent.click(undoButtons[0]);

    await waitFor(() => {
      expect(sent().filter((m) => m.action === 'RESTORE_TAG').length).toBe(restoresBefore + 1);
    });
    expect(sent().filter((m) => m.action === 'SET_RULE_TAGS').length).toBe(beforeClick);

    // The second bar survives the first being consumed.
    expect(await screen.findAllByRole('button', { name: /^Undo$/i })).toHaveLength(1);
  });
});