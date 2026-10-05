import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { IconService, VALID_FORMATS, type IconProcessResult } from '@background/icon-service';
import type { RecipeRenderer } from '@background/recipe-renderer';

describe('T12: Icon processing — URL/upload/template and local cache', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: IconService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new IconService(repo);
  });

  describe('Happy path — valid icons and caching', () => {
    it('should validate a valid PNG upload', () => {
      const result = service.validateUpload({
        type: 'image/png',
        size: 1024 * 100, // 100KB
        width: 256,
        height: 256,
      });
      expect(result.valid).toBe(true);
    });

    it('should validate all supported formats', () => {
      for (const format of VALID_FORMATS) {
        const result = service.validateUpload({ type: format, size: 1024 });
        expect(result.valid).toBe(true);
      }
    });

    it('should process upload and cache locally', async () => {
      const dataUri = 'data:image/png;base64,abc123';
      const result = await service.processUpload(dataUri, 'icon-test-1', {
        type: 'image/png',
        size: 1024,
        width: 64,
        height: 64,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.dataUri).toBe(dataUri);
        expect(result.cacheKey).toBe('icon-test-1');
      }

      // Verify cached
      const cached = await service.getCachedIcon('icon-test-1');
      expect(cached).toBe(dataUri);
    });

    it('should return cached icon without remote request', async () => {
      await repo.setIconCache('icon-cached', 'data:image/webp;base64,xyz');

      const result = await service.getCachedIcon('icon-cached');
      expect(result).toBe('data:image/webp;base64,xyz');

      // No fetch calls
      const fetchCalls = adapter.calls.filter((c) => c.method.includes('fetch'));
      expect(fetchCalls).toHaveLength(0);
    });

    it('should generate template icon with background and text', () => {
      const dataUri = service.generateTemplateIcon('#ff5733', 'GitHub');
      expect(dataUri).toContain('data:image/svg+xml');
      expect(dataUri).toContain('ff5733');
      expect(dataUri).toContain('G'); // First letter
    });

    it('T12/R1: resolves a template source to a PNG (single renderer), not SVG', async () => {
      // R1 changed this branch: the recipe now renders to `data:image/png` via
      // the background `OffscreenCanvas` renderer. jsdom has no OffscreenCanvas,
      // so the injected stub supplies the PNG; the value must NOT be svg+xml
      // (the page-side delivery gate drops svg+xml — the latent defect).
      const svc = new IconService(repo, {
        renderToPng: () => Promise.resolve('data:image/png;base64,STUB'),
      } as unknown as RecipeRenderer);
      const result = await svc.resolveForDisplay({
        type: 'template',
        value: '',
        backgroundColor: '#0071e3',
        text: 'Apple',
      });
      expect(result.startsWith('data:image/png')).toBe(true);
      expect(result).not.toContain('svg+xml');
    });

    it('T12/R1: template render failure degrades to the placeholder, never throws', async () => {
      const svc = new IconService(repo, {
        renderToPng: (_r: unknown, fallback: () => string) => Promise.resolve(fallback()),
      } as unknown as RecipeRenderer);
      const result = await svc.resolveForDisplay({ type: 'template', value: '', text: 'X' });
      expect(result).toContain('data:image/svg+xml'); // the EXISTING static placeholder
      expect(result).toContain('e0e0e0');
    });

    it('should return placeholder for uncached url/upload source', async () => {
      const result = await service.resolveForDisplay({
        type: 'url',
        value: 'https://example.com/icon.png',
      });
      // Should be placeholder, NOT trigger download
      expect(result).toContain('data:image/svg+xml');
      expect(result).toContain('e0e0e0'); // placeholder gray
    });

    it('should return placeholder for undefined source', async () => {
      const result = await service.resolveForDisplay(undefined);
      expect(result).toContain('data:image/svg+xml');
    });
  });

  describe('Error path — size/format/download failures', () => {
    it('should reject files exceeding 2MB', () => {
      const result = service.validateUpload({
        type: 'image/png',
        size: 3 * 1024 * 1024, // 3MB
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('ICON_TOO_LARGE');
    });

    it('should reject files exceeding 512px dimension', () => {
      const result = service.validateUpload({
        type: 'image/jpeg',
        size: 1024,
        width: 1024,
        height: 200,
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('ICON_TOO_LARGE');
    });

    it('should reject invalid formats', () => {
      const result = service.validateUpload({
        type: 'image/gif',
        size: 1024,
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('ICON_INVALID_FORMAT');
    });

    it('should handle download failure gracefully', async () => {
      // Mock fetch to fail
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await service.downloadAndCache('https://example.com/icon.png', 'icon-fail');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('ICON_DOWNLOAD_FAILED');
        expect(result.message).toContain('retry manually');
      }

      vi.unstubAllGlobals();
    });

    it('should not auto-retry after download failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      await service.downloadAndCache('https://example.com/icon.png', 'icon-noretry');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // No automatic second attempt
      await new Promise((r) => setTimeout(r, 100));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });

    it('should return cached result on repeated download attempt', async () => {
      // Pre-cache
      await repo.setIconCache('icon-existing', 'data:image/png;base64,cached');

      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.downloadAndCache('https://example.com/icon.png', 'icon-existing');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.dataUri).toBe('data:image/png;base64,cached');
      }

      // Should NOT have called fetch since already cached
      expect(mockFetch).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('should not sync/export data URIs (local only)', async () => {
      await repo.setIconCache('icon-local', 'data:image/png;base64,local-only');

      // Verify it's in local state
      const local = await repo.getLocalState();
      expect(local.iconCache['icon-local']).toBeDefined();

      // Verify sync state does NOT contain icon data
      const sync = await repo.getSyncState();
      expect(JSON.stringify(sync)).not.toContain('data:image');
    });
  });

  // ─── B8 (T8): SSRF / protocol / timeout / oversize hardening ─────────────
  describe('B8 — network boundary hardening', () => {
    it('should reject loopback and private-network hosts without any fetch', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const blocked = [
        'http://127.0.0.1/icon.png',
        'http://127.1.2.3/icon.png',
        'http://localhost/icon.png',
        'http://10.0.0.5/icon.png',
        'http://172.16.3.4/icon.png',
        'http://192.168.1.5/icon.png',
        'http://169.254.1.1/icon.png',
        'http://[::1]/icon.png',
      ];

      for (const url of blocked) {
        const result = await service.downloadAndCache(url, `blocked-${url}`);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.errorCode).toBe('ICON_DOWNLOAD_FAILED');
        }
      }

      // The SSRF surface must be closed BEFORE any network call
      expect(mockFetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('T27 (B8-4/5): should reject IPv4-mapped IPv6, .local and metadata hosts', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const blocked = [
        // IPv4-mapped IPv6 in dotted form
        'http://[::ffff:127.0.0.1]/icon.png',
        'http://[::ffff:169.254.169.254]/icon.png',
        'http://[::ffff:192.168.1.1]/icon.png',
        // IPv4-mapped IPv6 in hexadecimal form
        'http://[::ffff:7f00:1]/icon.png',
        'http://[::ffff:a9fe:a9fe]/icon.png',
        'http://[::ffff:c0a8:1]/icon.png',
        // IPv6 link-local full fe80::/10 range and site-local fec0::/10
        'http://[feb0::1]/icon.png',
        'http://[fec0::1]/icon.png',
        // mDNS
        'http://printer.local/icon.png',
        // Cloud metadata services
        'http://metadata.azure.com/icon.png',
        'http://100.100.100.200/icon.png',
        'http://168.63.129.16/icon.png',
      ];

      for (const url of blocked) {
        const result = await service.downloadAndCache(url, `t27-${url}`);
        expect(result.success, `expected ${url} to be blocked`).toBe(false);
        if (!result.success) {
          expect(result.errorCode).toBe('ICON_DOWNLOAD_FAILED');
        }
      }

      expect(mockFetch, 'SSRF surface must be closed before any fetch').not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('T35 (B8-9): should reject v4-translated and NAT64 addresses', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const blocked = [
        // IPv4-translated ::ffff:0:a.b.c.d (parser normalises to ::ffff:0:7f00:1)
        'http://[::ffff:0:127.0.0.1]/icon.png',
        'http://[::ffff:0:169.254.169.254]/icon.png',
        // NAT64 well-known prefix 64:ff9b::/96, hex and dotted forms
        'http://[64:ff9b::7f00:1]/icon.png',
        'http://[64:ff9b::127.0.0.1]/icon.png',
        'http://[64:ff9b::a9fe:a9fe]/icon.png',
      ];

      for (const url of blocked) {
        const result = await service.downloadAndCache(url, `t35-${url}`);
        expect(result.success, `expected ${url} to be blocked`).toBe(false);
        if (!result.success) {
          expect(result.errorCode).toBe('ICON_DOWNLOAD_FAILED');
        }
      }

      expect(mockFetch, 'SSRF surface must be closed before any fetch').not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('T35 (B8-9): must NOT over-block public IPv6 addresses', async () => {
      const pngBlob = () =>
        Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://cdn.example.com/icon.png',
        headers: { get: () => null },
        blob: pngBlob,
      });
      vi.stubGlobal('fetch', mockFetch);

      for (const url of [
        'http://[2606:4700::1111]/icon.png', // Cloudflare public
        'http://[2001:4860:4860::8888]/icon.png', // Google public DNS
      ]) {
        const result = await service.downloadAndCache(url, `t35-public-${url}`);
        expect(result.success, `public IPv6 ${url} must NOT be blocked`).toBe(true);
      }
      vi.unstubAllGlobals();
    });

    it('T35 (B8-9): a redirect to a NAT64/v4-translated host must be rejected', async () => {
      const pngBlob = () =>
        Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'http://[::ffff:0:7f00:1]/icon.png',
        headers: { get: () => null },
        blob: pngBlob,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.downloadAndCache('https://cdn.example.com/redir.png', 't35-redirect');
      expect(result.success, 'redirect to a v4-translated host must be rejected').toBe(false);
      expect((await repo.getLocalState()).iconCache['t35-redirect']).toBeUndefined();
      vi.unstubAllGlobals();
    });

    it('T28 (B8-6): should reject a redirect that lands on a private host', async () => {
      // Simulate what a browser actually does with `redirect: 'follow'`: the
      // request URL looks public, but the response we receive came from a
      // private host (`response.url` is the final hop). The pre-flight check
      // cannot see this, so the response URL must be re-validated.
      const pngBlob = () =>
        Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'http://127.0.0.1/secret.png',
        headers: { get: () => null },
        blob: pngBlob,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.downloadAndCache('https://cdn.example.com/redirect.png', 't28-redirect');
      expect(result.success, 'a redirect landing on a private host must be rejected').toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('ICON_DOWNLOAD_FAILED');
      }
      // Nothing from the private host may be cached.
      const local = await repo.getLocalState();
      expect(local.iconCache['t28-redirect']).toBeUndefined();
      vi.unstubAllGlobals();
    });

    it('should reject non-http(s) protocols without any fetch', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      for (const url of ['file:///etc/passwd', 'ftp://example.com/i.png', 'ws://example.com/i.png', 'not-a-url']) {
        const result = await service.downloadAndCache(url, `proto-${url}`);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.errorCode).toBe('ICON_DOWNLOAD_FAILED');
        }
      }

      expect(mockFetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('should still allow a public https host', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.downloadAndCache('https://cdn.example.com/icon.png', 'icon-public');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it('should abort a hanging request after the timeout and fail safely', async () => {
      vi.useFakeTimers();
      try {
        // fetch that never settles unless the abort signal fires
        const mockFetch = vi.fn(
          (_url: string, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        );
        vi.stubGlobal('fetch', mockFetch);

        // Deliberately NOT awaited directly: on unfixed code the request hangs
        // forever, which would stall the whole suite instead of failing.
        let settled: IconProcessResult | null = null;
        void service
          .downloadAndCache('https://slow.example.com/icon.png', 'icon-slow')
          .then((r) => {
            settled = r;
          })
          .catch(() => {
            settled = { success: false, errorCode: 'ICON_DOWNLOAD_FAILED', message: 'threw' };
          });

        // Advance past the 8s timeout and let the abort propagate
        await vi.advanceTimersByTimeAsync(8_100);
        await vi.advanceTimersByTimeAsync(0);

        // A timeout must NOT hang the service worker forever
        expect(settled).not.toBeNull();
        expect((settled as unknown as IconProcessResult).success).toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    });

    it('should reject an oversize response without reading the whole body', async () => {
      const blobSpy = vi.fn().mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/png' }));
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(5 * 1024 * 1024) : null) },
        blob: blobSpy,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.downloadAndCache('https://cdn.example.com/huge.png', 'icon-huge');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('ICON_TOO_LARGE');
      }
      // Must short-circuit on Content-Length, not download 5MB first
      expect(blobSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('should pass an abort signal to fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.downloadAndCache('https://cdn.example.com/sig.png', 'icon-signal');
      const init = mockFetch.mock.calls[0][1] as { signal?: AbortSignal };
      expect(init.signal).toBeInstanceOf(AbortSignal);
      vi.unstubAllGlobals();
    });
  });
});
