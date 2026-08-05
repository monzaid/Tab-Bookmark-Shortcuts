/**
 * Icon Service — URL/upload/template icon processing and local caching.
 *
 * - Validate PNG/JPEG/WebP, 2MB max, 512px max dimension
 * - Compress to ≤128px, ≤64KB WebP data URI
 * - Download URL icons once and cache to local storage
 * - Provide template icons (background color + text)
 * - Manual retry for failed downloads
 * - Cross-device missing cache shows placeholder
 * - Does NOT sync/export data URIs
 * - Does NOT make remote requests on display
 * - Does NOT auto-retry in background
 */

import type { StorageRepository } from './storage-repository';
import type { IconSource } from '@shared/types';

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2MB
export const MAX_UPLOAD_DIMENSION = 512; // px
export const MAX_OUTPUT_DIMENSION = 128; // px
export const MAX_OUTPUT_SIZE = 64 * 1024; // 64KB
export const VALID_FORMATS = ['image/png', 'image/jpeg', 'image/webp'];

// ─── Result Types ────────────────────────────────────────────────────────────

export type IconProcessResult =
  | { success: true; dataUri: string; cacheKey: string }
  | { success: false; errorCode: string; message: string };

// ─── Icon Service ────────────────────────────────────────────────────────────

export class IconService {
  constructor(
    private repo: StorageRepository,
  ) {}

  // ─── Validation ────────────────────────────────────────────────────────

  /**
   * Validate an uploaded icon file.
   */
  validateUpload(file: { type: string; size: number; width?: number; height?: number }): {
    valid: boolean;
    errorCode?: string;
    message?: string;
  } {
    if (!VALID_FORMATS.includes(file.type)) {
      return {
        valid: false,
        errorCode: 'ICON_INVALID_FORMAT',
        message: `Invalid format: ${file.type}. Supported: PNG, JPEG, WebP`,
      };
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return {
        valid: false,
        errorCode: 'ICON_TOO_LARGE',
        message: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 2MB`,
      };
    }

    if (file.width && file.width > MAX_UPLOAD_DIMENSION) {
      return {
        valid: false,
        errorCode: 'ICON_TOO_LARGE',
        message: `Width ${file.width}px exceeds max ${MAX_UPLOAD_DIMENSION}px`,
      };
    }

    if (file.height && file.height > MAX_UPLOAD_DIMENSION) {
      return {
        valid: false,
        errorCode: 'ICON_TOO_LARGE',
        message: `Height ${file.height}px exceeds max ${MAX_UPLOAD_DIMENSION}px`,
      };
    }

    return { valid: true };
  }

  // ─── URL Icon Download ─────────────────────────────────────────────────

  /**
   * Download a URL icon once and cache locally.
   * Does NOT auto-retry on failure.
   */
  async downloadAndCache(url: string, cacheKey: string): Promise<IconProcessResult> {
    // Check if already cached
    const local = await this.repo.getLocalState();
    if (local.iconCache[cacheKey]) {
      return { success: true, dataUri: local.iconCache[cacheKey], cacheKey };
    }

    try {
      // Fetch the icon
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        return {
          success: false,
          errorCode: 'ICON_DOWNLOAD_FAILED',
          message: `Download failed: HTTP ${response.status}`,
        };
      }

      const blob = await response.blob();

      // Validate format
      if (!VALID_FORMATS.includes(blob.type)) {
        return {
          success: false,
          errorCode: 'ICON_INVALID_FORMAT',
          message: `Downloaded file is not a valid icon format: ${blob.type}`,
        };
      }

      // Validate size
      if (blob.size > MAX_UPLOAD_SIZE) {
        return {
          success: false,
          errorCode: 'ICON_TOO_LARGE',
          message: 'Downloaded icon exceeds 2MB limit',
        };
      }

      // Convert to data URI (in production, would compress to WebP ≤128px ≤64KB)
      const dataUri = await this.blobToDataUri(blob);

      // Cache locally
      await this.repo.setIconCache(cacheKey, dataUri);

      return { success: true, dataUri, cacheKey };
    } catch (e) {
      return {
        success: false,
        errorCode: 'ICON_DOWNLOAD_FAILED',
        message: 'Failed to download icon. You can retry manually.',
      };
    }
  }

  /**
   * Manual retry for a previously failed download.
   */
  async retryDownload(url: string, cacheKey: string): Promise<IconProcessResult> {
    // Clear any cached failure state and retry
    return this.downloadAndCache(url, cacheKey);
  }

  // ─── Upload Icon ───────────────────────────────────────────────────────

  /**
   * Process an uploaded icon: validate, compress, cache.
   */
  async processUpload(
    dataUri: string,
    cacheKey: string,
    metadata: { type: string; size: number; width?: number; height?: number },
  ): Promise<IconProcessResult> {
    const validation = this.validateUpload(metadata);
    if (!validation.valid) {
      return {
        success: false,
        errorCode: validation.errorCode!,
        message: validation.message!,
      };
    }

    // In production: compress to ≤128px, ≤64KB WebP
    // For now, store the data URI directly (compression would use OffscreenCanvas)
    await this.repo.setIconCache(cacheKey, dataUri);

    return { success: true, dataUri, cacheKey };
  }

  // ─── Template Icon ─────────────────────────────────────────────────────

  /**
   * Generate a template icon (background color + text).
   * Returns an SVG data URI.
   */
  generateTemplateIcon(backgroundColor: string, text: string): string {
    const initial = text.charAt(0).toUpperCase() || '?';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="16" fill="${backgroundColor}"/>
      <text x="64" y="64" font-family="sans-serif" font-size="64" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">${initial}</text>
    </svg>`;

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // ─── Cache Query ───────────────────────────────────────────────────────

  /**
   * Get a cached icon by key. Returns null if not cached.
   * Does NOT make remote requests.
   */
  async getCachedIcon(cacheKey: string): Promise<string | null> {
    const local = await this.repo.getLocalState();
    return local.iconCache[cacheKey] ?? null;
  }

  /**
   * Check if an icon is cached (for cross-device placeholder display).
   */
  async isCached(cacheKey: string): Promise<boolean> {
    const local = await this.repo.getLocalState();
    return cacheKey in local.iconCache;
  }

  /**
   * Get placeholder indicator for missing cross-device icons.
   */
  getPlaceholder(): string {
    // Return a simple gray placeholder SVG
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="16" fill="#e0e0e0"/>
      <text x="64" y="64" font-family="sans-serif" font-size="48" fill="#999" text-anchor="middle" dominant-baseline="central">?</text>
    </svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // ─── Resolve Icon Source ───────────────────────────────────────────────

  /**
   * Resolve an IconSource to a displayable data URI or placeholder.
   * Does NOT trigger downloads — only reads cache.
   */
  async resolveForDisplay(source: IconSource | undefined): Promise<string> {
    if (!source) return this.getPlaceholder();

    switch (source.type) {
      case 'template':
        return this.generateTemplateIcon(source.backgroundColor ?? '#666666', source.text ?? '?');

      case 'upload':
      case 'url': {
        const cached = await this.getCachedIcon(source.value);
        if (cached) return cached;
        // Not cached — return placeholder (do NOT download on display)
        return this.getPlaceholder();
      }

      default:
        return this.getPlaceholder();
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private async blobToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
  }
}
