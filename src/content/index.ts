/**
 * Content Script — document_start static injection.
 *
 * Responsibilities:
 * - Report initial load, popstate, hashchange, wrapped pushState/replaceState navigations
 * - Receive minimal title/favicon rewrite instructions and apply to DOM
 * - Once-per-URL guard (bypassed with force flag for user-initiated edits)
 * - Send CONTENT_READY on DOMContentLoaded so background can re-push overrides
 * - Does NOT read page body, does NOT intercept site's subsequent rewrites
 * - Does NOT inject into protected pages
 */

import type { WorkerToContentMessage } from '@shared/messages';
import { PROTECTED_URL_PREFIXES } from './protected-prefixes.inline.generated';

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * B13: upper bound on the dedup sets.
 *
 * The content script runs on EVERY page and can live for the tab's whole
 * lifetime, so an unbounded `Set` grows without limit across SPA navigations
 * (long-lived tabs / infinite scroll). `MAX_TRACKED_URLS` covers any realistic
 * recent history while keeping resident memory constant.
 */
const MAX_TRACKED_URLS = 100;

/**
 * Insertion-ordered, size-capped set (FIFO eviction of the oldest URL).
 * `Set` preserves insertion order, so eviction is `values().next().value`.
 * MUST NOT be used with the Modification During Iteration pattern.
 */
class BoundedUrlSet {
  private readonly items = new Set<string>();

  constructor(private readonly capacity: number = MAX_TRACKED_URLS) {}

  has(url: string): boolean {
    return this.items.has(url);
  }

  /** Add a URL, evicting the oldest entry when the capacity is exceeded. */
  add(url: string): void {
    if (this.items.has(url)) return;
    if (this.items.size >= this.capacity) {
      const oldest = this.items.values().next().value;
      if (oldest !== undefined) {
        this.items.delete(oldest);
      }
    }
    this.items.add(url);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}

/** Track which URLs have already been reported to enforce once-per-URL reporting */
const reportedUrls = new BoundedUrlSet();
/** Track which URLs have had rewrite applied (bypassed with force) */
const appliedUrls = new BoundedUrlSet();

/**
 * Protected URL prefixes — content script should not operate on these.
 *
 * B14: imported from the generated single source rather than duplicated, so the
 * content script can never disagree with the worker about protected pages.
 * Vite bundles the module, so the script stays self-contained (no runtime fs).
 */

/** Pending favicon to apply once document.head is available */
let pendingFavicon: string | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isProtectedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PROTECTED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function getCurrentUrl(): string {
  return window.location.href;
}

// ─── Navigation Reporting ────────────────────────────────────────────────────

function reportNavigation(navigationType: 'initial' | 'popstate' | 'hashchange' | 'pushstate' | 'replacestate'): void {
  const url = getCurrentUrl();

  // Skip protected pages
  if (isProtectedUrl(url)) return;

  // Only report each URL once
  if (reportedUrls.has(url)) return;
  reportedUrls.add(url);

  // Send to background via runtime message (fire-and-forget, no long connection)
  try {
    chrome.runtime.sendMessage({
      requestId: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'CONTENT_NAVIGATION',
      payload: {
        tabId: -1, // Worker will determine actual tabId from sender
        url,
        navigationType,
      },
    }).catch(() => {
      // Worker might not be ready — ignore
    });
  } catch {
    // Extension context might be invalidated — ignore
  }
}

/**
 * Report CONTENT_READY to background after DOM is ready.
 * Background will re-compute and push any applicable overrides/rules.
 */
function reportReady(): void {
  const url = getCurrentUrl();
  if (isProtectedUrl(url)) return;

  try {
    chrome.runtime.sendMessage({
      requestId: `cs-ready-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'CONTENT_READY',
      payload: {
        tabId: -1,
        url,
      },
    }).catch(() => {
      // Worker might not be ready — ignore
    });
  } catch {
    // Extension context might be invalidated — ignore
  }
}

// ─── Rewrite Application ─────────────────────────────────────────────────────

/**
 * Set favicon by removing ALL existing icon links and creating a fresh one.
 * Defers if document.head is not yet available (document_start).
 */
/**
 * B9-7 (T32): the content-script favicon fallback allowlist.
 *
 * This is the last channel that writes `link.href`, and it runs in the page
 * context where `@shared/url-utils` cannot be imported. The list is therefore
 * mirrored inline and must stay **semantically identical** to
 * `isSafeFaviconProtocol` and to the inline copy in `apply-fields.ts`:
 * http/https, or `data:` limited to bitmap image types.
 */
const SAFE_FAVICON_PROTOCOLS = ['http:', 'https:'];
const SAFE_DATA_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
];

function isSafeFaviconValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  // Strip leading control/space characters so " javascript:" cannot slip past.
  const normalized = trimmed.replace(/^[\u0000-\u0020]+/, '');
  if (!normalized) return false;
  if (SAFE_FAVICON_PROTOCOLS.some((p) => normalized.indexOf(p) === 0)) return true;
  if (normalized.indexOf('data:') === 0) {
    const body = normalized.slice(5);
    const comma = body.indexOf(',');
    const meta = comma >= 0 ? body.slice(0, comma) : body;
    const mediaType = meta.split(';')[0].trim();
    return SAFE_DATA_IMAGE_TYPES.indexOf(mediaType) !== -1;
  }
  return false;
}

function setFavicon(dataUri: string): void {
  if (!document.head) {
    // document_start: head not available yet — defer
    pendingFavicon = dataUri;
    return;
  }

  // Remove ALL existing favicon links (icon, shortcut icon, apple-touch-icon, etc.)
  document.querySelectorAll('link[rel*="icon"]').forEach((l) => l.remove());

  // B9-7 (T32): never write a dangerous protocol into link.href. Existing links
  // have already been removed, so a rejected value simply leaves the page with
  // no replacement icon rather than executing anything.
  if (!isSafeFaviconValue(dataUri)) return;

  // Create new link
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = dataUri;
  document.head.appendChild(link);
}

/**
 * Flush any pending favicon that was deferred due to missing document.head.
 */
function flushPendingFavicon(): void {
  if (pendingFavicon && document.head) {
    const favicon = pendingFavicon;
    pendingFavicon = null;
    setFavicon(favicon);
  }
}

function applyRewrite(title?: string, favicon?: string, force = false): void {
  const url = getCurrentUrl();

  // Skip protected pages
  if (isProtectedUrl(url)) return;

  // Only apply once per URL unless forced (user edits must re-apply)
  if (!force && appliedUrls.has(url)) return;

  appliedUrls.add(url);

  // Apply title — works even at document_start (document.title is always available)
  if (title) {
    document.title = title;
  }

  // Apply favicon — may defer if head not ready
  if (favicon) {
    setFavicon(favicon);
  }
}

// ─── Message Listener ────────────────────────────────────────────────────────

function handleMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;

  const msg = message as WorkerToContentMessage;
  if (msg.type === 'APPLY_REWRITE') {
    applyRewrite(msg.payload.title, msg.payload.favicon, msg.payload.force);
  }
}

// ─── SPA Navigation Wrapping ─────────────────────────────────────────────────

function wrapHistoryMethods(): void {
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState(...args);
    reportNavigation('pushstate');
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState(...args);
    reportNavigation('replacestate');
  };
}

// ─── Initialization ──────────────────────────────────────────────────────────

function initialize(): void {
  // Skip protected pages entirely
  if (isProtectedUrl(getCurrentUrl())) return;

  // Listen for rewrite messages from Worker — register FIRST (before any reporting)
  chrome.runtime.onMessage.addListener(handleMessage);

  // Report initial load
  reportNavigation('initial');

  // Listen for popstate (back/forward)
  window.addEventListener('popstate', () => {
    reportNavigation('popstate');
  });

  // Listen for hashchange
  window.addEventListener('hashchange', () => {
    reportNavigation('hashchange');
  });

  // Wrap pushState/replaceState for SPA navigation
  wrapHistoryMethods();

  // On DOMContentLoaded: flush pending favicon + report CONTENT_READY
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      flushPendingFavicon();
      reportReady();
    });
  } else {
    // DOM already ready (shouldn't happen at document_start, but be safe)
    flushPendingFavicon();
    reportReady();
  }
}

// Run at document_start
initialize();

// Export for testing
export {
  isProtectedUrl,
  reportNavigation,
  reportReady,
  applyRewrite,
  setFavicon,
  flushPendingFavicon,
  handleMessage,
  reportedUrls,
  appliedUrls,
  initialize,
};
