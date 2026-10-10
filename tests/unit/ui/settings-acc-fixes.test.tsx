import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SettingsApp } from '@ui/settings/App';

/**
 * ACC#2 / ACC#5 / ACC#6a — settings-page fixes discovered in manual acceptance.
 * - #2  the Global Matching Settings section must reuse the settings row layout.
 * - #5  editing a per-slot Custom knob must NOT silently collapse the slot back
 *       to "Inherit global" when the async write fails.
 * - #6a Priority has meaning only for combination 1, so it must be hidden when
 *       Tab ID = "No tab ID" (its stored value is preserved, not cleared).
 */

const STATE = (over: { slots?: unknown[] } = {}) => ({
  result: {
    success: true,
    commands: [],
    sync: {
      configVersion: 1,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: over.slots ?? [],
      rules: [],
    },
    local: {},
  },
});

let mockSendMessage: ReturnType<typeof vi.fn>;

/** `impl` returns a plain value; the mock wraps it in a resolved promise. */
function installChrome(impl: (msg: { action: string; payload?: unknown }) => unknown) {
  mockSendMessage = vi.fn((msg: { action: string; payload?: unknown }) => Promise.resolve(impl(msg)));
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
}

async function openStrategy() {
  render(<SettingsApp />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
}

describe('ACC#2: Global Matching Settings uses the shared settings row layout', () => {
  beforeEach(() => {
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE();
      return { result: { success: true } };
    });
  });

  it('renders each global control row with the settings row class', async () => {
    await openStrategy();

    // The Switch Direction and Auto-bind rows already carry the row class.
    const directionRow = screen.getByText('Switch Direction').closest('label');
    expect(directionRow?.classList.contains('tbs-settings__row')).toBe(true);

    // The knobs container is a single styled block in the same row family.
    const knobs = document.querySelector('.tbs-settings__knobs');
    expect(knobs).not.toBeNull();
  });

  it('defines the row / knobs classes in settings.css (no unstyled controls)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/settings.css'), 'utf8');
    expect(css).toMatch(/\.tbs-settings__row\b/);
    expect(css).toMatch(/\.tbs-settings__knobs\b/);
  });
});

describe('ACC#5: per-slot Custom edit is never silently discarded', () => {
  it('keeps Strategy=Custom and the edited knob when the write FAILS', async () => {
    const slots = [
      {
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: 'inherit',
        uiMarker: {},
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE({ slots });
      if (msg.action === 'SET_SLOT_STRATEGY') {
        return { result: { success: false, errorCode: 'CONFIG_CONFLICT', message: 'conflict' } };
      }
      return { result: { success: true } };
    });

    await openStrategy();

    // Switch slot 1 to Custom.
    const slotStrategy = screen.getByRole('combobox', { name: 'Strategy for slot 1' });
    fireEvent.change(slotStrategy, { target: { value: 'custom' } });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Strategy for slot 1' })).toHaveValue('custom');
    });

    // Now edit one knobs control (the write will fail).
    const ruleCheck = screen.getByLabelText('Slot 1 Rule Check');
    fireEvent.change(ruleCheck, { target: { value: 'no-match' } });

    // The user's Custom selection and edited value must survive the failure.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Strategy for slot 1' })).toHaveValue('custom');
    });
    expect(screen.getByLabelText('Slot 1 Rule Check')).toHaveValue('no-match');
  });
});

describe('ACC#6a: Priority is hidden when Tab ID = "No tab ID"', () => {
  beforeEach(() => {
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE();
      return { result: { success: true } };
    });
  });

  it('hides the global Priority control when tabIdMode is no-exists', async () => {
    await openStrategy();

    expect(screen.getByLabelText('Global Priority')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Global Tab ID'), { target: { value: 'no-exists' } });

    await waitFor(() => {
      expect(screen.queryByLabelText('Global Priority')).toBeNull();
    });

    // The stored value is PRESERVED (payload keeps priority='tabId'), not cleared.
    const lastCall = mockSendMessage.mock.calls.at(-1)?.[0] as
      | { action: string; payload?: { matchSettings?: { priority?: string } } }
      | undefined;
    expect(lastCall?.action).toBe('SET_GLOBAL_STRATEGY');
    expect(lastCall?.payload?.matchSettings?.priority).toBe('tabId');
  });

  it('hides Priority in the per-slot Custom expansion too, keeping the value', async () => {
    const slots = [
      {
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'rule-check' },
        uiMarker: {},
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE({ slots });
      return { result: { success: true } };
    });

    await openStrategy();

    expect(screen.getByLabelText('Slot 1 Priority')).toHaveValue('rule-check');
    fireEvent.change(screen.getByLabelText('Slot 1 Tab ID'), { target: { value: 'no-exists' } });

    await waitFor(() => {
      expect(screen.queryByLabelText('Slot 1 Priority')).toBeNull();
    });

    const call = mockSendMessage.mock.calls.at(-1)?.[0] as
      | { action: string; payload?: { strategy?: { priority?: string } } }
      | undefined;
    expect(call?.action).toBe('SET_SLOT_STRATEGY');
    expect(call?.payload?.strategy?.priority).toBe('rule-check');
  });

  it('explains the missing Priority control instead of leaving a silent gap', async () => {
    // A control that merely DISAPPEARS leaves the reader wondering whether they
    // mis-clicked or lost their setting. The value is preserved, so the note must
    // say why the control is gone — and it must be visible only in that state.
    await openStrategy();

    expect(document.querySelector('.tbs-settings__note')).toBeNull();

    fireEvent.change(screen.getByLabelText('Global Tab ID'), { target: { value: 'no-exists' } });

    await waitFor(() => {
      expect(screen.queryByLabelText('Global Priority')).toBeNull();
    });
    expect(document.querySelector('.tbs-settings__note')?.textContent).toMatch(
      /Priority applies only when Tab ID is used/,
    );
    expect(document.querySelector('.tbs-settings__note')?.textContent).toMatch(/kept/i);
  });
});

/**
 * The section was three differently-styled piles of controls: an unlabelled run
 * of selects, two loose rows, then a full-width table. It now reads as three
 * titled blocks. jsdom has no layout engine, so these assert the STRUCTURE that
 * produces that reading (cf. `settings-class-css.test.ts`).
 */
describe('Global Matching Settings — the redesign’s structural claims', () => {
  beforeEach(() => {
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE();
      return { result: { success: true } };
    });
  });

  it('groups the controls into titled cards, in the order the questions are asked', async () => {
    await openStrategy();

    const titles = Array.from(
      document.querySelectorAll('.tbs-settings__card .tbs-settings__card-title'),
    ).map((el) => el.textContent);

    // Which tab → how it behaves → which slot differs. The order is the point:
    // the per-slot block only makes sense once the global values are known.
    expect(titles).toEqual([
      'Which tab to switch to',
      'How switching behaves',
      'Per-slot overrides',
    ]);
  });

  it('says what the screen decides before showing any control', async () => {
    await openStrategy();

    const sub = document.querySelector('.tbs-settings__panel-sub')?.textContent ?? '';
    expect(sub).toMatch(/finds its tab/i);
    // ...and that the values below are the DEFAULT, which is what makes the
    // per-slot block a set of exceptions rather than a second set of settings.
    expect(sub).toMatch(/default for every slot/i);
  });

  it('explains each knob’s EFFECT, not just its stored value', async () => {
    // "Exists" / "No tab ID" / "Match" are implementation facts. Without the hint
    // the only place to learn what they do is the collapsed reference.
    await openStrategy();

    const hints = Array.from(document.querySelectorAll('.tbs-settings__knob-hint'))
      .map((el) => el.textContent);
    expect(hints.length).toBe(3);
    expect(hints.some((h) => /bound to/i.test(h))).toBe(true);
    expect(hints.some((h) => /Match URL/.test(h))).toBe(true);
    expect(hints.some((h) => /wins when both/i.test(h))).toBe(true);
  });

  it('shows the slots as a list of self-contained rows, not a wide table', async () => {
    // The old table stretched to the pane, so the controls sat far from the row
    // they described and the Custom expansion was squeezed into one cell.
    await openStrategy();

    expect(screen.queryByRole('table', { name: 'Slot settings overrides' })).toBeNull();

    const rows = document.querySelectorAll('li.tbs-settings__slot-row');
    expect(rows).toHaveLength(10);

    // Each row owns its identity AND both controls, so no cell has to be found
    // by column position.
    for (const row of Array.from(rows)) {
      expect(row.querySelector('.tbs-settings__slot-row__name')?.textContent).toBeTruthy();
      expect(row.querySelectorAll('.tbs-settings__slot-row__field select')).toHaveLength(2);
    }
  });

  it('names each slot row by NUMBER only — never the page it currently holds', async () => {
    // This list is the SLOT dimension: a slot overrides how switching works for
    // whatever page it later holds. Appending the current page title
    // ("Slot 3 — Docs") reads as "this row manages the Docs tab", which is the
    // TAB dimension — a different mental model, and the wrong one.
    //
    // The fixture gives slot 3 BOTH a custom title and a snapshot, so the
    // assertion cannot pass merely because the machine had nothing to name.
    const slots = [
      {
        id: 3,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: 'inherit',
        uiMarker: { customTitle: 'Docs' },
        titleSnapshot: 'Example',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE({ slots });
      return { result: { success: true } };
    });
    await openStrategy();

    const name = screen.getByTestId('slot-row-3')
      .querySelector('.tbs-settings__slot-row__name')?.textContent;
    expect(name).toBe('Slot 3');
    // The title is genuinely available in the state, and deliberately NOT shown
    // here. Otherwise this passes by the title simply being absent.
    expect(screen.queryByText(/Docs/)).toBeNull();

    // Every other row is the bare number too — including the empty ones, which
    // must not become "Slot 1 — ".
    expect(
      Array.from(document.querySelectorAll('.tbs-settings__slot-row__name'))
        .map((el) => el.textContent),
    ).toEqual(Array.from({ length: 10 }, (_, i) => `Slot ${String(i + 1)}`));
  });

  it('flags an overridden slot and counts them in the card header', async () => {
    // "Which slots differ from the global value" is the question this block
    // answers; reading ten select values to answer it is the thing being fixed.
    const slot = (id: number, strategy: unknown, autoBindOverride?: boolean) => ({
      id,
      urlMatch: { type: 'exact', value: 'https://example.com' },
      strategy,
      ...(autoBindOverride === undefined ? {} : { autoBindOverride }),
      uiMarker: {},
      titleSnapshot: '',
      faviconSnapshot: '',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const slots = [
      slot(1, { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }),
      // Auto-bind ONLY: still an override, and the count must say so — a tally
      // that ignored it would read "1 of 10" beside a row visibly not inheriting.
      slot(2, 'inherit', true),
    ];
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE({ slots });
      return { result: { success: true } };
    });
    await openStrategy();

    expect(document.querySelectorAll('.tbs-settings__slot-row--custom')).toHaveLength(2);
    expect(document.querySelector('.tbs-settings__card-meta')?.textContent).toBe('2 of 10 customised');
  });

  it('does not repeat the knob hints down the per-slot expansions', async () => {
    // Three sentences × ten rows is noise, and by the per-slot block the reader
    // has already met them once in the global card.
    const slots = [
      {
        id: 1,
        urlMatch: { type: 'exact', value: 'https://example.com' },
        strategy: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
        uiMarker: {},
        titleSnapshot: '',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    installChrome((msg: { action: string }) => {
      if (msg.action === 'GET_STATE') return STATE({ slots });
      return { result: { success: true } };
    });
    await openStrategy();

    // The expansion IS rendered (Custom), and draws no hint lines.
    const detail = document.querySelector('.tbs-settings__slot-row__detail');
    expect(detail).not.toBeNull();
    expect(detail?.querySelector('.tbs-settings__knob-hint')).toBeNull();
    // The global card, meanwhile, still has all three.
    expect(document.querySelectorAll('.tbs-settings__knob-hint')).toHaveLength(3);
  });
});