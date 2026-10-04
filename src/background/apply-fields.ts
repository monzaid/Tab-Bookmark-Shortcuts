/**
 * Apply-only delivery fallback (C2/A6).
 *
 * The content script is the ONLY implementation of apply + restore (it is
 * long-lived and therefore holds the page-scoped snapshot needed by `restore`).
 * `scripting.executeScript` remains as a bounded fallback, but it is STATELESS:
 * it can only `set` a value, never restore one. A tab reached through this path
 * is marked `degraded` by the delivery service.
 */

import type { BrowserAdapter } from '@adapters/contract';
import type { FieldDirective } from '@shared/messages';

// ─── In-page apply function ──────────────────────────────────────────────────
// This function is serialized and executed in the page context by executeScript,
// so it must be fully self-contained (it cannot import from @shared/url-utils).
// It deliberately implements ONLY the `set` branch: `restore` degrades to
// "stop rewriting" (nothing is changed here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyInPage(payload: any): void {
  try {
    const title = payload && 'title' in payload ? payload.title : undefined;
    const favicon = payload && 'favicon' in payload ? payload.favicon : undefined;

    // `set` carries the resolved chain value; anything else (restore / none) is
    // NOT expressible here — the fallback only stops (or never starts) rewriting.
    if (typeof title === 'string') {
      document.title = title;
    }

    if (typeof favicon === 'string') {
      // Last line of defence (B9). Serialized into the page context, so the
      // allowlist is mirrored inline and must stay semantically identical to
      // `isSafeFaviconProtocol` (http/https, or data: limited to bitmaps).
      const headOf = (): HTMLElement | null => (document as unknown as { head: HTMLElement | null }).head;

      const SAFE_PROTOCOLS = ['http:', 'https:'];
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
      const isSafeFavicon = (v: string): boolean => {
        const trimmed = v.trim().toLowerCase();
        if (!trimmed) return false;
        const normalized = trimmed.replace(/^[\u0000-\u0020]+/, '');
        if (!normalized) return false;
        if (SAFE_PROTOCOLS.some((p) => normalized.indexOf(p) === 0)) return true;
        if (normalized.indexOf('data:') === 0) {
          const body = normalized.slice(5);
          const comma = body.indexOf(',');
          const meta = comma >= 0 ? body.slice(0, comma) : body;
          const mediaType = meta.split(';')[0].trim();
          return SAFE_DATA_IMAGE_TYPES.indexOf(mediaType) !== -1;
        }
        return false;
      };

      const applyFavicon = (): void => {
        const head = headOf();
        if (!head) return;
        // Remove existing icon links, then insert our own (apply-only: there is
        // no snapshot here, so a later restore is the content script's job).
        document.querySelectorAll('link[rel*="icon"]').forEach((l: Element) => { l.remove(); });
        const faviconValue: string = String(favicon);
        if (!isSafeFavicon(faviconValue)) return;
        // Mirror of the content script's rule: a FRESH element is required for
        // the browser to re-read the icon (mutating an existing `href` leaves the
        // already-decoded favicon in place), and every competing declaration was
        // removed above so ours wins.
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        link.href = faviconValue;
        head.appendChild(link);
      };

      applyFavicon();
      if (!headOf()) {
        const start = Date.now();
        const timer = globalThis.setInterval(() => {
          if (headOf()) {
            applyFavicon();
            globalThis.clearInterval(timer);
          } else if (Date.now() - start > 2000) {
            globalThis.clearInterval(timer);
          }
        }, 50);
      }
    }
  } catch {
    // Best-effort in-page rewrite — ignore any page-level errors.
  }
}

export interface ApplyPayload {
  /** A `set` directive's value; undefined means "nothing to write here". */
  title?: string;
  favicon?: string;
}

/**
 * Apply title/favicon via `scripting.executeScript` — the apply-only fallback.
 *
 * Returns `true` when the fallback actually ran (which the caller reports as
 * `degraded`, since `restore` is not available on this path).
 */
export async function applyFieldsToTab(
  adapter: BrowserAdapter,
  tabId: number,
  payload: ApplyPayload,
): Promise<boolean> {
  const { title, favicon } = payload;

  // Nothing to apply — the fallback cannot express any other directive.
  if (title === undefined && favicon === undefined) return false;

  try {
    await adapter.scripting.executeScript({
      target: { tabId },
      func: applyInPage as (...args: unknown[]) => unknown,
      args: [{ title, favicon }],
    });
    return true;
  } catch {
    // executeScript unavailable (restricted page / no permission).
    return false;
  }
}

/** Map a `FieldDirective` to the apply-only payload this fallback understands. */
export function directiveToApplyPayload(directive: FieldDirective | undefined): string | undefined {
  return directive?.kind === 'set' ? directive.value : undefined;
}