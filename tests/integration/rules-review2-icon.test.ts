/**
 * Manual review, round 2 — issue 2: "the tab got the title but NOT the icon".
 *
 * The icon a user actually sets comes from the UI's Custom Icon / Upload tabs,
 * i.e. a `data:` URI — not the tidy `.png` URL the earlier tests used. A large
 * one is additionally OFFLOADED to local storage and referenced as
 * `local-icon:<key>` in sync state.
 *
 * Each case asserts the icon genuinely landed in the page, so a case that fails
 * points at the real delivery gap rather than at a missing message.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import { ICON_OFFLOAD_THRESHOLD } from '@background/storage-repository';
import type { MockAdapter } from '@adapters/mock-adapter';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { FieldApplyMessage } from '@shared/messages';

const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
const tab: NormalizedTab = {
  id: 10, windowId: 1, index: 0, url: 'https://example.com/page',
  title: 'Site Title', favIconUrl: 'https://site.example/favicon.ico',
  active: false, incognito: false, status: 'complete',
};

function contentAdapter(): MockAdapter {
  const base = createMockAdapter();
  return {
    ...base,
    tabs: {
      ...base.tabs,
      sendMessage(tabId: number, message: unknown) {
        base.calls.push({ method: 'tabs.sendMessage', args: [tabId, message] });
        const msg = message as FieldApplyMessage;
        if (msg?.type === 'FIELD_APPLY') {
          void import('@content/index').then((m) => { m.applyFieldMessage(msg); });
        }
        return Promise.resolve(undefined);
      },
    },
  };
}

function iconHrefs(): string[] {
  return Array.from(document.querySelectorAll('link[rel*="icon"]'))
    .map((l) => l.getAttribute('href'))
    .filter((h): h is string => h !== null);
}

const SMALL_PNG = `data:image/png;base64,${'B'.repeat(200)}`;
const LARGE_PNG = `data:image/png;base64,${'A'.repeat(ICON_OFFLOAD_THRESHOLD + 500)}`;

describe('review round 2 — issue 2, the icon the UI actually produces', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;

  beforeEach(async () => {
    document.head.innerHTML = '<link rel="icon" href="https://site.example/favicon.ico">';
    document.title = 'Site Title';
    adapter = contentAdapter();
    adapter.setWindows([win]);
    adapter.setTabs([tab]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
    const mod = await import('@content/index');
    mod.resetCapturedSite();
  });

  it('delivers a small Custom-Icon data URI (a UI-created icon)', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'T',
      favicon: { type: 'upload', value: SMALL_PNG },
    }, 0);
    expect(created.success).toBe(true);
    await new Promise((r) => setTimeout(r, 30));

    expect(document.title).toBe('T');
    expect(iconHrefs()).toContain(SMALL_PNG);
  });

  it('delivers a LARGE Custom-Icon data URI (offloaded to local storage)', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'T',
      favicon: { type: 'upload', value: LARGE_PNG },
    }, 0);
    expect(created.success).toBe(true);
    await new Promise((r) => setTimeout(r, 30));

    expect(document.title).toBe('T');
    // The offloaded icon must resolve back to the real data URI on delivery.
    expect(iconHrefs()).toContain(LARGE_PNG);
  });

  it('delivers an .ico URL icon (a non-PNG type)', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'T',
      favicon: { type: 'url', value: 'https://cdn.example.com/favicon.ico' },
    }, 0);
    expect(created.success).toBe(true);
    await new Promise((r) => setTimeout(r, 30));

    expect(iconHrefs()).toContain('https://cdn.example.com/favicon.ico');
  });
});