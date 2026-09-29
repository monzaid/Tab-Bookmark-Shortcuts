/**
 * T20 — notification `iconUrl` must never be an empty string.
 *
 * An empty `iconUrl` is rejected by some platforms, so the notification silently
 * fails to appear. The real adapter must fall back to the bundled extension icon.
 *
 * Uses the REAL `createChromeAdapter` with a stubbed global `chrome`, because
 * `mock-adapter` records the call but does not reproduce this fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChromeAdapter } from '@adapters/chrome-adapter';

type CreatedNotification = { id: string; options: Record<string, unknown> };

let created: CreatedNotification[] = [];
let getURL: ReturnType<typeof vi.fn>;

function stubChrome(): void {
  created = [];
  getURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`);

  vi.stubGlobal('chrome', {
    runtime: {
      getURL,
      lastError: undefined as { message?: string } | undefined,
      getManifest: () => ({ version: '1.0.0', manifest_version: 3 }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    notifications: {
      create: (id: string, options: Record<string, unknown>, cb?: (id: string) => void) => {
        created.push({ id, options });
        cb?.(id);
      },
      clear: (_id: string, cb?: (cleared: boolean) => void) => {
        cb?.(true);
      },
      onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
}

describe('T20 — notification iconUrl falls back to the bundled icon', () => {
  beforeEach(() => {
    stubChrome();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should substitute the bundled icon when iconUrl is an empty string', async () => {
    const adapter = createChromeAdapter('chrome');
    await adapter.notifications.create('n-empty', {
      type: 'basic',
      title: 'Title',
      message: 'Message',
      iconUrl: '',
    });

    expect(created).toHaveLength(1);
    const iconUrl = created[0].options.iconUrl as string;
    expect(iconUrl).not.toBe('');
    expect(iconUrl.startsWith('chrome-extension://')).toBe(true);
    expect(iconUrl).toContain('icons/icon-128.png');
  });

  it('should substitute the bundled icon when iconUrl is missing entirely', async () => {
    const adapter = createChromeAdapter('chrome');
    await adapter.notifications.create('n-missing', {
      type: 'basic',
      title: 'Title',
      message: 'Message',
    });

    const iconUrl = created[0].options.iconUrl as string;
    expect(iconUrl).toBe('chrome-extension://test-id/icons/icon-128.png');
  });

  it('should preserve an explicitly provided iconUrl', async () => {
    const adapter = createChromeAdapter('chrome');
    await adapter.notifications.create('n-given', {
      type: 'basic',
      title: 'Title',
      message: 'Message',
      iconUrl: 'chrome-extension://test-id/icons/custom.png',
    });

    expect(created[0].options.iconUrl).toBe('chrome-extension://test-id/icons/custom.png');
  });

  it('should still create the notification when runtime.getURL throws', async () => {
    getURL.mockImplementation(() => {
      throw new Error('getURL unavailable');
    });

    const adapter = createChromeAdapter('chrome');
    await expect(
      adapter.notifications.create('n-degraded', {
        type: 'basic',
        title: 'Title',
        message: 'Message',
        iconUrl: '',
      })
    ).resolves.toBe('n-degraded');

    expect(created).toHaveLength(1);
  });
});