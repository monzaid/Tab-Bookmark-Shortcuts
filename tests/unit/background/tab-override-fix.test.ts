/**
 * T19 anchor migration — SEMANTIC-PRESERVED (representation adapted).
 *
 * The original Problems 1/2/6 assertions inspected `scripting.executeScript`
 * payloads carrying an `APPLY_REWRITE`-shaped `force` flag. C2/A2/A5 replaced
 * that: the content script is now the primary (and only) apply/restore
 * implementation, delivery goes out as a `FIELD_APPLY` message through
 * `tabs.sendMessage`, and `force` no longer exists.
 *
 * The underlying intents are UNCHANGED and still asserted here:
 *  - Problem 1: an override MERGE must not wipe the other field;
 *  - Problem 2: a field write must be delivered immediately;
 *  - Problem 6: a rule update must re-apply to matching tabs.
 *
 * Delivery is driven through the real `FieldDeliveryService` so the assertions
 * describe the production path rather than a stub.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { RuleService } from '@background/rule-service';
import { FieldDeliveryService } from '@background/field-delivery-service';
import type { NormalizedWindow, NormalizedTab } from '@adapters/contract';
import type { FieldApplyMessage } from '@shared/messages';

type AnyFieldApply = { tabId: number; message: FieldApplyMessage };

function fieldApplies(adapter: ReturnType<typeof createMockAdapter>): AnyFieldApply[] {
  return adapter.calls
    .filter((c) => c.method === 'tabs.sendMessage')
    .map((c) => ({ tabId: c.args[0] as number, message: c.args[1] as FieldApplyMessage }))
    .filter((c) => c.message?.type === 'FIELD_APPLY');
}

describe('Tab Override Merge & Immediate Delivery (Problems 1 & 2)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;
  let delivery: FieldDeliveryService;

  const currentWindow: NormalizedWindow = { id: 1, focused: true, incognito: false, type: 'normal' };
  const tab1: NormalizedTab = { id: 10, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Original', favIconUrl: 'orig.ico', active: true, incognito: false, status: 'complete' };

  beforeEach(async () => {
    adapter.reset();
    adapter.setWindows([currentWindow]);
    adapter.setTabs([tab1]);
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new RuleService(adapter, repo);
    delivery = new FieldDeliveryService(adapter, repo);
    service.setDelivery((tabIds) => delivery.recomputeAndRedeliver(tabIds));
  });

  it('should succeed on first setTabOverride call (no version conflict)', async () => {
    await service.setTabOverride(10, 'New Title');

    const local = await repo.getLocalState();
    const override = local.tabOverrides.find((o) => o.tabId === 10);
    expect(override).toBeDefined();
    expect(override!.title).toBe('New Title');
  });

  it('should MERGE title and icon — setting icon must NOT wipe existing title', async () => {
    await service.setTabOverride(10, 'Custom Title');
    await service.setTabOverride(10, undefined, { type: 'upload', value: 'data:image/png;base64,abc' });

    const local = await repo.getLocalState();
    const override = local.tabOverrides.find((o) => o.tabId === 10);
    expect(override).toBeDefined();
    expect(override!.title).toBe('Custom Title'); // MUST NOT be wiped
    expect(override!.favicon?.value).toBe('data:image/png;base64,abc');
  });

  it('should MERGE icon and title — setting title must NOT wipe existing icon', async () => {
    await service.setTabOverride(10, undefined, { type: 'upload', value: 'data:image/png;base64,xyz' });
    await service.setTabOverride(10, 'Another Title');

    const local = await repo.getLocalState();
    const override = local.tabOverrides.find((o) => o.tabId === 10);
    expect(override).toBeDefined();
    expect(override!.title).toBe('Another Title');
    expect(override!.favicon?.value).toBe('data:image/png;base64,xyz'); // MUST NOT be wiped
  });

  it('should deliver a FIELD_APPLY set immediately after setTabOverride', async () => {
    await service.setTabOverride(10, 'Immediate Title');

    const applies = fieldApplies(adapter).filter((c) => c.tabId === 10);
    expect(applies.length).toBeGreaterThan(0);
    expect(applies[applies.length - 1].message.title).toEqual({ kind: 'set', value: 'Immediate Title' });
  });

  it('should deliver the MERGED favicon payload when only the icon is updated', async () => {
    await service.setTabOverride(10, 'Merged Title');
    adapter.calls.length = 0;

    const iconValue = 'data:image/png;base64,SUM=';
    await service.setTabOverride(10, undefined, { type: 'upload', value: iconValue });

    const applies = fieldApplies(adapter).filter((c) => c.tabId === 10);
    expect(applies.length).toBeGreaterThan(0);
    const last = applies[applies.length - 1].message;
    expect(last.title).toEqual({ kind: 'set', value: 'Merged Title' });
    expect(last.favicon).toEqual({ kind: 'set', value: iconValue });
  });
});

describe('Rule Update Re-apply to Matching Tabs (Problem 6)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: RuleService;
  let delivery: FieldDeliveryService;

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
    delivery = new FieldDeliveryService(adapter, repo);
    service.setDelivery((tabIds) => delivery.recomputeAndRedeliver(tabIds));
  });

  it('should re-apply to matching tabs after updateRule changes title', async () => {
    const createResult = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'V1 Title',
    }, 0);
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    adapter.calls.length = 0;

    const updateResult = await service.updateRule(createResult.rule.id, { title: 'V2 Title' });
    expect(updateResult.success).toBe(true);

    const applies = fieldApplies(adapter);
    // tab 10 matches → delivered with the new value.
    const tab10 = applies.filter((c) => c.tabId === 10);
    expect(tab10.length).toBeGreaterThan(0);
    expect(tab10[0].message.title).toEqual({ kind: 'set', value: 'V2 Title' });
    // tab 20 does not match → never delivered.
    expect(applies.filter((c) => c.tabId === 20)).toHaveLength(0);
  });

  it('should not deliver a rewrite when the rule is disabled (nothing to override)', async () => {
    const createResult = await service.createRule({
      urlMatch: { type: 'exact', value: 'https://example.com/page' },
      priority: 5,
      title: 'Rule Title',
    }, 0);
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    adapter.calls.length = 0;

    const updateResult = await service.updateRule(createResult.rule.id, { enabled: false });
    expect(updateResult.success).toBe(true);

    // The chain no longer yields a value for the (un-captured) site tier, so the
    // directive is `none` — nothing is written to the page.
    const applies = fieldApplies(adapter).filter((c) => c.tabId === 10);
    for (const a of applies) {
      expect(a.message.title).toEqual({ kind: 'none' });
      expect(a.message.favicon).toEqual({ kind: 'none' });
    }
  });
});