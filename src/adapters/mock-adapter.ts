/**
 * Controllable Mock Adapter for testing.
 * Provides observable, programmable behavior for all adapter methods.
 * Tests use this instead of real browser APIs.
 */

import type {
  BrowserAdapter,
  BrowserType,
  NormalizedTab,
  NormalizedWindow,
  NormalizedCommand,
  StorageArea,
  StorageChange,
} from './contract';
import { AdapterError } from './contract';

export interface MockAdapterState {
  tabs: NormalizedTab[];
  windows: NormalizedWindow[];
  commands: NormalizedCommand[];
  syncStorage: Record<string, unknown>;
  localStorage: Record<string, unknown>;
  incognitoAllowed: boolean;
  sidePanelSupported: boolean;
  browserType: BrowserType;
  /**
   * T15: override for `commands.updateSupported()`. Omitted = derived from
   * `browserType` (firefox ⇒ true). Set it to force the unsupported path even on
   * firefox, or to model a future capability change without touching the default.
   */
  commandsUpdateSupported?: boolean;
  /** If set, next operation throws this error */
  nextError?: { code: string; message: string };
  /** If set, scripting.executeScript always throws this error (for fallback tests) */
  executeScriptError?: { code: string; message: string };
  /** If set, tabs.sendMessage always throws this error (content-script unreachable) */
  sendMessageError?: { code: string; message: string };
  /**
   * T0: directed storage-write failure injection.
   *
   * `key` omitted = every write to `area` fails; `key` set = only a write whose
   * item set contains that key fails. `remaining` omitted = persistent failure;
   * a number = fail only that many more writes, then clear.
   *
   * Throws BEFORE mutating the store or broadcasting `onChanged`, so a failed
   * write is a "clean failure" — the compensation path (T11/T16) gets an
   * unambiguous rollback baseline.
   */
  failStorageSet?: { area: StorageArea; key?: string; remaining?: number; quota?: boolean };
  /** Transient: set by `checkStorageFailure`, consumed by the throwing `set`. */
  injectedFailureWasQuota?: boolean;
}

export interface MockAdapter extends BrowserAdapter {
  state: MockAdapterState;
  /** Call log for assertions */
  calls: Array<{ method: string; args: unknown[] }>;
  /** Reset state and calls */
  reset(): void;
  /** Set tabs fixture */
  setTabs(tabs: NormalizedTab[]): void;
  /** Set windows fixture */
  setWindows(windows: NormalizedWindow[]): void;
  /** Set commands fixture */
  setCommands(commands: NormalizedCommand[]): void;
  /** Simulate storage change event */
  emitStorageChange(changes: Record<string, StorageChange>, area: string): void;
  /** Simulate tab removed event */
  emitTabRemoved(tabId: number, windowId: number): void;
  /** Simulate command event */
  emitCommand(command: string): void;
  /** Simulate tab activated event */
  emitTabActivated(tabId: number, windowId: number): void;
  /** Simulate tab updated event (e.g. status==='complete' on refresh) */
  emitTabUpdated(tabId: number, changeInfo: { url?: string; status?: string }, tab: NormalizedTab): void;
  /**
   * Dispatch a runtime message to every registered onMessage listener,
   * mirroring the browser's broadcast semantics.
   *
   * Used to prove listener uniqueness (T18): if two listeners both handle the
   * same action, the side effect fires twice.
   */
  emitRuntimeMessage(
    message: unknown,
    sender: unknown,
    sendResponse: (response?: unknown) => void,
  ): void;
  /**
   * T0: make the next `storage.set(area, …)` reject once.
   * With `key`, only a write containing that key is affected.
   */
  failNextStorageSet(area: StorageArea, key?: string): void;
  /**
   * T0: make every `storage.set(area, …)` reject until `clearStorageFailures()`
   * (or `reset()`). With `key`, only writes containing that key fail.
   */
  failStorageSet(area: StorageArea, key?: string): void;
  /**
   * T11: like `failStorageSet`, but the failure LOOKS like a quota error, which
   * `setSyncWithRetry` never retries and never escapes via local fallback — so
   * `writeSync` genuinely fails (the only honest way to exercise compensation).
   */
  failStorageSetQuota(area: StorageArea, key?: string): void;
  /** T0: drop any injected storage failures. */
  clearStorageFailures(): void;
}

export function createMockAdapter(initialState?: Partial<MockAdapterState>): MockAdapter {
  const state: MockAdapterState = {
    tabs: [],
    windows: [],
    commands: [],
    syncStorage: {},
    localStorage: {},
    incognitoAllowed: true,
    sidePanelSupported: true,
    browserType: 'chrome',
    ...initialState,
  };

  const calls: Array<{ method: string; args: unknown[] }> = [];

  const storageListeners: Array<(changes: Record<string, StorageChange>, areaName: string) => void> = [];
  const tabRemovedListeners: Array<(tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void> = [];
  const commandListeners: Array<(command: string) => void> = [];
  const tabActivatedListeners: Array<(activeInfo: { tabId: number; windowId: number }) => void> = [];
  const tabUpdatedListeners: Array<(tabId: number, changeInfo: { url?: string; status?: string }, tab: NormalizedTab) => void> = [];
  const messageListeners: Array<(message: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean | void> = [];
  const notificationClickListeners: Array<(id: string) => void> = [];
  const focusChangedListeners: Array<(windowId: number) => void> = [];

  function logCall(method: string, ...args: unknown[]) {
    calls.push({ method, args });
  }

  function checkError() {
    if (state.nextError) {
      const err = state.nextError;
      state.nextError = undefined;
      throw new AdapterError(err.code as AdapterError['code'], err.message);
    }
  }

  /**
   * T0: directed storage-write failure. Returns true when this `storage.set`
   * call must fail; decrements/clears a one-shot (`remaining`) injection.
   * Never mutates the store — callers throw before any write or broadcast.
   */
  function checkStorageFailure(area: StorageArea, items: Record<string, unknown>): boolean {
    const injection = state.failStorageSet;
    if (!injection || injection.area !== area) return false;
    if (injection.key !== undefined && !(injection.key in items)) return false;

    if (injection.remaining !== undefined) {
      injection.remaining -= 1;
      if (injection.remaining <= 0) state.failStorageSet = undefined;
    }
    // Record the quota flavour for the thrower, which clears it immediately so a
    // persistent injection keeps producing quota errors on every attempt.
    state.injectedFailureWasQuota = injection.quota === true;
    return true;
  }

  const adapter: MockAdapter = {
    state,
    calls,

    reset() {
      state.tabs = [];
      state.windows = [];
      state.commands = [];
      state.syncStorage = {};
      state.localStorage = {};
      state.incognitoAllowed = true;
      state.sidePanelSupported = true;
      state.browserType = 'chrome';
      // T15: the capability OVERRIDE must be cleared too, or a case that forced
      // it leaks into the next one (the derived default would be masked).
      state.commandsUpdateSupported = undefined;
      state.nextError = undefined;
      state.executeScriptError = undefined;
      state.sendMessageError = undefined;
      state.failStorageSet = undefined;
      calls.length = 0;
      // Clear all event listeners to prevent cross-test contamination
      storageListeners.length = 0;
      tabRemovedListeners.length = 0;
      commandListeners.length = 0;
      tabActivatedListeners.length = 0;
      tabUpdatedListeners.length = 0;
      messageListeners.length = 0;
      notificationClickListeners.length = 0;
      focusChangedListeners.length = 0;
    },

    setTabs(tabs: NormalizedTab[]) {
      state.tabs = tabs.map((t) => ({ ...t }));
    },

    setWindows(windows: NormalizedWindow[]) {
      state.windows = windows.map((w) => ({ ...w }));
    },

    setCommands(commands: NormalizedCommand[]) {
      state.commands = commands;
    },

    failNextStorageSet(area: StorageArea, key?: string) {
      state.failStorageSet = { area, key, remaining: 1 };
    },

    failStorageSet(area: StorageArea, key?: string) {
      state.failStorageSet = { area, key };
    },

    failStorageSetQuota(area: StorageArea, key?: string) {
      // A quota-shaped failure: `setSyncWithRetry` never retries and never falls
      // back to local for it, so `writeSync` genuinely fails. Needed to exercise
      // compensation for the "sync write failed" contract.
      state.failStorageSet = { area, key, quota: true };
    },

    clearStorageFailures() {
      state.failStorageSet = undefined;
    },

    emitStorageChange(changes: Record<string, StorageChange>, area: string) {
      storageListeners.forEach((l) => { l(changes, area); });
    },

    emitTabRemoved(tabId: number, windowId: number) {
      tabRemovedListeners.forEach((l) => { l(tabId, { windowId, isWindowClosing: false }); });
    },

    emitCommand(command: string) {
      commandListeners.forEach((l) => { l(command); });
    },

    emitTabActivated(tabId: number, windowId: number) {
      tabActivatedListeners.forEach((l) => { l({ tabId, windowId }); });
    },

    emitTabUpdated(tabId: number, changeInfo: { url?: string; status?: string }, tab: NormalizedTab) {
      tabUpdatedListeners.forEach((l) => { l(tabId, changeInfo, tab); });
    },

    emitRuntimeMessage(message, sender, sendResponse) {
      // Mirror the browser: every listener sees the message; listeners that
      // return true claim the async response.
      messageListeners.forEach((l) => {
        l(message, sender, sendResponse);
      });
    },

    getBrowserType: () => state.browserType,

    commands: {
      async getAll(): Promise<NormalizedCommand[]> {
        logCall('commands.getAll');
        checkError();
        return [...state.commands];
      },
      onCommand(listener) {
        commandListeners.push(listener);
      },
      removeCommandListener(listener) {
        const idx = commandListeners.indexOf(listener);
        if (idx >= 0) commandListeners.splice(idx, 1);
      },
      updateSupported(): boolean {
        return state.commandsUpdateSupported ?? state.browserType === 'firefox';
      },
      update(name, shortcut): Promise<void> {
        logCall('commands.update', name, shortcut);
        // Not `async`: the mock has no real async work, and the contract still
        // needs a REJECTED promise (not a synchronous throw) on an unsupported
        // platform, so errors are routed through `Promise.reject` explicitly.
        try {
          checkError();
          if (!(state.commandsUpdateSupported ?? state.browserType === 'firefox')) {
            throw new AdapterError('BROWSER_API_ERROR', 'commands.update is not supported on this browser');
          }
          // MDN: the UNBIND value is `""`, not `null` — map at the boundary so a
          // stored command never carries the unspecified `null`.
          const bound = shortcut ?? '';
          const idx = state.commands.findIndex((c) => c.name === name);
          if (idx >= 0) {
            state.commands[idx] = { ...state.commands[idx], shortcut: bound };
          } else {
            state.commands.push({ name, description: '', shortcut: bound });
          }
          return Promise.resolve();
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new AdapterError('BROWSER_API_ERROR', 'update failed'));
        }
      },
    },

    tabs: {
      async query(queryInfo): Promise<NormalizedTab[]> {
        logCall('tabs.query', queryInfo);
        checkError();
        let result = [...state.tabs];
        if (queryInfo.windowId !== undefined) {
          result = result.filter((t) => t.windowId === queryInfo.windowId);
        }
        if (queryInfo.active !== undefined) {
          result = result.filter((t) => t.active === queryInfo.active);
        }
        if (queryInfo.currentWindow) {
          const currentWin = state.windows.find((w) => w.focused);
          if (currentWin) {
            result = result.filter((t) => t.windowId === currentWin.id);
          }
        }
        return result;
      },
      async get(tabId: number): Promise<NormalizedTab> {
        logCall('tabs.get', tabId);
        checkError();
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab) throw new AdapterError('TAB_NOT_FOUND', `Tab ${tabId} not found`);
        return { ...tab };
      },
      async create(createProperties): Promise<NormalizedTab> {
        logCall('tabs.create', createProperties);
        checkError();
        const newTab: NormalizedTab = {
          id: Math.max(0, ...state.tabs.map((t) => t.id)) + 1,
          windowId: createProperties.windowId ?? state.windows[0]?.id ?? 1,
          index: state.tabs.length,
          url: createProperties.url ?? '',
          title: '',
          favIconUrl: '',
          active: createProperties.active ?? true,
          incognito: false,
          status: 'complete',
        };
        state.tabs.push(newTab);
        return newTab;
      },
      async update(tabId, updateProperties): Promise<NormalizedTab> {
        logCall('tabs.update', tabId, updateProperties);
        checkError();
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab) throw new AdapterError('TAB_NOT_FOUND', `Tab ${tabId} not found`);
        if (updateProperties.active !== undefined) tab.active = updateProperties.active;
        if (updateProperties.url !== undefined) tab.url = updateProperties.url;
        return { ...tab };
      },
      async remove(tabId: number): Promise<void> {
        logCall('tabs.remove', tabId);
        checkError();
        const idx = state.tabs.findIndex((t) => t.id === tabId);
        if (idx < 0) throw new AdapterError('TAB_NOT_FOUND', `Tab ${tabId} not found`);
        state.tabs.splice(idx, 1);
      },
      async sendMessage(tabId: number, message: unknown): Promise<unknown> {
        logCall('tabs.sendMessage', tabId, message);
        if (state.sendMessageError) {
          throw new AdapterError(state.sendMessageError.code as AdapterError['code'], state.sendMessageError.message);
        }
        checkError();
        return undefined;
      },
      onRemoved(listener) {
        tabRemovedListeners.push(listener);
      },
      removeOnRemovedListener(listener) {
        const idx = tabRemovedListeners.indexOf(listener);
        if (idx >= 0) tabRemovedListeners.splice(idx, 1);
      },
      onUpdated(listener) {
        tabUpdatedListeners.push(listener);
      },
      removeOnUpdatedListener(listener) {
        const idx = tabUpdatedListeners.indexOf(listener);
        if (idx >= 0) tabUpdatedListeners.splice(idx, 1);
      },
      onActivated(listener) {
        tabActivatedListeners.push(listener);
      },
      removeOnActivatedListener(listener) {
        const idx = tabActivatedListeners.indexOf(listener);
        if (idx >= 0) tabActivatedListeners.splice(idx, 1);
      },
    },

    windows: {
      async getAll(getInfo?): Promise<NormalizedWindow[]> {
        logCall('windows.getAll', getInfo);
        checkError();
        return state.windows.map((w) => ({
          ...w,
          tabs: getInfo?.populate ? state.tabs.filter((t) => t.windowId === w.id) : undefined,
        }));
      },
      async get(windowId: number): Promise<NormalizedWindow> {
        logCall('windows.get', windowId);
        checkError();
        const win = state.windows.find((w) => w.id === windowId);
        if (!win) throw new AdapterError('WINDOW_NOT_FOUND', `Window ${windowId} not found`);
        return { ...win };
      },
      async getCurrent(): Promise<NormalizedWindow> {
        logCall('windows.getCurrent');
        checkError();
        const win = state.windows.find((w) => w.focused);
        if (!win) throw new AdapterError('WINDOW_NOT_FOUND', 'No focused window');
        return { ...win };
      },
      async update(windowId, updateInfo): Promise<NormalizedWindow> {
        logCall('windows.update', windowId, updateInfo);
        checkError();
        const win = state.windows.find((w) => w.id === windowId);
        if (!win) throw new AdapterError('WINDOW_NOT_FOUND', `Window ${windowId} not found`);
        if (updateInfo.focused !== undefined) {
          state.windows.forEach((w) => { w.focused = false; });
          win.focused = updateInfo.focused;
        }
        return { ...win };
      },
      async create(createData): Promise<NormalizedWindow> {
        logCall('windows.create', createData);
        checkError();
        const newWin: NormalizedWindow = {
          id: Math.max(0, ...state.windows.map((w) => w.id)) + 1,
          focused: createData.focused ?? true,
          incognito: false,
          type: createData.type ?? 'normal',
        };
        state.windows.push(newWin);
        return newWin;
      },
      onFocusChanged(listener) {
        focusChangedListeners.push(listener);
      },
      removeOnFocusChangedListener(listener) {
        const idx = focusChangedListeners.indexOf(listener);
        if (idx >= 0) focusChangedListeners.splice(idx, 1);
      },
    },

    storage: {
      async get(area: StorageArea, keys?): Promise<Record<string, unknown>> {
        logCall('storage.get', area, keys);
        checkError();
        const store = area === 'sync' ? state.syncStorage : state.localStorage;
        if (!keys) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const k of keys) result[k] = store[k];
          return result;
        }
        return { ...keys, ...store };
      },
      async set(area: StorageArea, items: Record<string, unknown>): Promise<void> {
        logCall('storage.set', area, items);
        if (checkStorageFailure(area, items)) {
          const quota = state.injectedFailureWasQuota === true;
          state.injectedFailureWasQuota = false;
          throw new AdapterError(
            'BROWSER_API_ERROR',
            quota ? 'QUOTA_BYTES quota exceeded (injected)' : 'Injected storage.set failure',
          );
        }
        checkError();
        const store = area === 'sync' ? state.syncStorage : state.localStorage;
        const changes: Record<string, StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: store[key], newValue: value };
          store[key] = value;
        }
        storageListeners.forEach((l) => { l(changes, area); });
      },
      async remove(area: StorageArea, keys: string | string[]): Promise<void> {
        logCall('storage.remove', area, keys);
        checkError();
        const store = area === 'sync' ? state.syncStorage : state.localStorage;
        const keyArr = Array.isArray(keys) ? keys : [keys];
        keyArr.forEach((k) => { delete store[k]; });
      },
      async clear(area: StorageArea): Promise<void> {
        logCall('storage.clear', area);
        checkError();
        if (area === 'sync') state.syncStorage = {};
        else state.localStorage = {};
      },
      onChanged(listener) {
        storageListeners.push(listener);
      },
      removeOnChangedListener(listener) {
        const idx = storageListeners.indexOf(listener);
        if (idx >= 0) storageListeners.splice(idx, 1);
      },
    },

    runtime: {
      onMessage(listener) {
        messageListeners.push(listener as typeof messageListeners[number]);
      },
      removeOnMessageListener(listener) {
        const idx = messageListeners.indexOf(listener as typeof messageListeners[number]);
        if (idx >= 0) messageListeners.splice(idx, 1);
      },
      async sendMessage(message: unknown): Promise<unknown> {
        logCall('runtime.sendMessage', message);
        checkError();
        return undefined;
      },
      getURL(path: string): string {
        return `chrome-extension://mock-id/${path}`;
      },
      getManifest() {
        return { version: '1.0.0', manifest_version: 3 };
      },
      getId(): string {
        return 'mock-extension-id';
      },
    },

    scripting: {
      async executeScript(options): Promise<unknown[]> {
        logCall('scripting.executeScript', options);
        if (state.executeScriptError) {
          throw new AdapterError(state.executeScriptError.code as AdapterError['code'], state.executeScriptError.message);
        }
        checkError();
        return [];
      },
    },

    notifications: {
      async create(notificationId, options): Promise<string> {
        logCall('notifications.create', notificationId, options);
        checkError();
        return notificationId;
      },
      async clear(notificationId: string): Promise<boolean> {
        logCall('notifications.clear', notificationId);
        checkError();
        return true;
      },
      onClicked(listener) {
        notificationClickListeners.push(listener);
      },
      removeOnClickedListener(listener) {
        const idx = notificationClickListeners.indexOf(listener);
        if (idx >= 0) notificationClickListeners.splice(idx, 1);
      },
    },

    incognito: {
      async isAllowed(): Promise<boolean> {
        logCall('incognito.isAllowed');
        checkError();
        return state.incognitoAllowed;
      },
    },

    sidePanel: {
      async open(windowId?: number): Promise<void> {
        logCall('sidePanel.open', windowId);
        checkError();
        if (!state.sidePanelSupported) {
          throw new AdapterError('BROWSER_API_ERROR', 'Side panel not supported');
        }
      },
      async setOptions(options): Promise<void> {
        logCall('sidePanel.setOptions', options);
        checkError();
      },
      isSupported(): boolean {
        return state.sidePanelSupported;
      },
    },
  };

  return adapter;
}
