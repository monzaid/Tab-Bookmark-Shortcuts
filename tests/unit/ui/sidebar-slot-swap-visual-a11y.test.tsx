/**
 * T18 (visual) and T19 (a11y) for the slot swap.
 *
 * Two kinds of proof live here, for the reason the project already uses:
 *
 * - CSS is asserted as STRUCTURE, not as a rendered look. jsdom has no layout
 *   engine, so "the target row has an outline" can only mean "the stylesheet
 *   gives its class an outline" (cf. `settings-class-css.test.ts`).
 * - The a11y claims are asserted on the rendered DOM, which jsdom DOES model.
 *
 * The class names are read from the SAME two files that must agree, so the guard
 * fails if either side drifts — it is not a restatement of one side's memory.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const STYLE_DIR = resolve(process.cwd(), 'src/ui/styles');

/** The sidebar's own reachable stylesheets (base + sidebar), concatenated. */
function sidebarCss(): string {
  return ['base.css', 'sidebar.css', 'tokens.css']
    .map((f) => readFileSync(join(STYLE_DIR, f), 'utf-8'))
    .join('\n');
}

/**
 * The declaration block of the FIRST rule whose selector is EXACTLY `sel`.
 *
 * The surrounding guards are load-bearing: without them `.tbs-slot-row` would
 * also match inside `.tbs-slot-row--bound`, so the base row's rule could be
 * satisfied by a modifier's body and the assertion would pass on the wrong rule.
 * Comments are stripped first, so a selector QUOTED in prose is not a definition.
 */
function ruleBody(css: string, sel: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?<![\\w-])${escaped}\\s*\\{([^}]*)\\}`).exec(clean);
  return match?.[1] ?? '';
}

describe('T18 — swap visuals keep to their own channels (D20/D21)', () => {
  const css = sidebarCss();

  it('the pending TARGET row uses `outline`, and does not touch `background`', () => {
    // `background` is the hover channel (`.tbs-slot-row--bound:hover`). Reusing it
    // for the target would make "where is my pointer" and "where will it land"
    // indistinguishable — the exact confusion D21 forbids.
    const body = ruleBody(css, '.tbs-slot-row--swap-target');
    expect(body, 'the target rule must exist').not.toBe('');
    expect(body).toMatch(/outline\s*:/);
    expect(body).not.toMatch(/(?:^|;)\s*background/);
  });

  it('the SOURCE row is marked with `opacity`, on its own rule', () => {
    const body = ruleBody(css, '.tbs-slot-row--swap-source');
    expect(body, 'the source rule must exist').not.toBe('');
    expect(body).toMatch(/opacity\s*:/);
  });

  it('`cursor: grab` is on the NUMBER, while the bound row keeps `pointer`', () => {
    // D20: `pointer` (click = activate, the high-frequency action) must survive on
    // the row; `grab` is the low-frequency hint and belongs to the one element with
    // no other affordance to lose.
    expect(ruleBody(css, '.tbs-slot-row__number')).toMatch(/cursor\s*:\s*grab/);
    const bound = ruleBody(css, '.tbs-slot-row--bound');
    expect(bound).toMatch(/cursor\s*:\s*pointer/);
    // ...and the row's own base rule is explicitly NOT `grab`.
    expect(ruleBody(css, '.tbs-slot-row')).not.toMatch(/cursor\s*:\s*grab/);
  });

  it('the CSS reader discriminates (it is not passing by matching everything)', () => {
    // Without this, a reader that returned the whole stylesheet for any query would
    // satisfy every assertion above — a guard that cannot fail.
    expect(ruleBody(css, '.tbs-slot-row--swap-target')).not.toBe('');
    expect(ruleBody(css, '.tbs-definitely-absent-xyz')).toBe('');
    // The exact-selector guard: the BASE rule is not satisfied by a modifier's
    // body, so a `cursor: grab` that only ever lived on `--bound` would be caught.
    expect(ruleBody(css, '.tbs-slot-row')).not.toBe(ruleBody(css, '.tbs-slot-row--bound'));
  });

  it('every swap class the sidebar renders has a stylesheet definition', () => {
    // The standing rule this iteration already tripped over: a class spelled in
    // JSX and defined nowhere renders unstyled and no type check sees it.
    const source = readFileSync(resolve(process.cwd(), 'src/ui/sidebar/App.tsx'), 'utf-8');
    const allCss = readdirSync(STYLE_DIR)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(STYLE_DIR, f), 'utf-8'))
      .join('\n');
    const used = [...source.matchAll(/tbs-slot-(?:row|swap)__[a-z-]+|tbs-slot-(?:row|swap)--[a-z-]+/g)]
      .map((m) => m[0]);
    const missing = [...new Set(used)].filter((cls) => !allCss.includes(`.${cls}`));
    expect(missing).toEqual([]);
  });
});

const mockSendMessage = vi.fn();
const mockTabsQuery = vi.fn();

const ONE_SLOT = {
  result: {
    success: true,
    sync: {
      configVersion: 1,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [
        {
          id: 3,
          urlMatch: { type: 'exact', value: 'https://news.example' },
          strategy: 'inherit',
          uiMarker: { customTitle: 'News' },
          titleSnapshot: 'News',
          faviconSnapshot: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      rules: [],
    },
    local: {
      bindings: [{ slotId: 3, tabId: 43, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
      cycleCursors: [],
      lastSuccessSlotId: 3,
      recoverySessions: [],
      recoverySnapshots: [],
      tabOverrides: [],
      iconCache: {},
      diagnostics: [],
    },
  },
};

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: mockTabsQuery,
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

async function renderRows(): Promise<HTMLElement[]> {
  render(<SidebarApp />);
  await waitFor(() => {
    if (document.querySelectorAll('.tbs-slot-row').length !== 10) {
      throw new Error('ten slot rows not rendered yet');
    }
  });
  return Array.from(document.querySelectorAll<HTMLElement>('.tbs-slot-row'));
}

function makeTransfer(): {
  setData: (k: string, v: string) => void;
  getData: (k: string) => string;
  effectAllowed: string;
  dropEffect: string;
} {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => { data.set(k, v); },
    getData: (k: string) => data.get(k) ?? '',
    effectAllowed: '',
    dropEffect: '',
  };
}

describe('T19 — the slot rows carry their position, and the transient state stays silent (D26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabsQuery.mockResolvedValue([]);
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') return Promise.resolve(ONE_SLOT);
      return Promise.resolve({ result: { success: true } });
    });
  });

  it('each row reports its position with aria-posinset / aria-setsize', async () => {
    const rows = await renderRows();
    expect(rows).toHaveLength(10);
    rows.forEach((row, index) => {
      expect(row.getAttribute('aria-posinset')).toBe(String(index + 1));
      expect(row.getAttribute('aria-setsize')).toBe('10');
    });
  });

  it('the accessible name carries the number exactly ONCE', async () => {
    // The number is already in `aria-label` (`Slot 3: News (Bound)`). The `__number`
    // span stays `aria-hidden`, or a screen reader would say "3" twice — the
    // self-inflicted regression D26-3's note warns about.
    const rows = await renderRows();
    const row = rows[2];
    const label = row.getAttribute('aria-label') ?? '';
    expect(label.match(/3/g) ?? []).toHaveLength(1);
    const number = row.querySelector('.tbs-slot-row__number') as HTMLElement;
    expect(number.getAttribute('aria-hidden')).toBe('true');
  });

  it('the pending swap state is visual only — it adds no live region', async () => {
    const rows = await renderRows();
    const transfer = makeTransfer();

    fireEvent.dragStart(rows[0], { dataTransfer: transfer });
    fireEvent.dragOver(rows[6], { dataTransfer: transfer });

    // The two roles are on the DOM so a sighted user can see them...
    expect(rows[0].className).toContain('tbs-slot-row--swap-source');
    expect(rows[6].className).toContain('tbs-slot-row--swap-target');
    // ...and NOTHING announces them: the state changes on every pointer move, so a
    // live region here would interrupt the user continuously (D26-2 anti-pattern).
    expect(rows[0].closest('[aria-live]')).toBeNull();
    expect(rows[6].closest('[aria-live]')).toBeNull();
  });

  it('the result IS announced, through the bar and the error toast it already had', async () => {
    // D26-2's other half: the swap's outcome must be perceivable. It reuses the two
    // existing channels rather than inventing a third — a swap that changes the
    // list needs no success toast (D25-④), but a REJECTED swap must be announced.
    //
    // The SOURCE must be occupied for the request to leave the UI at all: since
    // T20, empty↔empty is refused locally (D17), so dragging two empty slots would
    // prove nothing about the failure channel. Slot 1 is therefore occupied here,
    // which is what makes this an occupied↔empty swap that reaches the wire. The
    // asserted wording is unchanged (`Failed to swap slots 1 and 7`).
    mockSendMessage.mockImplementation((message: { action?: string }) => {
      if (message.action === 'GET_STATE') {
        const occupied = {
          id: 1,
          urlMatch: { type: 'exact', value: 'https://example.com' },
          strategy: 'inherit',
          uiMarker: { customTitle: 'Example' },
          titleSnapshot: 'Example',
          faviconSnapshot: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        };
        return Promise.resolve({
          result: {
            ...ONE_SLOT.result,
            sync: { ...ONE_SLOT.result.sync, slots: [occupied, ...ONE_SLOT.result.sync.slots] },
            local: {
              ...ONE_SLOT.result.local,
              bindings: [
                { slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' },
                ...ONE_SLOT.result.local.bindings,
              ],
            },
          },
        });
      }
      // R2: a CONFLICT now has its own copy (see `handleSwap`), so this test uses a
      // NON-conflict failure to exercise the generic channel it actually asserts on
      // — its subject is "a rejected swap is announced at all", not the wording
      // split. A conflict rejection is covered by its own test in
      // `sidebar-slot-swap-integration.test.tsx`.
      if (message.action === 'SWAP_SLOTS') return Promise.resolve({ success: false, errorCode: 'BROWSER_API_ERROR', message: 'nope' });
      return Promise.resolve({ result: { success: true } });
    });
    const rows = await renderRows();
    const transfer = makeTransfer();
    fireEvent.dragStart(rows[0], { dataTransfer: transfer });
    fireEvent.dragOver(rows[6], { dataTransfer: transfer });
    fireEvent.drop(rows[6], { dataTransfer: transfer });

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
      expect(alerts.some((t) => t.includes('Failed to swap slots 1 and 7'))).toBe(true);
    });
  });
});
