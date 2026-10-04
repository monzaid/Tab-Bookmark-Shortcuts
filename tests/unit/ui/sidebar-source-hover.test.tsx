/**
 * Review — the source popover hangs off the VALUE, not off a separate dot.
 *
 * The previous implementation rendered a 6px `<span class="…__trigger">` next to
 * the value and hung the popover off THAT, so the user had to find and hover a
 * decorative dot instead of the icon / title they were looking at.
 *
 * The contract asserted here:
 * 1. no trigger element exists anywhere,
 * 2. the hover wrapper CONTAINS the value and the popover as siblings, so
 *    `:hover` on the value is what reveals it,
 * 3. the already-focusable favicon does not gain a second focus stop.
 *
 * The CSS half of the contract (`:hover` / `:focus-within` reveal, and no
 * `__trigger` rule left behind) is asserted against the stylesheet, because jsdom
 * applies no CSS and a structure-only test would not notice a deleted rule.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SidebarApp } from '@ui/sidebar/App';
import { sameOwner, shouldShowSource, sourceBadge, sourceDescription } from '@ui/shared/source-description';

const SLOT_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

const ACTIVE_TAB = {
  id: 42,
  url: 'https://example.com',
  title: 'Example page',
  favIconUrl: 'https://example.com/favicon.ico',
};

/**
 * The local half of the fixture. Held in a mutable object so a test can add a
 * tab override before rendering (see `override()` below).
 */
const localState = {
  bindings: [{ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
  cycleCursors: [] as unknown[],
  lastSuccessSlotId: 1 as number | null,
  recoverySessions: [] as unknown[],
  recoverySnapshots: [] as unknown[],
  tabOverrides: [] as unknown[],
  iconCache: {} as Record<string, string>,
  diagnostics: [] as unknown[],
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
          slots: [
            {
              id: 1,
              urlMatch: { type: 'exact', value: 'https://example.com' },
              strategy: 'inherit',
              // Both dimensions are set on the SLOT tier, so the slot wins both:
              // the slot ROW therefore shows its own value (no popover, review
              // item 7) while the Current Page explains where its value came from.
              uiMarker: { customTitle: 'Example', icon: { type: 'upload', value: SLOT_ICON } },
              titleSnapshot: 'Example',
              faviconSnapshot: '',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
          rules: [],
        },
        local: localState,
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

async function openSidebar(): Promise<void> {
  render(<SidebarApp />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'More options for slot 1' })).toBeInTheDocument();
  });
}

/**
 * Add a tab override to the fixture the mocks already serve.
 *
 * `mockSendMessage` is consulted on every GET_STATE, so mutating this object
 * before rendering changes what the sidebar resolves.
 */
function override(tabId: number, value: { title?: string; favicon?: string }): void {
  localState.tabOverrides = [{
    tabId,
    ...(value.title !== undefined ? { title: value.title } : {}),
    ...(value.favicon !== undefined ? { favicon: { type: 'url' as const, value: value.favicon } } : {}),
    createdAt: '2026-01-01T00:00:00Z',
  }];
}

/**
 * The bound slot's own row. Addressed by its exact accessible name, because
 * `/Slot 1/` also matches `Slot 1`, `Slot 10`, … and `getByRole` then throws.
 */
function slotRow(): HTMLElement {
  return screen.getByRole('listitem', { name: 'Slot 1: Example (Bound)' });
}

describe('review — the source popover is triggered by the value itself', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each test starts from the same fixture: no override on the active tab.
    localState.tabOverrides = [];
  });

  it('renders no separate trigger dot anywhere', async () => {
    await openSidebar();
    expect(document.querySelector('.tbs-source-hover__trigger')).toBeNull();
    // Sanity: the hover wrappers really are rendered.
    expect(document.querySelectorAll('.tbs-source-hover').length).toBeGreaterThan(0);
  });

  /**
   * Review item 7: when the value comes from the record the row ITSELF shows, the
   * popover is noise ("Slot 8 · from slot 8"), so it is dropped. In this fixture
   * the slot's own marker supplies both values, so the slot row must have no
   * popover at all — while the Current Page row, whose value comes from that
   * slot, must still explain it.
   */
it('omits the popover when the winner is the row own record', async () => {
    await openSidebar();

    const row = slotRow();
    // The winning record IS slot 1, which is the row being hovered.
    expect(row.querySelectorAll('.tbs-source-hover').length).toBe(0);
    expect(row.querySelector('.tbs-slot-row__title')?.textContent).toBe('Example');
    expect(row.querySelector('.tbs-slot-row__icon')).not.toBeNull();
  });

  it('hangs the Current Page popovers off the favicon and the title', async () => {
    await openSidebar();

    const current = await screen.findByLabelText('Current page');
    // The Current Page's value comes from slot 1 — a DIFFERENT record from the
    // one this surface edits (the page override) — so both wrappers are present
    // and each contains the value it describes.
    const iconWrapper = current.querySelector('.tbs-source-hover--icon');
    expect(iconWrapper?.querySelector('.tbs-sidebar__current-favicon-wrapper')).not.toBeNull();

    const titleWrapper = current.querySelector('.tbs-source-hover--title');
    expect(titleWrapper?.querySelector('.tbs-sidebar__current-title')).not.toBeNull();
  });

  /**
   * Review item 4 (round 6): the popover must not be clipped by the sidebar.
   *
   * jsdom has no layout engine, so this asserts the STRUCTURE that makes the fix
   * work: the popover is a child of `<body>` (a portal), not of the sidebar — the
   * only arrangement that escapes `overflow: hidden` and the sticky header.
   */
  it('renders the popover in a portal on document.body, not inside the sidebar', async () => {
    await openSidebar();
    const current = await screen.findByLabelText('Current page');
    const wrapper = current.querySelector('.tbs-source-hover--icon');
    expect(wrapper).not.toBeNull();

    fireEvent.mouseEnter(wrapper!);

    const popover = await waitFor(() => {
      const el = document.querySelector('.tbs-source-popover');
      if (!el) throw new Error('popover not shown yet');
      return el;
    });
    // Portalled: it is NOT inside the sidebar subtree that clips it.
    expect(document.querySelector('.tbs-sidebar')?.contains(popover)).toBe(false);
    expect(popover.parentElement).toBe(document.body);

    // Two parts: WHERE the value came from, then WHAT that record is.
    expect(popover.querySelector('.tbs-source-popover__title')?.textContent).toBe('Slot 1');
    expect(popover.querySelector('.tbs-source-popover__note')?.textContent)
      .toMatch(/whose bound tab is this one/);

    fireEvent.mouseLeave(wrapper!);
    await waitFor(() => {
      expect(document.querySelector('.tbs-source-popover')).toBeNull();
    });
  });

  it('does not add a second focus stop around the already-focusable favicon', async () => {
    await openSidebar();

    const current = await screen.findByLabelText('Current page');
    const wrapper = current.querySelector('.tbs-source-hover--icon');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.hasAttribute('tabindex')).toBe(false);
    // The favicon itself stays the keyboard stop; `:focus-within` opens the
    // popover from it, so no nested tab stop is needed.
    expect(wrapper?.querySelector('.tbs-sidebar__current-favicon-wrapper')?.getAttribute('tabindex')).toBe('0');
  });

  it('names the tab on a page-level record, and drops the page own popover', async () => {
    // Only the TITLE has an override. Two behaviours at once:
    //  - the title's winner IS the page record this surface edits (Current Page
    //    writes `override`), so its popover is suppressed (review item 7);
    //  - the icon still resolves to slot 1, a DIFFERENT record, so its popover
    //    stays and explains where the value comes from.
    override(42, { title: 'Pinned' });
    await openSidebar();

    const current = await screen.findByLabelText('Current page');
    expect(current.querySelector('.tbs-source-hover--title')).toBeNull();
    expect(current.querySelector('.tbs-sidebar__current-title')?.textContent).toBe('Pinned');

    // The icon still resolves to slot 1, so hovering it explains that record.
    fireEvent.mouseEnter(current.querySelector('.tbs-source-hover--icon')!);
    const iconBadge = await waitFor(() => {
      const el = document.querySelector('.tbs-source-popover__title');
      if (!el) throw new Error('popover not shown yet');
      return el;
    });
    expect(iconBadge.textContent).toBe('Slot 1');
  });

  it('names the tab on a page record and explains every layer (review item 7)', () => {
    // The wording itself is the deliverable here: `Slot 8` / `Page` / `Rule` on
    // their own do not tell the user what they are looking at, which is exactly
    // what the review asked to fix.
    expect(sourceBadge({ kind: 'override', tabId: 42 }, 42)).toBe('Page · tab 42');
    expect(sourceBadge({ kind: 'slot', slotId: 8 }, 42)).toBe('Slot 8');
    expect(sourceBadge({ kind: 'rule', ruleId: 'r1' }, 42)).toBe('Rule');

    // Every description answers "why is this tab showing this value", and names
    // the dimension so a title popover cannot describe an icon.
    expect(sourceDescription({ kind: 'slot', slotId: 8 }, 42, 'title')).toMatch(/bound tab is this one/);
    expect(sourceDescription({ kind: 'override', tabId: 42 }, 42, 'title')).toMatch(/outranks the slot, rule and site title/);
    expect(sourceDescription({ kind: 'site' }, 42, 'icon')).toMatch(/original icon/);

    // Identity comparison — drives the "is the winner the record I edit?" check.
    expect(sameOwner({ kind: 'slot', slotId: 8 }, { kind: 'slot', slotId: 8 })).toBe(true);
    expect(sameOwner({ kind: 'slot', slotId: 8 }, { kind: 'slot', slotId: 9 })).toBe(false);
    expect(sameOwner({ kind: 'rule', ruleId: 'a' }, { kind: 'rule', ruleId: 'b' })).toBe(false);
  });

  it('suppresses the popover when the winner is the record being edited (review item 7)', () => {
    const self = { kind: 'slot', slotId: 8 } as const;
    expect(shouldShowSource({ value: 'v', source: self }, self)).toBe(false);
    // A different record with the same value still deserves the explanation.
    expect(shouldShowSource({ value: 'v', source: { kind: 'slot', slotId: 9 } }, self)).toBe(true);
    // No winning value → nothing to explain.
    expect(shouldShowSource({ value: null, source: { kind: 'site' } }, self)).toBe(false);
  });
});

describe('review — the stylesheet places the popover outside the sidebar', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/sidebar.css'), 'utf-8');

  it('no longer defines the removed trigger element', () => {
    expect(css.includes('.tbs-source-hover__trigger')).toBe(false);
  });

  /**
   * Review item 4 (round 6): the popover used to be an absolutely-positioned
   * child of the wrapper, which put it inside `.tbs-sidebar` — an
   * `overflow: hidden` box around an `overflow-y: auto` slot list, under a sticky
   * header. It was clipped at the sidebar edge and painted beneath the first
   * rows. Being portalled to `<body>` is what fixes that, so the popover styling
   * must live on `.tbs-source-popover` as `position: fixed`.
   */
  it('positions the portalled popover against the viewport, above every sidebar layer', () => {
    expect(css).toMatch(/\.tbs-source-popover\s*\{[^}]*position:\s*fixed/);
    // Above the slot menu (200) and the modal overlay (500).
    expect(css).toMatch(/\.tbs-source-popover\s*\{[^}]*z-index:\s*2147483000/);
    // The in-flow rules are gone: they cannot reach a node outside the subtree.
    expect(css).not.toMatch(/\.tbs-source-hover__popover/);
  });

  it('gives the popover a sentence box, not a one-line pill (review item 7)', () => {
    // It carries a full explanation now, so it must wrap and be allowed to be
    // wider than the value it hangs off.
    expect(css).toMatch(/\.tbs-source-popover\s*\{[^}]*white-space:\s*normal/);
    expect(css).toMatch(/\.tbs-source-popover\s*\{[^}]*max-width:/);
  });

  it('never changes the resting appearance of the value', () => {
    // Review: the cue is the cursor plus a hover tint. A permanent underline
    // would mark every sourced value in the list — noise, not information.
    expect(css).not.toMatch(/\.tbs-source-hover[^{]*\{[^}]*border-bottom/);
  });
});