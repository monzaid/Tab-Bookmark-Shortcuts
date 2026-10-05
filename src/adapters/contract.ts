/**
 * WebExtensions Adapter Contract
 *
 * Minimal abstraction over browser extension APIs.
 * All browser differences are confined to this layer.
 * Business logic and UI MUST NOT reference chrome/browser globals directly.
 *
 * Supported APIs:
 * - commands: getAll, onCommand
 * - tabs: query, get, create, update, remove, sendMessage, onRemoved, onUpdated, onActivated
 * - windows: getAll, get, getCurrent, update, create, onFocusChanged
 * - storage: sync/local get/set/remove/clear, onChanged
 * - runtime: onMessage, sendMessage, getURL, getManifest, lastError, id
 * - scripting: executeScript
 * - notifications: create, clear, onClicked
 * - incognito: isAllowed
 * - sidePanel/sidebar: open, setOptions (Chromium), sidebar_action (Firefox)
 * - browser detection: getBrowserType
 */

import type { DomainErrorCode } from '@shared/types';

// ─── Browser Type ────────────────────────────────────────────────────────────

export type BrowserType = 'chrome' | 'edge' | 'firefox';

// ─── Normalized Types ────────────────────────────────────────────────────────

export interface NormalizedTab {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl: string;
  active: boolean;
  incognito: boolean;
  status: string;
}

export interface NormalizedWindow {
  id: number;
  focused: boolean;
  incognito: boolean;
  type: string;
  tabs?: NormalizedTab[];
}

export interface NormalizedCommand {
  name: string;
  description: string;
  shortcut: string | null;
}

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageArea = 'sync' | 'local';

// ─── Adapter Error ───────────────────────────────────────────────────────────

export class AdapterError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

// ─── Adapter Interface ───────────────────────────────────────────────────────

export interface BrowserAdapter {
  // Browser detection
  getBrowserType(): BrowserType;

  // Commands
  commands: {
    getAll(): Promise<NormalizedCommand[]>;
    onCommand(listener: (command: string) => void): void;
    removeCommandListener(listener: (command: string) => void): void;
    /**
     * T15 / D4: whether `update` can actually execute here (Firefox). Chrome and
     * Edge have no `commands.update`, so the shortcut dimension is read-only
     * there — the UI branches on this probe rather than on a rejection, because
     * an unsupported platform is a guidance case, NEVER an import failure.
     */
    updateSupported(): boolean;
    /** T15: WebExtensions `commands.update`; `null`/empty unbinds the shortcut. */
    update(name: string, shortcut: string | null): Promise<void>;
  };

  // Tabs
  tabs: {
    query(queryInfo: {
      windowId?: number;
      active?: boolean;
      currentWindow?: boolean;
      url?: string;
    }): Promise<NormalizedTab[]>;
    get(tabId: number): Promise<NormalizedTab>;
    create(createProperties: { url?: string; windowId?: number; active?: boolean }): Promise<NormalizedTab>;
    update(tabId: number, updateProperties: { active?: boolean; url?: string }): Promise<NormalizedTab>;
    remove(tabId: number): Promise<void>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    onRemoved(listener: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void): void;
    removeOnRemovedListener(listener: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void): void;
    onUpdated(listener: (tabId: number, changeInfo: { url?: string; status?: string }, tab: NormalizedTab) => void): void;
    removeOnUpdatedListener(listener: (tabId: number, changeInfo: { url?: string; status?: string }, tab: NormalizedTab) => void): void;
    onActivated(listener: (activeInfo: { tabId: number; windowId: number }) => void): void;
    removeOnActivatedListener(listener: (activeInfo: { tabId: number; windowId: number }) => void): void;
  };

  // Windows
  windows: {
    getAll(getInfo?: { populate?: boolean }): Promise<NormalizedWindow[]>;
    get(windowId: number): Promise<NormalizedWindow>;
    getCurrent(): Promise<NormalizedWindow>;
    update(windowId: number, updateInfo: { focused?: boolean }): Promise<NormalizedWindow>;
    create(createData: { url?: string; type?: string; width?: number; height?: number; focused?: boolean }): Promise<NormalizedWindow>;
    onFocusChanged(listener: (windowId: number) => void): void;
    removeOnFocusChangedListener(listener: (windowId: number) => void): void;
  };

  // Storage
  storage: {
    get(area: StorageArea, keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
    set(area: StorageArea, items: Record<string, unknown>): Promise<void>;
    remove(area: StorageArea, keys: string | string[]): Promise<void>;
    clear(area: StorageArea): Promise<void>;
    onChanged(listener: (changes: Record<string, StorageChange>, areaName: string) => void): void;
    removeOnChangedListener(listener: (changes: Record<string, StorageChange>, areaName: string) => void): void;
  };

  // Runtime messaging
  runtime: {
    onMessage(listener: (message: unknown, sender: { tab?: { id?: number; url?: string } }, sendResponse: (response?: unknown) => void) => boolean | void): void;
    removeOnMessageListener(listener: (message: unknown, sender: { tab?: { id?: number; url?: string } }, sendResponse: (response?: unknown) => void) => boolean | void): void;
    sendMessage(message: unknown): Promise<unknown>;
    getURL(path: string): string;
    getManifest(): { version: string; manifest_version: number };
    getId(): string;
  };

  // Scripting
  scripting: {
    executeScript(options: {
      target: { tabId: number };
      func: (...args: unknown[]) => unknown;
      args?: unknown[];
    }): Promise<unknown[]>;
  };

  // Notifications
  notifications: {
    create(notificationId: string, options: {
      type: string;
      title: string;
      message: string;
      iconUrl?: string;
    }): Promise<string>;
    clear(notificationId: string): Promise<boolean>;
    onClicked(listener: (notificationId: string) => void): void;
    removeOnClickedListener(listener: (notificationId: string) => void): void;
  };

  // Incognito
  incognito: {
    isAllowed(): Promise<boolean>;
  };

  // Side panel / Sidebar
  sidePanel: {
    open(windowId?: number): Promise<void>;
    setOptions(options: { path?: string; enabled?: boolean }): Promise<void>;
    isSupported(): boolean;
  };
}

// ─── Browser Detection ───────────────────────────────────────────────────────

export function detectBrowserType(): BrowserType {
  const g = globalThis as Record<string, unknown>;
  const browserNs = g.browser as Record<string, unknown> | undefined;
  const chromeNs = g.chrome as Record<string, unknown> | undefined;

  // ── Primary judgement: API shape ──────────────────────────────────────────
  // Capability presence cannot be spoofed by a user-agent string, and it does
  // not drift as browser version numbers change. `sidebarAction` is the
  // Firefox-only surface; `sidePanel` is the Chromium-only one.
  const hasSidebarAction =
    (browserNs?.sidebarAction as Record<string, unknown> | undefined) !== undefined ||
    (chromeNs?.sidebarAction as Record<string, unknown> | undefined) !== undefined;
  const hasSidePanel =
    (chromeNs?.sidePanel as Record<string, unknown> | undefined) !== undefined ||
    (browserNs?.sidePanel as Record<string, unknown> | undefined) !== undefined;

  if (hasSidebarAction && !hasSidePanel) return 'firefox';

  if (hasSidePanel) {
    // Edge exposes `chrome.sidePanel` too; it is distinguished from Chrome by
    // its UA token, but the API shape alone still proves the Chromium family.
    if (typeof navigator !== 'undefined' && /edg\//.test(navigator.userAgent.toLowerCase())) {
      return 'edge';
    }
    return 'chrome';
  }

  // ── Fallback: user-agent (only when no API shape is recognisable) ─────────
  if (hasSidebarAction) return 'firefox';

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('edg/') || ua.includes('edge/')) return 'edge';
    if (ua.includes('firefox/') || ua.includes('fxios/')) return 'firefox';
  }

  return 'chrome';
}
