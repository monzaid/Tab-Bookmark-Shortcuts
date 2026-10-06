import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { IconService } from '@background/icon-service';
import type { MatchRuleSettings, SlotDefinition } from '@shared/types';
import { defaultImportIntent } from '@shared/types';
import type { ExportPackage, PortableSettings, PortableSlotDef } from '@shared/export-package';

/**
 * T14b/T21: this file used to exercise the LEGACY trio
 * (`exportConfig` / `generatePreview` / `commitImport` + `applyBulkDecision`),
 * which was deleted with its contracts. The import-side invariants it only
 * covered are REBUILT here on the redesigned path (INSPECT + APPLY) rather than
 * dropped — the legacy `generatePreview` and the new `inspect` do NOT share
 * code, so deleting the cases would have opened a coverage vacuum (F1).
 *
 * Added in the same change: the Ruling-4 settings guard, asserted on BOTH new
 * entry points (INSPECT and APPLY parse the file independently, so covering one
 * would leave the other writable).
 *
 * REMOVED-CASE MAPPING (the suite is smaller by design — each legacy case either
 * moved or became obsolete; none was dropped for convenience):
 *   generatePreview: malformed JSON       → `structural gate` here
 *   generatePreview: unknown version /
 *                    missing slots array  → `structural gate` here (schemaVersion gate)
 *   generatePreview: T1 RED ④ (settings) → `Ruling 4 …` here (DUAL-PATH) +
 *                                          worker-import-export-rejection.test.ts
 *   generatePreview: dangerous regex (D15)→ `D15 …` here; also import-apply-result /
 *                                          import-icon-slot-clearing
 *   generatePreview: read-only             → `inspect writes nothing …` here
 *   exportConfig: excludes local data      → STRUCTURAL, not a test: the package
 *                                            schema (`PortableSlotDef`/`PortableRule`)
 *                                            has no local fields and
 *                                            `syncStateToPackage` reads `SyncState`
 *                                            only — nothing to assert per-case
 *   commitImport: per-slot decision /
 *                 keep-existing / bulk   → OBSOLETE: the intent + per-record
 *                                          override model replaced slot decisions
 *                                          (import-diff unit + import-flow ui-smoke)
 *   commitImport: stale version (TOCTOU)   → import-apply-version-binding.test.ts
 */

const SETTINGS_A: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'no-match', priority: 'tabId' };
const SETTINGS_B: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' };

const SETTINGS_DIM = (over: Partial<PortableSettings> = {}): PortableSettings => ({
  matchSettings: SETTINGS_A,
  switchDirection: 'next',
  autoBindGlobal: true,
  slotStrategies: {},
  ...over,
});

function pkgFile(parts: Partial<ExportPackage>): string {
  return JSON.stringify({
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-06T00:00:00.000Z',
    scope: {},
    ...parts,
  });
}

/** The PACKAGE shape (no strategy/timestamps) — what a file actually carries. */
const portableSlot = (id: number, url: string, type: 'exact' | 'regex' = 'exact'): PortableSlotDef => ({
  id,
  urlMatch: { type, value: url },
  marker: {},
  titleSnapshot: `Slot ${String(id)}`,
  faviconSnapshot: '',
});

/** The STORED shape (target machine). */
const storedSlot = (id: number, url: string): SlotDefinition => ({
  id,
  urlMatch: { type: 'exact', value: url },
  strategy: 'inherit',
  uiMarker: {},
  titleSnapshot: `Slot ${String(id)}`,
  faviconSnapshot: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('T14b/T21: import service (redesigned protocol)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  const apply = (file: string) =>
    service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());

  const rule = (id: string, value: string, type: 'exact' | 'regex' = 'exact') => ({
    id,
    urlMatch: { type, value },
    priority: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  describe('D15 — domain constraints are SKIPPED + disclosed, not a whole-apply rejection', () => {
    it('skips a package carrying a dangerous rule regex (good rules persist)', async () => {
      const result = await apply(pkgFile({
        rules: [rule('good', 'https://safe.com'), rule('evil', '^(a+){10}$', 'regex')],
        settings: SETTINGS_DIM(),
      }));

      expect(result.success, 'the apply proceeds by skipping the bad rule').toBe(true);
      if (!result.success) return;
      expect(result.result.domainViolations.length).toBeGreaterThan(0);
      const rules = (await repo.getSyncState()).rules;
      expect(rules.find((r) => r.id === 'evil'), 'the dangerous rule must not be persisted').toBeUndefined();
      expect(rules.find((r) => r.id === 'good')).toBeDefined();
    });

    it('skips a package carrying a dangerous slot regex (good slots persist)', async () => {
      const result = await apply(pkgFile({
        slots: [
          portableSlot(3, 'https://safe-3.com'),
          portableSlot(9, '^(.*a){20}$', 'regex'),
        ],
        settings: SETTINGS_DIM(),
      }));

      expect(result.success).toBe(true);
      const slots = (await repo.getSyncState()).slots;
      expect(slots.find((s) => s.id === 9)).toBeUndefined();
      expect(slots.find((s) => s.id === 3)).toBeDefined();
    });

    it('accepts a safe regex (it is persisted)', async () => {
      const result = await apply(pkgFile({
        rules: [rule('safe', '^https://example\\.com/.*$', 'regex')],
        settings: SETTINGS_DIM(),
      }));

      expect(result.success).toBe(true);
      expect((await repo.getSyncState()).rules.find((r) => r.id === 'safe')).toBeDefined();
    });
  });

  describe('structural gate — malformed input is rejected', () => {
    it('rejects malformed JSON', async () => {
      const inspected = await service.inspect('{ not json');
      const applied = await apply('{ not json');
      expect(inspected.success).toBe(false);
      expect(applied.success).toBe(false);
      if (!inspected.success) expect(inspected.errorCode).toBe('IMPORT_INVALID');
      if (!applied.success) expect(applied.errorCode).toBe('IMPORT_INVALID');
    });

    it('rejects a file that is not an export package', async () => {
      const notAPackage = JSON.stringify({ version: 1, slots: [], rules: [] });
      const inspected = await service.inspect(notAPackage);
      const applied = await apply(notAPackage);
      expect(inspected.success).toBe(false);
      expect(applied.success).toBe(false);
    });
  });

  // ─── Ruling 4 succession: the settings family guard (F-2) ──────────────────
  //
  // The legacy `generatePreview` was the ONLY enforcer that a well-formed
  // `settings` dimension is required; the structural `isExportPackage` gate
  // never checked it. These assertions are DUAL-PATH on purpose: INSPECT and
  // APPLY each `JSON.parse` the file, so a guard on one leaves the other
  // writable — and APPLY is the writer.
  describe('Ruling 4 — an invalid settings dimension is refused on BOTH paths', () => {
    it('① rejects an out-of-enum matchSettings on inspect AND apply', async () => {
      const file = pkgFile({
        settings: SETTINGS_DIM({
          matchSettings: { tabIdMode: 'sometimes', ruleCheckMode: 'match', priority: 'tabId' } as unknown as MatchRuleSettings,
        }),
      });

      const inspected = await service.inspect(file);
      const applied = await apply(file);
      expect(inspected.success, 'inspect must refuse').toBe(false);
      expect(applied.success, 'apply must refuse (it is the writer)').toBe(false);
      if (!inspected.success) expect(inspected.errorCode).toBe('IMPORT_INVALID');
      if (!applied.success) expect(applied.errorCode).toBe('IMPORT_INVALID');
    });

    it('② rejects an out-of-enum switchDirection on inspect AND apply', async () => {
      const file = pkgFile({
        settings: SETTINGS_DIM({ switchDirection: 'sideways' as unknown as 'next' }),
      });

      const inspected = await service.inspect(file);
      const applied = await apply(file);
      expect(inspected.success).toBe(false);
      expect(applied.success).toBe(false);
    });

    it('③ still accepts a legal settings dimension on both paths', async () => {
      const file = pkgFile({ rules: [rule('r-ok', 'https://ok.example/')], settings: SETTINGS_DIM({ matchSettings: SETTINGS_B }) });

      const inspected = await service.inspect(file);
      const applied = await apply(file);
      expect(inspected.success).toBe(true);
      expect(applied.success).toBe(true);
    });

    it('does not require the settings dimension at all (an uncarried axis is legal)', async () => {
      const file = pkgFile({ rules: [rule('r-only', 'https://only.example/')] });
      const inspected = await service.inspect(file);
      const applied = await apply(file);
      expect(inspected.success).toBe(true);
      expect(applied.success).toBe(true);
      // Locked to the API TRUTH, not the UI wording: the UI renders
      // `import-absent-settings` only because this flag is false. Asserting the
      // copy alone would pass even if the flag disappeared.
      if (!inspected.success) return;
      expect(inspected.inspection.dimensions.settings).toBe(false);
    });

    it('④ rejects an invalid autoBindGlobal on BOTH paths', async () => {
      const file = pkgFile({
        settings: SETTINGS_DIM({ autoBindGlobal: 'yes' as unknown as boolean }),
      });
      const inspected = await service.inspect(file);
      const applied = await apply(file);
      expect(inspected.success).toBe(false);
      expect(applied.success).toBe(false);
      if (!inspected.success) expect(inspected.errorCode).toBe('IMPORT_INVALID');
      if (!applied.success) expect(applied.errorCode).toBe('IMPORT_INVALID');
    });

    it('⑤ rejects an invalid slotStrategies VALUE on BOTH paths', async () => {
      // `.find` matches the real slot, so `'bogus'` would be WRITTEN onto
      // `slot.strategy` and then silently ignored by the literal comparator.
      const file = pkgFile({
        slots: [portableSlot(3, 'https://s3.example/')],
        settings: SETTINGS_DIM({ slotStrategies: { 3: 'bogus' } as unknown as Record<number, 'inherit'> }),
      });
      const inspected = await service.inspect(file);
      const applied = await apply(file);
      expect(inspected.success).toBe(false);
      expect(applied.success).toBe(false);
    });

    it('⑥ rejects an ORPHAN slot key (a strategy nobody reads = a silent no-op)', async () => {
      const file = pkgFile({
        rules: [rule('r-only', 'https://only.example/')],
        settings: SETTINGS_DIM({ slotStrategies: { 11: 'inherit' } }),
      });
      expect((await service.inspect(file)).success).toBe(false);
      expect((await apply(file)).success).toBe(false);
    });

    // The key must be the CANONICAL decimal literal for 1..10. A non-canonical
    // key addresses no slot (`packageToSyncPatch` indexes by `slot.id`), so it is
    // accepted-then-ignored — the "chosen but never applied" gap.
    for (const key of ['1.0', '01', '-1', '0', '11']) {
      it(`⑦ rejects the non-canonical slot key "${key}"`, async () => {
        const file = pkgFile({
          rules: [rule('r-only', 'https://only.example/')],
          settings: SETTINGS_DIM({ slotStrategies: { [key]: 'inherit' } as unknown as Record<number, 'inherit'> }),
        });
        expect((await service.inspect(file)).success).toBe(false);
        expect((await apply(file)).success).toBe(false);
      });
    }

    it('accepts a canonical slot key with a legal strategy value (no over-rejection)', async () => {
      const file = pkgFile({
        rules: [rule('r-only', 'https://only.example/')],
        settings: SETTINGS_DIM({ slotStrategies: { 10: 'inherit', 5: SETTINGS_B } }),
      });
      expect((await service.inspect(file)).success).toBe(true);
      expect((await apply(file)).success).toBe(true);
    });
  });

  // ─── F-3 ②: INSPECT is read-only; only APPLY writes ────────────────────────
  it('inspect writes nothing; apply is the only writer', async () => {
    await repo.saveSlot(storedSlot(1, 'https://original.com'), 0);

    const file = pkgFile({
      slots: [portableSlot(1, 'https://changed.com')],
      settings: SETTINGS_DIM(),
    });

    await service.inspect(file);
    const afterInspect = await repo.getSyncState();
    expect(afterInspect.slots[0].urlMatch.value, 'INSPECT must not mutate').toBe('https://original.com');
    expect(afterInspect.configVersion, 'INSPECT must not bump the version').toBe(1);

    const applied = await apply(file);
    expect(applied.success).toBe(true);
    const afterApply = await repo.getSyncState();
    expect(afterApply.slots[0].urlMatch.value).toBe('https://changed.com');
    expect(afterApply.configVersion).toBe(2);
  });
});