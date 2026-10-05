/**
 * Import/Export Service — JSON config export, import preview, and single-commit.
 *
 * - Export: sync config only (slots, rules, global strategy, configVersion)
 *   with local icon placeholder references (NOT data URIs)
 * - Import: parse plaintext JSON, generate full-replace or merge preview
 * - Per-slot existing/imported decision with select-all
 * - Single commit through the single-write service
 * - Does NOT export local bindings, cursors, recovery, overrides, snapshots, data URIs
 * - Does NOT write config before confirmation
 */

import type { StorageRepository } from './storage-repository';
import type {
  SlotDefinition,
  PageRule,
  MatchRuleSettings,
  ExportPayload,
  ImportPreview,
  ImportSlotConflict,
  ImportSlotDecision,
  ImportIntent,
  ImportApplyResult,
  ImportRecordStatus,
} from '@shared/types';
import { applyIntent, computeDiff, findMatchOverlaps } from '@shared/import-diff';
import { isExportPackage } from '@shared/export-package';
import { partitionByDomainRules, type DomainRecord, type DomainRejection } from './domain-rules';
import { iconToPortable, portableToIcon } from '@shared/export-package';

// ─── Import/Export Service ───────────────────────────────────────────────────

export class ImportExportService {
  constructor(private repo: StorageRepository) {}

  // ─── Export ────────────────────────────────────────────────────────────

  /**
   * Export sync configuration as JSON string.
   * Excludes all local-only data (bindings, cursors, recovery, overrides, data URIs).
   */
  async exportConfig(): Promise<{ success: true; json: string } | { success: false; errorCode: string; message: string }> {
    try {
      const sync = await this.repo.getSyncState();

      // C2: icons are carried as URL / BARE `local-icon:` reference / recipe —
      // never the retired legacy local wrapper and never a bitmap.
      const payload: ExportPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        slots: sync.slots.map((slot) => ({
          ...slot,
          uiMarker: {
            ...slot.uiMarker,
            icon: slot.uiMarker.icon
              ? portableToIcon(iconToPortable(slot.uiMarker.icon, `icon:slot-${String(slot.id)}`))
              : undefined,
          },
        })),
        rules: sync.rules.map((rule) => ({
          ...rule,
          favicon: rule.favicon ? portableToIcon(iconToPortable(rule.favicon, `icon:${rule.id}`)) : undefined,
        })),
        matchSettings: sync.matchSettings,
        switchDirection: sync.switchDirection,
        autoBindGlobal: sync.autoBindGlobal,
        configVersion: sync.configVersion,
      };

      return { success: true, json: JSON.stringify(payload, null, 2) };
    } catch {
      return { success: false, errorCode: 'INTERNAL_ERROR', message: 'Failed to export configuration' };
    }
  }

  // ─── Import Preview ────────────────────────────────────────────────────

  /**
   * Parse imported JSON and generate a preview with conflict resolution options.
   * Does NOT write anything until commit is called.
   */
  async generatePreview(json: string): Promise<
    { success: true; preview: ImportPreview } |
    { success: false; errorCode: string; message: string }
  > {
    // Parse JSON
    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Invalid JSON format' };
    }

    // Validate structure
    const data = payload as Record<string, unknown>;
    if (!data || typeof data !== 'object') {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Import data must be an object' };
    }

    if (data.version !== 1) {
      return { success: false, errorCode: 'IMPORT_VERSION_MISMATCH', message: `Unsupported import version: ${data.version}` };
    }

    if (!Array.isArray(data.slots)) {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Missing or invalid slots array' };
    }

    if (!Array.isArray(data.rules)) {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Missing or invalid rules array' };
    }

    const rawSlots = data.slots as SlotDefinition[];
    const rawRules = data.rules as PageRule[];

    // Ruling 4 (2026-09-30): legacy export files are NO LONGER importable.
    // Validate the new `matchSettings` shape; a missing/invalid shape is rejected
    // as IMPORT_INVALID. We deliberately do NOT read the legacy strategy field.
    if (!this.isValidMatchSettings(data.matchSettings)) {
      return {
        success: false,
        errorCode: 'IMPORT_INVALID',
        message: 'Missing or invalid matchSettings — legacy export files are not supported',
      };
    }
    const importedMatchSettings = data.matchSettings;
    const importedVersion = (data.configVersion as number) ?? 0;

    // D15: partition by domain constraints. A bad record is skipped + disclosed
    // (no longer a whole-package rejection). Warn-tier regexes stay importable.
    const partition = this.partitionRecords(rawSlots, rawRules);
    const importedSlots = partition.slots;
    const importedRules = partition.rules;

    // Get current state for conflict detection
    const currentSync = await this.repo.getSyncState();

    // Detect per-slot conflicts
    const slotConflicts: ImportSlotConflict[] = [];
    const newSlots: SlotDefinition[] = [];

    for (const imported of importedSlots) {
      const existing = currentSync.slots.find((s) => s.id === imported.id);
      if (existing) {
        slotConflicts.push({
          slotId: imported.id,
          existing,
          imported,
          decision: 'import', // Default to import
        });
      } else {
        newSlots.push(imported);
      }
    }

    const preview: ImportPreview = {
      valid: true,
      slotConflicts,
      newSlots,
      rules: importedRules,
      matchSettings: importedMatchSettings,
      switchDirection: data.switchDirection === 'previous' ? 'previous' : 'next',
      autoBindGlobal: data.autoBindGlobal !== false,
      configVersion: importedVersion,
      domainViolations: partition.rejected,
    };

    return { success: true, preview };
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

  // ─── Import Commit ─────────────────────────────────────────────────────

  /**
   * Commit an import with per-slot decisions through the single-write service.
   * All changes are applied in ONE version increment.
   */
  async commitImport(
    preview: ImportPreview,
    slotDecisions: ImportSlotConflict[],
    expectedVersion: number,
  ): Promise<{ success: true; configVersion: number } | { success: false; errorCode: string; message: string }> {
    if (!preview.valid) {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Cannot commit invalid preview' };
    }

    // T31 (B4-3) / D15: re-partition HERE rather than trusting `preview.valid`.
    // The preview is caller-supplied and may have been built by hand or mutated
    // between PREVIEW and COMMIT, so the earlier check is only a UX guard — this
    // is the enforcement point (closes the TOCTOU window). Unlike the old gate, a
    // bad record is SKIPPED, not a whole-commit rejection.
    const partition = this.partitionRecords(
      [...preview.newSlots, ...preview.slotConflicts.map((c) => c.imported)],
      preview.rules,
    );
    const safeSlotIds = new Set(partition.slots.map((s) => s.id));
    const safeRules = partition.rules;

    const result = await this.repo.writeSync(expectedVersion, (state) => {
      // Apply slot decisions
      for (const conflict of slotDecisions) {
        if (conflict.decision === 'import') {
          if (!safeSlotIds.has(conflict.slotId)) continue; // D15: skip unsafe
          const idx = state.slots.findIndex((s) => s.id === conflict.slotId);
          if (idx >= 0) {
            state.slots[idx] = conflict.imported;
          } else {
            state.slots.push(conflict.imported);
          }
        }
        // 'existing' — keep current, do nothing
      }

      // Add new (non-conflicting) slots
      for (const newSlot of preview.newSlots) {
        if (!safeSlotIds.has(newSlot.id)) continue; // D15: skip unsafe
        if (!state.slots.find((s) => s.id === newSlot.id)) {
          state.slots.push(newSlot);
        }
      }

      // Replace rules entirely with the domain-safe imported rules
      state.rules = safeRules;

      // Update global settings (tri-knob model)
      state.matchSettings = preview.matchSettings;
      state.switchDirection = preview.switchDirection;
      state.autoBindGlobal = preview.autoBindGlobal;

      return state;
    });

    if (!result.success) {
      return { success: false, errorCode: result.errorCode, message: result.message };
    }

    return { success: true, configVersion: result.configVersion };
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
  ): Promise<
    { success: true; configVersion: number; result: ImportApplyResult } |
    { success: false; errorCode: string; message: string }
  > {
    // 1. Parse + structural guard. The strict D14 validator is a separate
    //    concern; the shape guard is the minimum needed to recompute safely.
    let parsed: unknown;
    try {
      parsed = JSON.parse(file);
    } catch {
      return { success: false, errorCode: 'IMPORT_INVALID', message: 'Invalid JSON format' };
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

    return {
      success: true,
      configVersion: write.configVersion,
      result: {
        success: true,
        configVersion: write.configVersion,
        counts,
        tolerant: [],
        domainViolations: partition.rejected,
        // Filled by the missing-icon producer (a downstream wiring task).
        missingIcons: [],
        overlaps,
      },
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Shape guard for the new `matchSettings` field. Returns false for anything
   * that is not a well-formed `MatchRuleSettings` (including the legacy
   * legacy-strategy-only payloads), so legacy export files are rejected.
   */
  private isValidMatchSettings(value: unknown): value is MatchRuleSettings {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
      (v.tabIdMode === 'exists' || v.tabIdMode === 'no-exists') &&
      (v.ruleCheckMode === 'match' || v.ruleCheckMode === 'no-match') &&
      (v.priority === 'tabId' || v.priority === 'rule-check' || v.priority === 'none')
    );
  }

  /**
   * Apply a decision to all conflicts (select all import / all existing).
   */
  applyBulkDecision(conflicts: ImportSlotConflict[], decision: ImportSlotDecision): ImportSlotConflict[] {
    return conflicts.map((c) => ({ ...c, decision }));
  }
}
