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
import { RecipeRenderer } from './recipe-renderer';
import type { IconSource } from '@shared/types';

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2MB
export const MAX_UPLOAD_DIMENSION = 512; // px
export const MAX_OUTPUT_DIMENSION = 128; // px
export const MAX_OUTPUT_SIZE = 64 * 1024; // 64KB
export const VALID_FORMATS = ['image/png', 'image/jpeg', 'image/webp'];

/** B8: hard ceiling on how long a remote icon fetch may block the service worker. */
export const ICON_FETCH_TIMEOUT_MS = 8_000;
/** B8: protocols permitted for remote icon downloads (everything else is denied). */
const ALLOWED_FETCH_PROTOCOLS = ['http:', 'https:'];

/** B8: hosts that serve cloud instance metadata and must never be fetched. */
const METADATA_HOSTS = new Set([
  'metadata.azure.com',
  'metadata.google.internal',
  '100.100.100.200',
  '168.63.129.16',
]);

/** B8: RFC 1918 / loopback / link-local / unspecified check for dotted IPv4. */
function isPrivateIpv4(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;

  const octets = v4.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = octets;

  if (a === 0) return true; // "this network" / unspecified
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  return false;
}

/** Turn the two 16-bit halves of an embedded IPv4 into dotted-quad form. */
function hextetsToIpv4(highHextet: string, lowHextet: string): string {
  const high = parseInt(highHextet, 16);
  const low = parseInt(lowHextet, 16);
  return [String((high >> 8) & 0xff), String(high & 0xff), String((low >> 8) & 0xff), String(low & 0xff)].join('.');
}

/**
 * B8: recover the embedded IPv4 from an IPv6 address that carries one.
 *
 * Three forms embed an IPv4 and all three reach the same host, so all three must
 * be normalised before the IPv4 deny rules run (T35 — the v4-translated and
 * NAT64 variants previously slipped straight through the SSRF guard):
 *
 * 1. IPv4-mapped `::ffff:a.b.c.d` / `::ffff:aabb:ccdd`
 * 2. IPv4-translated `::ffff:0:a.b.c.d` / `::ffff:0:aabb:ccdd`
 * 3. NAT64 well-known prefix `64:ff9b::a.b.c.d` / `64:ff9b::aabb:ccdd`
 */
function extractMappedIpv4(host: string): string | null {
  const dotted = /^(?:::ffff:|::ffff:0:|64:ff9b::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (dotted) return dotted[1];

  const hex = /^(?:::ffff:|::ffff:0:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex) return hextetsToIpv4(hex[1], hex[2]);

  return null;
}

/**
 * B8: detect loopback / link-local / private-network / metadata hosts (SSRF defence).
 * Hand-written — no `is-ip` / `ipaddr.js` dependency is permitted.
 */
function isPrivateOrLoopbackHost(hostname: string): boolean {
  // Strip the URL bracket form and a trailing FQDN dot.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // mDNS names resolve on the local network.
  if (host.endsWith('.local')) return true;

  // Cloud metadata services.
  if (METADATA_HOSTS.has(host)) return true;

  // IPv4-mapped IPv6 must be judged by the IPv4 it embeds.
  const mapped = extractMappedIpv4(host);
  if (mapped) return isPrivateIpv4(mapped);

  // IPv6 loopback / unspecified.
  if (host === '::1' || host === '::') return true;

  // Compare the first hextet numerically so whole /10 blocks are covered — a
  // literal `fe80:` prefix test misses fe90::–febf:: entirely.
  const firstHextet = /^([0-9a-f]{1,4}):/.exec(host);
  if (firstHextet) {
    const value = parseInt(firstHextet[1], 16);
    if (value >= 0xfe80 && value <= 0xfebf) return true; // fe80::/10 link-local
    if (value >= 0xfec0 && value <= 0xfeff) return true; // fec0::/10 site-local
    if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  }

  return isPrivateIpv4(host);
}

/**
 * B8: returns `null` when the URL is safe to fetch, or a failure result.
 * Enforced BEFORE any network call so the SSRF surface stays closed.
 */
function rejectUnsafeFetchUrl(url: string): { success: false; errorCode: string; message: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      success: false,
      errorCode: 'ICON_DOWNLOAD_FAILED',
      message: 'Invalid icon URL. You can retry manually.',
    };
  }

  if (!ALLOWED_FETCH_PROTOCOLS.includes(parsed.protocol)) {
    return {
      success: false,
      errorCode: 'ICON_DOWNLOAD_FAILED',
      message: `Blocked icon protocol: ${parsed.protocol}. Only http/https are allowed.`,
    };
  }

  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return {
      success: false,
      errorCode: 'ICON_DOWNLOAD_FAILED',
      message: 'Blocked private/loopback icon host. You can retry manually.',
    };
  }

  return null;
}

// ─── Result Types ────────────────────────────────────────────────────────────

export type IconProcessResult =
  | { success: true; dataUri: string; cacheKey: string }
  | { success: false; errorCode: string; message: string };

// ─── Icon Service ────────────────────────────────────────────────────────────

export class IconService {
  /**
   * T12/R1: the SINGLE recipe renderer (`OffscreenCanvas` → PNG). Injectable so
   * unit tests can supply a stub — jsdom has no `OffscreenCanvas`, so a real
   * render cannot be asserted there (real pixels are covered by the F3 browser
   * pass / the T23 spike).
   */
  private renderer: RecipeRenderer;

  constructor(
    private repo: StorageRepository,
    renderer?: RecipeRenderer,
  ) {
    this.renderer = renderer ?? new RecipeRenderer(repo);
  }

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

    // B8: reject non-http(s) and private/loopback hosts BEFORE any network call.
    const rejected = rejectUnsafeFetchUrl(url);
    if (rejected) return rejected;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, ICON_FETCH_TIMEOUT_MS);

    try {
      // Fetch the icon with a hard timeout so a hung server cannot pin the SW.
      const response = await fetch(url, { mode: 'cors', signal: controller.signal });

      // T28 (B8-6): re-validate the FINAL URL. The pre-flight check only saw the
      // requested URL; a redirect can land on a private/loopback host, and the
      // browser reports that hop in `response.url`. Without this, the SSRF guard
      // is bypassable by a single 302.
      if (response.url && response.url !== url) {
        const redirected = rejectUnsafeFetchUrl(response.url);
        if (redirected) {
          return {
            success: false,
            errorCode: 'ICON_DOWNLOAD_FAILED',
            message: 'Blocked redirect to a private/loopback icon host. You can retry manually.',
          };
        }
      }

      if (!response.ok) {
        return {
          success: false,
          errorCode: 'ICON_DOWNLOAD_FAILED',
          message: `Download failed: HTTP ${response.status}`,
        };
      }

      // B8: short-circuit on an advertised oversize body instead of downloading it.
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null) {
        const advertised = Number(contentLength);
        if (Number.isFinite(advertised) && advertised > MAX_UPLOAD_SIZE) {
          return {
            success: false,
            errorCode: 'ICON_TOO_LARGE',
            message: 'Downloaded icon exceeds 2MB limit',
          };
        }
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

      // Validate size (second line of defence for servers that omit Content-Length)
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
    } catch {
      return {
        success: false,
        errorCode: 'ICON_DOWNLOAD_FAILED',
        message: 'Failed to download icon. You can retry manually.',
      };
    } finally {
      clearTimeout(timer);
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
        // T12/R1 + latent-defect fix: render the recipe to a PNG through the
        // SINGLE background renderer. Previously this produced an SVG data URI,
        // which the page-side delivery gate silently drops (the defect never
        // surfaced only because `type:'template'` was never produced). The
        // renderer degrades to `getPlaceholder()` on failure (never SVG-by-
        // recipe, never a throw).
        return this.renderer.renderToPng(
          {
            backgroundColor: source.backgroundColor,
            text: source.text,
            textColor: source.textColor,
          },
          () => this.getPlaceholder(),
        );

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
