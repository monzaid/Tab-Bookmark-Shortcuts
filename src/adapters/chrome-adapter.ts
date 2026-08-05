/**
 * Chrome/Edge adapter implementation.
 * Uses the chrome.* extension APIs directly.
 * All browser-specific error handling is confined here.
 */

import type {
  BrowserAdapter,
  BrowserType,
  NormalizedTab,
  NormalizedWindow,
  NormalizedCommand,
  StorageArea,
} from './contract';
import { AdapterError } from './contract';

function normalizeTab(tab: chrome.tabs.Tab): NormalizedTab {
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    index: tab.index ?? 0,
    url: tab.url ?? '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl ?? '',
    active: tab.active ?? false,
    incognito: tab.incognito ?? false,
    status: tab.status ?? 'unknown',
  };
}

function normalizeWindow(win: chrome.windows.Window): NormalizedWindow {
  return {
    id: win.id ?? -1,
    focused: win.focused ?? false,
    incognito: win.incognito ?? false,
    type: win.type ?? 'normal',
    tabs: win.tabs?.map(normalizeTab),
  };
}

export function createChromeAdapter(browserType: BrowserType = 'chrome'): BrowserAdapter {
  return {
    getBrowserType: () => browserType,

    commands: {
      async getAll(): Promise<NormalizedCommand[]> {
        try {
          const commands = await chrome.commands.getAll();
          return commands.map((cmd) => ({
            name: cmd.name ?? '',
            description: cmd.description ?? '',
            shortcut: cmd.shortcut || null,
          }));
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to get commands', e);
        }
      },
      onCommand(listener: (command: string) => void): void {
        chrome.commands.onCommand.addListener(listener);
      },
      removeCommandListener(listener: (command: string) => void): void {
        chrome.commands.onCommand.removeListener(listener);
      },
    },

    tabs: {
      async query(queryInfo): Promise<NormalizedTab[]> {
        try {
          const tabs = await chrome.tabs.query(queryInfo);
          return tabs.map(normalizeTab);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to query tabs', e);
        }
      },
      async get(tabId: number): Promise<NormalizedTab> {
        try {
          const tab = await chrome.tabs.get(tabId);
          return normalizeTab(tab);
        } catch (e) {
          throw new AdapterError('TAB_NOT_FOUND', `Tab ${tabId} not found`, e);
        }
      },
      async create(createProperties): Promise<NormalizedTab> {
        try {
          const tab = await chrome.tabs.create(createProperties);
          return normalizeTab(tab);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to create tab', e);
        }
      },
      async update(tabId, updateProperties): Promise<NormalizedTab> {
        try {
          const tab = await chrome.tabs.update(tabId, updateProperties);
          return normalizeTab(tab);
        } catch (e) {
          throw new AdapterError('TAB_NOT_FOUND', `Failed to update tab ${tabId}`, e);
        }
      },
      async remove(tabId: number): Promise<void> {
        try {
          await chrome.tabs.remove(tabId);
        } catch (e) {
          throw new AdapterError('TAB_NOT_FOUND', `Failed to remove tab ${tabId}`, e);
        }
      },
      async sendMessage(tabId: number, message: unknown): Promise<unknown> {
        try {
          return await chrome.tabs.sendMessage(tabId, message);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', `Failed to send message to tab ${tabId}`, e);
        }
      },
      onRemoved(listener): void {
        chrome.tabs.onRemoved.addListener(listener);
      },
      removeOnRemovedListener(listener): void {
        chrome.tabs.onRemoved.removeListener(listener);
      },
      onUpdated(listener): void {
        chrome.tabs.onUpdated.addListener(listener as (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void);
      },
      removeOnUpdatedListener(listener): void {
        chrome.tabs.onUpdated.removeListener(listener as (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void);
      },
      onActivated(listener): void {
        chrome.tabs.onActivated.addListener(listener);
      },
      removeOnActivatedListener(listener): void {
        chrome.tabs.onActivated.removeListener(listener);
      },
    },

    windows: {
      async getAll(getInfo?): Promise<NormalizedWindow[]> {
        try {
          const windows = getInfo !== undefined
            ? await chrome.windows.getAll(getInfo)
            : await chrome.windows.getAll();
          return windows.map(normalizeWindow);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to get windows', e);
        }
      },
      async get(windowId: number): Promise<NormalizedWindow> {
        try {
          const win = await chrome.windows.get(windowId);
          return normalizeWindow(win);
        } catch (e) {
          throw new AdapterError('WINDOW_NOT_FOUND', `Window ${windowId} not found`, e);
        }
      },
      async getCurrent(): Promise<NormalizedWindow> {
        try {
          const win = await chrome.windows.getCurrent();
          return normalizeWindow(win);
        } catch (e) {
          throw new AdapterError('WINDOW_NOT_FOUND', 'Failed to get current window', e);
        }
      },
      async update(windowId, updateInfo): Promise<NormalizedWindow> {
        try {
          const win = await chrome.windows.update(windowId, updateInfo);
          return normalizeWindow(win);
        } catch (e) {
          throw new AdapterError('WINDOW_NOT_FOUND', `Failed to update window ${windowId}`, e);
        }
      },
      async create(createData): Promise<NormalizedWindow> {
        try {
          const win = await chrome.windows.create({
            ...createData,
            type: createData.type as chrome.windows.CreateData['type'],
          });
          return normalizeWindow(win);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to create window', e);
        }
      },
      onFocusChanged(listener): void {
        chrome.windows.onFocusChanged.addListener(listener);
      },
      removeOnFocusChangedListener(listener): void {
        chrome.windows.onFocusChanged.removeListener(listener);
      },
    },

    storage: {
      async get(area: StorageArea, keys?): Promise<Record<string, unknown>> {
        try {
          return await chrome.storage[area].get(keys as string | string[] | Record<string, unknown> | undefined);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', `Failed to get from storage.${area}`, e);
        }
      },
      async set(area: StorageArea, items: Record<string, unknown>): Promise<void> {
        try {
          await chrome.storage[area].set(items);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', `Failed to set storage.${area}`, e);
        }
      },
      async remove(area: StorageArea, keys: string | string[]): Promise<void> {
        try {
          await chrome.storage[area].remove(keys);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', `Failed to remove from storage.${area}`, e);
        }
      },
      async clear(area: StorageArea): Promise<void> {
        try {
          await chrome.storage[area].clear();
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', `Failed to clear storage.${area}`, e);
        }
      },
      onChanged(listener): void {
        chrome.storage.onChanged.addListener(listener as (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void);
      },
      removeOnChangedListener(listener): void {
        chrome.storage.onChanged.removeListener(listener as (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void);
      },
    },

    runtime: {
      onMessage(listener): void {
        chrome.runtime.onMessage.addListener(listener as (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void);
      },
      removeOnMessageListener(listener): void {
        chrome.runtime.onMessage.removeListener(listener as (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void);
      },
      async sendMessage(message: unknown): Promise<unknown> {
        try {
          return await chrome.runtime.sendMessage(message);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to send runtime message', e);
        }
      },
      getURL(path: string): string {
        return chrome.runtime.getURL(path);
      },
      getManifest(): { version: string; manifest_version: number } {
        const manifest = chrome.runtime.getManifest();
        return { version: manifest.version, manifest_version: manifest.manifest_version };
      },
      getId(): string {
        return chrome.runtime.id ?? '';
      },
    },

    scripting: {
      async executeScript(options): Promise<unknown[]> {
        try {
          const results = await chrome.scripting.executeScript({
            target: options.target,
            func: options.func as (...args: unknown[]) => unknown,
            args: options.args,
          });
          return results.map((r) => r.result);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to execute script', e);
        }
      },
    },

    notifications: {
      async create(notificationId, options): Promise<string> {
        try {
          return await new Promise<string>((resolve, reject) => {
            chrome.notifications.create(notificationId, {
              type: options.type as chrome.notifications.TemplateType,
              title: options.title,
              message: options.message,
              iconUrl: options.iconUrl ?? '',
            }, (id) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(id);
              }
            });
          });
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to create notification', e);
        }
      },
      async clear(notificationId: string): Promise<boolean> {
        try {
          return await new Promise<boolean>((resolve, reject) => {
            chrome.notifications.clear(notificationId, (wasCleared) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(wasCleared);
              }
            });
          });
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to clear notification', e);
        }
      },
      onClicked(listener): void {
        chrome.notifications.onClicked.addListener(listener);
      },
      removeOnClickedListener(listener): void {
        chrome.notifications.onClicked.removeListener(listener);
      },
    },

    incognito: {
      async isAllowed(): Promise<boolean> {
        try {
          // Check if extension is allowed in incognito
          const manifest = chrome.runtime.getManifest();
          // In MV3, incognito access is determined by the "incognito" manifest key
          // Default is "spanning" which means allowed
          return (manifest as Record<string, unknown>).incognito !== 'not_allowed';
        } catch {
          return false;
        }
      },
    },

    sidePanel: {
      async open(windowId?: number): Promise<void> {
        try {
          if (windowId !== undefined) {
            await (chrome as unknown as { sidePanel: { open: (opts: { windowId: number }) => Promise<void> } }).sidePanel.open({ windowId });
          } else {
            await (chrome as unknown as { sidePanel: { open: (opts: Record<string, never>) => Promise<void> } }).sidePanel.open({});
          }
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to open side panel', e);
        }
      },
      async setOptions(options): Promise<void> {
        try {
          await (chrome as unknown as { sidePanel: { setOptions: (opts: unknown) => Promise<void> } }).sidePanel.setOptions(options);
        } catch (e) {
          throw new AdapterError('BROWSER_API_ERROR', 'Failed to set side panel options', e);
        }
      },
      isSupported(): boolean {
        return typeof (chrome as unknown as Record<string, unknown>).sidePanel !== 'undefined';
      },
    },
  };
}
