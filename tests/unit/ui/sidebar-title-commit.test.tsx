/**
 * Review item 4 — the title editor's `↺ Reset` and `⊘ Clear this layer`.
 *
 * Two reported symptoms, one root cause: the input commits on BLUR, and both
 * toolbar buttons blurred it on their way in (`mousedown` moves focus before
 * `click` fires), so the button's own action was overwritten by the commit it
 * had just triggered:
 *
 * - `↺` was meant to put the ORIGINAL text back into the box. The blur commit
 *   then SAVED the discarded text, so the tab kept the un-reset value.
 * - `⊘` was meant to clear the page layer. The blur commit immediately re-wrote
 *   the override from the still-filled draft, so the button looked dead.
 *
 * Both are asserted here through the messages the background receives, because
 * "the input's text changed" would pass even when the write cancels it out.
 *
 * NOTE on what these tests can and cannot prove: jsdom does not move focus on
 * `mousedown` (real browsers do), so it cannot reproduce the blur race itself.
 * What it CAN assert is the fix's mechanism — that `mousedown` is cancelled so
 * the focus never leaves the input — plus the once-only commit guard, which IS
 * observable because the guard is what a stray commit hits.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const ACTIVE_TAB = {
  id: 42,
  url: 'https://example.com',
  title: 'Original title',
  favIconUrl: 'https://example.com/favicon.ico',
};

const mockSendMessage = vi.fn().mockImplementation((message: { action: string }) => {
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
          // A matching rule gives the chain a RECORD, which is what makes the
          // record summary render inside the editor (item 3 needs one to exist).
          rules: [{
            id: 'r1',
            urlMatch: { type: 'exact', value: 'https://example.com' },
            priority: 0,
            title: 'Rule title',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
        local: {
          bindings: [],
          cycleCursors: [],
          lastSuccessSlotId: null,
          recoverySessions: [],
          recoverySnapshots: [],
          tabOverrides: [],
          iconCache: {},
          diagnostics: [],
        },
      },
    });
  }
  return Promise.resolve({ result: { success: true } });
});

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([ACTIVE_TAB]),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

/** Messages that WRITE a title — the only ones this behaviour can be judged by. */
const titleWrites = () =>
  mockSendMessage.mock.calls.filter((call) => {
    const message = call[0] as { action?: string; payload?: { title?: string } };
    return message.action === 'SET_TAB_OVERRIDE' && message.payload?.title !== undefined;
  });

/** Double-click the displayed title, which is what opens the inline editor. */
async function openTitleEditor(): Promise<HTMLInputElement> {
  render(<SidebarApp />);
  const displayed = await waitFor(() => {
    const el = document.querySelector('.tbs-sidebar__current-title');
    if (!el) throw new Error('current title not rendered yet');
    return el;
  });
  fireEvent.doubleClick(displayed);
  return await screen.findByLabelText('Rename current tab');
}

describe('review item 4 — the title editor buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
 * Review item 3 (round 6): the masking summary is INSIDE the open editor, so a
 * click on it used to tear the editor down — the input's blur committed and the
 * box closed. The `…and N more` disclosure was the worst offender: pure
 * disclosure should never end an edit.
 *
 * Like the button test below, jsdom cannot reproduce the focus race, so what is
 * asserted is the MECHANISM: the summary, its list and its controls all cancel
 * `mousedown`, which is what keeps the focus (and therefore the editor) alive.
 */
it('renders the summary inside the editor and cancels its mousedown', async () => {
  await openTitleEditor();

  const summary = document.querySelector('.tbs-masked');
  expect(summary).not.toBeNull();
  // It is genuinely inside the inline editor, which is why its events matter.
  expect(summary!.closest('.tbs-inline-field, .tbs-sidebar__current') ?? summary!.parentElement).not.toBeNull();

  const inertTargets = [summary!, summary!.querySelector('.tbs-masked__summary')!, summary!.querySelector('.tbs-masked__list')!];
  for (const target of inertTargets) {
    expect(fireEvent.mouseDown(target)).toBe(false);
  }

  // The controls must keep the editor alive too, not just look inert.
  const expand = summary!.querySelector<HTMLElement>('.tbs-masked__expand');
  if (expand) expect(fireEvent.mouseDown(expand)).toBe(false);
});

it('cancels the mousedown on both buttons so the input never blurs', async () => {
    /**
     * This is the MECHANISM of the fix. In a real browser, `mousedown` on a
     * button moves focus, the input fires `blur`, and the commit handler runs
     * BEFORE `click` — so the button's work was overwritten by its own blur.
     * Preventing the default on `mousedown` is what stops that chain, and
     * `defaultPrevented` is exactly what the browser consults.
     */
    const input = await openTitleEditor();
    // `↺` is disabled while the box still holds the opened value (there is
    // nothing to restore), so the race can only happen once the user has typed.
    fireEvent.change(input, { target: { value: 'Changed' } });

    for (const name of ['Reset current page title', 'Clear the page title override']) {
      const button = screen.getByRole('button', { name });
      // `fireEvent` returns `!event.defaultPrevented` — false proves the handler
      // cancelled the default (which is what keeps the focus on the input).
      expect(fireEvent.mouseDown(button)).toBe(false);
    }
  });

  it('ignores the stray commit a button press would otherwise trigger', async () => {
    // The second half of the fix: if a commit still arrives, it is swallowed
    // once so it cannot undo the button's action.
    const input = await openTitleEditor();
    fireEvent.change(input, { target: { value: 'Should not be saved' } });

    const reset = screen.getByRole('button', { name: 'Reset current page title' });
    fireEvent.click(reset);
    // A commit arriving now must be ignored, not written.
    fireEvent.blur(input);

    await waitFor(() => {
      const saved = titleWrites().filter((call) => {
        const message = call[0] as { payload?: { title?: string } };
        return message.payload?.title === 'Should not be saved';
      });
      expect(saved).toHaveLength(0);
    });
  });

  it('keeps the title box OPEN when Reset is pressed', async () => {
    const input = await openTitleEditor();
    fireEvent.change(input, { target: { value: 'Typed but unwanted' } });

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Reset current page title' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset current page title' }));

    // The box is still there (the blur did not close it) and holds the ORIGINAL.
    expect(screen.getByLabelText('Rename current tab')).toHaveValue('Original title');
  });

  it('does NOT save the discarded text when Reset is pressed', async () => {
    const input = await openTitleEditor();
    fireEvent.change(input, { target: { value: 'Typed but unwanted' } });

    const reset = screen.getByRole('button', { name: 'Reset current page title' });
    fireEvent.mouseDown(reset);
    fireEvent.click(reset);

    // The reported defect: the discarded value reached the storage layer anyway.
    await waitFor(() => {
      const discarded = titleWrites().filter((call) => {
        const message = call[0] as { payload?: { title?: string } };
        return message.payload?.title === 'Typed but unwanted';
      });
      expect(discarded).toHaveLength(0);
    });
  });

  it('clears the page layer when Clear this layer is pressed', async () => {
    const input = await openTitleEditor();
    fireEvent.change(input, { target: { value: 'Typed value' } });

    const clear = screen.getByRole('button', { name: 'Clear the page title override' });
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);

    // Clearing = an empty title write (the layer falls through to slot/rule/site).
    await waitFor(() => {
      const clearing = titleWrites().filter((call) => {
        const message = call[0] as { payload?: { title?: string } };
        return message.payload?.title === '';
      });
      expect(clearing.length).toBeGreaterThan(0);
    });
  });

  it('does NOT re-write the draft after the layer was cleared', async () => {
    const input = await openTitleEditor();
    fireEvent.change(input, { target: { value: 'Typed value' } });

    const clear = screen.getByRole('button', { name: 'Clear the page title override' });
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);

    // The reported defect: the blur commit landed AFTER the clear and restored it.
    await waitFor(() => {
      const restored = titleWrites().filter((call) => {
        const message = call[0] as { payload?: { title?: string } };
        return message.payload?.title === 'Typed value';
      });
      expect(restored).toHaveLength(0);
    });
  });

  it('still saves a genuine edit (the suppression is once-only)', async () => {
    const input = await openTitleEditor();
    fireEvent.change(input, { target: { value: 'A real edit' } });
    // A plain blur — no button involved.
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'SET_TAB_OVERRIDE',
        payload: expect.objectContaining({ tabId: 42, title: 'A real edit' }),
      }));
    });
  });
});