import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import type { SlotDefinition, ImportSlotConflict } from '@shared/types';

describe('T13: JSON import/export, merge preview, single commit', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo);
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

  describe('Happy path — export and import with decisions', () => {
    it('should export sync config only (no local data)', async () => {
      await repo.saveSlot(makeSlot(1, 'https://example.com'), 0);
      await repo.setBinding({ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' });
      await repo.setIconCache('icon-1', 'data:image/png;base64,secret');

      const result = await service.exportConfig();
      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = JSON.parse(result.json);
        expect(parsed.version).toBe(1);
        expect(parsed.slots).toHaveLength(1);
        expect(parsed.configVersion).toBe(1);
        // Must NOT contain local data
        expect(result.json).not.toContain('tabId');
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
        globalStrategy: 'A',
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
        rules: [{ id: 'r1', urlMatch: { type: 'exact', value: 'https://rule.com' }, mode: 'auto', priority: 5, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
        globalStrategy: 'C',
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
      expect(sync.globalStrategy).toBe('C');
    });

    it('should keep existing slot when decision is "existing"', async () => {
      await repo.saveSlot(makeSlot(1, 'https://keep-this.com'), 0);

      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [makeSlot(1, 'https://reject-this.com')],
        rules: [],
        globalStrategy: 'B',
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
        globalStrategy: 'B',
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

    it('should not write config before confirmation (preview is read-only)', async () => {
      await repo.saveSlot(makeSlot(1, 'https://original.com'), 0);

      const importJson = JSON.stringify({
        version: 1,
        exportedAt: '2026-06-01T00:00:00Z',
        slots: [makeSlot(1, 'https://changed.com')],
        rules: [],
        globalStrategy: 'A',
        configVersion: 99,
      });

      // Generate preview — should NOT modify state
      await service.generatePreview(importJson);

      const sync = await repo.getSyncState();
      expect(sync.slots[0].urlMatch.value).toBe('https://original.com');
      expect(sync.globalStrategy).toBe('B'); // Unchanged
      expect(sync.configVersion).toBe(1); // Unchanged
    });
  });
});
