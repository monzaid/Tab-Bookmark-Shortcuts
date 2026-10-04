/**
 * Manual review, round 2 — issue 2/3 mechanism probe.
 *
 * Reported: the TAB's title changes but its ICON does not, on both create and
 * edit, and a manual refresh does not help.
 *
 * `document.title` is unambiguous — any assignment shows. A favicon is only
 * re-read by the browser when the ICON LINK ITSELF changes in a way it notices.
 * Two mechanisms are known to defeat it, and BOTH are present here:
 *
 *  A. Mutating `href` on the SAME `<link>` element (no fresh element) — the
 *     browser keeps the already-decoded favicon.
 *  B. Leaving the SITE's own `<link rel="icon">` in place, so there are two
 *     competing declarations and the site's may keep winning.
 *
 * These tests pin the observable DOM contract that makes the icon refresh:
 * after applying, exactly ONE icon link must exist and it must be ours; after
 * restoring, the site's original must be back.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const SITE_ICON = 'https://site.example/favicon.ico';
const OURS_A = 'https://cdn.example.com/a.png';
const OURS_B = 'https://cdn.example.com/b.png';

function iconHrefs(): string[] {
  return Array.from(document.querySelectorAll('link[rel*="icon"]'))
    .map((l) => l.getAttribute('href'))
    .filter((h): h is string => h !== null);
}

describe('favicon application must force the browser to re-read the icon', () => {
  let mod: typeof import('@content/index');

  beforeEach(async () => {
    document.head.innerHTML = `<link rel="icon" href="${SITE_ICON}">`;
    document.title = 'Site Title';
    mod = await import('@content/index');
    mod.resetCapturedSite();
  });

  it('leaves exactly ONE icon link after applying (no competing declaration)', () => {
    mod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: OURS_A } });

    // Mechanism B: a second, competing link lets the site icon keep winning.
    expect(iconHrefs()).toEqual([OURS_A]);
  });

  it('REPLACES the link element on a second apply (no stale href mutation)', () => {
    mod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: OURS_A } });
    const first = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');

    mod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: OURS_B } });
    const second = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');

    expect(iconHrefs()).toEqual([OURS_B]);
    // Mechanism A: a FRESH element is what the browser re-reads.
    expect(second).not.toBe(first);
  });

  it('restores the SITE icon (the only link left) after a restore directive', () => {
    mod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: OURS_A } });
    mod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'restore' } });

    expect(iconHrefs()).toEqual([SITE_ICON]);
  });

  it('restores by RE-ADDING the site link when there was none originally', () => {
    document.head.innerHTML = '';
    mod.resetCapturedSite();

    mod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: OURS_A } });
    expect(iconHrefs()).toEqual([OURS_A]);

    mod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'restore' } });
    // Nothing of ours may remain; the page falls back to its own default.
    expect(iconHrefs()).toEqual([]);
  });
});