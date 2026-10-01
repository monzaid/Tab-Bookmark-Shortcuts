import { describe, it, expect } from 'vitest';
import { resolveSwitch } from '@background/switch/resolve-switch';
import type {
  MatchRuleSettings,
  TabCandidate,
  UrlMatchDefinition,
} from '@shared/types';

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

const settings = (
  tabIdMode: MatchRuleSettings['tabIdMode'],
  ruleCheckMode: MatchRuleSettings['ruleCheckMode'],
  priority: MatchRuleSettings['priority'],
): MatchRuleSettings => ({ tabIdMode, ruleCheckMode, priority });

// ─── Combination 1: exists + match ───────────────────────────────────────────

describe('resolver — combination 1 (exists + match)', () => {
  const base = {
    settings: settings('exists', 'match', 'tabId'),
    urlMatch: exact('https://example.com/1'),
    activeTabId: 11,
    direction: 'next' as const,
  };

  it("priority 'tabId': switches to the live binding without URL validation", () => {
    const r = resolveSwitch({
      ...base,
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://changed.com/' }),
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(r).toEqual({ kind: 'switch', targetTabId: 10 });
  });

  it("priority 'tabId': falls back to candidates when the binding is dead", () => {
    const r = resolveSwitch({
      ...base,
      bindingTabId: 10,
      bindingTab: null,
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(r).toEqual({ kind: 'switch', targetTabId: 11 });
  });

  it("priority 'none': binding used only when it exists AND its URL still matches", () => {
    const ok = resolveSwitch({
      ...base,
      settings: settings('exists', 'match', 'none'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://example.com/1' }),
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(ok).toEqual({ kind: 'switch', targetTabId: 10 });

    // Q1-B: alive but URL-drifted is terminal for the strictest tier — the
    // bound tab is the ONLY acceptable target, so this never uses candidates.
    const drift = resolveSwitch({
      ...base,
      settings: settings('exists', 'match', 'none'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://changed.com/' }),
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(drift).toEqual({ kind: 'recovery' });
  });

  it("priority 'rule-check': candidates first, binding only as fallback", () => {
    const withCandidates = resolveSwitch({
      ...base,
      settings: settings('exists', 'match', 'rule-check'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://example.com/1' }),
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(withCandidates).toEqual({ kind: 'switch', targetTabId: 11 });

    const noCandidates = resolveSwitch({
      ...base,
      settings: settings('exists', 'match', 'rule-check'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://example.com/1' }),
      candidates: [],
    });
    expect(noCandidates).toEqual({ kind: 'switch', targetTabId: 10 });
  });

  it('both unavailable → needs_recovery', () => {
    const r = resolveSwitch({
      ...base,
      bindingTabId: 10,
      bindingTab: null,
      candidates: [],
    });
    expect(r).toEqual({ kind: 'recovery' });
  });

  it("ACC#4 RED: priority 'none' + CLOSED binding → recovery even with candidates (C-A2)", () => {
    const r = resolveSwitch({
      ...base,
      settings: settings('exists', 'match', 'none'),
      bindingTabId: 10,
      bindingTab: null,
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(r).toEqual({ kind: 'recovery' });
  });

  it("ACC#4 RED: priority 'none' + never bound → recovery, never a candidate lookup", () => {
    const r = resolveSwitch({
      ...base,
      settings: settings('exists', 'match', 'none'),
      bindingTabId: null,
      bindingTab: null,
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(r).toEqual({ kind: 'recovery' });
  });

  it("ACC#6: priority 'none' + alive but URL drifted → recovery (Q1-B strict tier)", () => {
    const r = resolveSwitch({
      ...base,
      settings: settings('exists', 'match', 'none'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://changed.com/' }),
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(r).toEqual({ kind: 'recovery' });
  });

  // `tabId` / `rule-check` keep the documented "no binding → candidates" fallback.
  it("priority 'tabId': no binding at all → falls back to candidates", () => {
    const r = resolveSwitch({
      ...base,
      bindingTabId: null,
      bindingTab: null,
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
    });
    expect(r).toEqual({ kind: 'switch', targetTabId: 11 });
  });
});

// ─── Combination 2: exists + no-match ────────────────────────────────────────

describe('resolver — combination 2 (exists + no-match) never falls back to URL', () => {
  const settings2 = settings('exists', 'no-match', 'tabId');

  it('live binding → switch to it, ignoring the match URL', () => {
    const r = resolveSwitch({
      settings: settings2,
      urlMatch: exact('https://example.com/1'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://totally-different.com/' }),
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
      activeTabId: 11,
      direction: 'next',
    });
    expect(r).toEqual({ kind: 'switch', targetTabId: 10 });
  });

  it('dead binding → needs_recovery even when URL candidates exist (NO URL fallback)', () => {
    const r = resolveSwitch({
      settings: settings2,
      urlMatch: exact('https://example.com/1'),
      bindingTabId: 10,
      bindingTab: null,
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
      activeTabId: 11,
      direction: 'next',
    });
    expect(r).toEqual({ kind: 'recovery' });
  });

  it('no binding → needs_recovery (no URL lookup)', () => {
    const r = resolveSwitch({
      settings: settings2,
      urlMatch: exact('https://example.com/1'),
      bindingTabId: null,
      bindingTab: null,
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' })],
      activeTabId: 11,
      direction: 'next',
    });
    expect(r).toEqual({ kind: 'recovery' });
  });
});

// ─── Combination 3: no-exists + match ────────────────────────────────────────

describe('resolver — combination 3 (no-exists + match)', () => {
  const settings3 = settings('no-exists', 'match', 'tabId');

  it('switches to the first URL/regex candidate, ignoring any binding', () => {
    const r = resolveSwitch({
      settings: settings3,
      urlMatch: exact('https://example.com/1'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://example.com/1' }),
      candidates: [tab({ tabId: 11, url: 'https://example.com/1' }), tab({ tabId: 12, url: 'https://example.com/1' })],
      activeTabId: 11,
      direction: 'next',
    });
    expect(r).toEqual({ kind: 'switch', targetTabId: 11 });
  });

  it('no candidates → needs_recovery', () => {
    const r = resolveSwitch({
      settings: settings3,
      urlMatch: exact('https://example.com/1'),
      bindingTabId: 10,
      bindingTab: tab({ tabId: 10, url: 'https://example.com/1' }),
      candidates: [],
      activeTabId: 11,
      direction: 'next',
    });
    expect(r).toEqual({ kind: 'recovery' });
  });
});

// ─── Combination 4: no-exists + no-match (Position) ─────────────────────────

describe('resolver — combination 4 (no-exists + no-match) position ring', () => {
  const settings4 = settings('no-exists', 'no-match', 'tabId');
  const ring = [tab({ tabId: 10, index: 0 }), tab({ tabId: 11, index: 1 }), tab({ tabId: 12, index: 2 })];

  const run = (over: Partial<Parameters<typeof resolveSwitch>[0]>) =>
    resolveSwitch({
      settings: settings4,
      urlMatch: exact('https://example.com/1'),
      bindingTabId: 10,
      bindingTab: null,
      candidates: [],
      activeTabId: 10,
      direction: 'next',
      positionalRing: ring,
      ...over,
    });

  it('cursor == active → step by direction (commits)', () => {
    expect(run({ bindingTabId: 11, activeTabId: 11, direction: 'next' })).toEqual({
      kind: 'switch',
      targetTabId: 12,
    });
    expect(run({ bindingTabId: 11, activeTabId: 11, direction: 'previous' })).toEqual({
      kind: 'switch',
      targetTabId: 10,
    });
  });

  it('cursor != active → focus the cursor', () => {
    expect(run({ bindingTabId: 10, activeTabId: 12 })).toEqual({ kind: 'switch', targetTabId: 10 });
  });

  it('cursor missing from the ring → needs_recovery', () => {
    expect(run({ bindingTabId: 99, activeTabId: 10 })).toEqual({ kind: 'recovery' });
  });

  it('single-tab ring → no-op', () => {
    expect(run({ bindingTabId: 10, activeTabId: 10, positionalRing: [tab({ tabId: 10, index: 0 })] })).toEqual({
      kind: 'noop',
    });
  });
});