/**
 * T6 — consumer-side "unresolvable reference ⇒ MISSING" judgement + placeholder.
 *
 * C9-②: a `local-icon:<key>` reference that cannot be resolved must be treated
 * as a MISSING icon and shown as the placeholder — never left as the literal
 * reference text (which is what `resolveIconReferences` does today when the
 * lookup fails: it keeps the raw value, so the literal leaks to the UI and the
 * favicon path).
 *
 * D9 draws a HARD line: "missing" must be distinguishable from "never set".
 * A blank icon is `missing: false` (there was nothing to resolve), whereas a
 * broken reference is `missing: true`. Both may show the same placeholder, so
 * the boolean — not the pixel — is what tells the user "it was set and broke"
 * vs "you never set it".
 *
 * The placeholder is the EXISTING static grey `?` (getPlaceholder), so the
 * assertion is on its `#e0e0e0` fill; the point is that no SVG-by-recipe and no
 * raw reference text is ever returned here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { IconService } from '@background/icon-service';
import { LOCAL_ICON_REF_PREFIX } from '@shared/icon-ref';
import type { IconSource } from '@shared/types';

describe('T6: unresolvable icon reference ⇒ missing + placeholder', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let svc: IconService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    svc = new IconService(repo);
  });

  const ref = (key: string): IconSource => ({ type: 'upload', value: `${LOCAL_ICON_REF_PREFIX}${key}` });

  it('a reference with no local blob is MISSING and shows the placeholder', async () => {
    const { uri, missing } = await svc.resolveForDisplayState(ref('icon:slot-3'));

    expect(missing).toBe(true);
    expect(uri).toContain('data:image/svg+xml'); // the existing static placeholder
    expect(uri).toContain('e0e0e0');
    // The literal reference must NOT leak through as the displayed value.
    expect(uri).not.toContain(LOCAL_ICON_REF_PREFIX);
  });

  it('a resolvable reference is NOT missing and returns the real data URI', async () => {
    await repo.setIconCache('icon:slot-3', 'data:image/png;base64,REALBITS');

    const { uri, missing } = await svc.resolveForDisplayState(ref('icon:slot-3'));

    expect(missing).toBe(false);
    expect(uri).toBe('data:image/png;base64,REALBITS');
  });

  it('"never set" is NOT missing (D9: distinguishable from missing)', async () => {
    const absent = await svc.resolveForDisplayState(undefined);
    expect(absent.missing).toBe(false);
    expect(absent.uri).toContain('e0e0e0'); // still a placeholder, but NOT "missing"

    expect(await svc.isMissingIcon(undefined)).toBe(false);
    expect(await svc.isMissingIcon(null)).toBe(false);
  });

  it('a self-contained source is never "missing" (nothing to resolve)', async () => {
    // A recipe carries its own truth; a URL is external; neither is a broken ref.
    expect(await svc.isMissingIcon({ type: 'template', value: '', backgroundColor: '#000', text: 'A' })).toBe(false);
    expect(await svc.isMissingIcon({ type: 'url', value: 'https://example.com/i.png' })).toBe(false);
    expect(await svc.isMissingIcon({ type: 'upload', value: 'data:image/png;base64,AAA' })).toBe(false);
  });

  it('an unresolved ref is reported by isMissingIcon too', async () => {
    expect(await svc.isMissingIcon(ref('icon:slot-9'))).toBe(true);
  });
});