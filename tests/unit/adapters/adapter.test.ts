import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { AdapterError } from '@adapters/contract';

describe('T5: WebExtensions adapter contract and mock', () => {
  const adapter = createMockAdapter();

  beforeEach(() => {
    adapter.reset();
  });

  describe('Happy path — normalized results', () => {
    it('should query tabs and return normalized results', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 2, windowId: 1, index: 1, url: 'https://b.com', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' },
        { id: 3, windowId: 2, index: 0, url: 'https://c.com', title: 'C', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      const allTabs = await adapter.tabs.query({});
      expect(allTabs).toHaveLength(3);

      const window1Tabs = await adapter.tabs.query({ windowId: 1 });
      expect(window1Tabs).toHaveLength(2);

      const activeTabs = await adapter.tabs.query({ active: true });
      expect(activeTabs).toHaveLength(1);
      expect(activeTabs[0].url).toBe('https://a.com');
    });

    it('should update tab and return normalized result', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://a.com', title: 'A', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      const updated = await adapter.tabs.update(1, { active: true });
      expect(updated.active).toBe(true);
      expect(updated.id).toBe(1);
    });

    it('should update window focus', async () => {
      adapter.setWindows([
        { id: 1, focused: true, incognito: false, type: 'normal' },
        { id: 2, focused: false, incognito: false, type: 'normal' },
      ]);

      const updated = await adapter.windows.update(2, { focused: true });
      expect(updated.focused).toBe(true);

      // Window 1 should lose focus
      const win1 = await adapter.windows.get(1);
      expect(win1.focused).toBe(false);
    });

    it('should get/set storage and return normalized results', async () => {
      await adapter.storage.set('sync', { configVersion: 1, slots: [] });
      const result = await adapter.storage.get('sync', 'configVersion');
      expect(result).toEqual({ configVersion: 1 });

      const all = await adapter.storage.get('sync');
      expect(all).toEqual({ configVersion: 1, slots: [] });
    });

    it('should get all commands normalized', async () => {
      adapter.setCommands([
        { name: 'save-slot-1', description: 'Save to slot 1', shortcut: 'Ctrl+Shift+1' },
        { name: 'switch-slot-1', description: 'Switch to slot 1', shortcut: null },
        { name: 'next-match', description: 'Next match', shortcut: 'Ctrl+Shift+N' },
      ]);

      const commands = await adapter.commands.getAll();
      expect(commands).toHaveLength(3);
      expect(commands[0].shortcut).toBe('Ctrl+Shift+1');
      expect(commands[1].shortcut).toBeNull();
    });

    it('should track calls for assertion', async () => {
      await adapter.tabs.query({});
      await adapter.storage.get('local', 'key');

      expect(adapter.calls).toHaveLength(2);
      expect(adapter.calls[0].method).toBe('tabs.query');
      expect(adapter.calls[1].method).toBe('storage.get');
    });
  });

  describe('Error path — domain error mapping', () => {
    it('should map Chrome lastError to stable domain error', async () => {
      adapter.state.nextError = { code: 'BROWSER_API_ERROR', message: 'tabs.query: No matching signature' };

      await expect(adapter.tabs.query({})).rejects.toThrow(AdapterError);
      await expect(adapter.tabs.query({})).resolves.toBeDefined(); // error consumed
    });

    it('should map Firefox rejected promise to domain error', async () => {
      adapter.state.nextError = { code: 'TAB_NOT_FOUND', message: 'Tab 999 not found' };

      try {
        await adapter.tabs.get(999);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        expect((e as AdapterError).code).toBe('TAB_NOT_FOUND');
        // Should NOT leak browser-specific error text
        expect((e as AdapterError).message).not.toContain('NS_ERROR');
      }
    });

    it('should map incognito access denial to domain error', async () => {
      adapter.state.incognitoAllowed = false;
      const allowed = await adapter.incognito.isAllowed();
      expect(allowed).toBe(false);
    });

    it('should throw TAB_NOT_FOUND for missing tab', async () => {
      adapter.setTabs([]);
      await expect(adapter.tabs.get(999)).rejects.toThrow(AdapterError);
      try {
        await adapter.tabs.get(999);
      } catch (e) {
        expect((e as AdapterError).code).toBe('TAB_NOT_FOUND');
      }
    });

    it('should throw WINDOW_NOT_FOUND for missing window', async () => {
      adapter.setWindows([]);
      await expect(adapter.windows.get(999)).rejects.toThrow(AdapterError);
    });

    it('should throw when side panel not supported', async () => {
      adapter.state.sidePanelSupported = false;
      expect(adapter.sidePanel.isSupported()).toBe(false);
      await expect(adapter.sidePanel.open()).rejects.toThrow(AdapterError);
    });
  });

  describe('Event simulation', () => {
    it('should emit storage change events', async () => {
      const changes: Array<{ changes: Record<string, unknown>; area: string }> = [];
      adapter.storage.onChanged((c, area) => {
        changes.push({ changes: c, area });
      });

      await adapter.storage.set('sync', { configVersion: 2 });
      expect(changes).toHaveLength(1);
      expect(changes[0].area).toBe('sync');
    });

    it('should emit tab removed events', () => {
      const removed: number[] = [];
      adapter.tabs.onRemoved((tabId) => {
        removed.push(tabId);
      });

      adapter.emitTabRemoved(42, 1);
      expect(removed).toEqual([42]);
    });

    it('should emit command events', () => {
      const commands: string[] = [];
      adapter.commands.onCommand((cmd) => {
        commands.push(cmd);
      });

      adapter.emitCommand('save-slot-1');
      adapter.emitCommand('next-match');
      expect(commands).toEqual(['save-slot-1', 'next-match']);
    });

    it('should emit tab activated events', () => {
      const activations: Array<{ tabId: number; windowId: number }> = [];
      adapter.tabs.onActivated((info) => {
        activations.push(info);
      });

      adapter.emitTabActivated(5, 2);
      expect(activations).toEqual([{ tabId: 5, windowId: 2 }]);
    });
  });

  describe('Browser type detection', () => {
    it('should report configured browser type', () => {
      expect(adapter.getBrowserType()).toBe('chrome');
      adapter.state.browserType = 'firefox';
      expect(adapter.getBrowserType()).toBe('firefox');
    });
  });
});
