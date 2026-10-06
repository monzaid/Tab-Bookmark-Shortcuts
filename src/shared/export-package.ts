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
 * C8: the DECLARED field names of the package shapes above.
 *
 * This table exists so the "unknown extra field" tolerant reader has ONE source
 * of truth. It is deliberately in this file, ADJACENT to the interfaces it
 * mirrors — TypeScript erases types at runtime, so a runtime allowlist cannot be
 * derived from them; keeping it here is the closest thing to a single owner.
 *
 * ⚠️ CHANGE A SHAPE ABOVE ⇒ CHANGE THIS TABLE. A drift makes the tolerant
 * reader either mis-report a known field or silently accept a renamed one.
 */
export const PACKAGE_FIELD_ALLOWLIST = {
  root: ['schemaVersion', 'generator', 'exportedAt', 'scope', 'slots', 'rules', 'settings', 'shortcuts'],
  slot: ['id', 'urlMatch', 'autoBindOverride', 'marker', 'titleSnapshot', 'faviconSnapshot'],
  rule: ['id', 'urlMatch', 'priority', 'title', 'favicon', 'enabled'],
  icon: ['kind', 'url', 'ref', 'bgColor', 'text', 'textColor'],
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