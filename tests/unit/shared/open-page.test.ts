/**
 * Bug 1 (helper): openOrReusePage — pure tab-reuse logic.
 *
 * Compares URLs WITHOUT their hash/fragment. If a tab already shows the same
 * base page, activate it (and hash-navigate only when the target carries a
 * different hash). Only create a new tab when nothing matches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openOrReusePage, stripHash, type PageOpenApi } from '@shared/open-page';

function makeApi(existingTabs: Array<{ id: number; url: string }>) {
  return {
    queryAllTabs: vi.fn().mockResolvedValue(existingTabs),
    activateTab: vi.fn().mockResolvedValue(undefined),
    navigateTab: vi.fn().mockResolvedValue(undefined),
    createTab: vi.fn().mockResolvedValue(undefined),
  } satisfies PageOpenApi & {
    queryAllTabs: ReturnType<typeof vi.fn>;
    activateTab: ReturnType<typeof vi.fn>;
    navigateTab: ReturnType<typeof vi.fn>;
    createTab: ReturnType<typeof vi.fn>;
  };
}

const BASE = 'chrome-extension://abc/src/ui/settings/index.html';
const DIAG = `${BASE}#diagnostics`;

describe('Bug 1 helper: stripHash', () => {
  it('removes the fragment', () => {
    expect(stripHash(DIAG)).toBe(BASE);
    expect(stripHash(`${BASE}#a/b?c`)).toBe(BASE);
  });
  it('returns unchanged when no hash', () => {
    expect(stripHash(BASE)).toBe(BASE);
  });
});

describe('Bug 1 helper: openOrReusePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('activates the existing tab and does not create when base URL matches', async () => {
    const api = makeApi([{ id: 7, url: BASE }]);
    await openOrReusePage(api, BASE);

    expect(api.activateTab).toHaveBeenCalledTimes(1);
    expect(api.activateTab).toHaveBeenCalledWith(7);
    expect(api.createTab).not.toHaveBeenCalled();
  });

  it('treats a hash URL as the same page as its base (hash-insensitive match)', async () => {
    const api = makeApi([{ id: 7, url: BASE }]);
    await openOrReusePage(api, DIAG);

    expect(api.activateTab).toHaveBeenCalledWith(7);
    expect(api.createTab).not.toHaveBeenCalled();
  });

  it('hash-navigates when the target has a different hash than the open tab', async () => {
    const api = makeApi([{ id: 7, url: BASE }]);
    await openOrReusePage(api, DIAG);

    expect(api.navigateTab).toHaveBeenCalledTimes(1);
    expect(api.navigateTab).toHaveBeenCalledWith(7, DIAG);
    expect(api.createTab).not.toHaveBeenCalled();
  });

  it('does not navigate when the open tab already has the exact target URL', async () => {
    const api = makeApi([{ id: 7, url: DIAG }]);
    await openOrReusePage(api, DIAG);

    expect(api.navigateTab).not.toHaveBeenCalled();
    expect(api.activateTab).toHaveBeenCalledWith(7);
    expect(api.createTab).not.toHaveBeenCalled();
  });

  it('does not navigate when the target has no hash, even if the open tab has one', async () => {
    const api = makeApi([{ id: 7, url: DIAG }]);
    await openOrReusePage(api, BASE);

    expect(api.navigateTab).not.toHaveBeenCalled();
    expect(api.activateTab).toHaveBeenCalledWith(7);
    expect(api.createTab).not.toHaveBeenCalled();
  });

  it('creates a new tab when no open tab matches the base URL', async () => {
    const api = makeApi([{ id: 7, url: 'https://example.com/other' }]);
    await openOrReusePage(api, BASE);

    expect(api.createTab).toHaveBeenCalledTimes(1);
    expect(api.createTab).toHaveBeenCalledWith(BASE);
    expect(api.activateTab).not.toHaveBeenCalled();
    expect(api.navigateTab).not.toHaveBeenCalled();
  });

  it('creates a new tab when there are no open tabs at all', async () => {
    const api = makeApi([]);
    await openOrReusePage(api, DIAG);

    expect(api.createTab).toHaveBeenCalledWith(DIAG);
  });

  it('picks the first matching tab when several share the base URL', async () => {
    const api = makeApi([
      { id: 3, url: 'https://unrelated.com' },
      { id: 7, url: BASE },
      { id: 9, url: `${BASE}#other` },
    ]);
    await openOrReusePage(api, DIAG);

    expect(api.activateTab).toHaveBeenCalledWith(7);
    expect(api.createTab).not.toHaveBeenCalled();
  });
});
