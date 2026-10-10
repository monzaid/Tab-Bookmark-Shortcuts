/**
 * Import diff, intent application and match-overlap detection (T8).
 *
 * All four functions are PURE IN THEIR INPUTS: they read their arguments, never
 * touch storage and never mutate an input. They are NOT fully deterministic,
 * though — `applyIntent` stamps a NEW record's `createdAt`/`updatedAt` from the
 * wall clock (via `packageToSyncPatch`), so two calls can differ by a
 * millisecond. Tests that compare two runs must pin the clock.
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
  ImportRecordBefore,
  ImportPartDiff,
  DimensionPresence,
  MatchOverlap,
  DimensionMode,
  MatchRuleSettings,
} from './types';
import type { ExportPackage, PortableIcon, PortableShortcutBinding } from './export-package';
import {
  packageToSyncPatch,
  iconToPortable,
  summariseMatchSettings,
  slotStrategyPartId,
  slotAutoBindPartId,
} from './export-package';
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

/**
 * The facets of one side as the row-level view a list renders.
 *
 * The list needs the MACHINE's own values (so a `kept` row and the
 * `<target> → <imported>` detail both describe the target), and it must not
 * re-derive them: `Facets` is this module's private comparison shape, so exposing
 * it directly would let a consumer depend on something that is free to change.
 */
function toRecordBefore(facets: Facets, priority?: number): ImportRecordBefore {
  return {
    title: facets.title,
    icon: facets.icon,
    urlMatch: facets.urlMatch,
    matchType: facets.matchType,
    ...(priority !== undefined ? { priority } : {}),
  };
}

/**
 * The facets EVERY record has, in the order the UI shows them.
 *
 * `priority` is deliberately absent: it is a RULE's field, and a slot has none.
 * Listing it for a slot produced a `Priority: unchanged` line for a field that
 * does not exist on the record — the Fields detail must describe the record the
 * row is about, and inventing a field for it misstates what a slot is.
 */
const BASE_FACET_FIELDS = ['title', 'icon', 'match-url', 'match-type'] as const;

/**
 * Build the ordered facet list for a record.
 *
 * One constructor for every outcome (kept / changed / added / deleted) so the
 * facet set cannot depend on WHICH branch produced the row — only on whether the
 * record kind HAS the field. `before`/`after` default to each other, which is
 * exactly the "unchanged" case; `priority` is appended only when a side supplies
 * one, i.e. for rules (a rule whose side is genuinely absent — an `added` record
 * has no `before` — still supplies the side it does have).
 *
 * `priority` is included for rules so a change to one is REPORTED rather than
 * silently applied: leaving it out meant the detail could say "unchanged" for a
 * rule whose priority the import was about to overwrite.
 */
function buildFields(before: Facets, after: Facets, priority: PriorityPair): ImportFieldDiff[] {
  const hasPriority = priority.before !== undefined || priority.after !== undefined;
  const fields: Array<ImportFieldDiff['field']> = hasPriority
    ? [...BASE_FACET_FIELDS, 'priority']
    : [...BASE_FACET_FIELDS];

  const beforeByField: Record<string, ImportFieldValue | null> = {
    title: before.title,
    icon: before.icon,
    'match-url': before.urlMatch,
    'match-type': before.matchType,
    priority: numberFacet(priority.before),
  };
  const afterByField: Record<string, ImportFieldValue | null> = {
    title: after.title,
    icon: after.icon,
    'match-url': after.urlMatch,
    'match-type': after.matchType,
    priority: numberFacet(priority.after),
  };
  return fields.map((field) =>
    fieldDiff(field, beforeByField[field], afterByField[field]));
}

/** The priority of each side; `undefined` = the record has none (a slot). */
interface PriorityPair {
  before?: number;
  after?: number;
}

/** The four "unchanged" facets for a kept row (A12 keeps the shape stable). */
function keptFields(before: Facets, priority: PriorityPair = {}): ImportFieldDiff[] {
  return buildFields(before, before, priority);
}

/** The field diffs for a row whose record is being taken/deleted. */
function changedFields(
  before: Facets,
  after: Facets,
  priority: PriorityPair = {},
): ImportFieldDiff[] {
  return buildFields(before, after, priority);
}

/** A number as a text facet; a record with no such field yields `null`. */
function numberFacet(value: number | undefined): ImportFieldValue | null {
  return value === undefined ? null : { kind: 'text', value: String(value) };
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
 * `urlMatch` carry the raw value (both are `text` facets, which the renderer
 * returns verbatim; other kinds — `url`, `local-ref`, `recipe` — are formatted)
 * while `matchType` is NAMED HERE, in the producer — the mode is presentation-only
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
        // A file-only record is TAKE-able by default like every other row, but a
        // `keep` override declines it: the record is simply never added, which is
        // the target keeping what it has. Reporting it as `kept` keeps the row
        // visible with the file's own values still readable in its Fields — the
        // alternative (dropping the row) would make a decline look like the file
        // never carried it.
        const declinedAdded = overrideFor(intent, 'slot', portable.id) === 'keep';
        records.push({
          kind: 'slot',
          id: portable.id,
          label: portable.titleSnapshot || `Slot ${String(portable.id)}`,
          status: declinedAdded ? 'kept' : 'added',
          fields: changedFields(NO_FACETS, afterFacets),
          // A rule the machine does not have: `before` is null (no values to
          // describe), while `icon` is the one this row ends up with.
          before: null,
          // R2: the list needs the icon this row ends up with, in renderable
          // form — the same facet the field detail carries, promoted to row level
          // so the list does not have to walk `fields` to find it. A declined row
          // ends up with NO icon and says so (`null`) rather than showing the
          // file's, which is the value a `keep` was chosen to avoid.
          icon: declinedAdded ? null : afterFacets.icon,
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
      //
      // An explicit `take` is honoured as `replaced` even when the two sides are
      // EQUAL, because that is literally what `applyIntent` does with it: the
      // target's record is overwritten by the file's. Reporting `kept` there made
      // the checkbox a dead control in the take direction — an identical
      // both-sides row could never be ticked, so the one choice a user could not
      // express was "take this".
      const override = overrideFor(intent, 'slot', portable.id);
      const status: ImportRecordStatus =
        override === 'keep' ? 'kept' : override === 'take' ? 'replaced' : differs ? 'replaced' : 'kept';

      records.push({
        kind: 'slot',
        id: portable.id,
        label: existing.titleSnapshot || afterTitle || `Slot ${String(portable.id)}`,
        status,
        fields: status === 'kept' ? keptFields(before) : changedFields(before, afterFacets),
        before: toRecordBefore(before),
        // A `kept` row keeps the target's own icon; every other outcome shows
        // the one the file brings.
        icon: status === 'kept' ? before.icon : afterFacets.icon,
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
        before: toRecordBefore(before),
        // The file has no record for this slot, so the only icon in play is the
        // target's own — shown for a `kept` row, and with the `deleted` status
        // already saying it is on its way out.
        icon: before.icon,
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
        // See the slot case: a `keep` override declines a file-only record, and
        // the row reports that decline (`kept`) instead of claiming it will be
        // added. The file's own priority is still readable in the Fields.
        const declinedAdded = overrideFor(intent, 'rule', portable.id) === 'keep';
        records.push({
          kind: 'rule',
          id: portable.id,
          label: portable.title ?? portable.urlMatch.value,
          status: declinedAdded ? 'kept' : 'added',
          fields: changedFields(NO_FACETS, afterFacets, { after: portable.priority }),
          priority: portable.priority,
          // See the slot case: a record the machine does not have has no side to
          // describe.
          before: null,
          icon: declinedAdded ? null : afterFacets.icon,
        });
        continue;
      }

      const before = ruleFacets(existing);
      const differs =
        facetKey(before.title) !== facetKey(afterFacets.title) ||
        facetKey(before.icon) !== facetKey(afterFacets.icon) ||
        facetKey(before.urlMatch) !== facetKey(afterFacets.urlMatch) ||
        facetKey(before.matchType) !== facetKey(afterFacets.matchType);
      // See the slot case: `take` on a both-sides row is reported as `replaced`
      // even when the two sides are equal, because that is what `applyIntent`
      // does — otherwise the take direction of the checkbox would be a no-op.
      const override = overrideFor(intent, 'rule', portable.id);
      const status: ImportRecordStatus =
        override === 'keep' ? 'kept' : differs || override === 'take' ? 'replaced' : 'kept';

      records.push({
        kind: 'rule',
        id: portable.id,
        label: existing.title ?? (afterTitle || portable.urlMatch.value),
        status,
        fields: status === 'kept'
          ? keptFields(before, { before: existing.priority, after: portable.priority })
          : changedFields(before, afterFacets, { before: existing.priority, after: portable.priority }),
        before: toRecordBefore(before, existing.priority),
        // The list column shows the TARGET's priority — that is the rule as it
        // stands on this machine. The file's number is visible in the field
        // detail, so showing it here too would misreport the machine.
        priority: existing.priority,
        icon: status === 'kept' ? before.icon : afterFacets.icon,
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
        fields: deleted
          ? changedFields(before, NO_FACETS, { before: existing.priority })
          : keptFields(before, { before: existing.priority }),
        before: toRecordBefore(before, existing.priority),
        priority: existing.priority,
        icon: before.icon,
      });
    }
  }

  return {
    records,
    dimensions: presence(pkg),
    ...(pkg.settings !== undefined
      ? { settingsParts: settingsPartDiffs(pkg, current, intent) }
      : {}),
    ...(pkg.shortcuts !== undefined
      ? { shortcutParts: shortcutPartDiffs(pkg, intent) }
      : {}),
  };
}

// ─── Settings / shortcut parts (R9/R10) ───────────────────────────────

/** The three global settings parts, each as its own row. */
const GLOBAL_SETTING_ROWS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'matchSettings', label: 'Match settings' },
  { id: 'switchDirection', label: 'Switch direction' },
  { id: 'autoBindGlobal', label: 'Auto-bind' },
];

/**
 * A settings value as a renderable text facet (the diff's one value shape).
 *
 * A boolean renders as `true` / `false` — the SAME spelling the export panel
 * already uses for these two settings. Inventing a friendlier "On"/"Off" here
 * would make the same value read differently on the two surfaces, which is the
 * drift a single vocabulary exists to prevent.
 */
function settingText(value: unknown): ImportFieldValue | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return textFacet(value);
  if (typeof value === 'boolean') return { kind: 'text', value: String(value) };
  // `matchSettings` / a slot strategy: rendered through the SAME summariser the
  // export panel uses, so a strategy reads identically on both surfaces.
  return { kind: 'text', value: summariseMatchSettings(value as MatchRuleSettings) };
}

/**
 * Describe every settings part the FILE carries against the target machine.
 *
 * Only carried parts get a row: a part the file omits is not applied, so showing
 * it would offer a checkbox that does nothing. The row's `status` follows the
 * record convention — `kept` when the user left it (or it is identical),
 * `replaced` when it will be taken and differs.
 */
function settingsPartDiffs(
  pkg: ExportPackage,
  current: SyncState,
  intent: ImportIntent,
): ImportPartDiff[] {
  const settings = pkg.settings;
  if (!settings) return [];

  const taken = (id: string): boolean =>
    intent.takeSettingIds === undefined || intent.takeSettingIds.includes(id);

  const rows: ImportPartDiff[] = [];

  const push = (
    id: string,
    label: string,
    group: 'global' | 'slot',
    before: unknown,
    after: unknown,
    slotId?: number,
  ): void => {
    const afterFacet = settingText(after);
    const beforeFacet = settingText(before);
    const changed = facetKey(beforeFacet) !== facetKey(afterFacet);
    // `undefined` after = the file does not carry this part at all → no row.
    if (after === undefined) return;
    const status: ImportRecordStatus = taken(id) ? (changed ? 'replaced' : 'kept') : 'kept';
    rows.push({
      id,
      label,
      group,
      ...(slotId !== undefined ? { slotId } : {}),
      status,
      before: beforeFacet,
      after: afterFacet,
      changed,
    });
  };

  for (const row of GLOBAL_SETTING_ROWS) {
    const key = row.id as 'matchSettings' | 'switchDirection' | 'autoBindGlobal';
    push(row.id, row.label, 'global', current[key], settings[key]);
  }

  // Global auto-bind and the per-slot strategy rows are labelled with the slot
  // they address, using the same "Slot N" wording the record rows use.
  const slotEntries = settings.slotStrategies ?? {};
  for (const [key, strategy] of Object.entries(slotEntries)) {
    const slotId = Number(key);
    const existing = current.slots.find((s) => s.id === slotId);
    push(
      slotStrategyPartId(slotId),
      `Slot ${String(slotId)} strategy`,
      'slot',
      existing?.strategy ?? 'inherit',
      strategy,
      slotId,
    );
  }

  const autoBinds = settings.slotAutoBinds ?? {};
  for (const [key, override] of Object.entries(autoBinds)) {
    const slotId = Number(key);
    const existing = current.slots.find((s) => s.id === slotId);
    push(
      slotAutoBindPartId(slotId),
      `Slot ${String(slotId)} auto-bind`,
      'slot',
      existing?.autoBindOverride,
      override,
      slotId,
    );
  }

  return rows;
}

/**
 * Describe every shortcut binding the file carries.
 *
 * `before` is deliberately `null`: the current machine's bindings are not part
 * of this diff's inputs (a package does not carry the target's own shortcuts,
 * and the worker's diff is computed from the file plus `SyncState` only). The
 * row therefore reports what the FILE carries rather than inventing a
 * comparison it cannot make.
 */
function shortcutPartDiffs(pkg: ExportPackage, intent: ImportIntent): ImportPartDiff[] {
  const shortcuts = pkg.shortcuts;
  if (!shortcuts) return [];

  const taken = (name: string): boolean =>
    intent.takeShortcutNames === undefined || intent.takeShortcutNames.includes(name);

  const rows: ImportPartDiff[] = [];
  const push = (
    binding: PortableShortcutBinding,
    group: 'global-shortcut' | 'slot-shortcut',
    slotId?: number,
  ): void => {
    const after: ImportFieldValue | null =
      binding.shortcut === null ? null : textFacet(binding.shortcut);
    rows.push({
      id: binding.name,
      label: binding.name,
      group,
      ...(slotId !== undefined ? { slotId } : {}),
      status: taken(binding.name) ? 'added' : 'kept',
      before: null,
      after,
      changed: true,
    });
  };

  for (const binding of shortcuts.global) push(binding, 'global-shortcut');
  for (const [key, list] of Object.entries(shortcuts.perSlot)) {
    for (const binding of list) push(binding, 'slot-shortcut', Number(key));
  }

  return rows;
}

// ─── applyIntent (A1 / A4 / C4) ──────────────────────────────────────────────

/**
 * Produce the FINAL state the intent would create — a no-write derivation (it
 * never persists; the caller (T10) binds it to a version and saves it). It is
 * pure in its INPUTS but not clock-independent: new records get their timestamps
 * from `new Date()` inside `packageToSyncPatch`.
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
      // `keep` is the ONE declination, and it applies to BOTH cases: it preserves
      // the target's own record when there is one, and it declines to CREATE one
      // when there is not (the target "keeps" its absence). Treating `keep` as a
      // no-op for a file-only row made the row's checkbox a control that could
      // not do what its unchecked state said.
      if (override === 'keep') continue;
      if (idx >= 0) {
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
      // See the slot case: `keep` declines creation as well as replacement.
      if (override === 'keep') continue;
      if (idx >= 0) {
        final.rules[idx] = incoming;
      } else {
        final.rules.push(incoming);
      }
    }
  }

  // ── Settings (only when carried — A2/A3; per-part since R9) ─────────────
  if (patch.settings) {
    const settings = patch.settings;
    // R9: `takeSettingIds` is an ALLOW-list. `undefined` means "take every
    // part the file carries" (the A1 default); a defined array restricts the
    // write to the parts the user actually ticked. An absent part is skipped by
    // its own check below, so an unticked part and a non-carried part behave
    // identically: neither touches the target — which is what the user meant.
    const takes = (id: string): boolean =>
      intent.takeSettingIds === undefined || intent.takeSettingIds.includes(id);

    if (settings.matchSettings !== undefined && takes('matchSettings')) {
      final.matchSettings = { ...settings.matchSettings };
    }
    if (settings.switchDirection !== undefined && takes('switchDirection')) {
      final.switchDirection = settings.switchDirection;
    }
    if (settings.autoBindGlobal !== undefined && takes('autoBindGlobal')) {
      final.autoBindGlobal = settings.autoBindGlobal;
    }

    // D3: a slot's `strategy` lives in the settings dimension, so it is applied
    // here even for slots the file did not carry (settings is a global axis).
    // Iterating the record's entries (rather than indexing by slot id) is what
    // keeps the lookup honestly partial — a missing key has nothing to apply.
    //
    // REPLACE the element, never write through it: `final.slots` is a SHALLOW
    // copy of `current.slots`, so a surviving slot is the SAME object as the
    // caller's. `slot.strategy = strategy` would mutate the input `current` —
    // the mutation this file's own header promises never happens — and, in the
    // UI, write it straight into React state. A fresh object keeps the input
    // byte-for-byte intact while still carrying the new strategy.
    for (const [id, strategy] of Object.entries(settings.slotStrategies ?? {})) {
      const slotId = Number(id);
      if (!takes(slotStrategyPartId(slotId))) continue;
      const idx = final.slots.findIndex((s) => s.id === slotId);
      if (idx >= 0) final.slots[idx] = { ...final.slots[idx], strategy };
    }

    // R4: the per-slot auto-bind override, applied the same way. A slot with
    // no key keeps whatever it had (the sparse map means "no override", so
    // there is nothing to reset).
    for (const [id, override] of Object.entries(settings.slotAutoBinds ?? {})) {
      const slotId = Number(id);
      if (!takes(slotAutoBindPartId(slotId))) continue;
      const idx = final.slots.findIndex((s) => s.id === slotId);
      // An untickable "no override" cannot be expressed by a boolean map, so
      // removal is intentionally NOT offered: only an explicit true/false
      // travels.
      if (idx >= 0) final.slots[idx] = { ...final.slots[idx], autoBindOverride: override };
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