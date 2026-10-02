/**
 * T20 / RK-1 — BEFORE/AFTER equivalence of the field chain.
 *
 * The old `RuleService.computeFieldsFrom` algorithm is inlined here VERBATIM
 * (from HEAD `a3d6ab3`) and compared against `resolveFieldChain` across a fixed
 * input matrix. Any divergence must be on the explicit, whitelisted list:
 *
 *   1. `mode === 'manual'` no longer filters a rule out (Q11);
 *   2. the `site` tier is NEW (the old algorithm had no site node);
 *   3. an unsafe favicon protocol is checked per-tier (already true before —
 *      asserted here so it cannot drift).
 */
import { describe, it, expect } from 'vitest';
import { resolveFieldChain } from '@shared/field-chain';
import { isSafeFaviconProtocol, matchesUrl } from '@shared/url-utils';
import type { LocalState, PageRule, SlotDefinition, SyncState } from '@shared/types';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';

const TAB_ID = 7;
const TAB_URL = 'https://a.com/page';

// ─── VERBATIM copy of the HEAD (a3d6ab3) `computeFieldsFrom` algorithm ───────
interface OldComputation {
  title: string | null;
  favicon: string | null;
  titleSource: 'slot' | 'override' | 'rule' | 'site';
  faviconSource: 'slot' | 'override' | 'rule' | 'site';
}

function oldResolveSlotField(
  tabId: number,
  bindings: SlotBindingLike[],
  slots: SlotDefinition[],
): { title: string | null; favicon: string | null } | null {
  const binding = bindings.find((b) => b.tabId === tabId);
  if (!binding) return null;
  const slot = slots.find((s) => s.id === binding.slotId);
  if (!slot) return null;
  const title = slot.uiMarker.customTitle?.trim() || slot.titleSnapshot.trim() || null;
  let favicon: string | null = null;
  const iconValue = slot.uiMarker.icon?.value?.trim();
  if (iconValue && isSafeFaviconProtocol(iconValue)) favicon = iconValue;
  else {
    const snapshot = slot.faviconSnapshot.trim();
    if (snapshot && isSafeFaviconProtocol(snapshot)) favicon = snapshot;
  }
  if (!title && !favicon) return null;
  return { title, favicon };
}

interface SlotBindingLike { slotId: number; tabId: number; windowId: number; boundAt: string }

function oldComputeFieldsFrom(local: LocalState, sync: SyncState, tabId: number, tabUrl: string): OldComputation {
  const slotField = oldResolveSlotField(tabId, local.bindings, sync.slots);
  const override = local.tabOverrides.find((o) => o.tabId === tabId);

  const matchingRules = sync.rules
    .filter((r) => (r as PageRule & { mode?: string }).mode === 'auto' && r.enabled !== false && matchesUrl(tabUrl, r.urlMatch))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  const winningRule = matchingRules.length > 0 ? matchingRules[0] : null;

  let title: string | null = null;
  let titleSource: OldComputation['titleSource'] = 'site';
  if (override?.title) { title = override.title; titleSource = 'override'; }
  else if (slotField?.title) { title = slotField.title; titleSource = 'slot'; }
  else if (winningRule?.title) { title = winningRule.title; titleSource = 'rule'; }

  let favicon: string | null = null;
  let faviconSource: OldComputation['faviconSource'] = 'site';
  const overrideFavicon = override?.favicon?.value;
  const ruleFavicon = winningRule?.favicon?.value;
  if (overrideFavicon && isSafeFaviconProtocol(overrideFavicon)) { favicon = overrideFavicon; faviconSource = 'override'; }
  else if (slotField?.favicon) { favicon = slotField.favicon; faviconSource = 'slot'; }
  else if (ruleFavicon && isSafeFaviconProtocol(ruleFavicon)) { favicon = ruleFavicon; faviconSource = 'rule'; }

  return { title, favicon, titleSource, faviconSource };
}

// ─── Input matrix ────────────────────────────────────────────────────────────
function rule(id: string, over: Partial<PageRule> = {}): PageRule {
  return {
    id,
    urlMatch: { type: 'exact', value: TAB_URL },
    priority: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function slot(id: number, over: Partial<SlotDefinition> = {}): SlotDefinition {
  return {
    id,
    urlMatch: { type: 'exact', value: TAB_URL },
    strategy: 'inherit',
    uiMarker: {},
    titleSnapshot: '',
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

interface MatrixCase {
  name: string;
  sync: Partial<SyncState>;
  local: Partial<LocalState>;
}

const MATRIX: MatrixCase[] = [
  { name: 'nothing set', sync: {}, local: {} },
  { name: 'rule only', sync: { rules: [rule('r1', { title: 'R', favicon: { type: 'url', value: 'https://cdn/r.png' } })] }, local: {} },
  { name: 'slot only (bound)', sync: { slots: [slot(5, { uiMarker: { customTitle: 'S' } })] }, local: { bindings: [{ slotId: 5, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }] } },
  { name: 'override only', sync: {}, local: { tabOverrides: [{ tabId: TAB_ID, title: 'O', createdAt: '2026-01-01T00:00:00Z' }] } },
  { name: 'override + slot + rule', sync: { rules: [rule('r1', { title: 'R' })], slots: [slot(5, { uiMarker: { customTitle: 'S' } })] }, local: { bindings: [{ slotId: 5, tabId: TAB_ID, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }], tabOverrides: [{ tabId: TAB_ID, title: 'O', createdAt: '2026-01-01T00:00:00Z' }] } },
  { name: 'priority tie (newer wins)', sync: { rules: [rule('r-old', { title: 'Old', priority: 5, createdAt: '2026-01-01T00:00:00Z' }), rule('r-new', { title: 'New', priority: 5, createdAt: '2026-06-01T00:00:00Z' })] }, local: {} },
  { name: 'disabled rule', sync: { rules: [rule('r1', { title: 'R', enabled: false })] }, local: {} },
  { name: 'unsafe favicon at rule tier', sync: { rules: [rule('r1', { title: 'R', favicon: { type: 'url', value: 'javascript:alert(1)' } })] }, local: {} },
  { name: 'unsafe favicon at override tier', sync: {}, local: { tabOverrides: [{ tabId: TAB_ID, title: 'O', favicon: { type: 'url', value: 'file:///etc/passwd' }, createdAt: '2026-01-01T00:00:00Z' }] } },
];

describe('T20 / RK-1: chain before/after equivalence', () => {
  for (const c of MATRIX) {
    it(`matches the old algorithm (except whitelisted changes): ${c.name}`, () => {
      const syncBase: SyncState = { ...createDefaultSyncState(), ...c.sync };
      // The OLD algorithm required `mode === 'auto'`; the new contract has no
      // `mode`, so we tag the fixtures with the legacy value that would have
      // made them participate (whitelist item 1).
      const sync: SyncState = {
        ...syncBase,
        rules: syncBase.rules.map((r) => ({ ...r, mode: 'auto' }) as PageRule),
      };
      const local: LocalState = { ...createDefaultLocalState(), ...c.local };

      const oldTitle = oldComputeFieldsFrom(local, sync, TAB_ID, TAB_URL);
      const newTitle = resolveFieldChain('title', { sync, local, tabId: TAB_ID, tabUrl: TAB_URL });
      const oldFavicon = oldComputeFieldsFrom(local, sync, TAB_ID, TAB_URL);
      const newFavicon = resolveFieldChain('favicon', { sync, local, tabId: TAB_ID, tabUrl: TAB_URL });

      // Whitelist (1): the OLD algorithm filtered on mode==='auto'. Our matrix
      // only contains rules that would have been 'auto', so titles/favicons must
      // still agree exactly.
      expect(newTitle.winner.value).toBe(oldTitle.title);
      expect(newFavicon.winner.value).toBe(oldFavicon.favicon);
    });
  }

  it('whitelist (2): the `site` tier is a NEW addition, absent from the old algorithm', () => {
    const sync = createDefaultSyncState();
    const local = { ...createDefaultLocalState(), siteSnapshot: [{ tabId: TAB_ID, title: 'Site Original', faviconHref: null, capturedAt: '2026-01-01T00:00:00Z' }] };
    const result = resolveFieldChain('title', { sync, local, tabId: TAB_ID, tabUrl: TAB_URL });
    // The old algorithm had no site node — this is the documented addition.
    expect(result.tiers.site.known).toBe(true);
    expect(result.tiers.site.value).toBe('Site Original');
  });

  it('whitelist (3): favicon protocol is checked at EVERY tier (no drift)', () => {
    const sync: SyncState = {
      ...createDefaultSyncState(),
      rules: [rule('r1', { title: 'R', favicon: { type: 'url', value: 'javascript:alert(1)' } })],
    };
    const local = createDefaultLocalState();
    const result = resolveFieldChain('favicon', { sync, local, tabId: TAB_ID, tabUrl: TAB_URL });
    // Skipped, not accepted — exactly like the old algorithm.
    expect(result.winner.value).toBeNull();
    expect(result.tiers.rule?.value).toBeNull();
  });
});