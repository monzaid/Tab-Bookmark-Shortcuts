import { describe, it, expect } from 'vitest';
import {
  ruleCheckTabMatch,
  findMatchCandidates,
  buildPositionRing,
  applyPriority,
  focusOrStep,
} from '@background/switch/primitives';
import type { TabCandidate, UrlMatchDefinition } from '@shared/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function tab(over: Partial<TabCandidate> & { tabId: number }): TabCandidate {
  return {
    tabId: over.tabId,
    windowId: over.windowId ?? 1,
    index: over.index ?? over.tabId,
    url: over.url ?? 'https://example.com/' + String(over.tabId),
    title: over.title ?? 'Tab ' + String(over.tabId),
    favIconUrl: over.favIconUrl ?? '',
    isCurrentWindow: over.isCurrentWindow ?? true,
    isIncognito: over.isIncognito ?? false,
  };
}

const exact = (value: string): UrlMatchDefinition => ({ type: 'exact', value });

// ─── applyPriority (combination 1 only) ──────────────────────────────────────

describe('primitives.applyPriority — three priority levels for combination 1', () => {
  it("priority 'tabId': live binding wins without URL validation", () => {
    const decision = applyPriority('tabId', {
      bindingAlive: true,
      bindingUrlMatches: false,
      hasCandidates: true,
    });
    expect(decision).toBe('use-binding');
  });

  it("priority 'none': binding requires URL still matching; drift is terminal (Q1-B)", () => {
    expect(
      applyPriority('none', { bindingAlive: true, bindingUrlMatches: true, hasCandidates: true }),
    ).toBe('use-binding');
    // Q1-B: the strictest tier never delegates to a URL lookup.
    expect(
      applyPriority('none', { bindingAlive: true, bindingUrlMatches: false, hasCandidates: true }),
    ).toBe('unresolved');
  });

  it("ACC#4 RED: priority 'none' with a CLOSED binding never falls back to candidates (C-A2)", () => {
    // User ruling C-A2: `none` means "the bound tab MUST exist AND its URL must
    // still match". A CLOSED/never-bound tab → recovery (Tab Not Found), even
    // when URL candidates are available.
    expect(
      applyPriority('none', { bindingAlive: false, bindingUrlMatches: false, hasCandidates: true }),
    ).toBe('unresolved');
  });

  it("priority 'none' is terminal on EITHER half failing (C-A2 closed / Q1-B drifted)", () => {
    // alive + drifted → unresolved (Q1-B: never falls back to candidates);
    expect(
      applyPriority('none', { bindingAlive: true, bindingUrlMatches: false, hasCandidates: true }),
    ).toBe('unresolved');
    // absent (never bound / closed) → unresolved regardless of candidate count.
    expect(
      applyPriority('none', { bindingAlive: false, bindingUrlMatches: true, hasCandidates: true }),
    ).toBe('unresolved');
  });

  it("priority 'rule-check': candidates first; fall back to binding when none", () => {
    expect(
      applyPriority('rule-check', { bindingAlive: true, bindingUrlMatches: true, hasCandidates: true }),
    ).toBe('use-candidates');
    expect(
      applyPriority('rule-check', { bindingAlive: true, bindingUrlMatches: true, hasCandidates: false }),
    ).toBe('use-binding');
  });

  it("priority 'rule-check' with no candidates and no live binding → unresolved", () => {
    expect(
      applyPriority('rule-check', { bindingAlive: false, bindingUrlMatches: false, hasCandidates: false }),
    ).toBe('unresolved');
  });

  it("priority 'tabId' with dead binding and no candidates → unresolved", () => {
    expect(
      applyPriority('tabId', { bindingAlive: false, bindingUrlMatches: false, hasCandidates: false }),
    ).toBe('unresolved');
  });

  it("priority 'none' with dead binding and no candidates → unresolved", () => {
    expect(
      applyPriority('none', { bindingAlive: false, bindingUrlMatches: true, hasCandidates: false }),
    ).toBe('unresolved');
  });
});

// ─── ruleCheckTabMatch ───────────────────────────────────────────────────────

describe('primitives.ruleCheckTabMatch', () => {
  it('returns true when the tab URL matches the definition', () => {
    expect(
      ruleCheckTabMatch(tab({ tabId: 1, url: 'https://a.com/x' }), exact('https://a.com/x')),
    ).toBe(true);
  });

  it('returns false when the tab URL does not match', () => {
    expect(
      ruleCheckTabMatch(tab({ tabId: 1, url: 'https://a.com/x' }), exact('https://b.com/y')),
    ).toBe(false);
  });

  it('reuses regex matching from url-utils', () => {
    expect(
      ruleCheckTabMatch(tab({ tabId: 1, url: 'https://a.com/x' }), {
        type: 'regex',
        value: '^https://a\\.com/',
      }),
    ).toBe(true);
  });
});

// ─── findMatchCandidates ─────────────────────────────────────────────────────

describe('primitives.findMatchCandidates', () => {
  it('filters by URL match and keeps sortCandidates ordering (current window first)', () => {
    const tabs = [
      tab({ tabId: 1, windowId: 2, url: 'https://a.com/x', isCurrentWindow: false, index: 5 }),
      tab({ tabId: 2, windowId: 1, url: 'https://a.com/x', isCurrentWindow: true, index: 1 }),
      tab({ tabId: 3, windowId: 1, url: 'https://other.com/', isCurrentWindow: true, index: 2 }),
    ];
    const result = findMatchCandidates(tabs, exact('https://a.com/x'), true);
    expect(result.map((c) => c.tabId)).toEqual([2, 1]);
  });

  it('excludes incognito tabs when not authorized', () => {
    const tabs = [
      tab({ tabId: 1, url: 'https://a.com/x', isIncognito: true }),
      tab({ tabId: 2, url: 'https://a.com/x', isIncognito: false }),
    ];
    expect(findMatchCandidates(tabs, exact('https://a.com/x'), false).map((c) => c.tabId)).toEqual([2]);
    expect(findMatchCandidates(tabs, exact('https://a.com/x'), true).map((c) => c.tabId)).toEqual([1, 2]);
  });

  it('returns [] when nothing matches', () => {
    expect(findMatchCandidates([tab({ tabId: 1 })], exact('https://nope.com/'), true)).toEqual([]);
  });
});

// ─── buildPositionRing ───────────────────────────────────────────────────────

describe('primitives.buildPositionRing — current window only', () => {
  it('keeps only tabs from the given window, ordered by tab index', () => {
    const tabs = [
      tab({ tabId: 11, windowId: 1, index: 1 }),
      tab({ tabId: 10, windowId: 1, index: 0 }),
      tab({ tabId: 99, windowId: 2, index: 0 }),
    ];
    expect(buildPositionRing(tabs, 1).map((c) => c.tabId)).toEqual([10, 11]);
  });

  it('returns a single-element ring for a one-tab window', () => {
    expect(buildPositionRing([tab({ tabId: 7, windowId: 3, index: 0 })], 3).map((c) => c.tabId)).toEqual([7]);
  });
});

// ─── focusOrStep (combination 4) ─────────────────────────────────────────────

describe('primitives.focusOrStep — combination 4 semantics', () => {
  const ring = [
    tab({ tabId: 10, index: 0 }),
    tab({ tabId: 11, index: 1 }),
    tab({ tabId: 12, index: 2 }),
  ];

  it('cursor == active → step in the given direction', () => {
    expect(focusOrStep(ring, 11, 11, 'next')).toEqual({ kind: 'step', targetTabId: 12 });
    expect(focusOrStep(ring, 11, 11, 'previous')).toEqual({ kind: 'step', targetTabId: 10 });
  });

  it('cursor != active → focus the cursor', () => {
    expect(focusOrStep(ring, 10, 12, 'next')).toEqual({ kind: 'focus', targetTabId: 10 });
  });

  it('cursor missing from the ring → needs recovery', () => {
    expect(focusOrStep(ring, 99, 10, 'next')).toEqual({ kind: 'missing' });
  });

  it('single-element ring → no-op (never steps to itself)', () => {
    const one = [tab({ tabId: 5, index: 0 })];
    expect(focusOrStep(one, 5, 5, 'next')).toEqual({ kind: 'noop' });
  });

  it('no active tab → focus the cursor', () => {
    expect(focusOrStep(ring, 11, null, 'next')).toEqual({ kind: 'focus', targetTabId: 11 });
  });

  it('steps wrap around the ring', () => {
    expect(focusOrStep(ring, 12, 12, 'next')).toEqual({ kind: 'step', targetTabId: 10 });
    expect(focusOrStep(ring, 10, 10, 'previous')).toEqual({ kind: 'step', targetTabId: 12 });
  });
});