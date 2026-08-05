import '@testing-library/jest-dom';

// WebExtensions API mock setup
const createStorageMock = () => {
  let store: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void> = [];

  return {
    sync: {
      get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
        if (!keys) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const k of keys) result[k] = store[k];
          return result;
        }
        return { ...keys, ...store };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: store[key], newValue: value };
          store[key] = value;
        }
        listeners.forEach((l) => l(changes, 'sync'));
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        keyArr.forEach((k) => delete store[k]);
      }),
      clear: vi.fn(async () => {
        store = {};
      }),
    },
    local: {
      get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
        if (!keys) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const k of keys) result[k] = store[k];
          return result;
        }
        return { ...keys, ...store };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: store[key], newValue: value };
          store[key] = value;
        }
        listeners.forEach((l) => l(changes, 'local'));
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        keyArr.forEach((k) => delete store[k]);
      }),
      clear: vi.fn(async () => {
        store = {};
      }),
    },
    onChanged: {
      addListener: vi.fn((listener: typeof listeners[number]) => {
        listeners.push(listener);
      }),
      removeListener: vi.fn((listener: typeof listeners[number]) => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
    },
    __reset: () => {
      store = {};
      listeners.length = 0;
    },
    __getStore: () => store,
  };
};

const createTabsMock = () => ({
  query: vi.fn(async () => []),
  get: vi.fn(async () => ({})),
  create: vi.fn(async () => ({ id: 1 })),
  update: vi.fn(async () => ({})),
  remove: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
  onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
});

const createWindowsMock = () => ({
  getAll: vi.fn(async () => []),
  get: vi.fn(async () => ({})),
  getCurrent: vi.fn(async () => ({ id: 1 })),
  update: vi.fn(async () => ({})),
  create: vi.fn(async () => ({ id: 2 })),
  onFocusChanged: { addListener: vi.fn(), removeListener: vi.fn() },
});

const createCommandsMock = () => ({
  getAll: vi.fn(async () => []),
  onCommand: { addListener: vi.fn(), removeListener: vi.fn() },
});

const createRuntimeMock = () => ({
  onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  sendMessage: vi.fn(async () => undefined),
  getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
  getManifest: vi.fn(() => ({ version: '1.0.0', manifest_version: 3 })),
  lastError: null as { message?: string } | null,
  id: 'test-extension-id',
});

const createNotificationsMock = () => ({
  create: vi.fn(async () => 'notification-id'),
  clear: vi.fn(async () => true),
  onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
});

const createSidePanelMock = () => ({
  open: vi.fn(async () => undefined),
  setOptions: vi.fn(async () => undefined),
  getOptions: vi.fn(async () => ({})),
});

const chromeMock = {
  storage: createStorageMock(),
  tabs: createTabsMock(),
  windows: createWindowsMock(),
  commands: createCommandsMock(),
  runtime: createRuntimeMock(),
  notifications: createNotificationsMock(),
  sidePanel: createSidePanelMock(),
  scripting: {
    executeScript: vi.fn(async () => []),
  },
};

// Assign to global
Object.assign(globalThis, { chrome: chromeMock });

// Helper to reset all mocks between tests
export const resetBrowserMocks = () => {
  chromeMock.storage.__reset();
  vi.clearAllMocks();
};
