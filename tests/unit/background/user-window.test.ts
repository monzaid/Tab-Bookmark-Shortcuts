import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import type { NormalizedWindow } from '@adapters/contract';
import { resolveUserWindow } from '@background/user-window';

/**
 * `resolveUserWindow` is the single source of truth for "the window the user is
 * actually browsing in". A MV3 service worker's `windows.getCurrent()` returns
 * the most recently focused window — which is our own recovery popup when it is
 * focused. Every ring/focus decision must therefore go through this helper.
 */
describe('resolveUserWindow', () => {
  const adapter = createMockAdapter();

  const normal = (id: number, focused = false): NormalizedWindow => ({
    id,
    focused,
    incognito: false,
    type: 'normal',
  });
  const popup = (id: number, focused = true): NormalizedWindow => ({
    id,
    focused,
    incognito: false,
    type: 'popup',
  });

  beforeEach(() => {
    adapter.reset();
  });

  it('returns the focused window unchanged when it is a normal window', async () => {
    adapter.setWindows([normal(1, true), normal(2)]);
    await expect(resolveUserWindow(adapter)).resolves.toMatchObject({ id: 1, type: 'normal' });
  });

  it('skips a focused popup and returns the user window', async () => {
    adapter.setWindows([normal(1), popup(3, true)]);
    await expect(resolveUserWindow(adapter)).resolves.toMatchObject({ id: 1, type: 'normal' });
  });

  it('prefers a focused non-popup window over an unfocused one', async () => {
    adapter.setWindows([normal(1), normal(2, true), popup(3)]);
    // Mock getCurrent returns the focused window (id 2) — already non-popup.
    await expect(resolveUserWindow(adapter)).resolves.toMatchObject({ id: 2 });

    // Now force the popup to be the focused one while another normal window is also focused.
    adapter.setWindows([normal(1, true), normal(2, true), popup(3, true)]);
    const resolved = await resolveUserWindow(adapter);
    expect(resolved.type).toBe('normal');
    expect(resolved.id).toBe(1);
  });

  it('returns the first non-popup window when none is focused', async () => {
    adapter.setWindows([normal(1), normal(2), popup(3, true)]);
    await expect(resolveUserWindow(adapter)).resolves.toMatchObject({ id: 1 });
  });

  it('falls back to the popup when no user window exists at all', async () => {
    adapter.setWindows([popup(3, true)]);
    await expect(resolveUserWindow(adapter)).resolves.toMatchObject({ id: 3, type: 'popup' });
  });
});