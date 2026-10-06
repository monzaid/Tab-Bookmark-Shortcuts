/**
 * Import diff, intent application and match-overlap detection (T8).
 *
 * All four functions are PURE: they read their arguments, never touch storage
 * and never mutate an input.
 *
 * Semantics (locked by the design):
 *   - §3.2 — the dimension mode governs ONLY the "file-missing, target-has"
 *     case. "Both sides" is decided by the diff and behaves IDENTICALLY under
 *     both modes. Therefore "incremental" does NOT mean "delete nothing" — a
 *     per-record override can still create a deletion.
 *   - A4 — the per-dimension mode is the DEFAULT; a sparse per-record override
 *     wins over it.
 *   - A12 — record level by default, field level (`title` / `icon`) expandable.
 *   - D7 — quantify only IRREVERSIBLE deletes (slots / rules); a replacement is
 *     redoable and must not be counted.
 *   - D10 — an overlap is an EXACT same Match URL + Match Type. Semantic overlap
 *     (different patterns matching the same URL) is deliberately NOT reported.
 *
 * Note on overlap scope: only RULES are inspected. §3.8 gives the entire
 * rationale — rule ids are random, so a cross-machine incremental import keeps
 * both sides and may leave two rules competing for one URL. Slot ids are the
 * fixed set 1..10 and cannot duplicate. Two slots sharing a match is a slot
 * coincidence, not the "duplicate rule" hazard D10 was written for; reporting it
 * would be noise, so it is intentionally out of scope.
 */

import type {
  SyncState,
  PageRule,
  SlotDefinition,
  UrlMatchDefinition,
  IconSource,
  ImportIntent,
  ImportDiff,
  ImportRecordDiff,
  ImportFieldDiff,
  ImportFieldValue,
  ImportRecordStatus,
  DimensionPresence,
  MatchOverlap,
  DimensionMode,
} from './types';
import type { ExportPackage, PortableIcon } from './export-package';
import { packageToSyncPatch, iconToPortable } from './export-package';
import { defaultImportIntent } from './types';
import { matchTypeLabel } from './match-type-labels';

// ─── Facet helpers ───────────────────────────────────────────────────────────
//
// A facet is the RENDERABLE form of one field value (ImportFieldValue). The
// comparison key (`facetKey`) is a private string built ONLY for equality — it
// never enters a contract, so no consumer can render (or re-parse) it.
//
// `portableIconFacet` and `facetKey` are deliberately ADJACENT: they are the two
// halves of one decision (what the value IS / when two values are EQUAL), so a
// change to the carried shape cannot update one and silently miss the other.

/** The ONLY mapping from a carried icon into a renderable facet. */
function portableIconFacet(icon: PortableIcon | undefined): ImportFieldValue | null {
  if (!icon) return null;
  switch (icon.kind) {
    case 'url':
      return { kind: 'url', value: icon.url ?? '' };
    case 'local-ref':
      return { kind: 'local-ref', key: icon.ref ?? '' };
    case 'recipe':
      return {
        kind: 'recipe',
        bgColor: icon.bgColor ?? '',
        text: icon.text ?? '',
        textColor: icon.textColor ?? '',
      };
  }
}

/**
 * A STORED icon as a facet, normalised through the SAME portable form the export
 * uses — so a stored `upload`/bare-ref and a portable `local-ref` for the same
 * key compare EQUAL (no false "changed").
 */
function storedIconFacet(
  icon: IconSource | null | undefined,
  iconKey: string,
): ImportFieldValue | null {
  return icon ? portableIconFacet(iconToPortable(icon, iconKey)) : null;
}

/** An empty text facet is "no value" (`null`), not an empty string. */
function textFacet(s: string): ImportFieldValue | null {
  return s === '' ? null : { kind: 'text', value: s };
}

/** The ONLY equality rule. Private: never a contract shape, never rendered. */
function facetKey(v: ImportFieldValue | null): string {
  if (v === null) return '';
  switch (v.kind) {
    case 'text':
      return v.value;
    case 'url':
      return `url:${v.value}`;
    case 'local-ref':
      return `local-ref:${v.key}`;
    case 'recipe':
      return `recipe:${v.bgColor}|${v.text}|${v.textColor}`;
  }
}

/** Per-record override for a record, or `undefined` when none was given (A4). */
function overrideFor(
  intent: ImportIntent,
  kind: 'slot' | 'rule',
  id: number | string,
): 'keep' | 'take' | undefined {
  return intent.recordOverrides?.find((o) => o.kind === kind && o.id === id)?.action;
}

/**
 * Does the dimension mode delete this file-missing record, absent an override?
 * A `keep` override protects it; a `take` override deletes it (even under
 * incremental — that is how "incremental ≠ delete nothing" is expressed).
 */
function deletesFileMissing(mode: DimensionMode, override: 'keep' | 'take' | undefined): boolean {
  if (override === 'keep') return false;
  if (override === 'take') return true;
  return mode === 'overwrite';
}

function presence(pkg: ExportPackage): DimensionPresence {
  return {
    slots: pkg.slots !== undefined,
    rules: pkg.rules !== undefined,
    settings: pkg.settings !== undefined,
    shortcuts: pkg.shortcuts !== undefined,
  };
}

// ─── Field-level facets (A12) ────────────────────────────────────────────────

interface Facets {
  title: ImportFieldValue | null;
  icon: ImportFieldValue | null;
  urlMatch: ImportFieldValue | null;
  matchType: ImportFieldValue | null;
}

/** The fields a record can differ on, in the order the UI shows them. */
const FACET_FIELDS = ['title', 'icon', 'match-url', 'match-type'] as const;

/** The four "unchanged" facets for a kept row (A12 keeps the shape stable). */
function keptFields(before: Facets): ImportFieldDiff[] {
  const unchanged: Record<string, ImportFieldValue | null> = {
    title: before.title,
    icon: before.icon,
    'match-url': before.urlMatch,
    'match-type': before.matchType,
  };
  return FACET_FIELDS.map((field) => ({
    field,
    before: unchanged[field],
    after: unchanged[field],
    changed: false,
  }));
}

/** The four field diffs for a row whose record is being taken/deleted. */
function changedFields(before: Facets, after: Facets): ImportFieldDiff[] {
  const beforeByField: Record<string, ImportFieldValue | null> = {
    title: before.title,
    icon: before.icon,
    'match-url': before.urlMatch,
    'match-type': before.matchType,
  };
  const afterByField: Record<string, ImportFieldValue | null> = {
    title: after.title,
    icon: after.icon,
    'match-url': after.urlMatch,
    'match-type': after.matchType,
  };
  return FACET_FIELDS.map((field) =>
    fieldDiff(field, beforeByField[field] ?? null, afterByField[field] ?? null));
}

/**
 * The "this side is KNOWN to have no record" side — the before of an `added`
 * row and the after of a `deleted` one. Distinct from "unknown": every record
 * here has a real, readable other side, so all four facets are still
 * reportable ("Match URL: removed (https://…)"). Only a record whose other side
 * genuinely cannot be read may omit facets.
 */
const NO_FACETS: Facets = { title: null, icon: null, urlMatch: null, matchType: null };

/**
 * The match definition as two facets: the URL text and the mode name.
 *
 * Facet convention (what a facet CARRIES): `ImportFieldValue` is defined as a
 * RENDERABLE form, so a facet may be display-ready. Concretely, `title` and
 * `urlMatch` carry the raw value (the renderer touches nothing) while
 * `matchType` is NAMED HERE, in the producer — the mode is presentation-only
 * (`'exact'` has no meaning to a reader) and naming it at the boundary is what
 * keeps the diff and the rule form from drifting apart. The raw mode is not
 * lost: it stays on the record the diff was computed from.
 */
function matchFacets(urlMatch: UrlMatchDefinition): {
  urlMatch: ImportFieldValue | null;
  matchType: ImportFieldValue | null;
} {
  return {
    urlMatch: textFacet(urlMatch.value),
    // The MODE is not text: it is one of two contract values, and it is rendered
    // through the same names the rule form uses, so a diff never shows a raw
    // `exact` next to a form that says `Exact URL`.
    matchType: textFacet(matchTypeLabel(urlMatch.type)),
  };
}

function slotFacets(slot: SlotDefinition): Facets {
  return {
    title: textFacet(slot.uiMarker.customTitle ?? slot.titleSnapshot),
    icon: storedIconFacet(slot.uiMarker.icon, `icon:slot-${String(slot.id)}`),
    ...matchFacets(slot.urlMatch),
  };
}

function ruleFacets(rule: PageRule): Facets {
  return {
    title: textFacet(rule.title ?? ''),
    icon: storedIconFacet(rule.favicon, `icon:${rule.id}`),
    ...matchFacets(rule.urlMatch),
  };
}

function fieldDiff(
  field: ImportFieldDiff['field'],
  before: ImportFieldValue | null,
  after: ImportFieldValue | null,
): ImportFieldDiff {
  return { field, before, after, changed: facetKey(before) !== facetKey(after) };
}

// ─── computeDiff (A12 / §3.2 / A4) ───────────────────────────────────────────

/**
 * Build the record-level (with field-level detail) diff of a package against the
 * target machine's current sync state.
 *
 * `intent` is optional; omitting it means the A1 default (all dimensions
 * incremental), which is exactly what the UI shows before the user chooses.
 */
export function computeDiff(
  pkg: ExportPackage,
  current: SyncState,
  intent: ImportIntent = defaultImportIntent(),
): ImportDiff {
  const records: ImportRecordDiff[] = [];

  // ── Slots ──────────────────────────────────────────────────────────────────
  if (pkg.slots !== undefined) {
    const currentById = new Map(current.slots.map((s) => [s.id, s]));

    for (const portable of pkg.slots) {
      const existing = currentById.get(portable.id);
      const afterTitle = portable.marker.customTitle ?? portable.titleSnapshot;
      const afterFacets: Facets = {
        title: textFacet(afterTitle),
        icon: portableIconFacet(portable.marker.icon),
        ...matchFacets(portable.urlMatch),
      };

      if (!existing) {
        records.push({
          kind: 'slot',
          id: portable.id,
          label: portable.titleSnapshot || `Slot ${String(portable.id)}`,
          status: 'added',
          fields: changedFields(NO_FACETS, afterFacets),
        });
        continue;
      }

      const before = slotFacets(existing);
      const differs =
        facetKey(before.title) !== facetKey(afterFacets.title) ||
        facetKey(before.icon) !== facetKey(afterFacets.icon) ||
        facetKey(before.urlMatch) !== facetKey(afterFacets.urlMatch) ||
        facetKey(before.matchType) !== facetKey(afterFacets.matchType);
      // "Both sides" is decided by the diff, NOT by the mode (§3.2). The default
      // is to take the file (D8); only an explicit `keep` override protects it.
      const override = overrideFor(intent, 'slot', portable.id);
      const status: ImportRecordStatus = override === 'keep' ? 'kept' : differs ? 'replaced' : 'kept';

      records.push({
        kind: 'slot',
        id: portable.id,
        label: existing.titleSnapshot || afterTitle || `Slot ${String(portable.id)}`,
        status,
        fields: status === 'kept' ? keptFields(before) : changedFields(before, afterFacets),
      });
    }

    // "File-missing, target-has" — the ONE case the mode governs.
    const carried = new Set(pkg.slots.map((s) => s.id));
    for (const existing of current.slots) {
      if (carried.has(existing.id)) continue;
      const override = overrideFor(intent, 'slot', existing.id);
      const deleted = deletesFileMissing(intent.dimensionModes.slots, override);
      const before = slotFacets(existing);
      records.push({
        kind: 'slot',
        id: existing.id,
        label: existing.titleSnapshot || `Slot ${String(existing.id)}`,
        status: deleted ? 'deleted' : 'kept',
        fields: deleted ? changedFields(before, NO_FACETS) : keptFields(before),
      });
    }
  }

  // ── Rules ──────────────────────────────────────────────────────────────────
  if (pkg.rules !== undefined) {
    const currentById = new Map(current.rules.map((r) => [r.id, r]));

    for (const portable of pkg.rules) {
      const existing = currentById.get(portable.id);
      const afterTitle = portable.title ?? '';
      const afterFacets: Facets = {
        title: textFacet(afterTitle),
        icon: portableIconFacet(portable.favicon),
        ...matchFacets(portable.urlMatch),
      };

      if (!existing) {
        records.push({
          kind: 'rule',
          id: portable.id,
          label: portable.title ?? portable.urlMatch.value,
          status: 'added',
          fields: changedFields(NO_FACETS, afterFacets),
        });
        continue;
      }

      const before = ruleFacets(existing);
      const differs =
        facetKey(before.title) !== facetKey(afterFacets.title) ||
        facetKey(before.icon) !== facetKey(afterFacets.icon) ||
        facetKey(before.urlMatch) !== facetKey(afterFacets.urlMatch) ||
        facetKey(before.matchType) !== facetKey(afterFacets.matchType);
      const override = overrideFor(intent, 'rule', portable.id);
      const status: ImportRecordStatus = override === 'keep' ? 'kept' : differs ? 'replaced' : 'kept';

      records.push({
        kind: 'rule',
        id: portable.id,
        label: existing.title ?? (afterTitle || portable.urlMatch.value),
        status,
        fields: status === 'kept' ? keptFields(before) : changedFields(before, afterFacets),
      });
    }

    const carried = new Set(pkg.rules.map((r) => r.id));
    for (const existing of current.rules) {
      if (carried.has(existing.id)) continue;
      const override = overrideFor(intent, 'rule', existing.id);
      const deleted = deletesFileMissing(intent.dimensionModes.rules, override);
      const before = ruleFacets(existing);
      records.push({
        kind: 'rule',
        id: existing.id,
        label: existing.title ?? existing.urlMatch.value,
        status: deleted ? 'deleted' : 'kept',
        fields: deleted ? changedFields(before, NO_FACETS) : keptFields(before),
      });
    }
  }

  return { records, dimensions: presence(pkg) };
}

// ─── applyIntent (A1 / A4 / C4) ──────────────────────────────────────────────

/**
 * Produce the FINAL state the intent would create — a pure derivation, never a
 * write. The caller (T10) binds this to a version and persists it.
 *
 * The mapping of package records into stored shapes is delegated to
 * `packageToSyncPatch` so the server has exactly ONE mapping implementation.
 */
export function applyIntent(
  pkg: ExportPackage,
  current: SyncState,
  intent: ImportIntent,
): SyncState {
  const patch = packageToSyncPatch(pkg, current);

  const final: SyncState = {
    ...current,
    matchSettings: { ...current.matchSettings },
    slots: [...current.slots],
    rules: [...current.rules],
  };

  // ── Slots ──────────────────────────────────────────────────────────────────
  if (patch.slots) {
    const fileSlots = patch.slots;
    const fileIds = new Set(fileSlots.map((s) => s.id));

    // 1. Drop the file-missing records the mode (or a `take` override) deletes.
    final.slots = final.slots.filter((s) => {
      if (fileIds.has(s.id)) return true; // both sides — resolved in step 2
      return !deletesFileMissing(intent.dimensionModes.slots, overrideFor(intent, 'slot', s.id));
    });

    // 2. Take the file for both-sides / file-only rows unless kept.
    for (const incoming of fileSlots) {
      const idx = final.slots.findIndex((s) => s.id === incoming.id);
      const override = overrideFor(intent, 'slot', incoming.id);
      if (idx >= 0) {
        if (override === 'keep') continue; // preserve the target's own record
        final.slots[idx] = incoming;
      } else {
        final.slots.push(incoming);
      }
    }
  }

  // ── Rules ──────────────────────────────────────────────────────────────────
  if (patch.rules) {
    const fileRules = patch.rules;
    const fileIds = new Set(fileRules.map((r) => r.id));

    final.rules = final.rules.filter((r) => {
      if (fileIds.has(r.id)) return true;
      return !deletesFileMissing(intent.dimensionModes.rules, overrideFor(intent, 'rule', r.id));
    });

    for (const incoming of fileRules) {
      const idx = final.rules.findIndex((r) => r.id === incoming.id);
      const override = overrideFor(intent, 'rule', incoming.id);
      if (idx >= 0) {
        if (override === 'keep') continue;
        final.rules[idx] = incoming;
      } else {
        final.rules.push(incoming);
      }
    }
  }

  // ── Settings (only when carried — A2/A3) ───────────────────────────────────
  if (patch.settings) {
    final.matchSettings = { ...patch.settings.matchSettings };
    final.switchDirection = patch.settings.switchDirection;
    final.autoBindGlobal = patch.settings.autoBindGlobal;

    // D3: a slot's `strategy` lives in the settings dimension, so it is applied
    // here even for slots the file did not carry (settings is a global axis).
    // Iterating the record's entries (rather than indexing by slot id) is what
    // keeps the lookup honestly partial — a missing key has nothing to apply.
    for (const [id, strategy] of Object.entries(patch.settings.slotStrategies)) {
      const slot = final.slots.find((s) => s.id === Number(id));
      if (slot) slot.strategy = strategy;
    }
  }

  return final;
}

// ─── quantifyDeletions (D7) ──────────────────────────────────────────────────

/**
 * Count the records that would be PERMANENTLY removed (present in `current`,
 * absent from `final`). Replacements are deliberately excluded — they can be
 * redone, so they are not "irreversible" (D7).
 */
export function quantifyDeletions(
  final: SyncState,
  current: SyncState,
): { slots: number; rules: number } {
  const finalSlotIds = new Set(final.slots.map((s) => s.id));
  const finalRuleIds = new Set(final.rules.map((r) => r.id));
  return {
    slots: current.slots.filter((s) => !finalSlotIds.has(s.id)).length,
    rules: current.rules.filter((r) => !finalRuleIds.has(r.id)).length,
  };
}

// ─── findMatchOverlaps (D10) ─────────────────────────────────────────────────

/**
 * Report every set of rules sharing an EXACT (`type` + `value`) `urlMatch`.
 *
 * Deliberately a pure function of the FINAL state: the question D10 asks is
 * "does a duplicate exist in the result", not "how did it get there".
 */
export function findMatchOverlaps(final: SyncState): MatchOverlap[] {
  const groups = new Map<string, { urlMatch: PageRule['urlMatch']; ids: string[] }>();

  for (const rule of final.rules) {
    const key = `${rule.urlMatch.type}\u0000${rule.urlMatch.value}`;
    const group = groups.get(key);
    if (group) {
      group.ids.push(rule.id);
    } else {
      groups.set(key, { urlMatch: { ...rule.urlMatch }, ids: [rule.id] });
    }
  }

  const overlaps: MatchOverlap[] = [];
  for (const group of groups.values()) {
    if (group.ids.length > 1) {
      overlaps.push({ urlMatch: group.urlMatch, recordIds: [...group.ids] });
    }
  }
  return overlaps;
}