/**
 * T13 — `IconSource.textColor` must survive both round-trips.
 *
 * A recipe's text colour is part of its identity. If it is dropped, the renderer
 * falls back to `autoTextColor(background)` and the icon's appearance changes
 * SILENTLY — the same class of defect as F3 (a silent downgrade the user never
 * notices). This is why `textColor` was added to `IconSource` at all (C1).
 *
 * Two hops are asserted:
 *   1. storage  (write → `getSyncState`);
 *   2. package  (export-side portable → import-side back to `IconSource`).
 *
 * An ABSENT colour must stay absent — filling a default would be an undisclosed
 * tolerance, which C8 requires to be disclosed rather than silently applied.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { iconToPortable, portableToIcon } from '@shared/export-package';
import { computeDiff } from '@shared/import-diff';
import { defaultImportIntent } from '@shared/types';
import type { IconSource, PageRule, SyncState } from '@shared/types';
import type { ExportPackage } from '@shared/export-package';

const RECIPE: IconSource = {
  type: 'template',
  value: '',
  backgroundColor: '#000000',
  text: 'A',
  textColor: '#FF0000',
};

const rule = (favicon: IconSource): PageRule => ({
  id: 'rule-1',
  urlMatch: { type: 'exact', value: 'https://a.example/' },
  priority: 0,
  favicon,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('T13: IconSource.textColor survives storage and package round-trips', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
  });

  it('storage round-trip preserves textColor (and the rest of the recipe)', async () => {
    await repo.addRule(rule(RECIPE));

    const stored = (await repo.getSyncState()).rules[0].favicon!;

    // R2 materializes `value` at read time (to '' here — jsdom has no canvas),
    // but the recipe fields are untouched and remain the durable truth.
    expect(stored.type).toBe('template');
    expect(stored.backgroundColor).toBe('#000000');
    expect(stored.text).toBe('A');
    expect(stored.textColor).toBe('#FF0000');
  });

  it('package round-trip preserves textColor', () => {
    const portable = iconToPortable(RECIPE, 'icon:rule-1');
    expect(portable.kind).toBe('recipe');
    expect(portable.textColor).toBe('#FF0000');

    const back = portableToIcon(portable);
    expect(back).toEqual(RECIPE);
    expect(back.textColor).toBe('#FF0000');
  });

  it('an ABSENT textColor stays undefined (never silently defaulted)', () => {
    const bare: IconSource = { type: 'template', value: '', backgroundColor: '#123456', text: 'B' };

    expect(iconToPortable(bare, 'icon:rule-1').textColor).toBeUndefined();
    expect(portableToIcon(iconToPortable(bare, 'icon:rule-1')).textColor).toBeUndefined();

    // And through the diff's field signature, an absent colour is not a change.
    const sync: SyncState = {
      configVersion: 0,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [],
      rules: [rule(bare)],
    };
    const pkg: ExportPackage = {
      schemaVersion: 1,
      generator: { name: 't', version: '1' },
      exportedAt: 'x',
      scope: { rules: true },
      rules: [{ id: 'rule-1', urlMatch: { type: 'exact', value: 'https://a.example/' }, priority: 0, favicon: iconToPortable(bare, 'icon:rule-1') }],
    };
    const diff = computeDiff(pkg, sync, defaultImportIntent());
    const iconField = diff.records[0].fields.find((f) => f.field === 'icon');
    expect(iconField?.changed).toBe(false); // identical recipe ⇒ no spurious change
  });

  it('a DIFFERENT textColor is detected as a change (colour is part of identity)', () => {
    const sync: SyncState = {
      configVersion: 0,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [],
      rules: [rule(RECIPE)],
    };
    const pkg: ExportPackage = {
      schemaVersion: 1,
      generator: { name: 't', version: '1' },
      exportedAt: 'x',
      scope: { rules: true },
      rules: [{
        id: 'rule-1',
        urlMatch: { type: 'exact', value: 'https://a.example/' },
        priority: 0,
        favicon: { kind: 'recipe', bgColor: '#000000', text: 'A', textColor: '#00FF00' },
      }],
    };
    const diff = computeDiff(pkg, sync, defaultImportIntent());
    const iconField = diff.records[0].fields.find((f) => f.field === 'icon');
    expect(iconField?.changed).toBe(true);
  });
});