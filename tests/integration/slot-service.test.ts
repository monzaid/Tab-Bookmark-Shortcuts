import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { SlotService } from '@background/slot-service';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { MatchRuleSettings, SlotDefinition, SlotBinding } from '@shared/types';

/** Combination 3 = no-exists + match (semantic successor of the old "C"). */
const COMBO3: MatchRuleSettings = { tabIdMode: 'no-exists', ruleCheckMode: 'match', priority: 'tabId' };
/** Combination 1 with priority 'none' — binding must still match its URL. */
const COMBO1_NONE: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'none' };

describe('T8: Slot commands, cross-window matching, activation, cycle', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: SlotService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const otherWindow: NormalizedWindow = { id: 2, focused: false, incognito: false, type: 'normal' };

  const tabCurrentA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example A', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabCurrentB: NormalizedTab = { id: 11, windowId: 1, index: 2, url: 'https://example.com/page', title: 'Example B', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabOther: NormalizedTab = { id: 20, windowId: 2, index: 0, url: 'https://example.com/page', title: 'Example Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };
  const tabIncognito: NormalizedTab = { id: 30, windowId: 3, index: 0, url: 'https://example.com/page', title: 'Incognito', favIconUrl: '', active: false, incognito: true, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow, otherWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new SlotService(adapter, repo);
  });

  describe('Happy path — switch and next-match', () => {
    it('should save current tab to slot and bind tabId', async () => {
      adapter.setTabs([tabCurrentA]);
      const result = await service.saveSlot(1, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.slot.id).toBe(1);
        expect(result.slot.urlMatch.value).toBe('https://example.com/page');
      }

      const local = await repo.getLocalState();
      expect(local.bindings).toHaveLength(1);
      expect(local.bindings[0].tabId).toBe(10);
    });

    it('should switch to current window tab first (left-to-right priority)', async () => {
      adapter.setTabs([tabCurrentA, tabCurrentB, tabOther]);

      // Save slot with URL match
      await service.saveSlot(1, 0);

      // Switch should pick current window, lowest index
      const result = await service.switchSlot(1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.outcome.type).toBe('switched');
        if (result.outcome.type === 'switched') {
          expect(result.outcome.tabId).toBe(10); // current window, index 0
          expect(result.outcome.crossWindow).toBe(false);
        }
      }
    });

    it('should cycle to next match on second call', async () => {
      adapter.setTabs([tabCurrentA, tabCurrentB, tabOther]);
      await service.saveSlot(1, 0);

      // First switch
      const first = await service.switchSlot(1);
      expect(first.success).toBe(true);

      // Next match should go to next candidate
      const second = await service.nextMatch();
      expect(second.success).toBe(true);
      if (second.success && second.outcome.type === 'switched') {
        expect(second.outcome.tabId).toBe(11); // current window, index 2
      }

      // Third next-match should cycle to other window
      const third = await service.nextMatch();
      expect(third.success).toBe(true);
      if (third.success && third.outcome.type === 'switched') {
        expect(third.outcome.tabId).toBe(20); // other window
        expect(third.outcome.crossWindow).toBe(true);
      }
    });

    it('should focus other window on cross-window switch', async () => {
      // First save with a tab in current window
      adapter.setTabs([tabCurrentA]);
      await service.saveSlot(1, 0);

      // Now only other window has matching tabs
      adapter.setTabs([tabOther]);

      const result = await service.switchSlot(1);
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.windowId).toBe(2);
        expect(result.outcome.crossWindow).toBe(true);
      }

      // Verify window focus was updated
      const win2 = await adapter.windows.get(2);
      expect(win2.focused).toBe(true);
    });
  });

  describe('Error path — strategy fallback and incognito', () => {
    it('combination 1 + priority "none": falls back to URL search when the bound tab URL no longer matches', async () => {
      adapter.setTabs([tabCurrentA]);
      const saveResult = await service.saveSlot(1, 0, undefined, COMBO1_NONE);
      expect(saveResult.success).toBe(true);

      // Verify slot was saved
      const sync = await repo.getSyncState();
      expect(sync.slots).toHaveLength(1);

      // Change the bound tab's URL so it no longer matches
      adapter.setTabs([
        { ...tabCurrentA, url: 'https://different.com/other' },
        tabCurrentB, // This one still matches
      ]);

      const result = await service.switchSlot(1);
      if (!result.success) {
        throw new Error(`switchSlot failed: ${result.errorCode} - ${result.message}`);
      }
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.tabId).toBe(11);
      }
    });

    it('combination 3 (no-exists + match): ignores the binding and resolves by URL/regex only', async () => {
      adapter.setTabs([tabCurrentA, tabCurrentB]);
      await service.saveSlot(1, 0, undefined, COMBO3);

      // Even though the binding points to tab 10, combination 3 ignores it and
      // resolves from the URL candidates (first by sort order).
      const result = await service.switchSlot(1);
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.tabId).toBe(10); // First by sort order
      }
    });

    it('should return needs_recovery when only incognito candidates and not authorized', async () => {
      // Save with a normal tab first
      adapter.setTabs([tabCurrentA]);
      await service.saveSlot(1, 0);

      // Now only incognito tab matches, and incognito is not authorized
      adapter.state.incognitoAllowed = false;
      adapter.setTabs([tabIncognito]);

      const result = await service.switchSlot(1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.outcome.type).toBe('needs_recovery');
      }
    });

    it('should return needs_recovery when no candidates found', async () => {
      adapter.setTabs([tabCurrentA]);
      await service.saveSlot(1, 0);

      // Remove all matching tabs
      adapter.setTabs([]);

      const result = await service.switchSlot(1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.outcome.type).toBe('needs_recovery');
        if (result.outcome.type === 'needs_recovery') {
          expect(result.outcome.recoveryId).toContain('rec-');
        }
      }
    });

    it('should return SLOT_EMPTY for unconfigured slot', async () => {
      const result = await service.switchSlot(5);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('SLOT_EMPTY');
      }
    });

    it('should return NO_MATCH for next-match with no previous success', async () => {
      const result = await service.nextMatch();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('NO_MATCH');
      }
    });
  });

  // ─── T8: combination 4 (Position) three-branch + direction awareness ───────
  describe('T8: combination 4 (no-exists + no-match) and direction', () => {
    const COMBO4: MatchRuleSettings = { tabIdMode: 'no-exists', ruleCheckMode: 'no-match', priority: 'tabId' };

    async function setDirection(direction: 'previous' | 'next') {
      await repo.setSwitchDirection(direction, repo.getConfigVersion());
    }

    it('focuses the binding when it differs from the active tab', async () => {
      adapter.setTabs([
        { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'C', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);
      await service.saveSlot(1, 0, undefined, COMBO4);
      await repo.setBinding({ slotId: 1, tabId: 10, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });

      const r = await service.switchSlot(1);
      expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(10);
    });

    it('steps when the binding equals the active tab, honouring direction=next', async () => {
      adapter.setTabs([
        { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'C', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);
      await service.saveSlot(1, 0, undefined, COMBO4);
      await repo.setBinding({ slotId: 1, tabId: 11, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await setDirection('next');

      const r = await service.switchSlot(1);
      expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(12);
    });

    it('steps backward when direction=previous', async () => {
      adapter.setTabs([
        { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'C', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);
      await service.saveSlot(1, 0, undefined, COMBO4);
      await repo.setBinding({ slotId: 1, tabId: 11, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await setDirection('previous');

      const r = await service.switchSlot(1);
      expect(r.success && r.outcome.type === 'switched' ? r.outcome.tabId : null).toBe(10);
    });

    it('missing cursor → needs_recovery', async () => {
      adapter.setTabs([
        { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);
      await service.saveSlot(1, 0, undefined, COMBO4);
      await repo.setBinding({ slotId: 1, tabId: 99, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });

      const r = await service.switchSlot(1);
      expect(r.success ? r.outcome.type : null).toBe('needs_recovery');
    });

    it('ACC#7 RED: cursor == active tab steps correctly even when the focused window is the recovery popup', async () => {
      // Reproduction: the user is looking at the recovery popup (a focused
      // `type:'popup'` window). The slot binding equals the user's ACTIVE tab in
      // their real window, so per D4/D5 the action must STEP — not pop Tab Not
      // Found. Before the fix the ring was built from the focused popup window,
      // so the cursor was never "in the ring" → `missing` → recovery.
      adapter.setWindows([
        { id: 1, focused: false, incognito: false, type: 'normal' },
        { id: 3, focused: true, incognito: false, type: 'popup' },
      ]);
      adapter.setTabs([
        { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'C', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 30, windowId: 3, index: 0, url: 'chrome-extension://mock-id/src/ui/recovery/index.html', title: 'Tab Not Found', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);
      await service.saveSlot(1, 0, undefined, COMBO4);
      await repo.setBinding({ slotId: 1, tabId: 11, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setSwitchDirection('next', repo.getConfigVersion());

      const r = await service.switchSlot(1);

      expect(r.success ? r.outcome.type : null).toBe('switched');
      if (r.success && r.outcome.type === 'switched') {
        expect(r.outcome.tabId).toBe(12); // stepped forward within the user's window
        expect(r.outcome.crossWindow).toBe(false);
      }
    });

    it('nextMatch honours direction=previous (single-command entry, D6)', async () => {
      adapter.setTabs([
        { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'A', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 11, windowId: 1, index: 1, url: 'https://example.com/page', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 12, windowId: 1, index: 2, url: 'https://example.com/page', title: 'C', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);
      await service.saveSlot(1, 0);
      await repo.setLastSuccessSlot(1);
      await repo.setCycleCursor({ slotId: 1, currentIndex: 0, candidateTabIds: [10, 11, 12], updatedAt: new Date().toISOString() });
      await setDirection('previous');

      // Cursor at index 0; direction=previous steps backwards → index 2 (tab 12).
      const next = await service.nextMatch();
      expect(next.success && next.outcome.type === 'switched' ? next.outcome.tabId : null).toBe(12);

      // And again backwards → index 1 (tab 11).
      const again = await service.nextMatch();
      expect(again.success && again.outcome.type === 'switched' ? again.outcome.tabId : null).toBe(11);
    });
  });
});

/**
 * T8a (A10): `saveSlot` must hand back the `captureId` it generated, so a UI
 * surface can push a `replay:'background'` undo entry that names the EXACT
 * capture to undo. The id is minted deep inside `captureUndoSnapshot`; without a
 * return channel there is no way for any surface to learn it.
 *
 * An EMPTY slot has nothing to restore, so `captureUndoSnapshot` returns early
 * and no `captureId` is produced — matching the existing "undo is only offered
 * when an OCCUPIED slot is overwritten" gate.
 */
describe('T8a (A10) — saveSlot returns the captureId of its undo snapshot', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: SlotService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tabA: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://a.example/', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tabB: NormalizedTab = { id: 11, windowId: 1, index: 0, url: 'https://b.example/', title: 'B', favIconUrl: '', active: true, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new SlotService(adapter, repo);
  });

  it('returns captureId when an OCCUPIED slot is overwritten, and it resolves to that snapshot', async () => {
    adapter.setTabs([tabA]);
    const seed = await service.saveSlot(1, 0);
    expect(seed.success).toBe(true);
    if (!seed.success) return;
    // A first save onto an EMPTY slot captured no snapshot.
    expect(seed.captureId, 'empty-slot save must not report a captureId').toBeUndefined();

    adapter.setTabs([tabB]);
    const overwrite = await service.saveSlot(1, repo.getConfigVersion());
    expect(overwrite.success).toBe(true);
    if (!overwrite.success) return;

    const captureId = overwrite.captureId;
    expect(typeof captureId, 'overwriting an occupied slot must expose its captureId').toBe('number');

    const entry = await repo.getPendingUndo(captureId as number);
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({ kind: 'single', slotId: 1, captureId });
  });

  it('omits captureId when saving an EMPTY slot (nothing to restore)', async () => {
    adapter.setTabs([tabA]);
    const result = await service.saveSlot(3, 0);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.captureId).toBeUndefined();

    const live = await repo.getPendingUndo();
    expect(live.some((e) => e.kind === 'single' && e.slotId === 3)).toBe(false);
  });
});

/**
 * T11/T12/T14 — `swapSlots`: the four occupied/empty combinations, the D2
 * config/content boundary, the D5 derived-state purge (A6, single writeLocal),
 * version conflicts, the D14 step-④ compensation, and the Z1 undo (two slots).
 *
 * D2 KNOWN TRADE-OFF (asserted below, NOT a bug): the record MOVES but the
 * `strategy` / `autoBindOverride` STAY with the slot NUMBER, so a moved record
 * ends up using the TARGET number's strategy. No other entry point can produce
 * this state; it is the documented consequence of "swap content, not config".
 */
describe('T11/T12/T14 — swapSlots', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: SlotService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  const slotDef = (
    id: number,
    url: string,
    strategy: SlotDefinition['strategy'] = 'inherit',
    autoBindOverride?: boolean,
  ): SlotDefinition => ({
    id,
    urlMatch: { type: 'exact', value: url },
    strategy,
    ...(autoBindOverride === undefined ? {} : { autoBindOverride }),
    uiMarker: { customTitle: `Slot ${String(id)} title` },
    titleSnapshot: `title-${String(id)}`,
    faviconSnapshot: `https://fav.example/${String(id)}.png`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const bindingDef = (slotId: number, tabId: number): SlotBinding => ({
    slotId,
    tabId,
    windowId: 1,
    boundAt: '2026-01-01T00:00:00.000Z',
  });

  /** Seed slot definitions in ONE sync write (so the version starts at 1). */
  const seedSlots = async (slots: SlotDefinition[]): Promise<void> => {
    const result = await repo.writeSync(repo.getConfigVersion(), (state) => ({ ...state, slots }));
    expect(result.success).toBe(true);
  };

  /** Count how many times the `localState` LOCAL key was written. */
  const localStateWrites = (): number =>
    adapter.calls.filter(
      (c) =>
        c.method === 'storage.set'
        && c.args[0] === 'local'
        && typeof c.args[1] === 'object'
        && c.args[1] !== null
        && Object.prototype.hasOwnProperty.call(c.args[1], 'localState'),
    ).length;

  const slotById = async (id: number): Promise<SlotDefinition | undefined> =>
    (await repo.getSyncState()).slots.find((s) => s.id === id);

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new SlotService(adapter, repo);
  });

  // ── D3: the four combinations ──────────────────────────────────────────

  it('occupied ↔ occupied: swaps urlMatch/uiMarker/snapshots/binding, keeps strategy & autoBindOverride', async () => {
    const stratA: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'none' };
    const stratB: MatchRuleSettings = { tabIdMode: 'no-exists', ruleCheckMode: 'no-match', priority: 'none' };
    await seedSlots([slotDef(3, 'https://a.example/', stratA, true), slotDef(7, 'https://b.example/', stratB, false)]);
    await repo.setBinding(bindingDef(3, 30));
    await repo.setBinding(bindingDef(7, 70));

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changed).toBe(true);

    const s3 = await slotById(3);
    const s7 = await slotById(7);
    // Content followed the move: slot 3 now carries slot 7's URL/snapshots.
    expect(s3?.urlMatch.value).toBe('https://b.example/');
    expect(s3?.titleSnapshot).toBe('title-7');
    expect(s3?.faviconSnapshot).toBe('https://fav.example/7.png');
    expect(s3?.uiMarker.customTitle).toBe('Slot 7 title');
    expect(s7?.urlMatch.value).toBe('https://a.example/');
    expect(s7?.titleSnapshot).toBe('title-3');
    // Config stayed with the NUMBER (D2).
    expect(s3?.strategy).toEqual(stratA);
    expect(s3?.autoBindOverride).toBe(true);
    expect(s7?.strategy).toEqual(stratB);
    expect(s7?.autoBindOverride).toBe(false);

    // Bindings moved with the content.
    const local = await repo.getLocalState();
    expect(local.bindings.find((b) => b.slotId === 3)?.tabId).toBe(70);
    expect(local.bindings.find((b) => b.slotId === 7)?.tabId).toBe(30);
  });

  it('occupied ↔ empty: content moves to the empty slot and the source becomes empty', async () => {
    await seedSlots([slotDef(3, 'https://a.example/')]);
    await repo.setBinding(bindingDef(3, 30));

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changed).toBe(true);

    const sync = await repo.getSyncState();
    expect(sync.slots.some((s) => s.id === 3), 'the source must become empty').toBe(false);
    const s7 = sync.slots.find((s) => s.id === 7);
    expect(s7?.urlMatch.value).toBe('https://a.example/');

    const local = await repo.getLocalState();
    expect(local.bindings.some((b) => b.slotId === 3)).toBe(false);
    expect(local.bindings.find((b) => b.slotId === 7)?.tabId).toBe(30);
  });

  it('empty ↔ occupied: symmetric move to the source slot', async () => {
    await seedSlots([slotDef(7, 'https://b.example/')]);
    await repo.setBinding(bindingDef(7, 70));

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const sync = await repo.getSyncState();
    expect(sync.slots.some((s) => s.id === 7), 'the source (7) must become empty').toBe(false);
    expect(sync.slots.find((s) => s.id === 3)?.urlMatch.value).toBe('https://b.example/');
  });

  it('empty ↔ empty: short-circuits with changed=false and does NOT bump the version (A7)', async () => {
    await seedSlots([slotDef(1, 'https://keep.example/')]);
    const versionBefore = repo.getConfigVersion();
    const localWritesBefore = localStateWrites();

    const result = await service.swapSlots(3, 7, versionBefore);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changed).toBe(false);
    expect(result.configVersion).toBe(versionBefore);
    // No local write at all for a zero-change swap.
    expect(localStateWrites()).toBe(localWritesBefore);

    const sync = await repo.getSyncState();
    expect(sync.configVersion).toBe(versionBefore);
    expect(sync.slots.map((s) => s.id)).toEqual([1]);
  });

  // ── D17/A4: server-side fallback validation ────────────────────────────

  it('out-of-range ids (0 and 11) are SLOT_NOT_FOUND; in-range missing = empty (not an error)', async () => {
    await seedSlots([slotDef(3, 'https://a.example/')]);

    const low = await service.swapSlots(0, 3, repo.getConfigVersion());
    expect(low.success).toBe(false);
    if (!low.success) expect(low.errorCode).toBe('SLOT_NOT_FOUND');

    const high = await service.swapSlots(3, 11, repo.getConfigVersion());
    expect(high.success).toBe(false);
    if (!high.success) expect(high.errorCode).toBe('SLOT_NOT_FOUND');

    // In-range-but-missing (empty) is a LEGAL operand, never an error.
    const ok = await service.swapSlots(3, 4, repo.getConfigVersion());
    expect(ok.success).toBe(true);
  });

  it('source === target is INVALID_REQUEST', async () => {
    await seedSlots([slotDef(3, 'https://a.example/')]);
    const result = await service.swapSlots(3, 3, repo.getConfigVersion());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('INVALID_REQUEST');
  });

  it('version mismatch is CONFIG_CONFLICT and leaves BOTH slots untouched', async () => {
    await seedSlots([slotDef(3, 'https://a.example/'), slotDef(7, 'https://b.example/')]);
    const before = await repo.getSyncState();

    const result = await service.swapSlots(3, 7, repo.getConfigVersion() + 5);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('CONFIG_CONFLICT');

    const after = await repo.getSyncState();
    expect(after.configVersion).toBe(before.configVersion);
    expect(after.slots.find((s) => s.id === 3)?.urlMatch.value).toBe('https://a.example/');
    expect(after.slots.find((s) => s.id === 7)?.urlMatch.value).toBe('https://b.example/');
  });

  // ── D7/A5: post-write re-read delivery ─────────────────────────────────

  it('A5: redelivers to both slots\' RE-READ bound tabs and omits the empty side', async () => {
    await seedSlots([slotDef(3, 'https://a.example/')]);
    await repo.setBinding(bindingDef(3, 30));
    const delivered: number[][] = [];
    service.setDelivery((tabIds) => {
      delivered.push(tabIds);
      return Promise.resolve({});
    });

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.changed).toBe(true);
    expect(delivered).toHaveLength(1);
    // Slot 7 is now bound to 30 (content moved); slot 3 is empty → no undefined.
    expect(delivered[0]).toEqual([30]);
    expect(delivered[0].every((t) => typeof t === 'number')).toBe(true);
  });

  // ── D14 step ④: compensation ───────────────────────────────────────────

  it('D14 step ④: a failed local write is compensated — sync is rolled back', async () => {
    await seedSlots([slotDef(3, 'https://a.example/'), slotDef(7, 'https://b.example/')]);
    await repo.setBinding(bindingDef(3, 30));
    await repo.setBinding(bindingDef(7, 70));

    // Fail ONLY the swap's own localState write; the compensation write succeeds.
    adapter.failNextStorageSet('local', 'localState');

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(false);

    const sync = await repo.getSyncState();
    expect(sync.slots.find((s) => s.id === 3)?.urlMatch.value, 'sync must be rolled back').toBe('https://a.example/');
    expect(sync.slots.find((s) => s.id === 7)?.urlMatch.value).toBe('https://b.example/');
  });

  // ── T12: derived-state purge, single writeLocal, isolation ─────────────

  it('T12: purges cycleCursors/recoverySessions/recoverySnapshots for both slots and neutralises lastSuccessSlotId', async () => {
    await seedSlots([slotDef(3, 'https://a.example/'), slotDef(7, 'https://b.example/')]);
    await repo.setCycleCursor({ slotId: 3, currentIndex: 2, candidateTabIds: [30], updatedAt: '2026-01-01T00:00:00.000Z' });
    await repo.setCycleCursor({ slotId: 5, currentIndex: 1, candidateTabIds: [50], updatedAt: '2026-01-01T00:00:00.000Z' });
    await repo.setLastSuccessSlot(3);
    await repo.writeLocal((state) => ({
      ...state,
      recoverySessions: [
        { recoveryId: 'r-3', slotId: 3, urlMatch: { type: 'exact', value: 'x' }, titleSnapshot: '', faviconSnapshot: '', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', windowId: -1, candidateCursor: null },
        { recoveryId: 'r-5', slotId: 5, urlMatch: { type: 'exact', value: 'y' }, titleSnapshot: '', faviconSnapshot: '', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', windowId: -1, candidateCursor: null },
      ],
      recoverySnapshots: [
        { slotId: 7, url: 'u7', title: 't7', favicon: 'f7', recoveredAt: '2026-01-01T00:00:00.000Z' },
        { slotId: 9, url: 'u9', title: 't9', favicon: 'f9', recoveredAt: '2026-01-01T00:00:00.000Z' },
      ],
    }));

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(true);

    const local = await repo.getLocalState();
    expect(local.cycleCursors.some((c) => c.slotId === 3)).toBe(false);
    expect(local.recoverySessions.some((s) => s.slotId === 7)).toBe(false);
    expect(local.recoverySnapshots.some((s) => s.slotId === 3)).toBe(false);
    expect(local.recoverySnapshots.some((s) => s.slotId === 7)).toBe(false);
    expect(local.lastSuccessSlotId).toBeNull();
    // Other slots' derived state is NOT touched.
    expect(local.cycleCursors.some((c) => c.slotId === 5)).toBe(true);
    expect(local.recoverySessions.some((s) => s.slotId === 5)).toBe(true);
    expect(local.recoverySnapshots.some((s) => s.slotId === 9)).toBe(true);
    // D5 boundary: NOT in scope — tabOverrides stay untouched.
  });

  it('T12: the local change is ONE writeLocal call (A6/D14)', async () => {
    await seedSlots([slotDef(3, 'https://a.example/'), slotDef(7, 'https://b.example/')]);
    await repo.setBinding(bindingDef(3, 30));
    const before = localStateWrites();

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(true);
    expect(localStateWrites() - before).toBe(1);
  });

  // ── T14: the D2 trade-off + undo ───────────────────────────────────────

  it('T14/D2: the moved record adopts the TARGET number\'s strategy (documented trade-off, not a bug)', async () => {
    const stratSource: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' };
    const stratTarget: MatchRuleSettings = { tabIdMode: 'no-exists', ruleCheckMode: 'no-match', priority: 'none' };
    await seedSlots([slotDef(3, 'https://a.example/', stratSource), slotDef(7, 'https://b.example/', stratTarget)]);

    const result = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(result.success).toBe(true);

    const s7 = await slotById(7);
    // Slot 7 now holds slot 3's ORIGINAL record (urlMatch) but slot 7's OWN strategy.
    expect(s7?.urlMatch.value).toBe('https://a.example/');
    expect(s7?.strategy).toEqual(stratTarget);
  });

  it('T14/Z1: undo restores BOTH slots (content + binding) to their pre-swap state', async () => {
    await seedSlots([slotDef(3, 'https://a.example/'), slotDef(7, 'https://b.example/')]);
    await repo.setBinding(bindingDef(3, 30));
    await repo.setBinding(bindingDef(7, 70));

    const swap = await service.swapSlots(3, 7, repo.getConfigVersion());
    expect(swap.success).toBe(true);
    if (!swap.success) return;
    expect(typeof swap.captureId, 'the swap must expose its captureId (A10)').toBe('number');
    const captureId = swap.captureId as number;

    const entry = await repo.getPendingUndo(captureId);
    expect(entry).toMatchObject({ kind: 'swap', sourceSlotId: 3, targetSlotId: 7 });

    const undone = await service.restoreSlot(3, captureId);
    expect(undone.success).toBe(true);

    const sync = await repo.getSyncState();
    expect(sync.slots.find((s) => s.id === 3)?.urlMatch.value).toBe('https://a.example/');
    expect(sync.slots.find((s) => s.id === 7)?.urlMatch.value).toBe('https://b.example/');
    const local = await repo.getLocalState();
    expect(local.bindings.find((b) => b.slotId === 3)?.tabId).toBe(30);
    expect(local.bindings.find((b) => b.slotId === 7)?.tabId).toBe(70);
  });
});

/**
 * Delivery must not be on the swap's RESPONSE path.
 *
 * Reported defect: a swap answered "taking longer than expected — check whether it
 * applied" while the data HAD swapped. `swapSlots` awaited `deliver(...)` before
 * returning, so a bound tab that could not answer `FIELD_APPLY` (navigating,
 * frozen, no content script yet) held the response open until the worker's 10s
 * budget expired — for a write that was committed long before.
 */
describe('swap: delivery is a SIDE EFFECT, never part of the answer', () => {
  it('returns as soon as the write is committed, even if delivery never settles', async () => {
    const adapter = createMockAdapter();
    adapter.reset();
    const repo = new StorageRepository(adapter);
    await repo.initialize();
    const service = new SlotService(adapter, repo);

    const mk = (id: number, url: string, title: string): SlotDefinition => ({
      id,
      urlMatch: { type: 'exact', value: url },
      strategy: 'inherit',
      uiMarker: { customTitle: title },
      titleSnapshot: title,
      faviconSnapshot: '',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const bindings: SlotBinding[] = [
      { slotId: 1, tabId: 101, windowId: 1, boundAt: '2026-01-01T00:00:00Z' },
      { slotId: 3, tabId: 103, windowId: 1, boundAt: '2026-01-01T00:00:00Z' },
    ];

    const v0 = repo.getConfigVersion();
    await repo.writeSync(v0, (s) => ({ ...s, slots: [mk(1, 'https://one.example/', 'One'), mk(3, 'https://three.example/', 'Three')] }));
    await repo.writeLocal((s) => ({ ...s, bindings }));

    // A delivery function that NEVER settles — the tab is unreachable.
    service.setDelivery(() => new Promise(() => {}));

    const result = await Promise.race([
      service.swapSlots(1, 3, repo.getConfigVersion()),
      new Promise((resolve) => { setTimeout(() => { resolve('HUNG'); }, 1000); }),
    ]);

    // It answered — and it answered SUCCESS.
    expect(result).not.toBe('HUNG');
    expect(result).toMatchObject({ success: true, changed: true });

    // And the write it reported really did happen.
    const sync = await repo.getSyncState();
    expect(sync.slots.find((s) => s.id === 1)?.titleSnapshot).toBe('Three');
    expect(sync.slots.find((s) => s.id === 3)?.titleSnapshot).toBe('One');
  });
});
