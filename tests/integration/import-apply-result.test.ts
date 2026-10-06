/**
 * T22 — the APPLY result list: missing-icon disclosure (C11/D9), platform
 * shortcut guidance (D4 派生 2), and the tolerant reader (C8).
 *
 * These are BEHAVIOURAL: `missingIcons` was hard-coded `[]` and `tolerant` was
 * hard-coded `[]`, so each assertion fails because the OUTPUT is wrong (not
 * because a symbol is missing).
 *
 * C11 boundary: the missing-icon list is an APPLY PRODUCT — the read path keeps
 * carrying bare references and never produces this state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { StorageRepository } from '@background/storage-repository';
import { ImportExportService } from '@background/import-export-service';
import { IconService } from '@background/icon-service';
import { defaultImportIntent } from '@shared/types';
import type { ExportPackage, PortableIcon, PortableRule } from '@shared/export-package';
import type { PageRule } from '@shared/types';

const exact = (value: string) => ({ type: 'exact' as const, value });

function rule(id: string, value: string, extra: Partial<PortableRule> = {}): PortableRule {
  return { id, urlMatch: exact(value), priority: 0, ...extra };
}

function pkgString(parts: Partial<ExportPackage>): string {
  const pkg: ExportPackage = {
    schemaVersion: 1,
    generator: { name: 'test', version: '1' },
    exportedAt: '2026-10-05T00:00:00.000Z',
    scope: {},
    ...parts,
  };
  return JSON.stringify(pkg);
}

/** A stored `local-icon:` reference that (by default) has NO local blob. */
function storedRefRule(id: string, ref: string): PageRule {
  return {
    id,
    urlMatch: exact('https://a.example/'),
    priority: 0,
    favicon: { type: 'upload', value: ref },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ICON_REF = 'local-icon:icon:missing-key';
/** Carried in the BUNDLE, and unresolvable on this machine (no local blob). */
const localRefIcon: PortableIcon = { kind: 'local-ref', ref: ICON_REF };
const recipeIcon: PortableIcon = { kind: 'recipe', bgColor: '#fff', text: 'A', textColor: '#000' };
const urlIcon: PortableIcon = { kind: 'url', url: 'https://cdn.example/f.ico' };

describe('T22 — APPLY result: missing icons (C11/D9)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  it('reports a rule whose carried local-ref does not resolve on this machine', async () => {
    // The PACKAGE carries the reference, so it lands in the final state — and
    // this machine has no local blob for that key.
    const result = await service.applyImport(
      pkgString({ rules: [rule('rule-1', 'https://a.example/', { favicon: localRefIcon })] }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.result.missingIcons).toContainEqual({ kind: 'rule', id: 'rule-1' });
  });

  it('does NOT report a record that never had an icon (missing ≠ never set)', async () => {
    await repo.addRule({
      id: 'rule-2', urlMatch: exact('https://b.example/'), priority: 0,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await service.applyImport(
      pkgString({ rules: [rule('rule-2', 'https://b.example/')] }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.missingIcons).toHaveLength(0);
  });

  it('does NOT report a self-contained url icon or a recipe', async () => {
    await repo.addRule(storedRefRule('rule-3', ICON_REF));

    const result = await service.applyImport(
      pkgString({
        rules: [
          rule('rule-3', 'https://a.example/', { favicon: urlIcon }),
          rule('rule-4', 'https://c.example/', { favicon: recipeIcon }),
        ],
      }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.missingIcons).toHaveLength(0);
  });

  it('does NOT report a record the intent DELETED (it no longer exists)', async () => {
    await repo.addRule(storedRefRule('rule-1', ICON_REF));
    const base = defaultImportIntent();
    const overwrite = {
      ...base,
      dimensionModes: { ...base.dimensionModes, rules: 'overwrite' as const },
    };

    // The package carries NO rules ⇒ under overwrite the existing rule is deleted.
    const result = await service.applyImport(
      pkgString({ rules: [] }),
      overwrite,
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.missingIcons).toHaveLength(0);
  });

  it('reports a slot whose carried local-ref does not resolve', async () => {
    const result = await service.applyImport(
      pkgString({
        slots: [{
          id: 1,
          urlMatch: exact('https://s1.example/'),
          marker: { icon: localRefIcon },
          titleSnapshot: 'S1',
          faviconSnapshot: '',
        }],
      }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.result.missingIcons).toContainEqual({ kind: 'slot', id: 1 });
  });
});

describe('T22 — APPLY result: shortcut guidance (D4 派生 2)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  const withShortcuts = () => pkgString({
    rules: [],
    shortcuts: { global: [], perSlot: {} },
  });

  it('emits manual-set-up guidance when the platform cannot update commands', async () => {
    const result = await service.applyImport(
      withShortcuts(), defaultImportIntent(), repo.getConfigVersion(),
      { commandsUpdateSupported: false },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.shortcutGuidance).toContain('chrome://extensions/shortcuts');
  });

  it('emits NO guidance when the platform supports it', async () => {
    const result = await service.applyImport(
      withShortcuts(), defaultImportIntent(), repo.getConfigVersion(),
      { commandsUpdateSupported: true },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.shortcutGuidance).toBeUndefined();
  });

  it('emits NO guidance when the package did not carry shortcuts (no noise)', async () => {
    const result = await service.applyImport(
      pkgString({ rules: [] }), defaultImportIntent(), repo.getConfigVersion(),
      { commandsUpdateSupported: false },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.shortcutGuidance).toBeUndefined();
  });
});

describe('T22 — tolerant reader: unknown extra fields (C8)', () => {
  const adapter = createMockAdapter();
  let repo: StorageRepository;
  let service: ImportExportService;

  beforeEach(async () => {
    adapter.reset();
    repo = new StorageRepository(adapter);
    await repo.initialize();
    service = new ImportExportService(repo, new IconService(repo));
  });

  it('reports unknown keys at the package root and on records', async () => {
    const file = JSON.stringify({
      schemaVersion: 1,
      generator: { name: 'test', version: '1' },
      exportedAt: '2026-10-05T00:00:00.000Z',
      scope: {},
      futureTopLevel: true,
      rules: [{ id: 'r1', urlMatch: exact('https://a.example/'), priority: 0, mystery: 1 }],
    });

    const result = await service.applyImport(file, defaultImportIntent(), repo.getConfigVersion());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const details = result.result.tolerant.map((t) => t.detail);
    expect(details).toContain('futureTopLevel');
    expect(details).toContain('rules[0].mystery');
    for (const item of result.result.tolerant) expect(item.kind).toBe('unknown-field');
  });

  it('reports NOTHING for a package that only uses declared fields', async () => {
    const result = await service.applyImport(
      pkgString({ rules: [rule('r1', 'https://a.example/', { title: 'ok', enabled: true })] }),
      defaultImportIntent(),
      repo.getConfigVersion(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.tolerant).toHaveLength(0);
  });

  it('also discloses unknown fields at INSPECT time (pre-check, C8)', async () => {
    const file = JSON.stringify({
      schemaVersion: 1,
      generator: { name: 'test', version: '1' },
      exportedAt: '2026-10-05T00:00:00.000Z',
      scope: {},
      rules: [{ id: 'r1', urlMatch: exact('https://a.example/'), priority: 0, bogus: true }],
    });

    const inspected = await service.inspect(file);
    expect(inspected.success).toBe(true);
    if (!inspected.success) return;
    expect(inspected.inspection.tolerant.map((t) => t.detail)).toContain('rules[0].bogus');
  });
});