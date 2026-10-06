/**
 * Import/Export Service — the redesigned three-action protocol (A10/A11).
 *
 * - EXPORT_PACKAGE: the transfer package for the selected scope (icons carried
 *   as URL / bare `local-icon:` reference / recipe — never a bitmap).
 * - IMPORT_INSPECT: parse a file and diff it against the current state, READ-ONLY.
 * - IMPORT_APPLY (the ONLY writer): recompute the result server-side from the
 *   FILE STRING + the user's INTENT and write it in one version-bound mutation.
 *
 * The legacy export/preview/commit trio and its service methods were deleted in
 * T14b/T21; the Ruling-4 settings validation the legacy preview used to provide
 * now lives in `isValidPortableSettings`.
 */

import type { StorageRepository } from './storage-repository';
import type {
  SlotDefinition,
  PageRule,
  ExportScope,
  ImportIntent,
  ImportInspection,
  ImportApplyResult,
  ImportRecordStatus,
  TolerantItem,
  IconSource,
} from '@shared/types';
import { defaultImportIntent } from '@shared/types';
import { applyIntent, computeDiff, findMatchOverlaps } from '@shared/import-diff';
import { isExportPackage, isValidPortableSettings, syncStateToPackage, PACKAGE_FIELD_ALLOWLIST } from '@shared/export-package';
import { partitionByDomainRules, type DomainRecord, type DomainRejection } from './domain-rules';

// ─── Narrow collaborator seams (no adapter/service coupling) ─────────────────

/**
 * T22: the missing-icon judgement, narrowed to the ONE method needed.
 *
 * A structural type (not `IconService`) so this module stays free of a service
 * dependency, and so a test can supply a stub. `IconService` satisfies it.
 */
export interface MissingIconProbe {
  isMissingIcon(source: IconSource | undefined | null): Promise<boolean>;
}

/** T22: platform capability + guidance produced by APPLY (D4). */
export interface ImportApplyOptions {
  /**
   * `false` ⇒ the shortcut dimension cannot be applied programmatically and the
   * result carries manual-set-up guidance. `undefined` = capability unknown
   * (no guidance) — the pre-T22 behaviour.
   */
  commandsUpdateSupported?: boolean;
}

// ─── Import/Export Service ───────────────────────────────────────────────────

export class ImportExportService {
  constructor(
    private repo: StorageRepository,
    private icons: MissingIconProbe,
  ) {}

  // ─── Export Package (A11 — EXPORT_PACKAGE) ─────────────────────────────

  /**
   * A11: produce the transfer package for the selected scope.
   *
   * The package is the independent transport schema (A4): internal fields such
   * as `configVersion` / timestamps do not leak into the file, and each icon is
   * carried as URL / bare reference / recipe object.
   */
  async exportPackage(
    scope: ExportScope,
  ): Promise<{ success: true; package: string } | { success: false; errorCode: string; message: string }> {
    try {
      const sync = await this.repo.getSyncState();
      const pkg = syncStateToPackage(sync, scope);
      return { success: true, package: JSON.stringify(pkg, null, 2) };
    } catch {
      return { success: false, errorCode: 'INTERNAL_ERROR', message: 'Failed to export package' };
    }
  }

  // ─── Inspect (A11 — IMPORT_INSPECT) ────────────────────────────────────

  /**
   * A11: parse a file and diff it against the current state. READ-ONLY.
   *
   * Its COMPUTATION is intent-independent by design (A11): the preview is a pure
   * function of the FILE. The RESULT is produced under the DEFAULT intent, so
   * changing a dimension mode or a row decision never requires another INSPECT —
   * it is idempotent and re-runnable. The UI RECOMPUTES under the user's real
   * intent from the same file; it never re-inspects.
   *
   * `configVersion` is the value read HERE; APPLY binds to it (C3/F4).
   */
  async inspect(
    file: string,
  ): Promise<{ success: true; inspection: ImportInspection } | { success: false; errorCode: string; message: string }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file);
    } catch {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Invalid JSON format' };
    }
    // `settings` FIRST: it is the shorter gate and it subsumes the container
// checks for `parsed.settings`, so an invalid settings shape still yields the
// precise "settings" refusal rather than the generic package one.
    if (parsed !== null && typeof parsed === 'object' && 'settings' in parsed) {
      const settings = (parsed as { settings?: unknown }).settings;
      if (settings !== undefined && !isValidPortableSettings(settings)) {
        return { success: false, errorCode: 'IMPORT_INVALID', message: 'Invalid settings in the export package' };
      }
    }
    if (!isExportPackage(parsed)) {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Not a valid export package' };
    }

    const current = await this.repo.getSyncState();
    const intent = defaultImportIntent();
    const diff = computeDiff(parsed, current, intent);

    // D6/§6.2: the inspection also discloses which records the domain rejects,
    // and any exact-duplicate Match overlaps the result would introduce.
    const final = applyIntent(parsed, current, intent);
    const partition = this.partitionRecords(final.slots, final.rules);

    return {
      success: true,
      inspection: {
        diff,
        dimensions: diff.dimensions,
        tolerant: this.collectTolerant(parsed),
        domainViolations: partition.rejected,
        overlaps: findMatchOverlaps(final),
        configVersion: current.configVersion,
      },
    };
  }

  /**
   * D15: split imported records into accepted / skipped-by-domain-constraint.
   */
  private partitionRecords(
    slots: SlotDefinition[],
    rules: PageRule[],
  ): { slots: SlotDefinition[]; rules: PageRule[]; rejected: DomainRejection[] } {
    const ruleInput: DomainRecord[] = rules.map((r) => ({ kind: 'rule', id: r.id, urlMatch: r.urlMatch }));
    const slotInput: DomainRecord[] = slots.map((s) => ({ kind: 'slot', id: s.id, urlMatch: s.urlMatch }));

    const rulePartition = partitionByDomainRules(ruleInput);
    const slotPartition = partitionByDomainRules(slotInput);

    const acceptedRuleIds = new Set(rulePartition.accepted.map((r) => r.id as string));
    const acceptedSlotIds = new Set(slotPartition.accepted.map((s) => s.id as number));

    return {
      rules: rules.filter((r) => acceptedRuleIds.has(r.id)),
      slots: slots.filter((s) => acceptedSlotIds.has(s.id)),
      rejected: [...rulePartition.rejectedWithReason, ...slotPartition.rejectedWithReason],
    };
  }

  // ─── Apply (server-authoritative) ──────────────────────────────────────

  /**
   * The ONLY writer (A11 / C4).
   *
   * APPLY receives only the FILE STRING + the user's INTENT and recomputes the
   * result server-side — it never trusts a client-supplied preview (the old
   * commit path's own comment admitted that preview "may have been built by hand
   * or mutated"). The file string is the one INSPECT read, so there is no disk
   * re-read and no fingerprint (D12): the computation is a pure function of
   * `(file, intent, currentState)`.
   *
   * `expectedVersion` is the `configVersion` read at INSPECT time. It is passed
   * to `writeSync`'s optimistic lock, so any write in between is genuinely
   * refused with ZERO modification (F4 — previously the UI never sent one, so
   * the lock always passed).
   */
  async applyImport(
    file: string,
    intent: ImportIntent,
    expectedVersion: number,
    options: ImportApplyOptions = {},
  ): Promise<
    { success: true; configVersion: number; result: ImportApplyResult } |
    { success: false; errorCode: string; message: string }
  > {
    // 1. Parse + shape guards. Per-record domain rules and the settings family
    //    are separate concerns (the legacy `generatePreview` owned the latter;
    //    `isValidPortableSettings` is its successor). Every refusal below happens
    //    BEFORE any mutation, so a malformed file fails cleanly (store unchanged).
    let parsed: unknown;
    try {
      parsed = JSON.parse(file);
    } catch {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Invalid JSON format' };
    }
    // `settings` FIRST (shorter gate; APPLY and INSPECT parse the file
    // independently, so the same guard is needed on both sides).
    if (parsed !== null && typeof parsed === 'object' && 'settings' in parsed) {
      const settings = (parsed as { settings?: unknown }).settings;
      if (settings !== undefined && !isValidPortableSettings(settings)) {
        return { success: false, errorCode: 'IMPORT_INVALID', message: 'Invalid settings in the export package' };
      }
    }
    if (!isExportPackage(parsed)) {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Not a valid export package' };
    }

    // 2. Recompute the diff against the CURRENT state, from the file alone.
    const current = await this.repo.getSyncState();
    const diff = computeDiff(parsed, current, intent);

    // 3. Derive the final state and the destructive summary.
    const final = applyIntent(parsed, current, intent);
    const overlaps = findMatchOverlaps(final);

    // D15: records the domain constraints reject are skipped + disclosed.
    const partition = this.partitionRecords(final.slots, final.rules);
    const acceptedSlotIds = new Set(partition.slots.map((s) => s.id));
    const acceptedRuleIds = new Set(partition.rules.map((r) => r.id));
    const finalSafe = {
      ...final,
      slots: final.slots.filter((s) => acceptedSlotIds.has(s.id)),
      rules: final.rules.filter((r) => acceptedRuleIds.has(r.id)),
    };

    // 4. C10: the records this import REPLACES (or deletes) must not keep their
    //    target-machine icon blob. The reference key is derived from the record
    //    id, so a stale blob would make the reference resolve against the
    //    target's own icon — a "false success" the user never re-selects (§3.7).
    //    `keep existing` records are never in this set (C10-①: strict scope).
    const replacedSlotIds = new Set<number>();
    const replacedRuleIds = new Set<string>();
    for (const record of diff.records) {
      if (record.status === 'kept' || record.status === 'added') continue;
      if (record.kind === 'slot') replacedSlotIds.add(record.id as number);
      else replacedRuleIds.add(record.id as string);
    }
    const keysToClear = [
      ...[...replacedSlotIds].map((id) => `icon:slot-${String(id)}`),
      ...[...replacedRuleIds].map((id) => `icon:${id}`),
    ];

    // 5. ONE version-bound write, with the icon slots cleared atomically-ish
    //    around it (snapshot → clear → write → restore on failure).
    //    A stale `expectedVersion` is refused BEFORE mutating (zero changes).
    const write = await this.repo.clearAndWriteWithCompensation(
      keysToClear,
      expectedVersion,
      () => finalSafe,
    );
    if (!write.success) {
      return { success: false, errorCode: write.errorCode, message: write.message };
    }

    const counts = { added: 0, replaced: 0, kept: 0, deleted: 0, skipped: 0 };
    for (const record of diff.records) {
      counts[record.status as ImportRecordStatus] += 1;
    }

    // C11/D9: the missing-icon list is an APPLY PRODUCT — a one-shot disclosure,
    // never read-side state. Judged against `finalSafe` (the records actually
    // written, D15-filtered); records the intent DELETED are absent from `final`
    // by construction, so they cannot appear here.
    const missingIcons: Array<{ kind: 'slot' | 'rule'; id: number | string }> = [];
    for (const slot of finalSafe.slots) {
      if (await this.icons.isMissingIcon(slot.uiMarker.icon)) {
        missingIcons.push({ kind: 'slot', id: slot.id });
      }
    }
    for (const rule of finalSafe.rules) {
      if (await this.icons.isMissingIcon(rule.favicon)) {
        missingIcons.push({ kind: 'rule', id: rule.id });
      }
    }

    // D4 派生 2: a platform without `commands.update` cannot be applied
    // programmatically, so the result carries manual set-up guidance — but ONLY
    // when the package actually carried the shortcut dimension (otherwise the
    // notice would be noise on every import).
    const shortcutGuidance =
      options.commandsUpdateSupported === false && parsed.shortcuts !== undefined
        ? 'The shortcuts in this import must be set manually at chrome://extensions/shortcuts'
        : undefined;

    return {
      success: true,
      configVersion: write.configVersion,
      result: {
        success: true,
        configVersion: write.configVersion,
        counts,
        tolerant: this.collectTolerant(parsed),
        domainViolations: partition.rejected,
        missingIcons,
        overlaps,
        ...(shortcutGuidance !== undefined ? { shortcutGuidance } : {}),
      },
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * C8: the TOLERANT half of validation — a well-formed package may carry extra
   * fields the receiver does not know. They are IGNORED (not fatal) but each one
   * is disclosed, so "I made a decision for you" becomes "here is what I did".
   *
   * Scope is deliberately the DECLARED field names (the allowlist in
   * `export-package.ts`, adjacent to the shapes) at the package root and on each
   * `slots[]` / `rules[]` item. `urlMatch` / `marker` interiors are NOT walked —
   * a bounded, predictable report, not a schema walker.
   */
  private collectTolerant(parsed: unknown): TolerantItem[] {
    const items: TolerantItem[] = [];
    if (!parsed || typeof parsed !== 'object') return items;
    const root = parsed as Record<string, unknown>;

    const unknownKeys = (obj: Record<string, unknown>, allowed: readonly string[]): string[] =>
      Object.keys(obj).filter((k) => !allowed.includes(k));

    for (const key of unknownKeys(root, PACKAGE_FIELD_ALLOWLIST.root)) {
      items.push({ kind: 'unknown-field', detail: key });
    }

    const walk = (
      list: unknown,
      allowed: readonly string[],
      dimension: 'slots' | 'rules',
    ): void => {
      if (!Array.isArray(list)) return;
      list.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        for (const key of unknownKeys(entry as Record<string, unknown>, allowed)) {
          items.push({ kind: 'unknown-field', detail: `${dimension}[${String(index)}].${key}` });
        }
      });
    };

    walk(root.slots, PACKAGE_FIELD_ALLOWLIST.slot, 'slots');
    walk(root.rules, PACKAGE_FIELD_ALLOWLIST.rule, 'rules');
    return items;
  }

}
