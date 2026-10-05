import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import { WorkerOrchestrator } from '@background/worker-orchestrator';
import { FieldDeliveryService } from '@background/field-delivery-service';
import { ICON_OFFLOAD_THRESHOLD } from '@background/storage-repository';
import type { RecipeRenderer } from '@background/recipe-renderer';
import { wildcardToRegex } from '@shared/url-utils';
import type { MockAdapter } from '@adapters/mock-adapter';
import type { NormalizedTab, NormalizedWindow } from '@adapters/contract';
import type { FieldApplyMessage } from '@shared/messages';

/**
 * Real-browser delivery gap tests (T8 representation migration).
 *
 * The mock-based suites only assert a channel WAS CALLED. These tests run the
 * ACTUAL delivery logic against a real jsdom document, so the title/favicon are
 * verified to genuinely land in the page.
 *
 * C2 migration: the content script is now the PRIMARY implementation, so the
 * capture adapter routes `tabs.sendMessage({type:'FIELD_APPLY'})` into the real
 * `src/content/index.ts` handlers instead of capturing an `executeScript`
 * function. The behavioural intents (real DOM rewrite, ALL matching tabs,
 * refresh persistence, regex matching) are unchanged.
 */

type CapturedApply = { tabId: number; message: FieldApplyMessage };

// ─── Helper: mock adapter that routes FIELD_APPLY into the content script ────
function makeContentAdapter(capture: (call: CapturedApply) => void): MockAdapter {
  const base = createMockAdapter();
  const wrapped: MockAdapter = {
    ...base,
    tabs: {
      ...base.tabs,
      sendMessage(tabId: number, message: unknown) {
        base.calls.push({ method: 'tabs.sendMessage', args: [tabId, message] });
        const msg = message as FieldApplyMessage;
        if (msg?.type === 'FIELD_APPLY') capture({ tabId, message: msg });
        return Promise.resolve(undefined);
      },
    },
  };
  return wrapped;
}

const window: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

function baseTab(id: number, url: string, title = 'Original'): NormalizedTab {
  return { id, windowId: 1, index: id, url, title, favIconUrl: '', active: false, incognito: false, status: 'complete' };
}

/** Reset the jsdom document to a clean state with an old favicon + head. */
function resetDocument(): void {
  document.head.innerHTML = '<link rel="icon" href="https://old.example/favicon.ico">';
  document.title = '';
}

describe('Real-DOM delivery: the content script genuinely rewrites the tab', () => {
  let adapter: MockAdapter;
  let repo: StorageRepository;
  let service: RuleService;
  let applies: CapturedApply[];
  const contentMod = { applyFieldMessage: null as unknown as (m: FieldApplyMessage) => void, resetCapturedSite: null as unknown as () => void };

  const tab = baseTab(1, 'https://example.com/page');

  beforeEach(async () => {
    resetDocument();
    applies = [];
    adapter = makeContentAdapter((c) => applies.push(c));
    adapter.setWindows([window]);
    adapter.setTabs([tab]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
    // Production wiring (A2): inject the delivery coordinator.
    const delivery = new FieldDeliveryService(adapter, repo);
    service.setDelivery((tabIds) => delivery.recomputeAndRedeliver(tabIds));

    const mod = await import('@content/index');
    contentMod.applyFieldMessage = mod.applyFieldMessage;
    contentMod.resetCapturedSite = mod.resetCapturedSite;
    contentMod.resetCapturedSite();
  });

  it('sets document.title and inserts our favicon link in a real DOM', async () => {
    const result = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Delivered Title',
      favicon: { type: 'url', value: 'https://new.example/icon.png' },
    }, 0);
    expect(result.success).toBe(true);

    expect(applies.length).toBeGreaterThan(0);
    contentMod.applyFieldMessage(applies[0].message);

    expect(document.title).toBe('Delivered Title');
    const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));
    // Review round 2 (issue 2): ours REPLACES the site link. Keeping both left
    // the site icon winning, so the tab appeared not to update its icon.
    expect(iconLinks.length).toBe(1);
    expect(iconLinks[0].getAttribute('href')).toBe('https://new.example/icon.png');
  });

  it('B9: refuses to inject a javascript: favicon into the DOM', async () => {
    contentMod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: 'javascript:alert(1)' } });

    const hrefs = Array.from(document.querySelectorAll('link[rel*="icon"]')).map((l) => l.getAttribute('href'));
    expect(hrefs).not.toContain('javascript:alert(1)');
    expect(hrefs.filter((h) => h !== null && h.startsWith('javascript:'))).toHaveLength(0);
  });

  it('B9: still injects an https favicon (legitimate path unaffected)', async () => {
    contentMod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: 'https://new.example/icon.png' } });

    const hrefs = Array.from(document.querySelectorAll('link[rel*="icon"]')).map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('https://new.example/icon.png');
  });

  it('restores the ORIGINAL favicon link after a restore directive', async () => {
    contentMod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: 'https://new.example/icon.png' } });
    contentMod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'restore' } });

    const hrefs = Array.from(document.querySelectorAll('link[rel*="icon"]')).map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual(['https://old.example/favicon.ico']);
  });

  it('defers the favicon when document.head is initially null (document_start timing)', async () => {
    const headEl = document.head;
    Object.defineProperty(document, 'head', { configurable: true, value: null });

    contentMod.applyFieldMessage({ type: 'FIELD_APPLY', title: { kind: 'set', value: 'Early Title' } });
    expect(document.title).toBe('Early Title');
    // Favicon deferred (no head yet).
    contentMod.applyFieldMessage({ type: 'FIELD_APPLY', favicon: { kind: 'set', value: 'https://new.example/icon.png' } });

    // Simulate DOM becoming ready later and flushing the pending favicon.
    const mod = await import('@content/index');
    Object.defineProperty(document, 'head', { configurable: true, value: headEl });
    mod.flushPendingFavicon();
    await new Promise((r) => setTimeout(r, 20));

    const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));
    expect(iconLinks.some((l) => l.getAttribute('href') === 'https://new.example/icon.png')).toBe(true);
  });
});

// ─── Failure 1: Exact rule must deliver to ALL matching tabs ─────────────────

describe('Exact rule delivers to EVERY matching tab (real DOM)', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;

  const tabA = baseTab(10, 'https://example.com/page', 'A');
  const tabB = baseTab(11, 'https://example.com/page', 'B');
  const tabC = baseTab(12, 'https://example.com/page', 'C');
  const tabDiff = baseTab(13, 'https://other.com/x', 'Other');

  beforeEach(async () => {
    resetDocument();
    adapter = makeContentAdapter(() => undefined);
    adapter.setWindows([window]);
    adapter.setTabs([tabA, tabB, tabC, tabDiff]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();
  });

  it('delivers the rewrite for every matching tab (not just one)', async () => {
    const result = await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rewritten',
    }, 0);
    expect(result.success).toBe(true);

    const deliveredTabs = adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage')
      .map((c) => c.args[0] as number);

    expect(deliveredTabs).toContain(10);
    expect(deliveredTabs).toContain(11);
    expect(deliveredTabs).toContain(12);
    expect(deliveredTabs).not.toContain(13);
  });
});

// ─── Failure 2: Refresh persistence genuinely re-delivers to the DOM ─────────

describe('tabs.onUpdated re-delivers the rewrite (refresh persistence)', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;

  const tab = baseTab(10, 'https://example.com/page');

  beforeEach(async () => {
    resetDocument();
    adapter = makeContentAdapter(() => undefined);
    adapter.setWindows([window]);
    adapter.setTabs([tab]);
    worker = new WorkerOrchestrator(adapter);
    await worker.initialize();

    await worker.ruleService.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Persisted',
      favicon: { type: 'url', value: 'https://new.example/icon.png' },
    }, 0);

    // Simulate the page being refreshed: the DOM resets to original, then the
    // worker re-applies on tabs.onUpdated status==='complete'.
    resetDocument();
    adapter.calls.length = 0;
  });

  it('re-delivers title+favicon after a refresh and they land in the real DOM', async () => {
    adapter.emitTabUpdated(10, { status: 'complete' }, tab);
    await new Promise((r) => setTimeout(r, 80));

    const sends = adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage' && c.args[0] === 10)
      .map((c) => c.args[1] as FieldApplyMessage)
      .filter((m) => m?.type === 'FIELD_APPLY');
    expect(sends.length).toBeGreaterThan(0);

    const mod = await import('@content/index');
    mod.resetCapturedSite();
    mod.applyFieldMessage(sends[sends.length - 1]);

    expect(document.title).toBe('Persisted');
    const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));
    expect(iconLinks.some((l) => l.getAttribute('href') === 'https://new.example/icon.png')).toBe(true);
  });
});

// ─── Failure 3: Regex rule matches tabs + delivers ───────────────────────────

describe('Regex rule (wildcard-converted) matches and delivers to real DOM', () => {
  let adapter: MockAdapter;
  let worker: WorkerOrchestrator;

  const conversion = wildcardToRegex('https://example.com/*');
  const storedRegex = conversion.pattern;

  const tabA = baseTab(10, 'https://example.com/a');
  const tabB = baseTab(11, 'https://example.com/b');
  const tabDiff = baseTab(12, 'https://other.com/x');

  beforeEach(async () => {
    resetDocument();
    adapter = makeContentAdapter(() => undefined);
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
      priority: 5,
      title: 'Regex Delivered',
    }, 0);
    expect(result.success).toBe(true);

    const deliveredTabs = adapter.calls
      .filter((c) => c.method === 'tabs.sendMessage')
      .map((c) => c.args[0] as number);

    expect(deliveredTabs).toContain(10);
    expect(deliveredTabs).toContain(11);
    expect(deliveredTabs).not.toContain(12);

    // The delivered directive genuinely sets the title in a real DOM.
    const first = adapter.calls.find((c) => c.method === 'tabs.sendMessage')!;
    const mod = await import('@content/index');
    mod.resetCapturedSite();
    mod.applyFieldMessage(first.args[1] as FieldApplyMessage);
    expect(document.title).toBe('Regex Delivered');
  });
});

// ─── R2: a RECIPE genuinely reaches link.href as a PNG ───────────────────────
// This is the coverage whose ABSENCE let the BLOCKER hide: every existing
// delivery test used `type:'url'|'upload'`, so a `type:'template'` recipe was
// never exercised end-to-end. It must land in the real DOM as `data:image/png`,
// NOT as an SVG (the page gate drops svg+xml) and NOT as an empty href.

describe('R2: a template recipe is delivered to link.href as a PNG', () => {
  let adapter: MockAdapter;
  let repo: StorageRepository;
  let service: RuleService;
  let applies: CapturedApply[];
  const contentMod = { applyFieldMessage: null as unknown as (m: FieldApplyMessage) => void, resetCapturedSite: null as unknown as () => void };

  const tab = baseTab(1, 'https://example.com/page');
  const PNG = 'data:image/png;base64,AAAA';

  beforeEach(async () => {
    resetDocument();
    applies = [];
    adapter = makeContentAdapter((c) => applies.push(c));
    adapter.setWindows([window]);
    adapter.setTabs([tab]);
    repo = new StorageRepository(adapter);
    // jsdom has no OffscreenCanvas — inject a PNG-producing renderer, exactly as
    // the real `RecipeRenderer` would produce.
    repo.setRecipeRenderer({
      renderForResolution: () => Promise.resolve(PNG),
    } as unknown as RecipeRenderer);
    await repo.initialize();

    service = new RuleService(adapter, repo);
    const delivery = new FieldDeliveryService(adapter, repo);
    service.setDelivery((tabIds) => delivery.recomputeAndRedeliver(tabIds));

    const mod = await import('@content/index');
    contentMod.applyFieldMessage = mod.applyFieldMessage;
    contentMod.resetCapturedSite = mod.resetCapturedSite;
    contentMod.resetCapturedSite();
  });

  it('sets the page favicon to the rendered PNG (not svg, not empty)', async () => {
    const result = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      favicon: { type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' },
    }, 0);
    expect(result.success).toBe(true);

    expect(applies.length).toBeGreaterThan(0);
    contentMod.applyFieldMessage(applies[0].message);

    const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));
    expect(iconLinks.length).toBe(1);
    const href = iconLinks[0].getAttribute('href') ?? '';
    expect(href.startsWith('data:image/png')).toBe(true);
    expect(href).not.toContain('svg');
    expect(href).not.toBe('');
  });

  it('keeps the recipe EDITABLE after read (type + fields preserved)', async () => {
    await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      favicon: { type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' },
    }, 0);

    const stored = (await repo.getSyncState()).rules[0].favicon!;
    expect(stored.type).toBe('template'); // the chain/UI still knows it is a recipe
    expect(stored.backgroundColor).toBe('#2563EB');
    expect(stored.text).toBe('A');
    expect(stored.textColor).toBe('#FFFFFF');
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