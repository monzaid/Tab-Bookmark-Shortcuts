import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import type { NormalizedWindow } from '@adapters/contract';

describe('T10: Page rules, field override computation, manual apply', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
  });

  describe('Happy path — rule creation and field computation', () => {
    it('should create auto rule and apply to matching tabs', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 10,
        title: 'Custom Title',
      }, 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rule.id).toContain('rule-');
        expect(result.rule.priority).toBe(10);
      }

      // Verify rewrite was delivered via scripting.executeScript
      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      expect(execCalls.length).toBeGreaterThan(0);
    });

    it('should compute fields with override → rule → site chain', async () => {
      // Create a rule
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 5,
        title: 'Rule Title',
      }, 0);

      // Set tab override
      await service.setTabOverride(1, 'Override Title');

      // Compute: override wins for title
      const computed = await service.computeFields(1, 'https://example.com/page', 'Site Title', 'site-favicon.ico');
      expect(computed.title).toBe('Override Title');
      expect(computed.titleSource).toBe('override');
    });

    it('should select highest priority rule when multiple match', async () => {
      await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        mode: 'auto',
        priority: 5,
        title: 'Low Priority',
      }, 0);

      await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/page' },
        mode: 'auto',
        priority: 10,
        title: 'High Priority',
      }, 1);

      const computed = await service.computeFields(1, 'https://example.com/page', 'Site', '');
      expect(computed.title).toBe('High Priority');
      expect(computed.titleSource).toBe('rule');
    });

    it('should return manual candidates across windows', async () => {
      adapter.setWindows([
        { id: 1, focused: true, incognito: false, type: 'normal' },
        { id: 2, focused: false, incognito: false, type: 'normal' },
      ]);
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://example.com/a', title: 'A', favIconUrl: '', active: true, incognito: false, status: 'complete' },
        { id: 2, windowId: 2, index: 0, url: 'https://example.com/b', title: 'B', favIconUrl: '', active: false, incognito: false, status: 'complete' },
      ]);

      const createResult = await service.createRule({
        urlMatch: { type: 'regex', value: 'https://example\\.com/.*' },
        mode: 'manual',
        priority: 0,
        title: 'Manual Rule',
      }, 0);

      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const candidates = await service.getManualCandidates(createResult.rule.id);
      expect(candidates.success).toBe(true);
      if (candidates.success) {
        expect(candidates.candidates).toHaveLength(2);
        // Current window first
        expect(candidates.candidates[0].isCurrentWindow).toBe(true);
      }
    });
  });

  describe('Error path — protected URL, conflicts, manual restrictions', () => {
    it('should reject rule for protected URL', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'chrome://settings' },
        mode: 'auto',
        priority: 0,
      }, 0);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_PROTECTED_URL');
      }
    });

    it('should block identical exact URL rules', async () => {
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'auto',
        priority: 0,
      }, 0);

      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'manual',
        priority: 5,
      }, 1);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Identical URL pattern → duplicate detection takes precedence
        expect(result.errorCode).toBe('DUPLICATE_RULE');
      }
    });

    it('should reject invalid regex', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'regex', value: '(' },
        mode: 'auto',
        priority: 0,
      }, 0);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_INVALID_REGEX');
      }
    });

    it('should reject regex exceeding 500 chars', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'regex', value: 'a'.repeat(501) },
        mode: 'auto',
        priority: 0,
      }, 0);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('RULE_REGEX_TOO_LONG');
      }
    });

    it('should not auto-apply manual rules', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/page' },
        mode: 'manual',
        priority: 0,
        title: 'Manual Only',
      }, 0);

      // No delivery should have been triggered for manual rules
      const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
      const sendCalls = adapter.calls.filter((c) => c.method === 'tabs.sendMessage');
      expect(execCalls).toHaveLength(0);
      expect(sendCalls).toHaveLength(0);
    });

    it('should reject apply to protected page tab', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'chrome://extensions', title: 'Extensions', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      const createResult = await service.createRule({
        urlMatch: { type: 'regex', value: '.*' },
        mode: 'manual',
        priority: 0,
        title: 'Test',
      }, 0);

      if (!createResult.success) return;

      const result = await service.applyToTab(createResult.rule.id, 1);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('PROTECTED_PAGE');
      }
    });

    it('should clamp priority to -100..100', async () => {
      const result = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://example.com/clamp' },
        mode: 'auto',
        priority: 999,
      }, 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rule.priority).toBe(100);
      }
    });
  });

  // ─── B9 (T9): favicon protocol allowlist ─────────────────────────────────
  //
  // The security goal is to close the DANGEROUS-PROTOCOL injection surface
  // (javascript: / file: / blob: / data:text/html), NOT to ban remote favicons.
  // http(s) values MUST keep flowing — three existing integration suites assert
  // that behaviour (rule-delivery-real-dom / rule-apply-persistence /
  // rule-delivery-robust).
  describe('B9 — resolveSlotField favicon protocol allowlist', () => {
    const slotId = 1;
    const tabId = 7;

    async function seedSlot(favicon: string): Promise<void> {
      adapter.setTabs([
        { id: tabId, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      const saved = await repo.saveSlot(
        {
          id: slotId,
          urlMatch: { type: 'exact', value: 'https://example.com/page' },
          strategy: 'inherit',
          uiMarker: {},
          titleSnapshot: 'Example',
          faviconSnapshot: favicon,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        0,
      );
      expect(saved.success).toBe(true);
      await repo.setBinding({ slotId, tabId, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
    }

    it('should reject javascript: favicon (favicon === null)', async () => {
      await seedSlot('javascript:alert(1)');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBeNull();
    });

    it('should reject file: favicon', async () => {
      await seedSlot('file:///etc/passwd');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBeNull();
    });

    it('should reject data:text/html favicon', async () => {
      await seedSlot('data:text/html,<script>alert(1)</script>');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBeNull();
    });

    it('should reject blob: favicon', async () => {
      await seedSlot('blob:https://example.com/1234');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBeNull();
    });

    it('should ALLOW an https favicon (remote icon link must keep working)', async () => {
      await seedSlot('https://remote.example/icon.png');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBe('https://remote.example/icon.png');
    });

    it('should ALLOW an http favicon', async () => {
      await seedSlot('http://remote.example/icon.png');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBe('http://remote.example/icon.png');
    });

    it('should ALLOW a data:image/png favicon', async () => {
      await seedSlot('data:image/png;base64,iVBORw0KGgo=');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('should reject data:image/svg+xml (script-capable SVG vector)', async () => {
      await seedSlot('data:image/svg+xml,<svg onload=alert(1)>');
      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBeNull();
    });

    it('B7b: reapplyToMatchingTabs reads sync state only once regardless of tab count', async () => {
      // 6 tabs all matching the same rule
      adapter.setTabs(
        Array.from({ length: 6 }, (_, i) => ({
          id: i + 1,
          windowId: 1,
          index: i,
          url: `https://multi.example/p${String(i)}`,
          title: `Tab ${String(i)}`,
          favIconUrl: '',
          active: i === 0,
          incognito: false,
          status: 'complete' as const,
        })),
      );

      const created = await service.createRule({
        urlMatch: { type: 'regex', value: '^https://multi\\.example/' },
        mode: 'manual',
        priority: 5,
        title: 'Multi',
      }, 0);
      expect(created.success).toBe(true);

      // `getSyncState()` is memory-cached, so IPC counting cannot observe the
      // fan-out — count the state READ itself, which is what B7b collapses.
      const stateReadSpy = vi.spyOn(repo, 'getSyncState');

      // Drive the private reapply path directly (same cast style as other tests).
      await (
        service as unknown as {
          reapplyToMatchingTabs: (r: unknown, clearOnEmpty?: boolean) => Promise<void>;
        }
      ).reapplyToMatchingTabs({ urlMatch: { type: 'regex', value: '^https://multi\\.example/' } });

      // 6 matching tabs must NOT cause 6 state reads.
      expect(stateReadSpy.mock.calls.length).toBeLessThanOrEqual(2);
      stateReadSpy.mockRestore();
    });

    it('B12: reapplyToMatchingTabs delivers to every matching tab with bounded concurrency', async () => {
      const TAB_COUNT = 20;
      adapter.setTabs(
        Array.from({ length: TAB_COUNT }, (_, i) => ({
          id: i + 1,
          windowId: 1,
          index: i,
          url: `https://shard.example/p${String(i)}`,
          title: `Tab ${String(i)}`,
          favIconUrl: '',
          active: i === 0,
          incognito: false,
          status: 'complete' as const,
        })),
      );

      // An AUTO rule is required: the field chain only considers `mode === 'auto'`,
      // and without computed title/favicon applyFieldsToTab skips delivery entirely.
      const created = await service.createRule({
        urlMatch: { type: 'regex', value: '^https://shard\\.example/' },
        mode: 'auto',
        priority: 5,
        title: 'Sharded',
      }, 0);
      expect(created.success).toBe(true);
      if (!created.success) return;

      // Snapshot the real executeScript, then instrument concurrency on top.
      const originalExecute = adapter.scripting.executeScript.bind(adapter.scripting);
      let inFlight = 0;
      let peak = 0;
      const delivered: number[] = [];

      adapter.scripting.executeScript = async (options) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        delivered.push(options.target.tabId);
        try {
          await new Promise((r) => setTimeout(r, 1));
          return await originalExecute(options);
        } finally {
          inFlight--;
        }
      };

      try {
        await (
          service as unknown as {
            reapplyToMatchingTabs: (r: unknown, clearOnEmpty?: boolean) => Promise<void>;
          }
        ).reapplyToMatchingTabs(created.rule);
      } finally {
        adapter.scripting.executeScript = originalExecute;
      }

      // Every matching tab must be delivered exactly once
      expect(new Set(delivered).size).toBe(TAB_COUNT);
      expect(delivered).toHaveLength(TAB_COUNT);
      // Concurrency must be bounded (serial baseline would peak at 1)
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
    });

    it('B7b: computeFields output is unchanged by the pure-function refactor', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://equiv.example/page', title: 'Site', favIconUrl: 'https://site.example/f.ico', active: true, incognito: false, status: 'complete' },
      ]);

      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://equiv.example/page' },
        mode: 'auto',
        priority: 5,
        title: 'Rule Title',
        favicon: { type: 'url', value: 'https://rule.example/icon.png' },
      }, 0);

      // Rule tier
      const ruleOnly = await service.computeFields(1, 'https://equiv.example/page', 'Site', '');
      expect(ruleOnly).toMatchObject({
        title: 'Rule Title',
        favicon: 'https://rule.example/icon.png',
        titleSource: 'rule',
        faviconSource: 'rule',
      });

      // Override tier must beat the rule tier
      await service.setTabOverride(1, 'Override Title', { type: 'upload', value: 'data:image/png;base64,OVR' });
      const withOverride = await service.computeFields(1, 'https://equiv.example/page', 'Site', '');
      expect(withOverride).toMatchObject({
        title: 'Override Title',
        favicon: 'data:image/png;base64,OVR',
        titleSource: 'override',
        faviconSource: 'override',
      });

      // A tab with NO override and NO matching rule falls back to the site tier
      const otherTab = await service.computeFields(99, 'https://other.example/none', 'Site', '');
      expect(otherTab).toMatchObject({ title: null, favicon: null, titleSource: 'site', faviconSource: 'site' });
    });

    it('T33 (B9-8): the OVERRIDE tier must reject a dangerous favicon protocol', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      for (const dangerous of ['javascript:alert(1)', 'file:///etc/passwd', 'blob:https://x/y', 'data:text/html,<script>alert(1)</script>']) {
        await service.setTabOverride(1, undefined, { type: 'url', value: dangerous });
        const computed = await service.computeFields(1, 'https://example.com/page', 'Site', '');
        expect(computed.favicon, `override must not deliver ${dangerous}`).toBeNull();
        expect(computed.faviconSource).toBe('site');
      }
    });

    it('T33 (B9-8): the RULE tier must reject a dangerous favicon protocol', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://bad-rule.example/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);

      // Write the rule directly so we isolate the COMPUTE layer from the
      // write-layer rejection asserted separately below.
      const sync = await repo.getSyncState();
      await repo.writeSync(sync.configVersion, (state) => {
        state.rules.push({
          id: 'bad-rule',
          urlMatch: { type: 'exact', value: 'https://bad-rule.example/page' },
          mode: 'auto',
          priority: 5,
          favicon: { type: 'url', value: 'javascript:alert(1)' },
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        });
        return state;
      });

      const computed = await service.computeFields(1, 'https://bad-rule.example/page', 'Site', '');
      expect(computed.favicon, 'rule tier must not deliver a javascript: favicon').toBeNull();
      expect(computed.faviconSource).toBe('site');
    });

    it('T33 (B9-8): createRule/updateRule must reject a dangerous favicon value', async () => {
      const created = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://write.example/page' },
        mode: 'auto',
        priority: 1,
        title: 'T',
        favicon: { type: 'url', value: 'javascript:alert(1)' },
      }, 0);
      expect(created.success, 'createRule must reject a dangerous favicon').toBe(false);

      const direct = await service.createRule({
        urlMatch: { type: 'exact', value: 'https://write2.example/page' },
        mode: 'auto',
        priority: 1,
        favicon: { type: 'url', value: 'https://safe.example/i.png' },
      }, 0);
      expect(direct.success).toBe(true);
      if (direct.success) {
        const updated = await service.updateRule(direct.rule.id, {
          favicon: { type: 'url', value: 'data:text/html,<script>alert(1)</script>' },
        });
        expect(updated.success, 'updateRule must reject a dangerous favicon').toBe(false);
      }
    });

    it('T33 (B9-8): a SAFE override/rule favicon is still delivered', async () => {
      adapter.setTabs([
        { id: 1, windowId: 1, index: 0, url: 'https://safe-tier.example/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);
      await service.createRule({
        urlMatch: { type: 'exact', value: 'https://safe-tier.example/page' },
        mode: 'auto',
        priority: 5,
        favicon: { type: 'url', value: 'https://cdn.example.com/i.png' },
      }, 0);

      const ruleTier = await service.computeFields(1, 'https://safe-tier.example/page', 'Site', '');
      expect(ruleTier.favicon).toBe('https://cdn.example.com/i.png');
      expect(ruleTier.faviconSource).toBe('rule');

      await service.setTabOverride(1, undefined, { type: 'upload', value: 'data:image/png;base64,AAA' });
      const overrideTier = await service.computeFields(1, 'https://safe-tier.example/page', 'Site', '');
      expect(overrideTier.favicon).toBe('data:image/png;base64,AAA');
      expect(overrideTier.faviconSource).toBe('override');
    });

    it('should reject a dangerous protocol coming from uiMarker.icon.value too', async () => {
      adapter.setTabs([
        { id: tabId, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Example', favIconUrl: '', active: true, incognito: false, status: 'complete' },
      ]);
      await repo.saveSlot(
        {
          id: slotId,
          urlMatch: { type: 'exact', value: 'https://example.com/page' },
          strategy: 'inherit',
          uiMarker: { icon: { type: 'url', value: 'javascript:alert(1)' } },
          titleSnapshot: 'Example',
          faviconSnapshot: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        0,
      );
      await repo.setBinding({ slotId, tabId, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });

      const computed = await service.computeFields(tabId, 'https://example.com/page', 'Site', '');
      expect(computed.favicon).toBeNull();
    });
  });
});
