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

/**
 * Page-scoped original values (A4 / A7).
 *
 * `restore` means "put the ORIGINAL value back", and only the content script
 * holds a page-scoped snapshot that can survive across messages — the
 * `executeScript` fallback is stateless and therefore apply-only. The snapshot
 * is captured lazily, immediately BEFORE the first rewrite.
 */
let capturedTitle: string | null = null;
let capturedFaviconHref: string | null = null;
let siteCaptured = false;
/** The `<link rel="icon">` WE inserted (never the site's own links). */
let injectedIconLink: HTMLLinkElement | null = null;

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

/** Read the site's own current favicon href (null when there is none). */
function readSiteFaviconHref(): string | null {
  const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
  return link?.href ?? null;
}

/**
 * Capture the ORIGINAL page title/favicon once, immediately before the first
 * rewrite, and report it to the worker (A7 lazy capture). A second call is a
 * no-op — restoring must target the pre-rewrite value, never our own output.
 */
function captureSiteOnce(): void {
  if (siteCaptured) return;
  siteCaptured = true;
  capturedTitle = document.title;
  capturedFaviconHref = readSiteFaviconHref();

  try {
    chrome.runtime.sendMessage({
      requestId: `cs-snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'SITE_SNAPSHOT_REPORT',
      payload: { tabId: -1, title: capturedTitle, faviconHref: capturedFaviconHref },
    }).catch(() => {
      // Worker might not be ready — the in-page snapshot is still valid.
    });
  } catch {
    // Extension context invalidated — ignore.
  }
}

/** Reset the captured snapshot on a real navigation (a re-capture is required). */
function resetCapturedSite(): void {
  siteCaptured = false;
  capturedTitle = null;
  capturedFaviconHref = null;
  injectedIconLink = null;
}

/**
 * Apply OUR favicon, forcing the browser to actually re-read it.
 *
 * Two mechanisms silently defeat a naive update, which is why the reported
 * symptom was "the title changes but the icon does not":
 *
 * 1. Mutating `href` on the SAME `<link>` element. The browser has already
 *    decoded the favicon and does not re-read it for an in-place attribute
 *    change, so the tab keeps the old icon. A FRESH element is required.
 * 2. Leaving the SITE's own `<link rel="icon">` in place. Two competing
 *    declarations let the site's icon keep winning, regardless of document
 *    order. Ours must REPLACE it while we own the tab.
 *
 * The site's original href is preserved in `capturedFaviconHref` (A7) and
 * re-inserted by `restoreFavicon`, so nothing is lost by removing it here.
 */
function setFavicon(dataUri: string): void {
  if (!document.head) {
    // document_start: head not available yet — defer
    pendingFavicon = dataUri;
    return;
  }

  // B9-7 (T32): never write a dangerous protocol into link.href.
  if (!isSafeFaviconValue(dataUri)) return;

  // (2) Drop every competing icon declaration, including the site's own.
  document.querySelectorAll('link[rel*="icon"]').forEach((l) => { l.remove(); });

  // (1) Always a NEW element, so the browser re-reads the icon.
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = dataUri;
  document.head.appendChild(link);
  injectedIconLink = link;
}

/**
 * Restore the site's ORIGINAL favicon.
 *
 * Removes ours and puts the site's captured declaration back. Simply deleting
 * our link is NOT enough: the site's own link was removed by `setFavicon`, so
 * without re-adding it the page would keep showing OUR icon (the tab would
 * never fall back to the site value).
 */
function restoreFavicon(): void {
  if (injectedIconLink && document.contains(injectedIconLink)) {
    injectedIconLink.remove();
  }
  injectedIconLink = null;

  if (!document.head) return;
  if (document.querySelector('link[rel*="icon"]')) return;
  if (!capturedFaviconHref) return;

  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = capturedFaviconHref;
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

/** Apply a single per-field directive (A4). */
function applyDirective(
  field: 'title' | 'favicon',
  directive: import('@shared/messages').FieldDirective | undefined,
): void {
  if (!directive || directive.kind === 'none') return;

  if (field === 'title') {
    if (directive.kind === 'set') {
      document.title = directive.value;
    } else if (capturedTitle !== null) {
      document.title = capturedTitle;
    }
    return;
  }

  if (directive.kind === 'set') {
    setFavicon(directive.value);
  } else {
    restoreFavicon();
  }
}

/**
 * Handle a `FIELD_APPLY` message — the ONLY delivery protocol (A4/C2).
 *
 * The per-URL guard is deliberately GONE (A9): scheduling is now owned by the
 * background's single entry point (leading/trailing), so an unconditional apply
 * is correct and idempotent.
 */
function applyFieldMessage(msg: import('@shared/messages').FieldApplyMessage): void {
  const url = getCurrentUrl();
  // Protected pages are never rewritten (content-script side of A8).
  if (isProtectedUrl(url)) return;

  const willRewrite =
    msg.title?.kind === 'set' || msg.favicon?.kind === 'set';
  if (willRewrite) captureSiteOnce();

  applyDirective('title', msg.title);
  applyDirective('favicon', msg.favicon);
}

// ─── Message Listener ────────────────────────────────────────────────────────

function handleMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;

  const msg = message as Partial<WorkerToContentMessage>;
  // Defensive at runtime: the wire value is untrusted, so comparing against the
  // literal is meaningful even though the narrowed type says otherwise.
  if ((msg as { type?: unknown }).type === 'FIELD_APPLY') {
    applyFieldMessage(msg as WorkerToContentMessage);
  }
}

// ─── SPA Navigation Wrapping ─────────────────────────────────────────────────

function wrapHistoryMethods(): void {
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState(...args);
    // A7: a real navigation invalidates the page-scoped snapshot — the next
    // rewrite must re-capture the (possibly different) page's original value.
    resetCapturedSite();
    reportNavigation('pushstate');
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState(...args);
    resetCapturedSite();
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
  applyFieldMessage,
  setFavicon,
  restoreFavicon,
  captureSiteOnce,
  resetCapturedSite,
  flushPendingFavicon,
  handleMessage,
  reportedUrls,
  initialize,
};
