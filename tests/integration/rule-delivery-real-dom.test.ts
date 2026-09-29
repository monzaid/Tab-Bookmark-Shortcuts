import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import { ICON_OFFLOAD_THRESHOLD } from '@background/storage-repository';
import { wildcardToRegex } from '@shared/url-utils';
import type { MockAdapter } from '@adapters/mock-adapter';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';

/**
 * Real-browser delivery gap tests.
 *
 * The mock-based tests only assert `scripting.executeScript` was CALLED. They
 * never run the injected function against a real DOM, so `document.head` timing
 * bugs and genuine multi-tab / persistence delivery failures go undetected.
 *
 * These tests run the ACTUAL injected function against a real jsdom document
 * and verify the title/favicon genuinely land in the tab — the exact thing the
 * manual browser acceptance checks.
 */

// ─── Helper: mock adapter whose executeScript CAPTURES the injected func ─────
// Emulates chrome.scripting.executeScript (which invokes func in the page doc).

type InjectedCall = { func: (...args: unknown[]) => unknown; args: unknown[] };

function makeCaptureAdapter(capture: (call: InjectedCall) => void): MockAdapter {
  const base = createMockAdapter();
  const wrapped: MockAdapter = {
    ...base,
    scripting: {
      executeScript(options) {
        base.calls.push({ method: 'scripting.executeScript', args: [options] });
        capture({ func: options.func, args: options.args ?? [] });
        return Promise.resolve([undefined]);
      },
    },
  };
  return wrapped;
}

// ─── Shared fixture ───────────────────────────────────────────────────────────

const window: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

function baseTab(id: number, url: string, title = 'Original'): NormalizedTab {
  return { id, windowId: 1, index: id, url, title, favIconUrl: '', active: false, incognito: false, status: 'complete' };
}

/** Reset the jsdom document to a clean state with an old favicon + head. */
function resetDocument(): void {
  document.head.innerHTML = '<link rel="icon" href="https://old.example/favicon.ico">';
  document.title = '';
}

describe('Real-DOM delivery: the injected function genuinely rewrites the tab', () => {
  let adapter: MockAdapter;
  let repo: StorageRepository;
  let service: RuleService;
  let calls: InjectedCall[];

  const tab = baseTab(1, 'https://example.com/page');

  beforeEach(async () => {
    resetDocument();
    calls = [];
    adapter = makeCaptureAdapter((c) => calls.push(c));
    adapter.setWindows([window]);
    adapter.setTabs([tab]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
  });

  it('sets document.title and swaps the favicon link in a real DOM', async () => {
    const result = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'Delivered Title',
      favicon: { type: 'url', value: 'https://new.example/icon.png' },
    }, 0);
    expect(result.success).toBe(true);

    expect(calls.length).toBeGreaterThan(0);
    const c = calls[0];
    c.func(c.args[0]);

    expect(document.title).toBe('Delivered Title');
    const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));
    expect(iconLinks.length).toBe(1);
    expect(iconLinks[0].getAttribute('href')).toBe('https://new.example/icon.png');
  });

  it('B9: refuses to inject a javascript: favicon into the DOM', async () => {
    // Create a rule to obtain the injected function reference (captured above).
    await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'Safe Title',
      favicon: { type: 'url', value: 'https://new.example/icon.png' },
    }, 0);

    const c = calls[0];
    c.func({ favicon: 'javascript:alert(1)' });

    const hrefs = Array.from(document.querySelectorAll('link[rel*="icon"]')).map((l) => l.getAttribute('href'));
    expect(hrefs).not.toContain('javascript:alert(1)');
    // The previous (site) icon is removed and NOT replaced with anything unsafe
    expect(hrefs.filter((h) => h !== null && h.startsWith('javascript:'))).toHaveLength(0);
  });

  it('B9: still injects an https favicon (legitimate path unaffected)', async () => {
    await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'Safe Title',
      favicon: { type: 'url', value: 'https://unused.example/icon.png' },
    }, 0);

    const c = calls[0];
    c.func({ favicon: 'https://new.example/icon.png' });

    const hrefs = Array.from(document.querySelectorAll('link[rel*="icon"]')).map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('https://new.example/icon.png');
  });

  it('applies the favicon even when document.head is initially null (document_start timing)', async () => {
    const headEl = document.head;
    Object.defineProperty(document, 'head', { configurable: true, value: null });

    const result = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'Early Title',
      favicon: { type: 'url', value: 'https://new.example/icon.png' },
    }, 0);
    expect(result.success).toBe(true);

    const c = calls[0];
    c.func(c.args[0]);
    expect(document.title).toBe('Early Title');

    // Simulate DOM becoming ready later.
    Object.defineProperty(document, 'head', { configurable: true, value: headEl });
    await new Promise((r) => setTimeout(r, 80));

    const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));
    expect(iconLinks.some((l) => l.getAttribute('href') === 'https://new.example/icon.png')).toBe(true);
  });
});

// ─── Failure 1: Exact rule must deliver to ALL matching tabs ─────────────────

describe('Exact rule delivers to EVERY matching tab (real DOM)', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;
  let calls: InjectedCall[];

  const tabA = baseTab(10, 'https://example.com/page', 'A');
  const tabB = baseTab(11, 'https://example.com/page', 'B');
  const tabC = baseTab(12, 'https://example.com/page', 'C');
  const tabDiff = baseTab(13, 'https://other.com/x', 'Other');

  beforeEach(async () => {
    resetDocument();
    calls = [];
    adapter = makeCaptureAdapter((c) => calls.push(c));
    adapter.setWindows([window]);
    adapter.setTabs([tabA, tabB, tabC, tabDiff]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('invokes the injected rewrite for every matching tab (not just one)', async () => {
    const result = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'Rewritten',
    }, 0);
    expect(result.success).toBe(true);

    // The capture adapter captured one executeScript per matching tab.
    const executedTabs = adapter.calls
      .filter((c) => c.method === 'scripting.executeScript')
      .map((c) => (c.args[0] as { target: { tabId: number } }).target.tabId);

    expect(executedTabs).toContain(10);
    expect(executedTabs).toContain(11);
    expect(executedTabs).toContain(12);
    expect(executedTabs).not.toContain(13);
  });
});

// ─── Failure 2: Refresh persistence genuinely re-delivers to the DOM ─────────

describe('tabs.onUpdated re-delivers the rewrite (refresh persistence)', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;
  let calls: InjectedCall[];

  const tab = baseTab(10, 'https://example.com/page');

  beforeEach(async () => {
    resetDocument();
    calls = [];
    adapter = makeCaptureAdapter((c) => calls.push(c));
    adapter.setWindows([window]);
    adapter.setTabs([tab]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();

    await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'Persisted',
      favicon: { type: 'url', value: 'https://new.example/icon.png' },
    }, 0);

    // Simulate the page being refreshed: the DOM resets to original, then the
    // worker re-applies on tabs.onUpdated status==='complete'.
    resetDocument();
    calls.length = 0;
    adapter.calls.length = 0;
  });

  it('re-applies title+favicon to the real DOM after a refresh', async () => {
    adapter.emitTabUpdated(10, { status: 'complete' }, tab);
    await new Promise((r) => setTimeout(r, 80));

    // The injected function must have been invoked again after the refresh.
    expect(calls.length).toBeGreaterThan(0);

    // Run the LAST injected call against the (now original) DOM.
    const c = calls[calls.length - 1];
    c.func(c.args[0]);

    expect(document.title).toBe('Persisted');
    const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));
    expect(iconLinks.some((l) => l.getAttribute('href') === 'https://new.example/icon.png')).toBe(true);
  });
});

// ─── Failure 3: Regex rule matches tabs + delivers ───────────────────────────

describe('Regex rule (wildcard-converted) matches and delivers to real DOM', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;
  let calls: InjectedCall[];

  const conversion = wildcardToRegex('https://example.com/*');
  const storedRegex = conversion.pattern;

  const tabA = baseTab(10, 'https://example.com/a');
  const tabB = baseTab(11, 'https://example.com/b');
  const tabDiff = baseTab(12, 'https://other.com/x');

  beforeEach(async () => {
    resetDocument();
    calls = [];
    adapter = makeCaptureAdapter((c) => calls.push(c));
    adapter.setWindows([window]);
    adapter.setTabs([tabA, tabB, tabDiff]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('stores a valid regex that matches and delivers to every matching tab', async () => {
    expect(conversion.converted).toBe(true);
    expect(storedRegex).toBe('https://example\\.com/.*');

    const result = await worker.ruleService.createRule({
      urlMatch: { type: 'regex', value: storedRegex },
      mode: 'auto',
      priority: 5,
      title: 'Regex Delivered',
    }, 0);
    expect(result.success).toBe(true);

    const executedTabs = adapter.calls
      .filter((c) => c.method === 'scripting.executeScript')
      .map((c) => (c.args[0] as { target: { tabId: number } }).target.tabId);

    expect(executedTabs).toContain(10);
    expect(executedTabs).toContain(11);
    expect(executedTabs).not.toContain(12);

    // The injected function must genuinely set the title in a real DOM.
    const c = calls[0];
    c.func(c.args[0]);
    expect(document.title).toBe('Regex Delivered');
  });
});

// ─── computeFields must resolve an offloaded local-icon favicon ──────────────

describe('computeFields resolves offloaded local-icon favicon to a real data URI', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([window]);
    adapter.setTabs([baseTab(1, 'https://example.com/page')]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
  });

  it('returns a real data URI (not the literal local-icon: reference) for an offloaded rule favicon', async () => {
    const bigDataUri = `data:image/png;base64,${'A'.repeat(ICON_OFFLOAD_THRESHOLD + 100)}`;

    const result = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      favicon: { type: 'upload', value: bigDataUri },
    }, 0);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const rawSync = adapter.state.syncStorage['syncState'] as {
      rules: Array<{ id: string; favicon?: { value: string } }>;
    };
    const storedRaw = rawSync.rules.find((r) => r.id === result.rule.id);
    expect(storedRaw?.favicon?.value.startsWith('local-icon:')).toBe(true);

    const computed = await service.computeFields(1, 'https://example.com/page', '', '');
    expect(computed.favicon).toBe(bigDataUri);
    expect(computed.favicon?.startsWith('local-icon:')).toBe(false);
  });
});