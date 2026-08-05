import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { IconService, VALID_FORMATS } from '@background/icon-service';

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

    it('should resolve template source for display', async () => {
      const result = await service.resolveForDisplay({
        type: 'template',
        value: 'template-1',
        backgroundColor: '#0071e3',
        text: 'Apple',
      });
      expect(result).toContain('data:image/svg+xml');
      expect(result).toContain('0071e3');
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
});
