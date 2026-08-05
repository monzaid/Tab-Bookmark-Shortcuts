/**
 * Tests for critical bug fixes:
 * - Problem 1: setTabOverride must MERGE (not replace) — title then icon shouldn't wipe title
 * - Problem 2: setTabOverride must send APPLY_REWRITE with computed fields immediately
 * - Problem 6: updateRule must re-apply to matching tabs after save
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import type { NormalizedWindow, NormalizedTab } from '@adapters/contract';

describe('Tab Override Merge & Immediate Apply (Problems 1 & 2)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab1: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: 'orig.ico', active: true, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([tab1]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
  });

  it('should succeed on first setTabOverride call (no version conflict)', async () => {
    // First call should work — tabOverride is in local storage, no configVersion check
    await service.setTabOverride(10, 'New Title');

    const local = await repo.getLocalState();
    const override = local.tabOverrides.find((o) => o.tabId === 10);
    expect(override).toBeDefined();
    expect(override!.title).toBe('New Title');
  });

  it('should MERGE title and icon — setting icon must NOT wipe existing title', async () => {
    // Step 1: set title only
    await service.setTabOverride(10, 'Custom Title');

    // Step 2: set icon only (title should be preserved)
    await service.setTabOverride(10, undefined, { type: 'upload', value: 'data:image/png;base64,abc' });

    const local = await repo.getLocalState();
    const override = local.tabOverrides.find((o) => o.tabId === 10);
    expect(override).toBeDefined();
    expect(override!.title).toBe('Custom Title'); // MUST NOT be wiped
    expect(override!.favicon?.value).toBe('data:image/png;base64,abc');
  });

  it('should MERGE icon and title — setting title must NOT wipe existing icon', async () => {
    // Step 1: set icon only
    await service.setTabOverride(10, undefined, { type: 'upload', value: 'data:image/png;base64,xyz' });

    // Step 2: set title only (icon should be preserved)
    await service.setTabOverride(10, 'Another Title');

    const local = await repo.getLocalState();
    const override = local.tabOverrides.find((o) => o.tabId === 10);
    expect(override).toBeDefined();
    expect(override!.title).toBe('Another Title');
    expect(override!.favicon?.value).toBe('data:image/png;base64,xyz'); // MUST NOT be wiped
  });

  it('should apply override via executeScript immediately after setTabOverride', async () => {
    await service.setTabOverride(10, 'Immediate Title');

    const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
    expect(execCalls.length).toBeGreaterThan(0);

    const payload = (execCalls[execCalls.length - 1].args[0] as { args: unknown[] }).args[0] as { title?: string; force?: boolean };
    expect(payload.title).toBe('Immediate Title');
    expect(payload.force).toBe(true);
  });

  it('should send APPLY_REWRITE with merged favicon when only icon is updated', async () => {
    // Set title first
    await service.setTabOverride(10, 'Merged Title');
    // Clear call log
    adapter.calls.length = 0;

    // Now set icon — APPLY_REWRITE should include BOTH title and favicon
    await service.setTabOverride(10, undefined, { type: 'upload', value: 'data:icon' });

    const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
    expect(execCalls.length).toBeGreaterThan(0);

    const lastCall = execCalls[execCalls.length - 1];
    const payload = (lastCall.args[0] as { args: unknown[] }).args[0] as { title?: string; favicon?: string; force?: boolean };
    expect(payload.force).toBe(true);
    // Should include the merged title from previous override
    expect(payload.title).toBe('Merged Title');
    expect(payload.favicon).toBe('data:icon');
  });
});

describe('Rule Update Re-apply to Matching Tabs (Problem 6)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab1: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: '', active: true, incognito: false, status: 'complete' };
  const tab2: NormalizedTab = { id: 20, windowId: 1, index: 1, url: 'https://other.com/page', title: 'Other', favIconUrl: '', active: false, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([tab1, tab2]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
  });

  it('should re-apply to matching tabs after updateRule changes title', async () => {
    // Create auto rule matching tab1
    const createResult = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'V1 Title',
    }, 0);
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    // Clear calls from creation
    adapter.calls.length = 0;

    // Update the rule title (no version marker — skips lightweight version check)
    const updateResult = await service.updateRule(createResult.rule.id, { title: 'V2 Title' });
    expect(updateResult.success).toBe(true);

    // Should have applied rewrite to matching tab (tab1) but NOT tab2 via executeScript
    const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
    expect(execCalls.length).toBeGreaterThan(0);

    // Verify the tab 10 (matching) got the apply with force
    const tab10Calls = execCalls.filter((c) => (c.args[0] as { target: { tabId: number } }).target.tabId === 10);
    expect(tab10Calls.length).toBeGreaterThan(0);
    const payload = (tab10Calls[0].args[0] as { args: unknown[] }).args[0] as { title?: string; force?: boolean };
    expect(payload.title).toBe('V2 Title');
    expect(payload.force).toBe(true);

    // tab 20 should NOT receive apply (doesn't match)
    const tab20Calls = execCalls.filter((c) => (c.args[0] as { target: { tabId: number } }).target.tabId === 20);
    expect(tab20Calls).toHaveLength(0);
  });

  it('should NOT deliver a rewrite when rule is disabled (nothing to override)', async () => {
    const createResult = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      mode: 'auto',
      priority: 5,
      title: 'Rule Title',
    }, 0);
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    adapter.calls.length = 0;

    // Disable the rule (no version marker — skips lightweight version check)
    const updateResult = await service.updateRule(createResult.rule.id, { enabled: false });
    expect(updateResult.success).toBe(true);

    // With the rule disabled there is no computed title/favicon to apply, so no
    // delivery occurs — the site recovers on refresh (no forced empty rewrite).
    const execCalls = adapter.calls.filter((c) => c.method === 'scripting.executeScript');
    const tab10Calls = execCalls.filter((c) => (c.args[0] as { target: { tabId: number } }).target.tabId === 10);
    expect(tab10Calls).toHaveLength(0);
    const sendCalls = adapter.calls.filter((c) => c.method === 'tabs.sendMessage');
    expect(sendCalls).toHaveLength(0);
  });
});
