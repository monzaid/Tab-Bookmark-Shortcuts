/**
 * B11b (T17) — the "background unavailable" fallback must be funnelled through
 * a SINGLE named helper.
 *
 * Context: `tests/unit/ui/sidebar-open-page.test.tsx` locks the observable
 * fallback behaviour (reuse an open tab, hash-only navigation, create when
 * nothing matches). That suite is a guardrail and is NOT modified.
 *
 * What was still missing is a structural guarantee: the four `chrome.tabs.*`
 * operations used to be inlined in the `openPage` body. This suite asserts they
 * now live in exactly one place, `createChromePageOpenApi()`, so the fallback
 * cannot be silently re-duplicated later.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({}),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('B11b — sidebar fallback converges on a single helper', () => {
  it('should export createChromePageOpenApi() as the only chrome.tabs entry point', async () => {
    const mod = await import('@ui/sidebar/App');
    expect(typeof (mod as { createChromePageOpenApi?: unknown }).createChromePageOpenApi).toBe('function');
  });

  it('should build a PageOpenApi whose operations delegate to chrome.tabs', async () => {
    const { createChromePageOpenApi } = await import('@ui/sidebar/App');
    const api = createChromePageOpenApi();
    expect(api).not.toBeNull();

    await api!.queryAllTabs();
    expect(chrome.tabs.query).toHaveBeenCalledWith({});

    await api!.activateTab(5);
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true });

    await api!.navigateTab(5, 'chrome-extension://test-id/settings.html#diagnostics');
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, {
      url: 'chrome-extension://test-id/settings.html#diagnostics',
    });

    await api!.createTab('chrome-extension://test-id/settings.html');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test-id/settings.html' });
  });

  it('should return null when chrome.tabs is unavailable (fail-safe)', async () => {
    const original = (globalThis as unknown as { chrome: { tabs?: unknown } }).chrome;
    try {
      (globalThis as unknown as { chrome: { tabs?: unknown } }).chrome = { ...original, tabs: undefined };
      const { createChromePageOpenApi } = await import('@ui/sidebar/App');
      expect(createChromePageOpenApi()).toBeNull();
    } finally {
      (globalThis as unknown as { chrome: unknown }).chrome = original;
    }
  });

  it('should keep chrome.tabs.* OUT of the openPage body (main path is message-only)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/ui/sidebar/App.tsx'), 'utf-8');

    // Extract the openPage callback body and assert it holds no direct chrome.tabs call.
    const start = source.indexOf('const openPage = useCallback');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('}, []);', start);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    expect(body).not.toMatch(/chrome\.tabs\.(query|update|create)/);
    expect(body).not.toMatch(/chrome\.windows\./);
    // The main path must still be the OPEN_PAGE message
    expect(body).toContain("sendMessage('OPEN_PAGE'");
    // ...and the fallback must go through the shared reuse logic + the helper
    expect(body).toContain('openOrReusePage');
    expect(body).toContain('createChromePageOpenApi');
  });
});