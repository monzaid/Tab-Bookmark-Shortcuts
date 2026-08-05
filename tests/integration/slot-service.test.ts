import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { SlotService } from '@background/slot-service';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

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
    it('should fallback to rule search when strategy B tab URL no longer matches', async () => {
      adapter.setTabs([tabCurrentA]);
      const saveResult = await service.saveSlot(1, 0);
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
        // Debug: print the error
        throw new Error(`switchSlot failed: ${result.errorCode} - ${result.message}`);
      }
      expect(result.success).toBe(true);
      if (result.success && result.outcome.type === 'switched') {
        expect(result.outcome.tabId).toBe(11);
      }
    });

    it('should ignore tabId with strategy C (strict rule matching)', async () => {
      adapter.setTabs([tabCurrentA, tabCurrentB]);
      await service.saveSlot(1, 0, undefined, 'C');

      // Even though binding points to tab 10, strategy C ignores it
      // It should still find via URL search (first candidate)
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
});
