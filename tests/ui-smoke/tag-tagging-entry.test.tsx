/**
 * T13 — the tagging ENTRY POINT, driven end to end through the sidebar.
 *
 * The assertion that matters is the MESSAGE ORDER: `CREATE_RULE` first, then
 * `SET_RULE_TAGS`. The order is not stylistic — `SET_RULE_TAGS` addresses a
 * `ruleId`, so sending it first would name a rule that does not exist yet, and
 * folding tags INTO the create payload would put them on the delivery path (A1:
 * `createRule` ends in a re-application). Both are asserted, the second as a
 * negative: the create payload must not carry a tag field.
 *
 * Cancelling the form is also asserted, because D-f makes "the tag stays behind"
 * a deliberate outcome, not an oversight.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';
import type { TagDefinition } from '@shared/types';

type SentMessage = { action: string; payload?: Record<string, unknown> };

const sent: SentMessage[] = [];
const mockSendMessage = vi.fn((message: SentMessage) => {
  sent.push(message);
  if (message.action === 'CREATE_RULE') {
    return Promise.resolve({ result: { success: true, rule: { id: 'rule-new' } } });
  }
  if (message.action === 'SET_RULE_TAGS') {
    return Promise.resolve({ result: { success: true, tagIds: ['t1'] } });
  }
  if (message.action === 'CREATE_TAG') {
    return Promise.resolve({ result: { success: true, tag: { id: 't-new', name: 'temp-tag', backgroundColor: '#000', textColor: '#fff' } } });
  }
  if (message.action === 'GET_STATE') {
    return Promise.resolve({
      result: {
        success: true,
        sync: {
          configVersion: 1,
          matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
          switchDirection: 'next',
          autoBindGlobal: true,
          slots: [],
          rules: [],
          tags: [{ id: 't1', name: 'work', backgroundColor: '#3366cc', textColor: '#fff' }] as TagDefinition[],
        },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    });
  }
  return Promise.resolve({ result: { success: true } });
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
});

describe('T13: saving a rule from the sidebar writes the rule then its tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
  });

  it('an INTERNAL page is not prefilled, and the modal says why (the reported dead end)', async () => {
    // The reported flow: open the sidebar on `edge://extensions/`, click "Add to
    // global rules". The URL was prefilled, the form opened already invalid (an
    // internal page can never be a rule target), and Save was disabled with nothing
    // on screen explaining it — the prefill itself was the problem.
    // The full surface `SidebarApp` touches: a declared `chrome.tabs` makes it
// register the tab listeners, so those must exist too or the mount throws.
    const noopEvent = { addListener: vi.fn(), removeListener: vi.fn() };
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() }, getURL: (p: string) => p, id: 'test' },
      storage: { local: {}, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
      tabs: {
        query: vi.fn().mockResolvedValue([{
          id: 1, url: 'edge://extensions/', title: 'Extensions', favIconUrl: '', active: true,
        }]),
        get: vi.fn().mockResolvedValue({ id: 1, windowId: 1 }),
        update: vi.fn().mockResolvedValue(undefined),
        onActivated: noopEvent,
        onUpdated: noopEvent,
      },
    });
    render(<SidebarApp />);
    await waitFor(() => { expect(screen.getByRole('application', { name: 'Tab Bookmarks Sidebar' })).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
    await waitFor(() => { expect(screen.getByRole('dialog', { name: 'New Global Page Rule' })).toBeInTheDocument(); });

    const dialog = screen.getByRole('dialog', { name: 'New Global Page Rule' });
    // The field is EMPTY, so the form is not born invalid...
    expect(within(dialog).getByRole('textbox', { name: /^Match URL/ })).toHaveValue('');
    // ...and the reason is stated, so an empty field reads as deliberate.
    expect(within(dialog).getByTestId('rule-prefill-refused')).toHaveTextContent(/internal page/i);
  });

  it('one Save click sends EXACTLY ONE CREATE_RULE', async () => {
    // The findIndex assertions below only ever look at the FIRST occurrence, so a
    // second CREATE_RULE from the same click is invisible to them — and a second
    // call is rejected as a duplicate, which is what the user sees: a success
    // toast AND a duplicate error, with the rule created either way.
    render(<SidebarApp />);
    await waitFor(() => { expect(screen.getByRole('application', { name: 'Tab Bookmarks Sidebar' })).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
    await waitFor(() => { expect(screen.getByRole('dialog', { name: 'New Global Page Rule' })).toBeInTheDocument(); });

    const dialog = screen.getByRole('dialog', { name: 'New Global Page Rule' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Match URL/ }), {
      target: { value: 'https://example.com/' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save/ }));

    await waitFor(() => { expect(sent.some((m) => m.action === 'CREATE_RULE')).toBe(true); });
    // Let any trailing effect / second dispatch settle before counting.
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((m) => m.action === 'CREATE_RULE')).toHaveLength(1);
  });

  it('sends CREATE_RULE first and SET_RULE_TAGS second, with no tags in the create payload', async () => {
    render(<SidebarApp />);
    await waitFor(() => { expect(screen.getByRole('application', { name: 'Tab Bookmarks Sidebar' })).toBeInTheDocument(); });

    // Open the rule modal.
    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
    await waitFor(() => { expect(screen.getByRole('dialog', { name: 'New Global Page Rule' })).toBeInTheDocument(); });

    // Pick a tag, then save. Scope to the dialog: the page behind it also has
    // Save-labelled buttons, and picking the wrong one would test nothing.
    const dialog = screen.getByRole('dialog', { name: 'New Global Page Rule' });
    // The Save action is gated on a non-empty Match URL; the stub has no live
    // tab, so the field must be filled for the form to be saveable at all.
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Match URL/ }), {
      target: { value: 'https://example.com/' },
    });
    const workBox = await screen.findByRole('checkbox', { name: 'work' });
    fireEvent.click(workBox);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save/ }));

    await waitFor(() => {
      expect(sent.some((m) => m.action === 'SET_RULE_TAGS')).toBe(true);
    });

    const createIndex = sent.findIndex((m) => m.action === 'CREATE_RULE');
    const tagsIndex = sent.findIndex((m) => m.action === 'SET_RULE_TAGS');
    // ORDER: the rule exists before tags address it.
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(tagsIndex).toBeGreaterThan(createIndex);

    // The create payload carries NO tag field (A1/R5 — tags must not reach the
    // delivery path).
    const createPayload = sent[createIndex].payload ?? {};
    expect(Object.keys(createPayload)).not.toContain('tagIds');
    expect(Object.keys(createPayload)).not.toContain('tags');

    // The tag write names the NEW rule and the picked tag.
    const tagsPayload = sent[tagsIndex].payload ?? {};
    expect(tagsPayload.ruleId).toBe('rule-new');
    expect(tagsPayload.tagIds).toEqual(['t1']);
  });

  it('cancelling the form does NOT delete a tag created in place (D-f)', async () => {
    render(<SidebarApp />);
    await waitFor(() => { expect(screen.getByRole('application', { name: 'Tab Bookmarks Sidebar' })).toBeInTheDocument(); });

    fireEvent.click(screen.getByRole('button', { name: 'Add to global rules' }));
    await waitFor(() => { expect(screen.getByRole('dialog', { name: 'New Global Page Rule' })).toBeInTheDocument(); });

    // Create a tag in place.
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New tag name' }), { target: { value: 'temp-tag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => { expect(sent.some((m) => m.action === 'CREATE_TAG')).toBe(true); });

    // Cancel the form. The query is EXACT (`/^Cancel$/`) because the tag selector can
// now be open in its create state, whose own action is named "Cancel new tag" —
// a substring match would be ambiguous between abandoning the new TAG and
// abandoning the whole RULE, which is precisely the distinction this test is
// about.
    const dialog = screen.getByRole('dialog', { name: 'New Global Page Rule' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }));

    // No rollback: the tag stays (it is now an orphan, visible on the Tags page).
    expect(sent.some((m) => m.action === 'DELETE_TAG')).toBe(false);
    expect(sent.some((m) => m.action === 'CREATE_RULE')).toBe(false);
  });
});
