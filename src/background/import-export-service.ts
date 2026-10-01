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
} from '@shared/types';
import { validateRegex } from '@shared/url-utils';

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

      const payload: ExportPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        slots: sync.slots.map((slot) => ({
          ...slot,
          // Strip any local icon data URIs from UI markers
          uiMarker: {
            ...slot.uiMarker,
            icon: slot.uiMarker.icon
              ? { ...slot.uiMarker.icon, value: slot.uiMarker.icon.type === 'url' ? slot.uiMarker.icon.value : `[local:${slot.uiMarker.icon.value}]` }
              : undefined,
          },
        })),
        rules: sync.rules,
        matchSettings: sync.matchSettings,
        switchDirection: sync.switchDirection,
        autoBindGlobal: sync.autoBindGlobal,
        configVersion: sync.configVersion,
      };

      return { success: true, json: JSON.stringify(payload, null, 2) };
    } catch (e) {
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

    const importedSlots = data.slots as SlotDefinition[];
    const importedRules = data.rules as PageRule[];

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

    // B4: static regex safety check on every imported regex (never executed here).
    // Reject tier = invalid syntax, too long, or catastrophic backtracking.
    // Warn tier (broad match) stays importable — `valid` remains true for it.
    const regexRejection = this.findUnsafeRegex(importedSlots, importedRules);
    if (regexRejection) {
      return { success: false, errorCode: 'IMPORT_INVALID', message: regexRejection };
    }

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
    };

    return { success: true, preview };
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

    // T31 (B4-3): re-run the regex safety gate HERE rather than trusting
    // `preview.valid`. The preview is caller-supplied and may have been built by
    // hand or mutated between PREVIEW and COMMIT, so the earlier check is only a
    // UX guard — this is the enforcement point (closes the TOCTOU window).
    const commitRejection = this.findUnsafeRegex(
      [...preview.newSlots, ...preview.slotConflicts.map((c) => c.imported)],
      preview.rules,
    );
    if (commitRejection) {
      return { success: false, errorCode: 'IMPORT_INVALID', message: commitRejection };
    }

    const result = await this.repo.writeSync(expectedVersion, (state) => {
      // Apply slot decisions
      for (const conflict of slotDecisions) {
        if (conflict.decision === 'import') {
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
        if (!state.slots.find((s) => s.id === newSlot.id)) {
          state.slots.push(newSlot);
        }
      }

      // Replace rules entirely with imported rules
      state.rules = preview.rules;

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
   * B4: Statically validate every imported regex definition and return a
   * locating error message for the first unsafe one, or `null` when all are safe.
   *
   * `validateRegex` is the single entry point: `valid === false` is the reject
   * tier (REGEX_TOO_LONG / REGEX_INVALID / catastrophic REGEX_RISK); the broad
   * -match warning surfaces as `valid === true` + `error === 'REGEX_RISK'`.
   * Patterns are never executed here, so preview itself cannot be ReDoS'd.
   */
  private findUnsafeRegex(slots: unknown[], rules: unknown[]): string | null {
    const extractRegex = (entry: unknown): string | null => {
      if (typeof entry !== 'object' || entry === null) return null;
      const match = (entry as { urlMatch?: unknown }).urlMatch;
      if (typeof match !== 'object' || match === null) return null;
      const { type, value } = match as { type?: unknown; value?: unknown };
      return type === 'regex' && typeof value === 'string' ? value : null;
    };

    const reason = (check: { message?: string; error?: string }): string =>
      check.message ?? check.error ?? 'rejected';

    for (const rule of rules) {
      const pattern = extractRegex(rule);
      if (pattern === null) continue;
      const check = validateRegex(pattern);
      if (!check.valid) {
        const id = (rule as { id?: unknown }).id;
        const label = typeof id === 'string' ? id : '(unknown)';
        return `Rule "${label}" has an unsafe regex: ${reason(check)}`;
      }
    }

    for (const slot of slots) {
      const pattern = extractRegex(slot);
      if (pattern === null) continue;
      const check = validateRegex(pattern);
      if (!check.valid) {
        const id = (slot as { id?: unknown }).id;
        const label = typeof id === 'number' ? String(id) : '(unknown)';
        return `Slot ${label} has an unsafe regex: ${reason(check)}`;
      }
    }

    return null;
  }

  /**
   * Apply a decision to all conflicts (select all import / all existing).
   */
  applyBulkDecision(conflicts: ImportSlotConflict[], decision: ImportSlotDecision): ImportSlotConflict[] {
    return conflicts.map((c) => ({ ...c, decision }));
  }
}
