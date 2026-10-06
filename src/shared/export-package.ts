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
  autoBindOverride?: boolean;
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

/** Global settings + the per-slot strategies that were stripped from `slots[]`. */
export interface PortableSettings {
  matchSettings: MatchRuleSettings;
  switchDirection: SwitchDirection;
  autoBindGlobal: boolean;
  slotStrategies: Record<number, 'inherit' | MatchRuleSettings>;
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
  id: true, urlMatch: true, autoBindOverride: true, marker: true,
  titleSnapshot: true, faviconSnapshot: true,
} as const satisfies Record<keyof PortableSlotDef, true>;

const RULE_KEYS = {
  id: true, urlMatch: true, priority: true, title: true, favicon: true, enabled: true,
} as const satisfies Record<keyof PortableRule, true>;

export const PACKAGE_FIELD_ALLOWLIST = {
  root: Object.keys(ROOT_KEYS),
  slot: Object.keys(SLOT_KEYS),
  rule: Object.keys(RULE_KEYS),
} as const;

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
        autoBindOverride: slot.autoBindOverride,
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
    const slotStrategies: Record<number, 'inherit' | MatchRuleSettings> = {};
    for (const slot of sync.slots) {
      slotStrategies[slot.id] = slot.strategy;
    }
    pkg.settings = {
      matchSettings: sync.matchSettings,
      switchDirection: sync.switchDirection,
      autoBindGlobal: sync.autoBindGlobal,
      slotStrategies,
    };
  }

  if (scope.shortcuts && extras.shortcuts) {
    pkg.shortcuts = extras.shortcuts;
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
      const strategy = pkg.settings?.slotStrategies[portable.id] ?? existing?.strategy ?? 'inherit';
      const now = new Date().toISOString();
      return {
        id: portable.id,
        urlMatch: portable.urlMatch,
        strategy,
        autoBindOverride: portable.autoBindOverride,
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
    patch.settings = {
      matchSettings: pkg.settings.matchSettings,
      switchDirection: pkg.settings.switchDirection,
      autoBindGlobal: pkg.settings.autoBindGlobal,
      slotStrategies: { ...pkg.settings.slotStrategies },
    };
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

/**
 * Is this value shaped like a package AT ALL? Structural only — the D14
 * validator (T3) is a separate concern.
 */
export function isExportPackage(value: unknown): value is ExportPackage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== SCHEMA_VERSION) return false;
  if (!v.generator || typeof v.generator !== 'object') return false;
  if (typeof v.exportedAt !== 'string') return false;
  if (!v.scope || typeof v.scope !== 'object') return false;
  return true;
}

/**
 * Strict shape guard for the `settings` dimension — the successor to the legacy
 * `generatePreview` check that enforced Ruling 4 ("a legacy export file is NOT
 * importable"). An absent `settings` is legal (the dimension was simply not
 * carried); a PRESENT one must be well-formed.
 *
 * Deliberately NOT folded into `isExportPackage`: `tolerant` reporting is
 * structural and must run on a structurally-sound package, so this is a
 * SEPARATE pass applied after the structural gate. `settings` is an
 * all-or-nothing global axis — there is no "half a matchSettings".
 *
 * The whole `PortableSettings` family is covered, not just `matchSettings`:
 * `applyIntent` assigns `switchDirection` under a bare TS assertion, so an
 * out-of-enum value would otherwise be trusted and written (`resolve-switch`
 * compares literals and would silently fall through).
 */
export function isValidPortableSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;

  const ms = v.matchSettings as Record<string, unknown> | undefined;
  if (!ms || typeof ms !== 'object') return false;
  // Ported verbatim from the legacy guard: the enum members ARE the contract.
  if (!(ms.tabIdMode === 'exists' || ms.tabIdMode === 'no-exists')) return false;
  if (!(ms.ruleCheckMode === 'match' || ms.ruleCheckMode === 'no-match')) return false;
  if (!(ms.priority === 'tabId' || ms.priority === 'rule-check' || ms.priority === 'none')) return false;

  if (!(v.switchDirection === 'next' || v.switchDirection === 'previous')) return false;

  return true;
}