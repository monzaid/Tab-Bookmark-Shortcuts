import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { IconService } from '@background/icon-service';
import type { SlotDefinition, ImportSlotConflict, MatchRuleSettings } from '@shared/types';

const SETTINGS_B: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' };
const SETTINGS_A: MatchRuleSettings = { tabIdMode: 'exists', ruleCheckMode: 'no-match', priority: 'tabId' };
const SETTINGS_C: MatchRuleSettings = { tabIdMode: 'no-exists', ruleCheckMode: 'match', priority: 'tabId' };

describe('T13: JSON import/export, merge preview, single commit', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  const makeSlot = (id: number, url: string): SlotDefinition => ({
    id,
    urlMatch: { type: 'exact', value: url },
    strategy: 'inherit',
    uiMarker: {},
    titleSnapshot: `Slot ${id}`,
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  describe('T31 (B4-3) / D15 — commitImport re-partitions the preview (TOCTOU)', () => {
    it('skips a commit whose preview carries a dangerous rule regex (good rules persist)', async () => {
      // A preview that never went through `previewImport` (or was mutated after
      // it) must not be trusted at commit time. D15: the bad rule is SKIPPED,
      // not a whole-commit rejection.
      const forged = {
        valid: true,
        slotConflicts: [],
        newSlots: [],
        rules: [
          {
            id: 'good',
            urlMatch: { type: 'exact', value: 'https://safe.com' },
            priority: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'evil',
            urlMatch: { type: 'regex', value: '^(a+){10}$' },
            priority: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 1,
        domainViolations: [],
      };

      const result = await service.commitImport(forged as never, [], repo.getConfigVersion());
      expect(result.success, 'the commit can proceed by skipping the bad rule').toBe(true);
      const rules = (await repo.getSyncState()).rules;
      expect(rules.find((r) => r.id === 'evil'), 'the dangerous rule must not be persisted').toBeUndefined();
      expect(rules.find((r) => r.id === 'good')).toBeDefined();
    });

    it('skips a commit whose preview carries a dangerous slot regex (good slots persist)', async () => {
      const forged = {
        valid: true,
        slotConflicts: [],
        newSlots: [
          makeSlot(3, 'https://safe-3.com'),
          { ...makeSlot(9, 'https://bad.com'), urlMatch: { type: 'regex' as const, value: '^(.*a){20}$' } },
        ],
        rules: [],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 1,
        domainViolations: [],
      };

      const result = await service.commitImport(forged as never, [], repo.getConfigVersion());
      expect(result.success).toBe(true);
      const slots = (await repo.getSyncState()).slots;
      expect(slots.find((s) => s.id === 9)).toBeUndefined();
      expect(slots.find((s) => s.id === 3)).toBeDefined();
    });

    it('should still commit a safe preview', async () => {
      const safe = {
        valid: true,
        slotConflicts: [],
        newSlots: [],
        rules: [
          {
            id: 'safe',
            urlMatch: { type: 'regex', value: '^https://example\\.com/.*$' },
            priority: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 1,
      };

      const result = await service.commitImport(safe as never, [], repo.getConfigVersion());
      expect(result.success).toBe(true);
      expect((await repo.getSyncState()).rules.find((r) => r.id === 'safe')).toBeDefined();
    });
  });

  describe('Happy path — export and import with decisions', () => {
    it('should export sync config only (no local data)', async () => {
      await repo.saveSlot(makeSlot(1, 'https://example.com'), 0);
      await repo.setBinding({ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setIconCache('icon-1', 'data:image/png;base64,secret');

      const result = await service.exportConfig();
      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = JSON.parse(result.json) as {
          version: number;
          slots: Array<Record<string, unknown>>;
          configVersion: number;
        };
        expect(parsed.version).toBe(1);
        expect(parsed.slots).toHaveLength(1);
        expect(parsed.configVersion).toBe(1);
        // Must NOT contain local data. NOTE: the new-shape export legitimately
        // contains the token `tabId` as a Priority value (matchSettings.priority),
        // so the local-binding exclusion is asserted on the STRUCTURAL key, not
        // the raw substring.
        expect(parsed.slots[0]).not.toHaveProperty('tabId');
        expect(result.json).not.toContain('"tabId":');
        expect(result.json).not.toContain('data:image/png;base64,secret');
        expect(result.json).not.toContain('bindings');
        expect(result.json).not.toContain('recoverySessions');
      }
    });

    it('should generate preview with slot conflicts', async () => {
      // Set up existing slot
      await repo.saveSlot(makeSlot(1, 'https://existing.com'), 0);

      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [
          makeSlot(1, 'https://imported.com'), // Conflicts with existing
          makeSlot(2, 'https://new-slot.com'), // New
        ],
        rules: [],
        matchSettings: SETTINGS_A,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 5,
      });

      const result = await service.generatePreview(importJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.preview.slotConflicts).toHaveLength(1);
        expect(result.preview.slotConflicts[0].slotId).toBe(1);
        expect(result.preview.slotConflicts[0].existing?.urlMatch.value).toBe('https://existing.com');
        expect(result.preview.slotConflicts[0].imported.urlMatch.value).toBe('https://imported.com');
        expect(result.preview.newSlots).toHaveLength(1);
        expect(result.preview.newSlots[0].id).toBe(2);
      }
    });

    it('should commit import with per-slot decisions in single version write', async () => {
      await repo.saveSlot(makeSlot(1, 'https://existing.com'), 0);

      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [
          makeSlot(1, 'https://imported.com'),
          makeSlot(2, 'https://new-slot.com'),
        ],
        rules: [{ id: 'r1', urlMatch: { type: 'exact', value: 'https://rule.com' }, priority: 5, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
        matchSettings: SETTINGS_C,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 5,
      });

      const previewResult = await service.generatePreview(importJson);
      if (!previewResult.success) throw new Error('Preview failed');

      // Decide: import slot 1 (overwrite existing)
      const decisions: ImportSlotConflict[] = [
        { ...previewResult.preview.slotConflicts[0], decision: 'import' },
      ];

      const commitResult = await service.commitImport(previewResult.preview, decisions, 1);
      expect(commitResult.success).toBe(true);
      if (commitResult.success) {
        expect(commitResult.configVersion).toBe(2); // Single increment
      }

      // Verify final state
      const sync = await repo.getSyncState();
      expect(sync.slots).toHaveLength(2);
      expect(sync.slots.find((s) => s.id === 1)?.urlMatch.value).toBe('https://imported.com');
      expect(sync.slots.find((s) => s.id === 2)?.urlMatch.value).toBe('https://new-slot.com');
      expect(sync.rules).toHaveLength(1);
      expect(sync.matchSettings).toEqual(SETTINGS_C);
    });

    it('should keep existing slot when decision is "existing"', async () => {
      await repo.saveSlot(makeSlot(1, 'https://keep-this.com'), 0);

      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [makeSlot(1, 'https://reject-this.com')],
        rules: [],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 3,
      });

      const previewResult = await service.generatePreview(importJson);
      if (!previewResult.success) throw new Error('Preview failed');

      const decisions: ImportSlotConflict[] = [
        { ...previewResult.preview.slotConflicts[0], decision: 'existing' },
      ];

      await service.commitImport(previewResult.preview, decisions, 1);

      const sync = await repo.getSyncState();
      expect(sync.slots.find((s) => s.id === 1)?.urlMatch.value).toBe('https://keep-this.com');
    });

    it('should support bulk decision (select all)', () => {
      const conflicts: ImportSlotConflict[] = [
        { slotId: 1, existing: makeSlot(1, 'a'), imported: makeSlot(1, 'b'), decision: 'existing' },
        { slotId: 2, existing: makeSlot(2, 'c'), imported: makeSlot(2, 'd'), decision: 'existing' },
      ];

      const allImport = service.applyBulkDecision(conflicts, 'import');
      expect(allImport.every((c) => c.decision === 'import')).toBe(true);

      const allExisting = service.applyBulkDecision(conflicts, 'existing');
      expect(allExisting.every((c) => c.decision === 'existing')).toBe(true);
    });
  });

  describe('Error path — malformed JSON, unknown version, cancel', () => {
    it('should reject malformed JSON', async () => {
      const result = await service.generatePreview('{invalid json!!!');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('IMPORT_INVALID');
      }
    });

    it('should reject unknown version', async () => {
      const result = await service.generatePreview(JSON.stringify({ version: 99, slots: [], rules: [] }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('IMPORT_VERSION_MISMATCH');
      }
    });

    it('should reject missing slots array', async () => {
      const result = await service.generatePreview(JSON.stringify({ version: 1, rules: [] }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('IMPORT_INVALID');
      }
    });

    it('should reject commit with stale version (zero writes)', async () => {
      await repo.saveSlot(makeSlot(1, 'https://example.com'), 0); // version → 1

      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [makeSlot(2, 'https://new.com')],
        rules: [],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 0,
      });

      const previewResult = await service.generatePreview(importJson);
      if (!previewResult.success) throw new Error('Preview failed');

      // Try to commit with stale version 0 (current is 1)
      const commitResult = await service.commitImport(previewResult.preview, [], 0);
      expect(commitResult.success).toBe(false);
      if (!commitResult.success) {
        expect(commitResult.errorCode).toBe('CONFIG_CONFLICT');
      }

      // Verify nothing was written
      const sync = await repo.getSyncState();
      expect(sync.slots).toHaveLength(1); // Only original slot
    });

    // ─── T3 (D15): per-record skip replaces whole-package rejection ───
    it('D15: skips an imported rule with catastrophic regex, keeping good rules', async () => {
      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [],
        rules: [
          { id: 'good-rule', urlMatch: { type: 'exact', value: 'https://ok.com' }, priority: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
          {
            id: 'evil-rule',
            urlMatch: { type: 'regex', value: '(a+)+$' },
            priority: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 0,
      });

      const result = await service.generatePreview(importJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.preview.rules.map((r) => r.id)).toEqual(['good-rule']);
        expect(result.preview.domainViolations).toHaveLength(1);
        expect(result.preview.domainViolations[0].id).toBe('evil-rule');
        expect(result.preview.domainViolations[0].reason).toContain('evil-rule');
      }
    });

    it('D15: skips an imported slot with catastrophic regex, keeping good slots', async () => {
      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [
          makeSlot(1, 'https://good.com'),
          { ...makeSlot(2, 'https://example.com'), urlMatch: { type: 'regex', value: '(x+)+' } },
        ],
        rules: [],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 0,
      });

      const result = await service.generatePreview(importJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.preview.newSlots.map((s) => s.id)).toEqual([1]);
        expect(result.preview.domainViolations).toHaveLength(1);
        expect(result.preview.domainViolations[0].kind).toBe('slot');
        expect(result.preview.domainViolations[0].id).toBe(2);
      }
    });

    it('B4: should accept imported regex that is safe', async () => {
      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [],
        rules: [
          {
            id: 'safe-rule',
            urlMatch: { type: 'regex', value: '^https://example\\.com/.*$' },
            priority: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 0,
      });

      const result = await service.generatePreview(importJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.preview.rules).toHaveLength(1);
      }
    });

    it('B4: should NOT reject overly-broad (warn-tier) regex — warning only', async () => {
      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [],
        rules: [
          {
            id: 'broad-rule',
            urlMatch: { type: 'regex', value: '.*' },
            priority: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        matchSettings: SETTINGS_B,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 0,
      });

      const result = await service.generatePreview(importJson);
      // Warn tier (REGEX_RISK with valid:true) must remain importable
      expect(result.success).toBe(true);
    });

    // ─── T1 RED ④ (ruling 4): legacy export files are no longer importable ───
    it('T1 RED ④: rejects a legacy export file that has no matchSettings', async () => {
      // The legacy export field is used as *rejected input* — the mandated RED
      // fixture for ruling 4 (see delivery report).
      const legacyJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [],
        rules: [],
        globalStrategy: 'B',
        configVersion: 3,
      });

      const result = await service.generatePreview(legacyJson);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('IMPORT_INVALID');
      }
    });

    it('T1 RED ④: rejects an export file whose matchSettings shape is invalid', async () => {
      const badJson = JSON.stringify({
        version: 1,
        slots: [],
        rules: [],
        matchSettings: { tabIdMode: 'sometimes', ruleCheckMode: 'match', priority: 'tabId' },
        configVersion: 3,
      });
      const result = await service.generatePreview(badJson);
      expect(result.success).toBe(false);
    });

    it('T1 RED ④: accepts a new-shape export file (matchSettings present)', async () => {
      const newJson = JSON.stringify({
        version: 1,
        slots: [],
        rules: [],
        matchSettings: SETTINGS_C,
        switchDirection: 'previous',
        autoBindGlobal: false,
        configVersion: 3,
      });
      const result = await service.generatePreview(newJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.preview.matchSettings).toEqual(SETTINGS_C);
      }
    });

    it('should not write config before confirmation (preview is read-only)', async () => {
      await repo.saveSlot(makeSlot(1, 'https://original.com'), 0);

      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [makeSlot(1, 'https://changed.com')],
        rules: [],
        matchSettings: SETTINGS_A,
        switchDirection: 'next',
        autoBindGlobal: true,
        configVersion: 99,
      });

      // Generate preview — should NOT modify state
      await service.generatePreview(importJson);

      const sync = await repo.getSyncState();
      expect(sync.slots[0].urlMatch.value).toBe('https://original.com');
      expect(sync.matchSettings).toEqual(SETTINGS_B); // Unchanged
      expect(sync.configVersion).toBe(1); // Unchanged
    });
  });
});
