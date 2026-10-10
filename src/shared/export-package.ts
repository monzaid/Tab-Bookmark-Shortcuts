/**
 * Portable export package — independent transfer schema + bidirectional mapping.
 *
 * A14: the package deliberately does NOT mirror `SyncState`. It carries only
 * what can be reproduced on another machine:
 * - icons as URL / bare `local-icon:` reference / reproducible recipe (C1/C2);
 * - no bitmaps, no `configVersion`, no timestamps (C1/D5).
 *
 * D3: a slot's `strategy` is stripped from `slots[]` and carried once in the
 * settings dimension (`settings.slotStrategies`).
 *
 * This module does ONLY shape conversion — no diff, no validation, no storage.
 */

import type {
  SyncState,
  SlotDefinition,
  PageRule,
  IconSource,
  UrlMatchDefinition,
  MatchRuleSettings,
  SwitchDirection,
  SlotUiMarker,
  ExportScope,
} from './types';
import { LOCAL_ICON_REF_PREFIX } from './icon-ref';

// ─── Portable shapes ─────────────────────────────────────────────────────────

/** How an icon is carried in a package (C1) — never a bitmap. */
export interface PortableIcon {
  kind: 'url' | 'local-ref' | 'recipe';
  /** kind === 'url' */
  url?: string;
  /** kind === 'local-ref' — BARE `local-icon:<key>` (C2) */
  ref?: string;
  /** kind === 'recipe' */
  bgColor?: string;
  text?: string;
  textColor?: string;
}

export interface PortableSlotMarker {
  customTitle?: string | null;
  icon?: PortableIcon;
  backgroundColor?: string;
}

/** A slot as carried in the package — no `strategy`, no timestamps (D3/D5). */
export interface PortableSlotDef {
  id: number;
  urlMatch: UrlMatchDefinition;
  marker: PortableSlotMarker;
  titleSnapshot: string;
  faviconSnapshot: string;
}

/** A rule as carried in the package — no timestamps (D5). */
export interface PortableRule {
  id: string;
  urlMatch: UrlMatchDefinition;
  priority: number;
  title?: string;
  favicon?: PortableIcon;
  enabled?: boolean;
}

/**
 * Settings — the three global parts plus the per-slot parts that were stripped
 * from `slots[]` (D3).
 *
 * EVERY part is optional (R4/9). This is a deliberate reversal of the earlier
 * "settings is an all-or-nothing global axis" ruling: a user genuinely needs to
 * share "how switching works" without also shipping twenty per-slot overrides,
 * and the part is the unit they think in ("Match settings", "per-slot strategy").
 *
 * Semantics of absence: an ABSENT part is NOT carried and therefore NEVER
 * applied — it cannot overwrite the target machine's value. A part that IS
 * present is validated exactly as before. An old package carrying all four parts
 * is still a valid package, so `schemaVersion` stays 1.
 */
export interface PortableSettings {
  matchSettings?: MatchRuleSettings;
  switchDirection?: SwitchDirection;
  autoBindGlobal?: boolean;
  slotStrategies?: Record<number, 'inherit' | MatchRuleSettings>;
  /**
   * Per-slot auto-bind overrides, moved OUT of `slots[]` so the settings
   * dimension is the single home of every setting-shaped value (R4: "每个槽的
   * Strategy、Auto-bind" are the same kind of thing and belong on one axis).
   * `true`/`false` = explicit override, absent key = follow the global default.
   */
  slotAutoBinds?: Record<number, boolean>;
}

export interface PortableShortcutBinding {
  name: string;
  shortcut: string | null;
}

export interface PortableShortcuts {
  global: PortableShortcutBinding[];
  perSlot: Record<number, PortableShortcutBinding[]>;
}

/** The transfer package (schemaVersion fixed at 1 — no back-compat). */
export interface ExportPackage {
  schemaVersion: number;
  /** Diagnostic only — never participates in validation (D11). */
  generator: { name: string; version: string };
  exportedAt: string;
  scope: ExportScope;
  slots?: PortableSlotDef[];
  rules?: PortableRule[];
  settings?: PortableSettings;
  shortcuts?: PortableShortcuts;
}

/**
 * C8: the DECLARED field names of the package shapes above — the key sets the
 * "unknown extra field" tolerant reader compares against.
 *
 * Kept in this file, ADJACENT to the interfaces it mirrors, because a runtime
 * key list cannot be derived from a type (types are erased). The key sets are
 * therefore spelled out as `as const satisfies Record<keyof T, true>`: the
 * mapped type is EXHAUSTIVE, so ADDING A FIELD to any shape above without
 * mirroring it here is a COMPILE error, not a silent gap.
 *
 * Scope is deliberate: only the package root and each `slots[]` / `rules[]`
 * item are walked. Deeper interiors (`urlMatch`, `marker`, `icon`) are NOT
 * inspected — a bounded report, not a schema walker.
 *
 * Deferred (T22 follow-up): the "defaulted" half of C8 — a field the reader
 * filled from a derived default rather than the file — is NOT reported. It
 * needs design input on which derived defaults (`packageToSyncPatch`'s
 * cross-machine defaults) are worth surfacing; the strict-reject path (D14)
 * already covers a *required* field being absent.
 */
const ROOT_KEYS = {
  schemaVersion: true, generator: true, exportedAt: true, scope: true,
  slots: true, rules: true, settings: true, shortcuts: true,
} as const satisfies Record<keyof ExportPackage, true>;

const SLOT_KEYS = {
  id: true, urlMatch: true, marker: true,
  titleSnapshot: true, faviconSnapshot: true,
} as const satisfies Record<keyof PortableSlotDef, true>;

/**
 * The `settings` part names — the allowlist the tolerant reader compares the
 * `settings` object against, so an unknown setting-shaped key is disclosed
 * rather than silently dropped.
 */
const SETTINGS_KEYS = {
  matchSettings: true, switchDirection: true, autoBindGlobal: true,
  slotStrategies: true, slotAutoBinds: true,
} as const satisfies Record<keyof PortableSettings, true>;

const RULE_KEYS = {
  id: true, urlMatch: true, priority: true, title: true, favicon: true, enabled: true,
} as const satisfies Record<keyof PortableRule, true>;

export const PACKAGE_FIELD_ALLOWLIST = {
  root: Object.keys(ROOT_KEYS),
  slot: Object.keys(SLOT_KEYS),
  rule: Object.keys(RULE_KEYS),
  settings: Object.keys(SETTINGS_KEYS),
} as const;

// ─── Settings part ids (R4/R9 — ONE vocabulary for both surfaces) ─────

/**
 * The id of one settings part. The SAME id space is used by:
 *   1. `ExportScope.excludedSettingIds` — what the user left out;
 *   2. `ImportIntent.takeSettingIds`    — what the user chose to take;
 *   3. the checkbox rows on both panels.
 *
 * Living here (not in the UI) is what makes (1) and (2) the same vocabulary: the
 * export panel's exclusion and the import panel's take-checkbox address a part
 * by one name, so the two surfaces cannot drift into two spellings of "the
 * global match settings".
 */
export type SettingPartId =
  | 'matchSettings'
  | 'switchDirection'
  | 'autoBindGlobal'
  | `slot:${number}:strategy`
  | `slot:${number}:autoBind`;

/** The three global parts, in display order. */
export const GLOBAL_SETTING_PART_IDS: readonly SettingPartId[] = [
  'matchSettings',
  'switchDirection',
  'autoBindGlobal',
];

/**
 * The per-slot parts a slot OWNS — i.e. the parts that address THIS slot.
 *
 * `slotAutoBinds` is sparse: a slot with no explicit override owns nothing here
 * (it follows the global default), so no row is invented for it. That is why the
 * caller must ask per slot against the real data rather than render the full
 * cross-product of 10 slots × 2 parts.
 */
/**
 * The two per-slot part ids, as functions.
 *
 * `String(slotId)` plus an assertion is deliberate: interpolating the NUMBER
 * directly would satisfy the template literal type but violates the lint rule
 * against numbers in templates, while `String()` widens the literal to
 * `${string}` — which no longer satisfies `SettingPartId`. The assertion bridges
 * exactly that gap and is the ONLY place either id is spelled.
 */
export function slotStrategyPartId(slotId: number): SettingPartId {
  return `slot:${String(slotId)}:strategy` as SettingPartId;
}

export function slotAutoBindPartId(slotId: number): SettingPartId {
  return `slot:${String(slotId)}:autoBind` as SettingPartId;
}

/** The per-slot parts a slot owns, in display order. */
export function slotSettingPartIds(slotId: number, hasAutoBindOverride: boolean): SettingPartId[] {
  const parts: SettingPartId[] = [slotStrategyPartId(slotId)];
  if (hasAutoBindOverride) parts.push(slotAutoBindPartId(slotId));
  return parts;
}

// ─── Settings value rendering (ONE wording for the diff and both panels) ─────

/**
 * A match-settings triple as text — never `[object Object]`.
 *
 * Lives in `shared` because THREE consumers must agree on the wording: the
 * export panel's value preview, the import panel's settings values, and the
 * settings-part diff rows. Two spellings of the same triple is exactly the drift
 * a single source prevents.
 */
export function summariseMatchSettings(s: MatchRuleSettings): string {
  return `Tab ID ${s.tabIdMode}, Rule check ${s.ruleCheckMode}, Priority ${s.priority}`;
}

/**
 * A per-slot strategy as text. `undefined` is NOT an explicit `'inherit'`:
 * absent means the package carries no strategy for that slot (the target is left
 * alone), while an explicit `'inherit'` resets the target to inherit.
 */
export function summariseStrategy(v: 'inherit' | MatchRuleSettings | undefined): string {
  if (v === undefined) return 'inherit (by default)';
  if (v === 'inherit') return 'inherit';
  return summariseMatchSettings(v);
}

/** A partial config derived from a package, ready to be merged by the service. */
export interface SyncPatch {
  slots?: SlotDefinition[];
  rules?: PageRule[];
  settings?: PortableSettings;
  shortcuts?: PortableShortcuts;
}

const SCHEMA_VERSION = 1;
const GENERATOR = { name: 'tab-bookmark-shortcuts', version: '1.0.0' };

// ─── Icon ⇄ portable ─────────────────────────────────────────────────────────

/**
 * Convert a stored `IconSource` into its portable form (C1/C2).
 *
 * Q1=A: `type:'template'` is judged directly from the `IconSource` (background
 * passes recipes through unrendered), so no data-URI reverse-engineering is
 * needed. `type:'upload'` may arrive already dereferenced to a data URI (the
 * storage read resolves refs) — in that case `iconKey` (derived from the record
 * id) supplies the BARE reference key to send.
 */
export function iconToPortable(icon: IconSource, iconKey?: string): PortableIcon {
  if (icon.type === 'url') return { kind: 'url', url: icon.value };
  if (icon.type === 'template') {
    return {
      kind: 'recipe',
      bgColor: icon.backgroundColor,
      text: icon.text,
      textColor: icon.textColor,
    };
  }
  // upload: already-bare ref passes through; a dereferenced data URI is mapped
  // back to its derived key (`icon:slot-N` / `icon:<rule.id>`).
  if (icon.value.startsWith(LOCAL_ICON_REF_PREFIX)) {
    return { kind: 'local-ref', ref: icon.value };
  }
  return { kind: 'local-ref', ref: `${LOCAL_ICON_REF_PREFIX}${iconKey ?? ''}` };
}

export function portableToIcon(portable: PortableIcon): IconSource {
  if (portable.kind === 'url') return { type: 'url', value: portable.url ?? '' };
  if (portable.kind === 'recipe') {
    return {
      type: 'template',
      value: '',
      backgroundColor: portable.bgColor,
      text: portable.text,
      textColor: portable.textColor,
    };
  }
  return { type: 'upload', value: portable.ref ?? '' };
}

// ─── SyncState → Package ─────────────────────────────────────────────────────

export interface PackageExtras {
  shortcuts?: PortableShortcuts;
}

export function syncStateToPackage(
  sync: SyncState,
  scope: ExportScope,
  extras: PackageExtras = {},
): ExportPackage {
  const pkg: ExportPackage = {
    schemaVersion: SCHEMA_VERSION,
    generator: { ...GENERATOR },
    exportedAt: new Date().toISOString(),
    scope,
  };

  const excludedSlots = new Set(scope.excludedSlotIds ?? []);
  const excludedRules = new Set(scope.excludedRuleIds ?? []);

  if (scope.slots) {
    pkg.slots = sync.slots
      .filter((s) => !excludedSlots.has(s.id))
      .map((slot) => ({
        id: slot.id,
        urlMatch: slot.urlMatch,
        marker: markerToPortable(slot.uiMarker, `icon:slot-${String(slot.id)}`),
        titleSnapshot: slot.titleSnapshot,
        faviconSnapshot: slot.faviconSnapshot,
      }));
  }

  if (scope.rules) {
    pkg.rules = sync.rules
      .filter((r) => !excludedRules.has(r.id))
      .map((rule) => ({
        id: rule.id,
        urlMatch: rule.urlMatch,
        priority: rule.priority,
        title: rule.title,
        favicon: rule.favicon ? iconToPortable(rule.favicon, `icon:${rule.id}`) : undefined,
        enabled: rule.enabled,
      }));
  }

  if (scope.settings) {
    const omitted = new Set<string>(scope.excludedSettingIds ?? []);
    const settings: PortableSettings = {};

    // Only the parts that were NOT deselected are written, and nothing is
    // written as an empty placeholder: an absent part must mean "not carried",
    // never "carried and empty" (the two differ at import — see the absent
    // semantics on `PortableSettings`).
    if (!omitted.has('matchSettings')) settings.matchSettings = sync.matchSettings;
    if (!omitted.has('switchDirection')) settings.switchDirection = sync.switchDirection;
    if (!omitted.has('autoBindGlobal')) settings.autoBindGlobal = sync.autoBindGlobal;

    const slotStrategies: Record<number, 'inherit' | MatchRuleSettings> = {};
    const slotAutoBinds: Record<number, boolean> = {};
    for (const slot of sync.slots) {
      const strategyId = slotStrategyPartId(slot.id);
      const autoBindId = slotAutoBindPartId(slot.id);
      if (!omitted.has(strategyId)) {
        slotStrategies[slot.id] = slot.strategy;
      }
      // A slot without an explicit override owns no `autoBind` part, so there is
      // nothing to omit and no key to write.
      if (slot.autoBindOverride !== undefined && !omitted.has(autoBindId)) {
        slotAutoBinds[slot.id] = slot.autoBindOverride;
      }
    }
    // Keep the part PRESENT when at least one slot contributed: an empty object
    // then legitimately means "no slot currently overrides anything", which is
    // not the same as "the user deselected every per-slot part".
    if (Object.keys(slotStrategies).length > 0) settings.slotStrategies = slotStrategies;
    if (Object.keys(slotAutoBinds).length > 0) settings.slotAutoBinds = slotAutoBinds;

    pkg.settings = settings;
  }

  if (scope.shortcuts && extras.shortcuts) {
    const omitted = new Set<string>(scope.excludedShortcutNames ?? []);
    const bindings = (list: PortableShortcutBinding[]): PortableShortcutBinding[] =>
      list.filter((b) => !omitted.has(b.name));

    const perSlot: Record<number, PortableShortcutBinding[]> = {};
    for (const [slotId, list] of Object.entries(extras.shortcuts.perSlot)) {
      const kept = bindings(list);
      if (kept.length > 0) perSlot[Number(slotId)] = kept;
    }
    pkg.shortcuts = { global: bindings(extras.shortcuts.global), perSlot };
  }

  return pkg;
}

function markerToPortable(marker: SlotUiMarker, iconKey?: string): PortableSlotMarker {
  return {
    customTitle: marker.customTitle,
    icon: marker.icon ? iconToPortable(marker.icon, iconKey) : undefined,
    backgroundColor: marker.backgroundColor,
  };
}

// ─── Package → SyncPatch ─────────────────────────────────────────────────────

/**
 * Rebuild a partial config from a package. Timestamps are NOT carried, so a
 * record that already exists on the target machine keeps its original
 * timestamps (identity preserved); a genuinely new record gets fresh ones.
 */
export function packageToSyncPatch(pkg: ExportPackage, current: SyncState): SyncPatch {
  const patch: SyncPatch = {};

  if (pkg.slots) {
    patch.slots = pkg.slots.map((portable) => {
      const existing = current.slots.find((s) => s.id === portable.id);
      // A slot record's own fields are `slots`-dimension data. The two
      // settings-shaped values it carries (`strategy`, `autoBindOverride`) belong
      // to the SETTINGS dimension and are therefore only read from `settings` —
      // never from the slot record itself (D3 + R4: settings is their one
      // home). An absent part means "not carried", so the existing value is kept
      // rather than defaulted: `strategy` falls back to the target's own value
      // (or `inherit` for a genuinely new slot), and an absent auto-bind key
      // leaves the target's override untouched.
      const strategy = pkg.settings?.slotStrategies?.[portable.id] ?? existing?.strategy ?? 'inherit';
      const autoBindOverride =
        pkg.settings?.slotAutoBinds !== undefined && portable.id in pkg.settings.slotAutoBinds
          ? pkg.settings.slotAutoBinds[portable.id]
          : existing?.autoBindOverride;
      const now = new Date().toISOString();
      return {
        id: portable.id,
        urlMatch: portable.urlMatch,
        strategy,
        autoBindOverride,
        uiMarker: markerFromPortable(portable.marker),
        titleSnapshot: portable.titleSnapshot,
        faviconSnapshot: portable.faviconSnapshot,
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing?.updatedAt ?? now,
      };
    });
  }

  if (pkg.rules) {
    patch.rules = pkg.rules.map((portable) => {
      const existing = current.rules.find((r) => r.id === portable.id);
      const now = new Date().toISOString();
      return {
        id: portable.id,
        urlMatch: portable.urlMatch,
        priority: portable.priority,
        title: portable.title,
        favicon: portable.favicon ? portableToIcon(portable.favicon) : undefined,
        enabled: portable.enabled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing?.updatedAt ?? now,
      };
    });
  }

  if (pkg.settings) {
    // Spread the carried parts THROUGH unchanged. Copying all four
    // unconditionally would turn an absent part into an `undefined` key that
    // `applyIntent` then reads as "apply nothing" — which happens to be right,
    // but only by accident. Copying only what exists makes the partial shape
    // explicit at the boundary where it is created.
    patch.settings = { ...pkg.settings };
    if (pkg.settings.slotStrategies) {
      patch.settings.slotStrategies = { ...pkg.settings.slotStrategies };
    }
    if (pkg.settings.slotAutoBinds) {
      patch.settings.slotAutoBinds = { ...pkg.settings.slotAutoBinds };
    }
  }

  if (pkg.shortcuts) {
    patch.shortcuts = pkg.shortcuts;
  }

  return patch;
}

function markerFromPortable(marker: PortableSlotMarker): SlotUiMarker {
  return {
    customTitle: marker.customTitle,
    icon: marker.icon ? portableToIcon(marker.icon) : undefined,
    backgroundColor: marker.backgroundColor,
  };
}

// ─── Shape guard ─────────────────────────────────────────────────────────────

/** A non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The structural gate as a predicate — SINGLE SOURCE OF TRUTH so a caller that
 * must order the passes differently (the import service checks `settings`
 * first, to collapse every invalid shape onto one explicit refusal) reuses it
 * instead of re-encoding the checks.
 *
 * Structural only (see `isExportPackage`): field ENUMS are NOT checked here.
 * Container TYPES are: an optional dimension, if present, must be an array /
 * plain object. Without that, a malformed container (`slots: 'x'`) reaches
 * `computeDiff` and THROWS — an unhandled exception at the worker boundary
 * (`INTERNAL_ERROR`) instead of a clean `IMPORT_INVALID` refusal.
 */
function isStructurallyAPackage(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.schemaVersion !== SCHEMA_VERSION) return false;
  if (!isPlainObject(value.generator)) return false;
  if (typeof value.exportedAt !== 'string') return false;
  if (!isPlainObject(value.scope)) return false;
  // An ABSENT dimension is legal (A2: "not carried"). A present one must be
  // the right container type.
  if (value.slots !== undefined && !Array.isArray(value.slots)) return false;
  if (value.rules !== undefined && !Array.isArray(value.rules)) return false;
  if (value.settings !== undefined && !isPlainObject(value.settings)) return false;
  if (value.shortcuts !== undefined && !isPlainObject(value.shortcuts)) return false;
  return true;
}

/**
 * Is this value shaped like a package AT ALL? Structural only — per-field
 * validation (both the record-level domain rules AND the settings family) is a
 * SEPARATE concern; see `isValidPortableSettings`.
 */
export function isExportPackage(value: unknown): value is ExportPackage {
  return isStructurallyAPackage(value);
}

/** The enum members of `MatchRuleSettings` ARE the contract (legacy-ported). */
function isValidMatchSettingsShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    (value.tabIdMode === 'exists' || value.tabIdMode === 'no-exists') &&
    (value.ruleCheckMode === 'match' || value.ruleCheckMode === 'no-match') &&
    (value.priority === 'tabId' || value.priority === 'rule-check' || value.priority === 'none')
  );
}

/**
 * A slot-id key must be the CANONICAL decimal literal for 1..10 — matching the
 * record-level D14 range. `"01"`, `"1.0"`, `"-1"`, `"0"`, `"11"` are all
 * rejected: a non-canonical key silently addresses no slot (`packageToSyncPatch`
 * indexes by `slot.id`), so accepting it would be a "chosen but never applied"
 * no-op — or, for `"-1"`/`"1.0"`, a `Number()` coercion that does NOT round-trip.
 */
function isCanonicalSlotKey(key: string): boolean {
  return /^(?:[1-9]|10)$/.test(key);
}

/**
 * Strict shape guard for the `settings` dimension — the successor to the legacy
 * `generatePreview` check that enforced Ruling 4 ("a legacy export file is NOT
 * importable"). An ABSENT `settings` is legal (the dimension was simply not
 * carried — A2/D6, and the UI says so via `import-absent-settings`).
 *
 * A PRESENT `settings` is now PARTIAL by design (R4/9): every part is
 * individually optional, and the rule is per part — PRESENT ⇒ validated by its
 * own rule below, ABSENT ⇒ not carried and never applied.
 *
 *   matchSettings   enum members
 *   switchDirection enum members
 *   autoBindGlobal  boolean          (legacy normalised it; the new path wrote it raw)
 *   slotStrategies  keys = canonical 1..10, values = 'inherit' | valid matchSettings
 *   slotAutoBinds   keys = canonical 1..10, values = boolean
 *
 * `slotStrategies` is the one settings field even the LEGACY guard never
 * covered: `applyIntent` walks it and writes each value onto `slot.strategy`
 * without checking, so an invalid value would be persisted and then silently
 * ignored by the literal-comparing resolver. `slotAutoBinds` gets the same
 * treatment for the same reason (it writes onto `slot.autoBindOverride`).
 *
 * Deliberately NOT folded into `isExportPackage`: `tolerant` reporting is
 * structural and must run on a structurally-sound package, so this is a
 * SEPARATE pass.
 *
 * An empty object (`{}`) is VALID: it means "the settings dimension was carried
 * but the user deselected every part". That is a real user choice, not a
 * malformed file, and it applies nothing — so it must not be refused.
 */
export function isValidPortableSettings(value: unknown): boolean {
  if (!isPlainObject(value)) return false;

  if (value.matchSettings !== undefined && !isValidMatchSettingsShape(value.matchSettings)) return false;
  if (
    value.switchDirection !== undefined &&
    !(value.switchDirection === 'next' || value.switchDirection === 'previous')
  ) {
    return false;
  }
  if (value.autoBindGlobal !== undefined && typeof value.autoBindGlobal !== 'boolean') return false;

  if (value.slotStrategies !== undefined) {
    if (!isPlainObject(value.slotStrategies)) return false;
    for (const [key, strategy] of Object.entries(value.slotStrategies)) {
      if (!isCanonicalSlotKey(key)) return false;
      if (strategy === 'inherit') continue;
      if (!isValidMatchSettingsShape(strategy)) return false;
    }
  }

  if (value.slotAutoBinds !== undefined) {
    if (!isPlainObject(value.slotAutoBinds)) return false;
    for (const [key, override] of Object.entries(value.slotAutoBinds)) {
      if (!isCanonicalSlotKey(key)) return false;
      if (typeof override !== 'boolean') return false;
    }
  }

  return true;
}