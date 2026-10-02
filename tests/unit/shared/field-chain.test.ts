/**
 * T1 — `field-chain` exhaustive matrix (RK-1 mitigation).
 *
 * The chain is the single read-side source of truth, so this file enumerates:
 * - title and favicon as TWO independent chains
 * - all four tiers (override / slot / rule / site) in set / unset states
 * - priority ties (createdAt breaks the tie)
 * - `masked` owners
 * - `known:false` (site snapshot not captured)
 * - `clearChain` ordered tier lists
 */
import { describe, it, expect } from 'vitest';
import { resolveFieldChain, clearChain } from '@shared/field-chain';
import type { ChainResult } from '@shared/field-chain';
import type { LocalState, PageRule, SlotDefinition, SyncState } from '@shared/types';
import { createDefaultSyncState, createDefaultLocalState } from '@background/storage-repository';

const TAB_ID = 1;
const TAB_URL = 'https://a.com/';

function rule(overrides: Partial<PageRule> & { id: string }): PageRule {
  return {
    urlMatch: { type: 'exact', value: TAB_URL },
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

function makeState(opts: {
  rules?: PageRule[];
  slots?: SlotDefinition[];
  bindings?: LocalState['bindings'];
  overrides?: LocalState['tabOverrides'];
  siteSnapshot?: LocalState['siteSnapshot'];
}): { sync: SyncState; local: LocalState } {
  const sync: SyncState = {
    ...createDefaultSyncState(),
    rules: opts.rules ?? [],
    slots: opts.slots ?? [],
  };
  const local: LocalState = {
    ...createDefaultLocalState(),
    bindings: opts.bindings ?? [],
    tabOverrides: opts.overrides ?? [],
    siteSnapshot: opts.siteSnapshot ?? [],
  };
  return { sync, local };
}

function resolve(field: 'title' | 'favicon', state: { sync: SyncState; local: LocalState }): ChainResult {
  return resolveFieldChain(field, { ...state, tabId: TAB_ID, tabUrl: TAB_URL });
}

describe('field-chain — title chain', () => {
  it('override wins over slot and rule', () => {
    const state = makeState({
      rules: [rule({ id: 'r1', title: 'R' })],
      slots: [
        slot({
          id: 5,
          uiMarker: { customTitle: 'S' },
        }),
      ],
      bindings: [{ slotId: 5, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' }],
      overrides: [{ tabId: TAB_ID, title: 'O', createdAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = resolve('title', state);
    expect(result.winner.value).toBe('O');
    expect(result.winner.source).toBe('override');
    expect(result.masked).toEqual(
      expect.arrayContaining([
        { kind: 'slot', slotId: 5 },
        { kind: 'rule', ruleId: 'r1' },
      ]),
    );
  });

  it('slot wins over rule when no override', () => {
    const state = makeState({
      rules: [rule({ id: 'r1', title: 'R' })],
      slots: [slot({ id: 5, uiMarker: { customTitle: 'S' } })],
      bindings: [{ slotId: 5, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = resolve('title', state);
    expect(result.winner.value).toBe('S');
    expect(result.winner.source).toBe('slot');
    expect(result.masked).toEqual([{ kind: 'rule', ruleId: 'r1' }]);
  });

  it('rule wins when no override/slot', () => {
    const state = makeState({ rules: [rule({ id: 'r1', title: 'R' })] });

    const result = resolve('title', state);
    expect(result.winner.value).toBe('R');
    expect(result.winner.source).toBe('rule');
    expect(result.masked).toEqual([]);
  });

  it('falls through to site when no tier is set', () => {
    const state = makeState({});

    const result = resolve('title', state);
    expect(result.winner.value).toBeNull();
    expect(result.winner.source).toBe('site');
    expect(result.tiers.site.known).toBe(false);
  });

  it('site tier is known when a snapshot exists', () => {
    const state = makeState({
      siteSnapshot: [
        { tabId: TAB_ID, title: 'Site Title', faviconHref: null, capturedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });

    const result = resolve('title', state);
    expect(result.tiers.site.known).toBe(true);
    expect(result.tiers.site.value).toBe('Site Title');
    expect(result.winner.value).toBe('Site Title');
    expect(result.winner.source).toBe('site');
  });

  it('slot tier is strictly tabId-scoped (no binding → no slot value)', () => {
    const state = makeState({
      slots: [slot({ id: 5, uiMarker: { customTitle: 'S' } })],
      bindings: [{ slotId: 5, tabId: 99, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = resolve('title', state);
    expect(result.tiers.slot).toBeUndefined();
    expect(result.winner.value).toBeNull();
  });

  it('disabled rules do not participate', () => {
    const state = makeState({ rules: [rule({ id: 'r1', title: 'R', enabled: false })] });

    const result = resolve('title', state);
    expect(result.winner.value).toBeNull();
  });

  it('non-matching rules do not participate', () => {
    const state = makeState({
      rules: [rule({ id: 'r1', title: 'R', urlMatch: { type: 'exact', value: 'https://other.com/' } })],
    });

    const result = resolve('title', state);
    expect(result.winner.value).toBeNull();
  });
});

describe('field-chain — priority ties (rule tier is a SINGLE winner)', () => {
  // The rule tier exposes exactly one value: the winner of
  // `sortRulesByPriority` / `selectWinningRule`. Losing rules are therefore not
  // addressable tiers and never appear in `masked` — this mirrors the
  // authoritative `computeFieldsFrom` behaviour that T20 pins by construction.

  it('higher priority rule wins', () => {
    const state = makeState({
      rules: [
        rule({ id: 'r-low', title: 'Low', priority: 0 }),
        rule({ id: 'r-high', title: 'High', priority: 10 }),
      ],
    });

    const result = resolve('title', state);
    expect(result.winner.value).toBe('High');
    expect(result.winner.source).toBe('rule');
    expect(result.tiers.rule?.owner).toEqual({ kind: 'rule', ruleId: 'r-high' });
    expect(result.masked).toEqual([]);
  });

  it('on equal priority the newer rule wins', () => {
    const state = makeState({
      rules: [
        rule({ id: 'r-old', title: 'Old', priority: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
        rule({ id: 'r-new', title: 'New', priority: 5, createdAt: '2026-06-01T00:00:00.000Z' }),
      ],
    });

    const result = resolve('title', state);
    expect(result.winner.value).toBe('New');
    expect(result.tiers.rule?.owner).toEqual({ kind: 'rule', ruleId: 'r-new' });
  });

  it('the winning rule is chosen per-rule, not per-field (higher priority without a title yields no title)', () => {
    const state = makeState({
      rules: [
        rule({ id: 'r-high', priority: 10 }), // no title
        rule({ id: 'r-low', title: 'Low', priority: 0 }),
      ],
    });

    const result = resolve('title', state);
    // The higher-priority rule wins the tier; it carries no title, so the chain
    // falls THROUGH to site rather than consulting the losing rule.
    expect(result.winner.value).toBeNull();
    expect(result.winner.source).toBe('site');
    expect(result.tiers.rule?.owner).toEqual({ kind: 'rule', ruleId: 'r-high' });
    expect(result.tiers.rule?.value).toBeNull();
  });
});

describe('field-chain — unset value tolerance (A1-bis)', () => {
  it('treats an empty-string override title as unset', () => {
    const state = makeState({
      overrides: [{ tabId: TAB_ID, title: '', createdAt: '2026-01-01T00:00:00.000Z' }],
      rules: [rule({ id: 'r1', title: 'R' })],
    });

    const result = resolve('title', state);
    expect(result.winner.value).toBe('R');
    expect(result.winner.source).toBe('rule');
  });

  it('treats a whitespace-only override title as unset', () => {
    const state = makeState({
      overrides: [{ tabId: TAB_ID, title: '   ', createdAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = resolve('title', state);
    expect(result.tiers.override?.value).toBeNull();
    expect(result.winner.value).toBeNull();
  });

  it('treats a legacy empty-string slot title marker as unset', () => {
    const state = makeState({
      slots: [slot({ id: 5, uiMarker: { customTitle: '' }, titleSnapshot: '' })],
      bindings: [{ slotId: 5, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' }],
      rules: [rule({ id: 'r1', title: 'R' })],
    });

    const result = resolve('title', state);
    expect(result.tiers.slot?.value).toBeNull();
    expect(result.winner.value).toBe('R');
  });
});

describe('field-chain — favicon chain (independent from title)', () => {
  it('favicon override wins', () => {
    const state = makeState({
      overrides: [
        {
          tabId: TAB_ID,
          title: 'O-title',
          favicon: { type: 'url', value: 'https://cdn/o.png' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = resolve('favicon', state);
    expect(result.winner.value).toBe('https://cdn/o.png');
    expect(result.winner.source).toBe('override');
  });

  it('unsafe favicon protocol falls through to the next tier', () => {
    const state = makeState({
      overrides: [
        {
          tabId: TAB_ID,
          favicon: { type: 'url', value: 'javascript:alert(1)' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      rules: [rule({ id: 'r1', favicon: { type: 'url', value: 'https://cdn/x.png' } })],
    });

    const result = resolve('favicon', state);
    expect(result.winner.value).toBe('https://cdn/x.png');
    expect(result.winner.source).toBe('rule');
  });

  it('unsafe favicon in the winning rule falls through to site', () => {
    const state = makeState({
      rules: [rule({ id: 'r1', favicon: { type: 'url', value: 'file:///etc/passwd' } })],
    });

    const result = resolve('favicon', state);
    expect(result.winner.value).toBeNull();
    expect(result.winner.source).toBe('site');
  });

  it('slot favicon prefers the icon marker over the snapshot', () => {
    const state = makeState({
      slots: [
        slot({
          id: 5,
          uiMarker: { icon: { type: 'url', value: 'https://cdn/marker.png' } },
          faviconSnapshot: 'https://cdn/snapshot.png',
        }),
      ],
      bindings: [{ slotId: 5, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = resolve('favicon', state);
    expect(result.winner.value).toBe('https://cdn/marker.png');
  });

  it('slot favicon falls back to the snapshot when the marker is unsafe', () => {
    const state = makeState({
      slots: [
        slot({
          id: 5,
          uiMarker: { icon: { type: 'url', value: 'javascript:alert(1)' } },
          faviconSnapshot: 'https://cdn/snapshot.png',
        }),
      ],
      bindings: [{ slotId: 5, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = resolve('favicon', state);
    expect(result.winner.value).toBe('https://cdn/snapshot.png');
  });

  it('title and favicon chains do not interfere', () => {
    const state = makeState({
      overrides: [
        {
          tabId: TAB_ID,
          title: 'O-title',
          favicon: { type: 'url', value: 'https://cdn/o.png' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      rules: [rule({ id: 'r1', title: 'R-title' })],
    });

    const titleResult = resolve('title', state);
    const faviconResult = resolve('favicon', state);

    // The rule has no favicon, so the favicon chain sees nothing beyond the override.
    expect(titleResult.winner.source).toBe('override');
    expect(titleResult.masked).toEqual([{ kind: 'rule', ruleId: 'r1' }]);
    expect(faviconResult.winner.source).toBe('override');
    expect(faviconResult.masked).toEqual([]);
  });
});

describe('field-chain — clearChain scope', () => {
  it('an override (Dashboard) entry clears override + slot + rule in order', () => {
    expect(clearChain('title', { kind: 'override', tabId: 1, slotId: 5, ruleId: 'r1' })).toEqual([
      { kind: 'override', tabId: 1 },
      { kind: 'slot', slotId: 5 },
      { kind: 'rule', ruleId: 'r1' },
    ]);
  });

  it('a position-slot entry clears slot + rule, never the override', () => {
    expect(clearChain('favicon', { kind: 'slot', slotId: 5, ruleId: 'r1' })).toEqual([
      { kind: 'slot', slotId: 5 },
      { kind: 'rule', ruleId: 'r1' },
    ]);
  });

  it('a rule entry clears only the rule', () => {
    expect(clearChain('title', { kind: 'rule', ruleId: 'r9' })).toEqual([
      { kind: 'rule', ruleId: 'r9' },
    ]);
  });

  it('the site tier is never written', () => {
    expect(clearChain('title', { kind: 'site' })).toEqual([]);
  });
});