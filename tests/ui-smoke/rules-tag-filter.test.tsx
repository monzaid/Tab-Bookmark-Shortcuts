/**
 * T15 — the Rules table's tag expression filter, its TWO pause messages, and the
 * default-collapsed Tags column.
 *
 * The central distinction is C6 vs C7: both "do not filter", but they differ in
 * whether a tag is NAMED:
 *   C6 — the expression is incomplete (the user is mid-edit)  => no naming
 *   C7 — the expression is complete but a tag was DELETED      => the tag is named
 * Merging them regresses to "syntactically fine but silently shows everything",
 * which is the hardest form to diagnose, so each is asserted separately —
 * including the NEGATIVE half (C6's message must NOT contain the tag name).
 *
 * The Tags column is asserted STRUCTURALLY: default = not in the DOM at all
 * (D-c says the column is not rendered, not rendered-empty), and the empty
 * state's colSpan must track the visible column count.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';
import type { TagDefinition } from '@shared/types';

const TAGS: TagDefinition[] = [{ id: 'a', name: 'work', backgroundColor: '#3366cc', textColor: '#fff' }];

const RULES = [
  { id: 'r1', urlMatch: { type: 'exact', value: 'https://a.com/one' }, priority: 0, title: 'Alpha', enabled: true, tagIds: ['a'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'r2', urlMatch: { type: 'exact', value: 'https://b.com/two' }, priority: 5, title: 'Beta', enabled: true, tagIds: [], createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
];

/** Mutable so a test can simulate the tag being deleted elsewhere (C7). */
let stateTags: TagDefinition[] = [...TAGS];
const storageListeners: Array<(c: unknown, area: string) => void> = [];
/**
 * Whether `CREATE_TAG` succeeds. A flag rather than `mockImplementationOnce`
 * because `GET_STATE` goes through the SAME mock and would consume the one-shot.
 */
let createTagSucceeds = true;

interface SentMessage { action: string; payload?: Record<string, unknown> }
/**
 * The messages actually sent, TYPED.
 *
 * `mock.calls` is `any[]`, so reading `c[0].action` inline is an unsafe member
 * access on `any` — four of them per assertion. One typed accessor keeps the
 * assertions readable and the lint honest.
 */
const sentCalls = (): SentMessage[] => mockSendMessage.mock.calls.map((c) => c[0] as SentMessage);

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string; payload?: { name?: string } }) => {
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: { configVersion: 2, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: RULES, tags: stateTags },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  if (msg.action === 'CREATE_TAG') {
    const name = msg.payload?.name ?? '';
    if (!createTagSucceeds) {
      return { result: { success: false, errorCode: 'TAG_NAME_DUPLICATE', message: 'A tag with this name already exists.' } };
    }
    const tag: TagDefinition = { id: 't-new', name, backgroundColor: '#6B7280', textColor: '#FFFFFF' };
    // PERSIST it, so the `GET_STATE` the section re-reads after the write shows
    // the tag as live — that re-read is what makes it a usable operand rather
    // than a chip naming nothing.
    stateTags = [...stateTags, tag];
    return { result: { success: true, tag } };
  }
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  if (msg.action === 'CREATE_RULE') {
    // `createRule` returns the new rule, and the section needs its ID to tag it —
    // so a mock that omits `rule` would let the tag write silently not happen.
    return { result: { success: true, rule: { ...RULES[1], id: 'rule-new' } } };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
  storage: {
    onChanged: {
      addListener: vi.fn((cb: (c: unknown, area: string) => void) => { storageListeners.push(cb); }),
      removeListener: vi.fn(),
    },
  },
});

/** Simulate a sync-area change (what the section listens to) and let React settle. */
function emitSyncChange(): void {
  for (const cb of storageListeners) cb({}, 'sync');
}

async function openRules() {
  render(<SettingsApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Page Rules' }));
  await waitFor(() => { expect(screen.getByRole('table', { name: 'Page rules' })).toBeInTheDocument(); });
}

/** Click a candidate chip in the expression input (e.g. the `work` tag or AND). */
function addChip(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  stateTags = [...TAGS];
  storageListeners.length = 0;
  createTagSucceeds = true;
});

describe('G3: the New Rule and Edit Rule forms carry the tag editor', () => {
  it('New Rule shows the tag control, and Save writes the tags AFTER the rule', async () => {
    // The defect this pins: this form called `RuleFormFields` WITHOUT
    // `availableTags`, and the selector only renders when it is defined — so the
    // tag control was simply absent from New Rule and Edit Rule, while the
    // sidebar's modal (the same field set, passed the props) had it.
    await openRules();
    fireEvent.click(screen.getByRole('button', { name: 'Create new rule' }));

    const form = await screen.findByRole('form', { name: 'Create new rule' });
    expect(within(form).getByRole('group', { name: /tags/i })).toBeInTheDocument();

    // Fill the URL (required) and pick the fixture tag.
    // Anchored: `Reset Match URL` (the inline reset button) also matches a bare
  // `/Match URL/i`, so an unanchored query is ambiguous between the field and its
  // own reset affordance.
  fireEvent.change(within(form).getByLabelText(/^Match URL/), { target: { value: 'https://c.com/three' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'work' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => { expect(sentCalls().some((m) => m.action === 'SET_RULE_TAGS')).toBe(true); });
    const tagsCall = sentCalls().find((m) => m.action === 'SET_RULE_TAGS');
    // It targets the rule the create returned — a tag referencing a rule that does
    // not exist yet would be the broken-reference state.
    expect(tagsCall?.payload).toEqual({ ruleId: 'rule-new', tagIds: ['a'] });

    // ...and the rule write came FIRST (order matters: the rule must exist).
    const createIndex = sentCalls().findIndex((m) => m.action === 'CREATE_RULE');
    const tagsIndex = sentCalls().findIndex((m) => m.action === 'SET_RULE_TAGS');
    expect(createIndex).toBeLessThan(tagsIndex);
  });

  it('Edit Rule shows the CURRENT tags of the rule and writes the changed set', async () => {
    await openRules();
    // `r1` carries tag `a`; `r2` carries none. Open r2's editor.
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule r2' }));

    const form = await screen.findByRole('form', { name: /Edit rule r2/i });
    const tagGroup = within(form).getByRole('group', { name: /tags/i });
    expect(tagGroup).toBeInTheDocument();
    // Seeded from the RULE, so it opens showing what the rule actually carries.
    expect(within(tagGroup).getByRole('checkbox', { name: 'work' })).not.toBeChecked();

    fireEvent.click(within(tagGroup).getByRole('checkbox', { name: 'work' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Update Rule' }));

    await waitFor(() => { expect(sentCalls().some((m) => m.action === 'SET_RULE_TAGS')).toBe(true); });
    const tagsCall = sentCalls().find((m) => m.action === 'SET_RULE_TAGS');
    expect(tagsCall?.payload).toEqual({ ruleId: 'r2', tagIds: ['a'] });
  });
});

describe('T15: both rules visible whenever the expression does not apply (C6)', () => {
  it('an INCOMPLETE expression shows everything and does NOT name the tag', async () => {
    await openRules();
    addChip('Add work');
    addChip('Add AND');       // now half-written: `work AND`
    await waitFor(() => {
      expect(screen.getByTestId('rule-row-r1')).toBeInTheDocument();
      expect(screen.getByTestId('rule-row-r2')).toBeInTheDocument();
    });
    // The pause notice exists and does NOT contain the tag name (C6: no naming).
    const notices = screen.getAllByTestId('tag-filter-notice');
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.map((n) => n.textContent).join(' ')).not.toContain('work');
  });

  it('an expression referencing a tag deleted elsewhere shows everything and NAMES it (C7)', async () => {
    await openRules();
    addChip('Add work');       // a valid expression referencing `work`
    await waitFor(() => { expect(screen.queryByTestId('rule-row-r2')).toBeNull(); });

    // The tag is deleted on another surface; the section reloads on the change.
    stateTags = [];
    emitSyncChange();

    await waitFor(() => {
      // No filter now — BOTH rows return (C7 "pause", not "empty").
      expect(screen.getByTestId('rule-row-r1')).toBeInTheDocument();
      expect(screen.getByTestId('rule-row-r2')).toBeInTheDocument();
    });
    // ...and the notice NAMES the deleted tag via its insert-time name (C7).
    const notices = screen.getAllByTestId('tag-filter-notice');
    expect(notices.map((n) => n.textContent).join(' ')).toContain('work');
  });
});

describe('T15: a complete expression narrows the list', () => {
  it('`work` alone shows only the rule that carries it', async () => {
    await openRules();
    addChip('Add work');
    await waitFor(() => {
      expect(screen.getByTestId('rule-row-r1')).toBeInTheDocument();
      expect(screen.queryByTestId('rule-row-r2')).toBeNull();
    });
  });
});

describe('T15: the Tags column is NOT rendered by default (D-c)', () => {
  it('the column is absent from the DOM until toggled', async () => {
    await openRules();
    expect(screen.queryByTestId('rules-col-tags')).toBeNull();
  });

  it('the toggle reveals the column and its header reads Tags', async () => {
    await openRules();
    fireEvent.click(screen.getByRole('button', { name: /Show tags/i }));
    await waitFor(() => { expect(screen.getByTestId('rules-col-tags')).toBeInTheDocument(); });
    expect(within(screen.getByTestId('rules-col-tags')).getByText('Tags')).toBeInTheDocument();
  });
});

describe('D-c: the Tags-column control is a LABELLED button, not a glyph', () => {
  it('states its action in text, and flips it with the state', async () => {
    // The reported complaint: a 20px square carrying `⊘`. A glyph is not a label —
    // the accessible name lived only in `aria-label`, so a sighted user had to
    // guess at a symbol — and 20px is below the density floor this table uses.
    await openRules();
    const toggle = await screen.findByTestId('rules-tags-column-toggle');
    expect(toggle.textContent).toBe('Show Tags column');
    // `aria-pressed` states the toggle's state as a toggle (not a fire-and-forget
    // button), which is also what lets the label name the ACTION.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    // No glyph left behind.
    expect(toggle.textContent).not.toContain('⊘');

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId('rules-tags-column-toggle').textContent).toBe('Hide Tags column');
    });
    expect(screen.getByTestId('rules-tags-column-toggle').getAttribute('aria-pressed')).toBe('true');
    // The column really appeared, so the label is not a claim on its own.
    expect(screen.getByTestId('rules-col-tags')).toBeInTheDocument();
  });

  it('owns no icon-button classes (it is not an icon button)', async () => {
    await openRules();
    const toggle = await screen.findByTestId('rules-tags-column-toggle');
    // The old spelling borrowed the Dashboard's icon toggle classes, which is what
    // made a 20px glyph box out of it.
    expect(toggle.className).not.toContain('tbs-settings__url-toggle');
    expect(toggle.className).toContain('tbs-btn');
  });
});

describe('T15: the empty state colSpan tracks the visible column count', () => {
  it('colSpan is 7 with the Tags column hidden and 8 with it shown', async () => {
    await openRules();
    // Force the empty state by searching for something that matches nothing.
    // Addressed by LABEL, not role: the box is `type="search"`, whose role is
    // `searchbox` — it used to be a hand-rolled `type="text"` here, which is why
    // this read as a `textbox`.
    fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'zzz-no-match' } });
    await waitFor(() => { expect(screen.getByText(/No rules match|No rules/i)).toBeInTheDocument(); });
    const cell = screen.getByRole('cell');
    expect(cell.getAttribute('colspan')).toBe('7');

    fireEvent.click(screen.getByRole('button', { name: /Show tags/i }));
    await waitFor(() => { expect(screen.getByRole('cell').getAttribute('colspan')).toBe('8'); });
  });
});

describe('T15: the text search keeps working alongside the expression (G6)', () => {
  it('search narrows by literal text independent of the expression', async () => {
    await openRules();
    fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'Beta' } });
    await waitFor(() => {
      expect(screen.getByTestId('rule-row-r2')).toBeInTheDocument();
      expect(screen.queryByTestId('rule-row-r1')).toBeNull();
    });
  });
});

/**
 * G5/D-b: creating a tag in place from the expression filter.
 *
 * This path was wired to a STUB (`async () => null`), so the control rendered and
 * then did nothing. The stub was invisible to the existing suite because every
 * test either supplied its own `onCreateTag` or never typed a new name — and the
 * create row appears EXACTLY in the case the tests did not cover (a name matching
 * no existing tag). Both directions are asserted, so neither passes vacuously:
 * a success that writes and becomes usable, and a failure that SAYS SO.
 */
describe('G5/D-b: the expression input creates a tag through the real write path', () => {
  /** Type a name that matches no existing tag, then take the offered create row. */
  async function createTagFromFilter(name: string): Promise<void> {
    await openRules();
    const field = document.querySelector('.tbs-tag-chip-input__field');
    if (!field) throw new Error('the expression input rendered no text field');
    fireEvent.change(field, { target: { value: name } });
    fireEvent.click(await screen.findByRole('button', { name: `Create tag "${name}"` }));
  }

  it('sends CREATE_TAG and the created tag becomes a usable chip and candidate', async () => {
    await createTagFromFilter('urgent');

    // The WRITE happened, through the one message every create-in-place surface
    // uses — with an appearance, because a tag with no colours is not a tag.
    const call = mockSendMessage.mock.calls.find((c) => (c[0] as { action: string }).action === 'CREATE_TAG');
    expect(call).toBeDefined();
    const payload = (call?.[0] as { payload?: Record<string, unknown> }).payload ?? {};
    expect(payload.name).toBe('urgent');
    expect(payload.backgroundColor).toBeTruthy();
    expect(payload.textColor).toBeTruthy();

    // The chip lands ASYNCHRONOUSLY: the write is awaited, then the section
    // re-reads its snapshot, and only then does the component append the chip.
    // Asserting synchronously here failed on the first run — the DOM is a
    // consequence of the write, not of the click.
    await waitFor(() => {
      expect(document.querySelector('.tbs-tag-chip')?.textContent).toContain('urgent');
    });
    // ...and the tag is LIVE, not just a name on a chip: the section re-read it,
    // so it is also offered as a candidate in its own right. A chip naming a tag
    // the machine does not have is the C7 broken-reference state, not a create.
    expect(await screen.findByRole('button', { name: 'Add urgent' })).toBeInTheDocument();
  });

  it('a REFUSED create reports why, and adds nothing', async () => {
    // The failure direction is the one a user most needs told: the create row
    // appearing is itself the prompt, so silence there is indistinguishable from
    // a slow render. (The service refuses duplicates by name — C2.)
    createTagSucceeds = false;
    await createTagFromFilter('urgent');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already exists/i);

    // No chip, and no phantom candidate — a refusal adds nothing to the filter.
    expect(document.querySelector('.tbs-tag-chip')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add urgent' })).toBeNull();
  });
});