/**
 * T8 — content script is the ONLY apply/restore implementation (A4/C2).
 *
 * Rewritten for the `FIELD_APPLY` three-state protocol:
 *   { kind: 'set', value } | { kind: 'restore' } | { kind: 'none' }
 *
 * The per-URL guard (`appliedUrls`) is gone (A9) — scheduling now belongs to
 * the background's single entry, so an unconditional, idempotent apply is the
 * correct behaviour and the restored `restore` semantics are what actually
 * fixes "clearing only worked on the executeScript path".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockAddListener = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: mockAddListener },
  },
});

describe('T8: Content script — FIELD_APPLY set / restore / none', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    document.head.innerHTML = '';
    document.title = 'Original';
    const mod = await import('@content/index');
    mod.resetCapturedSite();
  });

  it('applies a `set` title directive and lazily captures the site value', async () => {
    const { applyFieldMessage } = await import('@content/index');

    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'Rewritten' } });

    expect(document.title).toBe('Rewritten');
    // Lazy capture reported the ORIGINAL title before the rewrite.
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SITE_SNAPSHOT_REPORT',
        payload: expect.objectContaining({ title: 'Original' }),
      }),
    );
  });

  it('restores the site original title on a `restore` directive', async () => {
    const { applyFieldMessage } = await import('@content/index');

    // First write captures 'Original', then rewrites.
    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'Rewritten' } });
    expect(document.title).toBe('Rewritten');

    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'restore' } });
    expect(document.title).toBe('Original');
  });

  it('does not clear the title to an empty string when restoring', async () => {
    const { applyFieldMessage } = await import('@content/index');

    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'X' } });
    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'restore' } });
    expect(document.title).not.toBe('');
  });

  it('leaves the document untouched on a `none` directive', async () => {
    const { applyFieldMessage } = await import('@content/index');

    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'none' } });
    expect(document.title).toBe('Original');
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SITE_SNAPSHOT_REPORT' }),
    );
  });

  it('our favicon REPLACES the site link, so no competing declaration remains', async () => {
    const { applyFieldMessage } = await import('@content/index');

    const siteLink = document.createElement('link');
    siteLink.rel = 'icon';
    siteLink.href = 'https://site.example/original.ico';
    document.head.appendChild(siteLink);

    applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: 'https://cdn/new.png' } });

    // Review round 2 (issue 2): leaving the site's link in place let IT keep
    // winning, so the tab appeared not to change its icon. Ours must be the only
    // declaration while we own the tab; the original is restored on `restore`.
    const links = document.head.querySelectorAll('link[rel*="icon"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://cdn/new.png');
    expect(document.head.contains(siteLink)).toBe(false);
  });

  it('restores by putting the site original back (our link is gone, theirs returns)', async () => {
    const { applyFieldMessage } = await import('@content/index');

    const siteLink = document.createElement('link');
    siteLink.rel = 'icon';
    siteLink.href = 'https://site.example/original.ico';
    document.head.appendChild(siteLink);

    applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: 'https://cdn/new.png' } });
    applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'restore' } });

    const links = document.head.querySelectorAll('link[rel*="icon"]');
    expect(links.length).toBe(1);
    // The href is what matters: our link was removed and the site value is back.
    expect(links[0].getAttribute('href')).toBe('https://site.example/original.ico');
    expect(links[0]).not.toBe(siteLink);
  });

  it('refuses to write an unsafe favicon protocol', async () => {
    const { applyFieldMessage } = await import('@content/index');

    applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: 'javascript:alert(1)' } });
    expect(document.head.querySelectorAll('link[rel*="icon"]').length).toBe(0);
  });

  it('captures the site snapshot only once (a second write must not overwrite it)', async () => {
    const { applyFieldMessage } = await import('@content/index');

    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'First' } });
    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'Second' } });
    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'restore' } });

    // The captured value is the ORIGINAL, not our first rewrite.
    expect(document.title).toBe('Original');
  });

  it('re-captures after a navigation reset', async () => {
    const { applyFieldMessage, resetCapturedSite } = await import('@content/index');

    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'Page1' } });
    document.title = 'Page2';
    resetCapturedSite(); // simulates a real navigation

    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'Page2 Rewritten' } });
    applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'restore' } });

    expect(document.title).toBe('Page2');
  });

  it('handleMessage dispatches FIELD_APPLY', async () => {
    const { handleMessage } = await import('@content/index');

    handleMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'Via Message' } });
    expect(document.title).toBe('Via Message');
  });

  it('ignores unknown message types', async () => {
    const { handleMessage } = await import('@content/index');

    handleMessage({ type: 'APPLY_REWRITE', payload: { title: 'Legacy' } });
    expect(document.title).toBe('Original');
  });

  it('no longer exports a per-URL apply guard (A9)', async () => {
    const mod = await import('@content/index');
    expect('appliedUrls' in mod).toBe(false);
    expect('applyRewrite' in mod).toBe(false);
  });
});