/**
 * Saving to a slot must not put a value on the chain's SLOT node.
 *
 * The user's rule, stated plainly: "图标/标题用户并没有修改，只有通过图标/标题修改
 * 操作后才能在 slot 节点赋值" — saving is a PLACEMENT action, and only an explicit
 * title/icon edit is a CUSTOMIZATION.
 *
 * `saveSlot` records the live page title/favicon into `titleSnapshot` /
 * `faviconSnapshot`. Those fields are a record of what the page showed at save time;
 * treating them as the slot's value meant the slot tier silently outranked the rule
 * with a copy of the page's own title, so a rule that matched the tab could never
 * contribute and nothing in the UI explained why.
 *
 * The tier keeps its meaning — a slot the user HAS customized still outranks the
 * rule. Only the vehicle changed: `uiMarker`, not the snapshot.
 */
import { describe, it, expect } from 'vitest';
import { resolveFieldChain } from '@shared/field-chain';
import type { LocalState, PageRule, SlotDefinition, SyncState } from '@shared/types';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';

const TAB_ID = 7;
const TAB_URL = 'https://example.com/page';

function slot(overrides: Partial<SlotDefinition> & { id: number }): SlotDefinition {
  return {
    urlMatch: { type: 'exact', value: TAB_URL },
    strategy: 'inherit',
    uiMarker: {},
    titleSnapshot: '',
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rule(overrides: Partial<PageRule> & { id: string }): PageRule {
  return {
    urlMatch: { type: 'exact', value: TAB_URL },
    priority: 0,
    tagIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeState(opts: {
  slots?: SlotDefinition[];
  rules?: PageRule[];
  bound?: boolean;
}): { sync: SyncState; local: LocalState } {
  const sync: SyncState = {
    configVersion: 1,
    matchSettings: DEFAULT_MATCH_SETTINGS,
    switchDirection: 'next',
    autoBindGlobal: true,
    slots: opts.slots ?? [],
    rules: opts.rules ?? [],
    tags: [],
  };
  const local: LocalState = {
    bindings:
      opts.bound === false
        ? []
        : [{ slotId: 1, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' }],
    cycleCursors: [],
    lastSuccessSlotId: null,
    recoverySessions: [],
    recoverySnapshots: [],
    tabOverrides: [],
    iconCache: {},
    diagnostics: [],
  };
  return { sync, local };
}

const resolve = (field: 'title' | 'favicon', state: { sync: SyncState; local: LocalState }) =>
  resolveFieldChain(field, { ...state, tabId: TAB_ID, tabUrl: TAB_URL });

describe('the slot node is set only by an explicit edit', () => {
  it('a SAVE (snapshot only) leaves the slot node unset, so the rule applies', () => {
    const state = makeState({
      // Exactly what `saveSlot` writes: the page's own title, no marker.
      slots: [slot({ id: 1, titleSnapshot: 'Page Title At Save Time' })],
      rules: [rule({ id: 'r1', title: 'Rule Title' })],
    });

    const result = resolve('title', state);
    expect(result.tiers.slot?.value).toBeNull();
    expect(result.winner.value).toBe('Rule Title');
    expect(result.winner.source).toBe('rule');
  });

  it('a SAVE leaves the slot favicon node unset too', () => {
    const state = makeState({
      slots: [slot({ id: 1, faviconSnapshot: 'https://page.example/icon.png' })],
      rules: [rule({ id: 'r1', favicon: { type: 'url', value: 'https://rule.example/icon.png' } })],
    });

    const result = resolve('favicon', state);
    expect(result.tiers.slot?.value).toBeNull();
    expect(result.winner.value).toBe('https://rule.example/icon.png');
    expect(result.winner.source).toBe('rule');
  });

  it('the same holds for a regex rule, so the pattern type is not the variable', () => {
    const state = makeState({
      slots: [slot({ id: 1, titleSnapshot: 'Page Title At Save Time' })],
      rules: [rule({ id: 'r1', title: 'Regex Rule', urlMatch: { type: 'regex', value: 'https://example\\.com/.*' } })],
    });

    expect(resolve('title', state).winner.value).toBe('Regex Rule');
  });

  it('an EXPLICIT title edit DOES set the slot node and outrank the rule', () => {
    const state = makeState({
      slots: [slot({ id: 1, uiMarker: { customTitle: 'My Title' }, titleSnapshot: 'Page Title At Save Time' })],
      rules: [rule({ id: 'r1', title: 'Rule Title' })],
    });

    const result = resolve('title', state);
    expect(result.tiers.slot?.value).toBe('My Title');
    expect(result.winner.value).toBe('My Title');
    expect(result.winner.source).toBe('slot');
  });

  it('an EXPLICIT icon edit DOES set the slot node and outrank the rule', () => {
    const state = makeState({
      slots: [slot({ id: 1, uiMarker: { icon: { type: 'url', value: 'https://mine.example/i.png' } }, faviconSnapshot: 'https://page.example/icon.png' })],
      rules: [rule({ id: 'r1', favicon: { type: 'url', value: 'https://rule.example/icon.png' } })],
    });

    const result = resolve('favicon', state);
    expect(result.tiers.slot?.value).toBe('https://mine.example/i.png');
    expect(result.winner.source).toBe('slot');
  });

  it('an explicitly CLEARED marker means "unset", so the rule applies again', () => {
    const state = makeState({
      // DT11: `''` is the cleared form of a marker the user had.
      slots: [slot({ id: 1, uiMarker: { customTitle: '' }, titleSnapshot: 'Page Title At Save Time' })],
      rules: [rule({ id: 'r1', title: 'Rule Title' })],
    });

    expect(resolve('title', state).tiers.slot?.value).toBeNull();
    expect(resolve('title', state).winner.value).toBe('Rule Title');
  });

  it('an UNBOUND tab is unaffected by any of this (the control case)', () => {
    const state = makeState({
      slots: [slot({ id: 1, titleSnapshot: 'Page Title At Save Time' })],
      rules: [rule({ id: 'r1', title: 'Rule Title' })],
      bound: false,
    });

    expect(resolve('title', state).tiers.slot).toBeUndefined();
    expect(resolve('title', state).winner.value).toBe('Rule Title');
  });
});
