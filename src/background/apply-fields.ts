/**
 * Robust title/favicon delivery to a tab.
 *
 * Primary mechanism: `scripting.executeScript` runs a self-contained function in the
 * page context, so it works even for tabs that were already open before the extension
 * was installed/reloaded (where a static content script was never injected).
 *
 * Fallback: `tabs.sendMessage` to the content script (kept for SPA re-application and
 * restricted pages where executeScript is unavailable).
 */

import type { BrowserAdapter } from '@adapters/contract';

// ─── In-page rewrite function ────────────────────────────────────────────────
// This function is serialized and executed in the page context by executeScript.
// It must be fully self-contained (no closure references) and typed as accepting
// the serialized args. The `APPLY_REWRITE` payload shape is:
//   { title: string | undefined | null, favicon: string | undefined | null, ... }
// A `null` title/favicon means "clear" (revert to the site's original value),
// which is used when a rule is deleted so the previously-applied rewrite is undone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRewriteInPage(payload: any): void {
  try {
    // `title`/`favicon`: string = set, null = clear, undefined = leave unchanged.
    const title = payload && 'title' in payload ? payload.title : undefined;
    const favicon = payload && 'favicon' in payload ? payload.favicon : undefined;

    if (typeof title === 'string') {
      document.title = title;
    } else if (title === null) {
      // Clear: restore the site's original <title> text (the rewritten one is gone).
      document.title = '';
    }

    if (typeof favicon === 'string' || favicon === null) {
      // Apply (or clear) the favicon once document.head is available. When this
      // function is invoked via scripting.executeScript at document_start (or on
      // a tab whose <head> has not yet parsed), document.head may be null. We poll
      // briefly for it so the favicon genuinely lands instead of being dropped.
      const headOf = (): HTMLElement | null => (document as unknown as { head: HTMLElement | null }).head;

      const applyFavicon = (): void => {
        const head = headOf();
        if (!head) return;
        // Remove ALL existing favicon links (icon, shortcut icon, apple-touch-icon, etc.)
        document.querySelectorAll('link[rel*="icon"]').forEach((l: Element) => { l.remove(); });
        if (favicon === null) return; // cleared — no replacement link
        // Create new link
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        link.href = favicon;
        head.appendChild(link);
      };

      applyFavicon();
      if (!headOf()) {
        // Retry up to ~2s (document.head usually appears within a few frames).
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
  /** string = set title, null = clear title, undefined = leave unchanged */
  title?: string | null;
  /** string = set favicon, null = clear favicon, undefined = leave unchanged */
  favicon?: string | null;
  force?: boolean;
}

/**
 * Apply title/favicon to a tab using executeScript as the primary mechanism,
 * falling back to tabs.sendMessage (content script) when executeScript is
 * unavailable (e.g. restricted page).
 *
 * A payload with `title`/`favicon` explicitly set to `null` is a CLEAR
 * operation (undo a previously-applied rewrite, e.g. after a rule delete).
 */
export async function applyFieldsToTab(
  adapter: BrowserAdapter,
  tabId: number,
  payload: ApplyPayload,
): Promise<void> {
  const { title, favicon } = payload;

  // Nothing to apply or clear — skip.
  if (title === undefined && favicon === undefined) return;

  // Keep the full payload shape (including force) uniform across both delivery paths.
  const execArgs: ApplyPayload = { title, favicon, force: payload.force };

  // Primary: scripting.executeScript — works on any tab regardless of content-script
  // injection state (fixes already-open tabs after install/reload).
  try {
    await adapter.scripting.executeScript({
      target: { tabId },
      func: applyRewriteInPage as (...args: unknown[]) => unknown,
      args: [execArgs],
    });
    return;
  } catch {
    // executeScript unavailable (restricted page / no permission) — fall through
    // to the content-script sendMessage path.
  }

  // Fallback: content-script sendMessage (SPA re-application, restricted pages).
  try {
    await adapter.tabs.sendMessage(tabId, {
      type: 'APPLY_REWRITE',
      payload: { title: title ?? undefined, favicon: favicon ?? undefined, force: payload.force },
    });
  } catch {
    // Content script not ready — ignore.
  }
}