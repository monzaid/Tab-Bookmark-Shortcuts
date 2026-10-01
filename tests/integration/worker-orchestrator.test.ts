import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator, RESPONSE_TIMEOUT_MS } from '@background/worker-orchestrator';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

describe('T21: Service Worker lifecycle, message routing, command dispatch, cleanup', () => {
  const adapter = createMockAdapter();
  let worker: WorkerOrchestrator;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab1: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([tab1]);
    adapter.setCommands([
      { name: 'save-slot-1', description: 'Save slot 1', shortcut: 'Ctrl+1' },
      { name: 'switch-slot-1', description: 'Switch slot 1', shortcut: 'Ctrl+Shift+1' },
      { name: 'next-match', description: 'Next match', shortcut: null },
    ]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  describe('Happy path — startup, dispatch, routing', () => {
    it('should initialize and hydrate cache on startup', async () => {
      const sync = await worker.repo.getSyncState();
      expect(sync.configVersion).toBe(0);
      expect(sync.matchSettings).toEqual({ tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' });
    });

    it('should dispatch save-slot-1 command', async () => {
      adapter.emitCommand('save-slot-1');
      // Wait for async handling
      await new Promise((r) => setTimeout(r, 50));

      const sync = await worker.repo.getSyncState();
      expect(sync.slots).toHaveLength(1);
      expect(sync.slots[0].id).toBe(1);
    });

    it('should dispatch switch-slot-1 command after save', async () => {
      adapter.emitCommand('save-slot-1');
      await new Promise((r) => setTimeout(r, 50));

      adapter.emitCommand('switch-slot-1');
      await new Promise((r) => setTimeout(r, 50));

      const local = await worker.repo.getLocalState();
      expect(local.lastSuccessSlotId).toBe(1);
    });

    it('should route GET_STATE message', async () => {
      // Simulate message via the registered listener
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'test-1', action: 'GET_STATE' },
        {}
      );

      expect(result).toEqual(expect.objectContaining({ success: true }));
      const typed = result as { success: boolean; sync: { configVersion: number } };
      expect(typed.sync.configVersion).toBe(0);
    });

    it('should route GET_COMMANDS message', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'test-2', action: 'GET_COMMANDS' },
        {}
      ) as { success: boolean; commands: Array<{ name: string }> };

      expect(result.success).toBe(true);
      expect(result.commands).toHaveLength(3);
    });

    it('should route SAVE_SLOT message with configVersion', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'test-3', action: 'SAVE_SLOT', configVersion: 0, payload: { slotId: 2, urlMatch: { type: 'exact', value: 'https://test.com' }, titleSnapshot: 'Test', faviconSnapshot: '' } },
        {}
      ) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('should handle content navigation and apply rules', async () => {
      // Create an auto rule first
      await worker.ruleService.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Custom Title',
      }, 0);

      // Simulate content navigation
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'nav-1', action: 'CONTENT_NAVIGATION', payload: { tabId: 10, url: 'https://example.com/page', navigationType: 'initial' } },
        { tab: { id: 10 } }
      );

      expect(result).toEqual(expect.objectContaining({ success: true }));

      // Verify rewrite was delivered via scripting.executeScript
      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      expect(execCalls.length).toBeGreaterThan(0);
    });
  });

  describe('T37 (B9-10) — write-layer favicon protocol validation', () => {
    const send = (msg: unknown): Promise<unknown> =>
      (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

    it('SET_TAB_OVERRIDE must reject and NOT persist a dangerous favicon', async () => {
      const result = (await send({
        requestId: 't37-ov-1',
        action: 'SET_TAB_OVERRIDE',
        payload: { tabId: 10, favicon: { type: 'url', value: 'javascript:alert(1)' } },
      })) as { success: boolean; errorCode?: string };

      expect(result.success, 'a javascript: override favicon must be rejected').toBe(false);

      const local = await worker.repo.getLocalState();
      const override = local.tabOverrides.find((o) => o.tabId === 10);
      expect(override?.favicon, 'nothing may be persisted').toBeUndefined();
    });

    it('SET_TAB_OVERRIDE must still accept safe favicons', async () => {
      const https = (await send({
        requestId: 't37-ov-2',
        action: 'SET_TAB_OVERRIDE',
        payload: { tabId: 10, favicon: { type: 'url', value: 'https://cdn.example.com/i.png' } },
      })) as { success: boolean };
      expect(https.success).toBe(true);
      expect((await worker.repo.getLocalState()).tabOverrides.find((o) => o.tabId === 10)?.favicon?.value).toBe(
        'https://cdn.example.com/i.png',
      );

      const dataImg = (await send({
        requestId: 't37-ov-3',
        action: 'SET_TAB_OVERRIDE',
        payload: { tabId: 10, favicon: { type: 'upload', value: 'data:image/png;base64,AAA' } },
      })) as { success: boolean };
      expect(dataImg.success).toBe(true);
    });

    it('UPDATE_SLOT_UI_MARKER must reject and NOT persist a dangerous icon', async () => {
      // Occupy slot 1 so the marker can be attached.
      expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);

      const result = (await send({
        requestId: 't37-mk-1',
        action: 'UPDATE_SLOT_UI_MARKER',
        payload: { slotId: 1, uiMarker: { icon: { type: 'url', value: 'javascript:alert(1)' } } },
      })) as { success: boolean; errorCode?: string };

      expect(result.success, 'a javascript: slot icon must be rejected').toBe(false);

      const slot = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1);
      expect(slot?.uiMarker.icon, 'nothing may be persisted').toBeUndefined();
    });

    it('UPDATE_SLOT_UI_MARKER must still accept a safe icon', async () => {
      expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);

      const result = (await send({
        requestId: 't37-mk-2',
        action: 'UPDATE_SLOT_UI_MARKER',
        payload: { slotId: 1, uiMarker: { icon: { type: 'url', value: 'https://cdn.example.com/i.png' } } },
      })) as { success: boolean };

      expect(result.success).toBe(true);
      expect((await worker.repo.getSyncState()).slots.find((s) => s.id === 1)?.uiMarker.icon?.value).toBe(
        'https://cdn.example.com/i.png',
      );
    });
  });

  describe('T30 (B4-2) — UPDATE_SLOT_URL validates regex before persisting', () => {
    const send = (msg: unknown): Promise<unknown> =>
      (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

    it('should reject a catastrophic regex instead of persisting it', async () => {
      await send({ requestId: 't30-seed', action: 'SAVE_SLOT', payload: { slotId: 1 } });

      const result = (await send({
        requestId: 't30-bad',
        action: 'UPDATE_SLOT_URL',
        payload: { slotId: 1, url: '^(a+){10}$', matchType: 'regex' },
      })) as { success: boolean; errorCode?: string };

      expect(result.success, 'a catastrophic regex must not be accepted').toBe(false);
      expect(result.errorCode).toBe('REGEX_RISK');

      // Nothing may have been written.
      const after = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1);
      expect(after?.urlMatch.type).toBe('exact');
      expect(after?.urlMatch.value).not.toBe('^(a+){10}$');
    });

    it('should still accept a safe regex and record it', async () => {
      await send({ requestId: 't30-seed2', action: 'SAVE_SLOT', payload: { slotId: 1 } });

      const result = (await send({
        requestId: 't30-good',
        action: 'UPDATE_SLOT_URL',
        payload: { slotId: 1, url: '^https://example\\.com/.*$', matchType: 'regex' },
      })) as { success: boolean };

      expect(result.success).toBe(true);
      const after = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1);
      expect(after?.urlMatch.type).toBe('regex');
      expect(after?.urlMatch.value).toBe('^https://example\\.com/.*$');
    });
  });

  describe('T24 — SAVE_SLOT overwrite captures an undo snapshot', () => {
    const send = (msg: unknown): Promise<unknown> =>
      (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

    it('should restore the previous slot definition and binding when SAVE_SLOT overwrote it', async () => {
      // 1) Occupy slot 1 via the normal SAVE_SLOT path.
      const first = (await send({ requestId: 't24-a', action: 'SAVE_SLOT', payload: { slotId: 1 } })) as {
        success: boolean;
      };
      expect(first.success).toBe(true);

      const originalSlot = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1);
      const originalUrl = originalSlot?.urlMatch.value;
      const originalBinding = (await worker.repo.getLocalState()).bindings.find((b) => b.slotId === 1);
      expect(originalBinding?.tabId).toBe(10);

      // 2) Overwrite slot 1 from a DIFFERENT active tab, still through SAVE_SLOT
      //    (the sidebar overwrite path — no conflict popup involved).
      adapter.setTabs([{ ...tab1, id: 20, url: 'https://changed.example/other', title: 'Changed' }]);
      const second = (await send({ requestId: 't24-b', action: 'SAVE_SLOT', payload: { slotId: 1 } })) as {
        success: boolean;
      };
      expect(second.success).toBe(true);
      expect((await worker.repo.getSyncState()).slots.find((s) => s.id === 1)?.urlMatch.value).toContain(
        'changed.example',
      );

      // 3) UNDO_SAVE must RESTORE the overwritten slot, not delete it.
      const undone = (await send({ requestId: 't24-c', action: 'UNDO_SAVE', payload: { slotId: 1 } })) as {
        success: boolean;
      };
      expect(undone.success).toBe(true);

      const restored = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1);
      expect(restored, 'slot definition must be restored after undo, not deleted').toBeDefined();
      expect(restored?.urlMatch.value).toBe(originalUrl);
      expect((await worker.repo.getLocalState()).bindings.find((b) => b.slotId === 1)?.tabId).toBe(10);
    });

    it('should capture a snapshot when saveSlot is invoked directly (shared capture point)', async () => {
      // Occupy slot 1.
      await send({ requestId: 't24-e', action: 'SAVE_SLOT', payload: { slotId: 1 } });
      const originalUrl = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1)?.urlMatch.value;

      // Overwrite by calling the service method directly — this is the route the
      // keyboard command and any non-message caller uses. The capture must live
      // in the service layer, not only in the message handler.
      adapter.setTabs([{ ...tab1, id: 20, url: 'https://changed.example/direct', title: 'Changed' }]);
      const overwritten = await worker.slotService.saveSlot(1, worker.repo.getConfigVersion());
      expect(overwritten.success).toBe(true);

      const undone = (await send({ requestId: 't24-f', action: 'UNDO_SAVE', payload: { slotId: 1 } })) as {
        success: boolean;
      };
      expect(undone.success).toBe(true);

      const restored = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1);
      expect(restored, 'direct saveSlot overwrite must also be undoable').toBeDefined();
      expect(restored?.urlMatch.value).toBe(originalUrl);
    });

    it('should open the conflict prompt on the command path instead of silently overwriting', async () => {
      // Occupy slot 1.
      adapter.emitCommand('save-slot-1');
      await new Promise((r) => setTimeout(r, 50));
      const before = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1)?.urlMatch.value;

      // Second command press with a different active tab → conflict popup, no write.
      adapter.setTabs([{ ...tab1, id: 20, url: 'https://changed.example/cmd', title: 'Changed' }]);
      adapter.emitCommand('save-slot-1');
      await new Promise((r) => setTimeout(r, 50));

      const after = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1)?.urlMatch.value;
      expect(after, 'occupied slot must not be silently overwritten').toBe(before);
      expect(adapter.calls.filter((c) => c.method === 'windows.create')).toHaveLength(1);
    });
  });

  describe('T21 — action whitelist and response timeout', () => {
    it('should reply explicitly (not hang) and report false for an unknown action', async () => {
      adapter.reset();
      adapter.setWindows([{ id: 1, focused: true, incognito: false, type: 'normal' }]);
      adapter.setTabs([]);
      const w = new WorkerOrchestrator(adapter);
      await w.initialize();

      let response: unknown;
      adapter.emitRuntimeMessage({ requestId: 'unknown-1', action: 'NOPE_NOT_REAL' }, {}, (r) => {
        response = r;
      });
      // The reply is synchronous for a whitelist rejection — no waiting needed.
      expect(response).toEqual(
        expect.objectContaining({ success: false, errorCode: 'UNKNOWN_ACTION' }),
      );
    });

    it('should return TIMEOUT when an action outlives the response budget', async () => {
      adapter.reset();
      adapter.setWindows([{ id: 1, focused: true, incognito: false, type: 'normal' }]);
      adapter.setTabs([]);
      const w = new WorkerOrchestrator(adapter);
      await w.initialize();

      // Make one action hang forever: the router must still answer.
      const originalGetState = w.repo.getSyncState.bind(w.repo);
      w.repo.getSyncState = () => new Promise(() => {});
      let response: unknown;

      vi.useFakeTimers();
      try {
        (
          w as unknown as {
            handleMessage: (
              m: unknown,
              s: unknown,
              sendResponse: (r?: unknown) => void,
            ) => boolean;
          }
        ).handleMessage({ requestId: 'timeout-1', action: 'GET_STATE' }, {}, (r) => {
          response = r;
        });

        // Advance past the response budget without waiting in real time.
        await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS + 50);
      } finally {
        vi.useRealTimers();
        w.repo.getSyncState = originalGetState;
      }

      expect(response).toEqual(
        expect.objectContaining({ success: false, errorCode: 'TIMEOUT' }),
      );
    });
  });

  describe('B11c (T18) — OPEN_SIDEBAR is routed exactly once', () => {
    it('should route OPEN_SIDEBAR through routeMessage and open the side panel', async () => {
      adapter.reset();
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = true;
      adapter.setWindows([{ id: 1, focused: true, incognito: false, type: 'normal' }]);
      adapter.setTabs([]);
      const w = new WorkerOrchestrator(adapter);
      await w.initialize();

      adapter.calls.length = 0;
      const result = (await (
        w as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }
      ).routeMessage({ requestId: 'open-sidebar-1', action: 'OPEN_SIDEBAR', payload: { windowId: 1 } }, {})) as {
        success: boolean;
      };

      expect(result.success).toBe(true);
      const opens = adapter.calls.filter((c) => c.method === 'sidePanel.open');
      expect(opens).toHaveLength(1);
      expect(opens[0].args[0]).toBe(1);
    });

    it('should NOT double-handle OPEN_SIDEBAR (single listener, no duplicate sidePanel.open)', async () => {
      adapter.reset();
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = true;
      adapter.setWindows([{ id: 1, focused: true, incognito: false, type: 'normal' }]);
      adapter.setTabs([]);
      const w = new WorkerOrchestrator(adapter);
      await w.initialize();

      // Dispatch through the registered runtime.onMessage listener — this is the
      // path that previously risked two listeners both responding.
      adapter.calls.length = 0;
      let response: unknown;
      adapter.emitRuntimeMessage(
        { requestId: 'open-sidebar-2', action: 'OPEN_SIDEBAR', payload: { windowId: 1 } },
        {},
        (r) => {
          response = r;
        },
      );
      await new Promise((r) => setTimeout(r, 30));

      expect(response).toEqual(expect.objectContaining({ success: true }));
      expect(adapter.calls.filter((c) => c.method === 'sidePanel.open')).toHaveLength(1);
    });
  });

  describe('Error path — unknown command, cold start, handler rejection', () => {
    it('should handle unknown command gracefully', async () => {
      adapter.emitCommand('unknown-command-xyz');
      await new Promise((r) => setTimeout(r, 50));

      // Should not crash — diagnostics should record it
      const entries = await worker.diagnostics.getEntries();
      const unknownEntry = entries.find((e) => e.operationType === 'unknown_command');
      expect(unknownEntry).toBeDefined();
      expect(unknownEntry!.errorCode).toBe('COMMAND_NOT_FOUND');
    });

    it('should return UNKNOWN_ACTION for invalid message', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        { requestId: 'bad-1', action: 'TOTALLY_INVALID' },
        {}
      ) as { success: boolean; errorCode: string };

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN_ACTION');
    });

    it('B10: rule operation failures must report INTERNAL_ERROR (never the drifting INTERNAL)', async () => {
    const sendRoute = (msg: unknown) =>
      (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

    // Force the rule service to throw so the catch branch is exercised.
    const originalCreate = worker.ruleService.createRule.bind(worker.ruleService);
    worker.ruleService.createRule = () => Promise.reject(new Error('boom'));
    let result: { success: boolean; errorCode?: string } | undefined;
    try {
      result = (await sendRoute({
        requestId: 'b10-create',
        action: 'CREATE_RULE',
        payload: { urlMatch: { type: 'exact', value: 'https://x.example' }, mode: 'auto', priority: 0 },
      })) as { success: boolean; errorCode?: string };
    } finally {
      worker.ruleService.createRule = originalCreate;
    }

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INTERNAL_ERROR');
  });

  it('B10: UPDATE_RULE and DELETE_RULE failures also report INTERNAL_ERROR', async () => {
    const sendRoute = (msg: unknown) =>
      (worker as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

    const originalUpdate = worker.ruleService.updateRule.bind(worker.ruleService);
    const originalDelete = worker.ruleService.deleteRule.bind(worker.ruleService);
    worker.ruleService.updateRule = () => Promise.reject(new Error('boom-update'));
    worker.ruleService.deleteRule = () => Promise.reject(new Error('boom-delete'));

    let updated: { errorCode?: string } | undefined;
    let deleted: { errorCode?: string } | undefined;
    try {
      updated = (await sendRoute({
        requestId: 'b10-update',
        action: 'UPDATE_RULE',
        payload: { ruleId: 'r1' },
      })) as { errorCode?: string };
      deleted = (await sendRoute({
        requestId: 'b10-delete',
        action: 'DELETE_RULE',
        payload: { ruleId: 'r1' },
      })) as { errorCode?: string };
    } finally {
      worker.ruleService.updateRule = originalUpdate;
      worker.ruleService.deleteRule = originalDelete;
    }

    expect(updated.errorCode).toBe('INTERNAL_ERROR');
    expect(deleted.errorCode).toBe('INTERNAL_ERROR');
  });

    it('should return INVALID_REQUEST for null message', async () => {
      const result = await (worker as unknown as { routeMessage: (msg: unknown, sender: unknown) => Promise<unknown> }).routeMessage(
        null,
        {}
      ) as { success: boolean; errorCode: string };

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_REQUEST');
    });

    it('should clean up bindings on tab removed', async () => {
      // Save slot to create binding
      adapter.emitCommand('save-slot-1');
      await new Promise((r) => setTimeout(r, 50));

      let local = await worker.repo.getLocalState();
      expect(local.bindings).toHaveLength(1);

      // Simulate tab removed
      adapter.emitTabRemoved(10, 1);
      await new Promise((r) => setTimeout(r, 50));

      local = await worker.repo.getLocalState();
      expect(local.bindings).toHaveLength(0);
    });

    it('should re-hydrate on cold start (ensureReady)', async () => {
      // Simulate cold start by creating new worker without initialize
      const worker2 = new WorkerOrchestrator(adapter);
      await worker2.ensureReady();

      const sync = await worker2.repo.getSyncState();
      expect(sync.configVersion).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── B2 (T3): UNDO_SAVE restores the overwritten slot snapshot ─────────────
  describe('B2 — UNDO_SAVE restores pendingUndo snapshot instead of deleting', () => {
    const route = (w: WorkerOrchestrator, msg: unknown) =>
      (w as unknown as { routeMessage: (m: unknown, s: unknown) => Promise<unknown> }).routeMessage(msg, {});

    async function overwriteSlot1(): Promise<void> {
      const result = await route(worker, {
        requestId: 'ow-1',
        action: 'CONFLICT_OVERWRITE',
        payload: {
          slotId: 1,
          tabId: 10,
          url: 'https://new.example/overwritten',
          title: 'New Page',
          favIconUrl: 'https://new.example/icon.png',
        },
      });
      expect(result).toMatchObject({ success: true });
    }

    it('should restore the slot definition after an overwrite', async () => {
      // Seed slot 1 from the active tab (url https://example.com/page, title Example)
      const seeded = await worker.slotService.saveSlot(1, 0);
      expect(seeded.success).toBe(true);

      await overwriteSlot1();

      // Overwrite took effect
      let sync = await worker.repo.getSyncState();
      expect(sync.slots[0].urlMatch.value).toBe('https://new.example/overwritten');

      const undoResult = await route(worker, { requestId: 'undo-1', action: 'UNDO_SAVE', payload: { slotId: 1 } });
      expect(undoResult).toMatchObject({ success: true });

      // Slot definition restored field-by-field (not deleted)
      sync = await worker.repo.getSyncState();
      expect(sync.slots).toHaveLength(1);
      expect(sync.slots[0].id).toBe(1);
      expect(sync.slots[0].urlMatch.value).toBe('https://example.com/page');
      expect(sync.slots[0].titleSnapshot).toBe('Example');
      expect(sync.slots[0].strategy).toBe(seeded.success ? seeded.slot.strategy : 'inherit');
    });

    it('should restore the pre-overwrite binding after an overwrite', async () => {
      const seeded = await worker.slotService.saveSlot(1, 0);
      expect(seeded.success).toBe(true);

      const before = await worker.repo.getLocalState();
      const originalBinding = before.bindings.find((b) => b.slotId === 1);
      expect(originalBinding).toBeDefined();

      await overwriteSlot1();

      await route(worker, { requestId: 'undo-2', action: 'UNDO_SAVE', payload: { slotId: 1 } });

      const after = await worker.repo.getLocalState();
      const restoredBinding = after.bindings.find((b) => b.slotId === 1);
      expect(restoredBinding).toEqual(originalBinding);
    });

    it('T25: a stale slot timer must not delete a newer slot snapshot', async () => {
      // Seed two occupied slots.
      expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);
      expect((await worker.slotService.saveSlot(2, worker.repo.getConfigVersion())).success).toBe(true);

      vi.useFakeTimers();
      try {
        // Snapshot slot 1, then (later) snapshot slot 2 into the same key.
        await worker.slotService.captureUndoSnapshot(1); // timer armed for t≈5100
        await vi.advanceTimersByTimeAsync(1000);
        await worker.slotService.captureUndoSnapshot(2); // expires at t≈6000

        // Advance past slot 1's cleanup timer but NOT past slot 2's expiry.
        await vi.advanceTimersByTimeAsync(4200); // now t≈5200

        // Slot 1's timer must NOT have wiped slot 2's still-valid snapshot.
        const pending2 = await worker.repo.getPendingUndo(2);
        expect(pending2, "slot 1's timer deleted slot 2's live snapshot").not.toBeNull();
        expect(pending2?.slotId).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('T34: a fast re-overwrite of the SAME slot must survive the first timer', async () => {
      // Occupy slot 1 with a known URL, then overwrite it twice in quick
      // succession. The FIRST capture's cleanup timer must not delete the
      // SECOND (still-valid) capture: matching on slotId alone is not enough.
      const seeded = await worker.slotService.saveSlot(1, worker.repo.getConfigVersion());
      expect(seeded.success).toBe(true);

      vi.useFakeTimers();
      try {
        // t = 0: capture A for slot 1 (timer armed for t≈5100, A expires t=5000).
        adapter.setTabs([{ ...tab1, id: 20, url: 'https://first-overwrite.example/a', title: 'A' }]);
        expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);

        // t = 4000: overwrite slot 1 again → capture B (B expires t=9000).
        await vi.advanceTimersByTimeAsync(4000);
        adapter.setTabs([{ ...tab1, id: 21, url: 'https://second-overwrite.example/b', title: 'B' }]);
        expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);

        const pendingB = await worker.repo.getPendingUndo(1);
        expect(pendingB, 'capture B should be live right after the second overwrite').not.toBeNull();
        const bUrl = pendingB?.slotSnapshot.urlMatch.value;

        // t = 5200: the FIRST timer fires. B is still valid until t=9000.
        await vi.advanceTimersByTimeAsync(1200);

        const afterTimer = await worker.repo.getPendingUndo(1);
        expect(
          afterTimer,
          "the first capture's timer deleted the still-valid second capture",
        ).not.toBeNull();
        expect(afterTimer?.slotSnapshot.urlMatch.value).toBe(bUrl);
      } finally {
        vi.useRealTimers();
      }
    });

    it('T34: UNDO_SAVE after a fast re-overwrite RESTORES rather than deleting', async () => {
      const seeded = await worker.slotService.saveSlot(1, worker.repo.getConfigVersion());
      expect(seeded.success).toBe(true);

      // Overwrite twice; with the bug, the first timer wipes the second capture
      // and UNDO_SAVE silently degrades to deletion while reporting success.
      adapter.setTabs([{ ...tab1, id: 20, url: 'https://first.example/a', title: 'A' }]);
      expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);
      adapter.setTabs([{ ...tab1, id: 21, url: 'https://second.example/b', title: 'B' }]);
      expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);

      // Simulate the older timer having already fired (its expiry is nearer).
      vi.useFakeTimers();
      try {
        await vi.advanceTimersByTimeAsync(5200);
      } finally {
        vi.useRealTimers();
      }

      const undone = (await route(worker, {
        requestId: 't34-undo',
        action: 'UNDO_SAVE',
        payload: { slotId: 1 },
      })) as { success: boolean };
      expect(undone.success).toBe(true);

      const slot = (await worker.repo.getSyncState()).slots.find((s) => s.id === 1);
      expect(slot, 'UNDO_SAVE must restore, not delete').toBeDefined();
      expect(slot?.urlMatch.value).toContain('first.example');
    });

    it('T25: clearPendingUndo(slotId) leaves a different slot snapshot intact', async () => {
      expect((await worker.slotService.saveSlot(1, worker.repo.getConfigVersion())).success).toBe(true);
      expect((await worker.slotService.saveSlot(2, worker.repo.getConfigVersion())).success).toBe(true);

      await worker.slotService.captureUndoSnapshot(2);
      // Conditional clear aimed at slot 1 must be a no-op for slot 2's snapshot.
      await worker.repo.clearPendingUndo(1);
      expect(await worker.repo.getPendingUndo(2)).not.toBeNull();

      // Conditional clear aimed at the owning slot removes it.
      await worker.repo.clearPendingUndo(2);
      expect(await worker.repo.getPendingUndo(2)).toBeNull();
    });

    it('should degrade to deletion when NO snapshot exists (slot never overwritten)', async () => {
      const seeded = await worker.slotService.saveSlot(1, 0);
      expect(seeded.success).toBe(true);

      const undoResult = await route(worker, { requestId: 'undo-3', action: 'UNDO_SAVE', payload: { slotId: 1 } });
      expect(undoResult).toMatchObject({ success: true });

      const sync = await worker.repo.getSyncState();
      expect(sync.slots.find((s) => s.id === 1)).toBeUndefined();
    });

    it('should ignore an EXPIRED snapshot and degrade to deletion', async () => {
      const seeded = await worker.slotService.saveSlot(1, 0);
      expect(seeded.success).toBe(true);

      // Forge an already-expired snapshot directly in local storage
      adapter.state.localStorage['pendingUndo'] = {
        slotId: 1,
        slotSnapshot: {
          id: 1,
          urlMatch: { type: 'exact', value: 'https://stale.example' },
          strategy: 'inherit',
          uiMarker: {},
          titleSnapshot: 'Stale',
          faviconSnapshot: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        bindingSnapshot: null,
        expiresAt: Date.now() - 1,
      };

      const undoResult = await route(worker, { requestId: 'undo-4', action: 'UNDO_SAVE', payload: { slotId: 1 } });
      expect(undoResult).toMatchObject({ success: true });

      const sync = await worker.repo.getSyncState();
      expect(sync.slots.find((s) => s.id === 1)).toBeUndefined();
    });

    it('should propagate failure on the degraded path when the sync delete fails', async () => {
      const seeded = await worker.slotService.saveSlot(1, 0);
      expect(seeded.success).toBe(true);

      const originalSet = adapter.storage.set;
      let response: { success: boolean } | undefined;
      try {
        adapter.storage.set = async (area, items) => {
          if (area === 'sync') throw new Error('QUOTA_BYTES exceeded');
          return originalSet(area, items);
        };
        response = (await route(worker, {
          requestId: 'undo-5',
          action: 'UNDO_SAVE',
          payload: { slotId: 1 },
        })) as { success: boolean };
      } finally {
        adapter.storage.set = originalSet;
      }

      expect(response.success).toBe(false);
    });
  });
});
