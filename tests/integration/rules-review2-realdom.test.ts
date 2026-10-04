/**
 * Manual review, round 2 — issues 2 and 3 verified in a REAL DOM.
 *
 * Issue 2: "the rule list shows a title but the matching tab only got the TITLE,
 *          not the icon."
 * Issue 3: "the Dashboard rule-hit row says `Tab x updated`, but the row never
 *          gets a title/icon and the tab is never updated (a manual refresh
 *          does not help either)."
 *
 * The channel assertions elsewhere prove a message WAS SENT. These tests route
 * that message into the actual content-script handler and read `document`, so
 * they fail on precisely the reported symptom: the icon/title did not land.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import type { MockAdapter } from '@adapters/mock-adapter';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { FieldApplyMessage } from '@shared/messages';

const win: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

function baseTab(id: number, url: string, title = 'Site Title'): NormalizedTab {
  return {
    id, windowId: 1, index: id, url, title,
    favIconUrl: 'https://site.example/favicon.ico',
    active: false, incognito: false, status: 'complete',
  };
}

function resetDocument(): void {
  document.head.innerHTML = '<link rel="icon" href="https://site.example/favicon.ico">';
  document.title = 'Site Title';
}

/** Route FIELD_APPLY into the real content script. */
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
          // Fire-and-forget into the real page handler.
          void import('@content/index').then((m) => { m.applyFieldMessage(msg); });
        }
        return Promise.resolve(undefined);
      },
    },
  };
}

/** Every favicon href currently in the document. */
function iconHrefs(): string[] {
  return Array.from(document.querySelectorAll('link[rel*="icon"]'))
    .map((l) => l.getAttribute('href'))
    .filter((h): h is string => h !== null);
}

describe('review round 2 — rule writes land in the real DOM', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;

  const tab = baseTab(10, 'https://example.com/page');

  beforeEach(async () => {
    resetDocument();
    adapter = contentAdapter();
    adapter.setWindows([win]);
    adapter.setTabs([tab]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
    const mod = await import('@content/index');
    mod.resetCapturedSite();
  });

  it('issue 2: a rule with title AND icon puts BOTH into the page', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rule Title',
      favicon: { type: 'url', value: 'https://cdn.example.com/rule.png' },
    }, 0);
    expect(created.success).toBe(true);

    await new Promise((r) => setTimeout(r, 30));

    expect(document.title).toBe('Rule Title');
    expect(iconHrefs()).toContain('https://cdn.example.com/rule.png');
  });

  it('issue 3: editing a rule via the Dashboard path updates title AND icon in the page', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Before',
      favicon: { type: 'url', value: 'https://cdn.example.com/before.png' },
    }, 0);
    if (!created.success) throw new Error('setup failed');

    await new Promise((r) => setTimeout(r, 30));
    expect(document.title).toBe('Before');

    // The Dashboard `rule-hit` Save writes the rule (the UI's payload shape).
    const updated = await worker.ruleService.updateRule(created.rule.id, {
      title: 'After',
      favicon: { type: 'url', value: 'https://cdn.example.com/after.png' },
    });
    expect(updated.success).toBe(true);
    await new Promise((r) => setTimeout(r, 30));

    expect(document.title).toBe('After');
    expect(iconHrefs()).toContain('https://cdn.example.com/after.png');
  });

  it('issue 3: a title-only rule edit must NOT wipe the icon (no fall back to the site value)', async () => {
    const created = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Before',
      favicon: { type: 'url', value: 'https://cdn.example.com/keep.png' },
    }, 0);
    if (!created.success) throw new Error('setup failed');
    await new Promise((r) => setTimeout(r, 30));

    // A title-only update — exactly what an icon-untouched draft produces.
    const updated = await worker.ruleService.updateRule(created.rule.id, { title: 'After' });
    expect(updated.success).toBe(true);
    await new Promise((r) => setTimeout(r, 30));

    expect(document.title).toBe('After');
    // The rule icon must still be present; the site value must NOT have returned.
    expect(iconHrefs()).toContain('https://cdn.example.com/keep.png');
  });
});