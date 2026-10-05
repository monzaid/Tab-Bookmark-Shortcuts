/**
 * T11 / C10 — a REPLACED record must not keep its target-machine icon blob.
 *
 * §3.7: the reference key is derived from the record id (`icon:slot-3`). If the
 * target machine happens to have slot 3 and its icon was offloaded, a replaced
 * record's reference would resolve against the TARGET's own icon — a "false
 * success" that is worse than a broken image, because the user sees a working
 * icon and never re-selects it.
 *
 * Contract:
 *   - replaced / deleted records  → their local icon key is cleared;
 *   - `keep existing` records     → NOT touched, not one byte (C10-①);
 *   - sync write fails            → the cleared keys are RESTORED and the
 *     version does not move (compensation, C10-② / §3.6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { defaultImportIntent } from '@shared/types';
import type { ExportPackage } from '@shared/export-package';
import type { SlotDefinition, SyncState } from '@shared/types';

const exact = (value: string) => ({ type: 'exact' as const, value });

/** A sync slot whose icon is an offloaded reference. */
function slotWithRef(id: number): SlotDefinition {
  return {
    id,
    urlMatch: exact(`https://s${String(id)}/`),
    strategy: 'inherit',
    uiMarker: { icon: { type: 'upload', value: `local-icon:icon:slot-${String(id)}` } },
    titleSnapshot: `S${String(id)}`,
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * The portable form of the same slot, carrying a DIFFERENT title so the diff
 * genuinely classifies it as a replacement (an identical record is `kept`, which
 * correctly leaves its icon slot alone).
 */
function portableSlotWithRef(id: number) {
  return {
    id,
    urlMatch: exact(`https://s${String(id)}/`),
    marker: { icon: { kind: 'local-ref' as const, ref: `local-icon:icon:slot-${String(id)}` } },
    titleSnapshot: `IMPORTED-S${String(id)}`,
    faviconSnapshot: '',
  };
}

function pkgString(parts: Partial<ExportPackage>): string {
  const pkg: ExportPackage = {
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-05T00:00:00.000Z',
    scope: { slots: true },
    ...parts,
  };
  return JSON.stringify(pkg);
}

describe('T11: replaced records lose their icon slot; kept records do not', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  /**
   * Seed raw sync + the offloaded local blobs (bypasses writeSync's read-back),
   * then RE-HYDRATE: the repository cached an empty state during `initialize()`,
   * so a raw storage write must be followed by a refresh to be visible.
   */
  async function seed(slots: SlotDefinition[]): Promise<void> {
    adapter.state.syncStorage['syncState'] = {
      configVersion: 0,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots,
      rules: [],
    } satisfies SyncState;
    for (const s of slots) {
      adapter.state.localStorage[`icon:slot-${String(s.id)}`] = `ORIGINAL_URI_${String(s.id)}`;
    }
    await repo.hydrate();
  }

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo);
  });

  it('clears the icon key of a REPLACED slot (so it lands in "missing")', async () => {
    await seed([slotWithRef(3)]);
    expect(adapter.state.localStorage['icon:slot-3']).toBe('ORIGINAL_URI_3');

    const result = await service.applyImport(
      pkgString({ slots: [portableSlotWithRef(3)] }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);

    // The stale blob is gone ⇒ the reference can no longer resolve to the
    // target machine's own icon.
    expect(adapter.state.localStorage['icon:slot-3']).toBeUndefined();
  });

  it('does NOT touch a kept record\'s icon key (C10-① / G4-A)', async () => {
    await seed([slotWithRef(3), slotWithRef(4)]);

    // File carries ONLY slot 3 ⇒ slot 4 is "file-missing, target-has" and the
    // incremental default KEEPS it.
    const result = await service.applyImport(
      pkgString({ slots: [portableSlotWithRef(3)] }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);

    expect(adapter.state.localStorage['icon:slot-3']).toBeUndefined(); // replaced
    expect(adapter.state.localStorage['icon:slot-4']).toBe('ORIGINAL_URI_4'); // kept, untouched
  });

  it('restores the cleared key and leaves the version alone when the sync write FAILS', async () => {
    await seed([slotWithRef(3)]);
    const versionBefore = repo.getConfigVersion();

    adapter.failStorageSetQuota('sync');
    const result = await service.applyImport(
      pkgString({ slots: [portableSlotWithRef(3)] }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );

    expect(result.success).toBe(false);
    // Compensation: the cleared blob is back, byte-for-byte.
    expect(adapter.state.localStorage['icon:slot-3']).toBe('ORIGINAL_URI_3');
    // Zero modification: the version did not move.
    expect((await repo.getSyncState()).configVersion).toBe(versionBefore);
  });

  it('does not touch any icon key when the version is stale (refused before clearing)', async () => {
    await seed([slotWithRef(3)]);
    const stale = repo.getConfigVersion();
    await repo.addRule({
      id: 'r', urlMatch: exact('https://x/'), priority: 0,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await service.applyImport(
      pkgString({ slots: [portableSlotWithRef(3)] }),
      defaultImportIntent(),
      stale,
    );
    expect(result.success).toBe(false);
    expect(adapter.state.localStorage['icon:slot-3']).toBe('ORIGINAL_URI_3'); // restored / never lost
  });
});