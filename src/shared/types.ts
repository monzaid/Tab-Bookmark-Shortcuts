/**
 * Domain models for Tab Bookmark Shortcuts extension.
 * Covers: slots, strategies, rules, icons, overrides, recovery, diagnostics, import.
 */

// Type-only import (erased at runtime — no module cycle with `field-chain.ts`,
// which imports these same models back from here).
import type { ChainResult, TierOwner } from './field-chain';

// ─── Matching Strategy (tri-knob model) ──────────────────────────────────────
//
// The legacy single-letter strategy type and its default constant were removed
// entirely (D17) — no dead type, no dead constant. The old A/B/C → four-cell
// correspondence lives ONLY in the design doc §3.1 markdown table; it does not
// exist in code or types.

/** Does the slot require its bound tab to exist? */
export type TabIdMode = 'exists' | 'no-exists';
/** Does the slot require a URL/regex match? */
export type RuleCheckMode = 'match' | 'no-match';
/** Combination 1 only: which source wins when both are available. */
export type Priority = 'tabId' | 'rule-check' | 'none';

export interface MatchRuleSettings {
  tabIdMode: TabIdMode;
  ruleCheckMode: RuleCheckMode;
  priority: Priority;
}

/** Global switch direction for single-command entries (design §3.3). */
export type SwitchDirection = 'previous' | 'next';

/**
 * New default settings = combination 1 + `priority = tabId` (design D9).
 * Replaces the removed legacy strategy default.
 */
export const DEFAULT_MATCH_SETTINGS: MatchRuleSettings = {
  tabIdMode: 'exists',
  ruleCheckMode: 'match',
  priority: 'tabId',
};

// ─── URL Matching ────────────────────────────────────────────────────────────

export type UrlMatchType = 'exact' | 'regex';

export interface UrlMatchDefinition {
  type: UrlMatchType;
  /** For exact: normalized URL. For regex: pattern string (max 500 chars) */
  value: string;
}

// ─── Icon Source ─────────────────────────────────────────────────────────────

export type IconSourceType = 'url' | 'upload' | 'template';

export interface IconSource {
  type: IconSourceType;
  /** For url: the source URL. For upload/template: identifier */
  value: string;
  /** Template only: background color hex */
  backgroundColor?: string;
  /** Template only: display text */
  text?: string;
  /**
   * Template only: display text colour hex.
   *
   * T2/C1: a recipe (background + text + text colour) is the durable truth for
   * a `type: 'template'` icon. Without this field a round-trip would silently
   * fall back to `autoTextColor` and change the icon's appearance.
   */
  textColor?: string;
}

// ─── UI Marker (slot display customization) ──────────────────────────────────

export interface SlotUiMarker {
  /** `null` = explicitly cleared (DT11: writes unify on null, never `''`). */
  customTitle?: string | null;
  /** `null` = explicitly cleared (DT11 unified write shape). */
  icon?: IconSource | null;
  backgroundColor?: string;
}

// ─── Slot Definition (sync) ──────────────────────────────────────────────────

export interface SlotDefinition {
  id: number; // 1-10
  urlMatch: UrlMatchDefinition;
  strategy: 'inherit' | MatchRuleSettings; // 'inherit' uses global default
  /** undefined = inherit `autoBindGlobal` (D14). */
  autoBindOverride?: boolean;
  uiMarker: SlotUiMarker;
  /** Title snapshot at save time */
  titleSnapshot: string;
  /** Favicon URL snapshot at save time */
  faviconSnapshot: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ─── Slot Binding (local) ────────────────────────────────────────────────────

export interface SlotBinding {
  slotId: number;
  tabId: number;
  windowId: number;
  boundAt: string; // ISO 8601
}

// ─── Tag (sync) ──────────────────────────────────────────────────────────────

/**
 * A tag — a purely ORGANISATIONAL dimension of a rule (C1/S1).
 *
 * Field ORDER mirrors `IconSource`'s recipe trio (`backgroundColor` / `text` /
 * `textColor`), so a tag's appearance can be rendered by the same primitives
 * instead of a second colour model. Reusing that shape is why a tag has no
 * "style" concept of its own.
 *
 * `backgroundColor` / `textColor` are APPEARANCE, never identity: two tags
 * whose names differ only by surrounding whitespace are duplicates regardless
 * of colour, and recolouring a tag never changes which rules reference it
 * (C2 — identity is `normalizeTagName(name)`, byte-for-byte).
 *
 * Tags are NOT part of the rule execution chain: they never influence match,
 * priority, enabled state or delivery. That invariant is structural — see
 * `TagService`, which holds no delivery entry point (A-a/I1).
 */
export interface TagDefinition {
  id: string;
  name: string;
  backgroundColor: string;
  textColor: string;
}

// ─── Page Rewrite Rule (sync) ────────────────────────────────────────────────

export interface PageRule {
  id: string;
  urlMatch: UrlMatchDefinition;
  /** -100 to 100, default 0. Higher wins. */
  priority: number;
  title?: string;
  favicon?: IconSource;
  /** Whether this rule is active. Defaults to true if undefined. */
  enabled?: boolean;
  /**
   * Ids into `SyncState.tags` (C1/A6).
   *
   * REQUIRED, not optional (P1): an optional field would let a dangling
   * reference be constructed in the type layer, and "a stored id always has a
   * live definition" (I2) is exactly what the required-ness buys. The cost is
   * that every existing `PageRule` literal must be migrated — that cost is
   * paid once, and the compiler enumerates it.
   */
  tagIds: string[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ─── Tab Temporary Override (local) ─────────────────────────────────────────

export interface TabOverride {
  tabId: number;
  title?: string;
  favicon?: IconSource;
  createdAt: string; // ISO 8601
}

// ─── Data Dashboard Row (A10) ────────────────────────────────────────────────

/**
 * A single row in the settings Data Dashboard.
 *
 * `kind` mirrors the three managed sets: an explicit tab override, a slot whose
 * title/icon was explicitly set, and a page whose value comes from a rule hit.
 *
 * `chain` carries the FULL A1 `ChainResult` for both fields (computed once in the
 * background, so the UI never assembles a second copy of the chain), and
 * `delivery` reports whether the background could actually apply the value.
 */
export interface DashboardRow {
  id: string;
  kind: 'override' | 'slot' | 'rule-hit';
  label: string;
  url: string | null;
  /** Jump-to-row address (null when there is nothing to jump to). */
  anchor: TierOwner | null;
  tabId?: number;
  slotId?: number;
  ruleId?: string;
  chain: { title: ChainResult; favicon: ChainResult };
  delivery: 'ok' | 'degraded' | 'protected' | 'unknown';
}

// ─── Recovery Session (local) ────────────────────────────────────────────────

export interface RecoverySession {
  recoveryId: string;
  slotId: number;
  urlMatch: UrlMatchDefinition;
  titleSnapshot: string;
  faviconSnapshot: string;
  createdAt: string; // ISO 8601
  /** TTL: 5 minutes from createdAt */
  expiresAt: string; // ISO 8601
  /**
   * Window id of the recovery window (design A11/DT1). Backfilled by the worker
   * when the window is created so create-or-focus can reuse one window per slot.
   */
  windowId: number;
  /**
   * Prev/Next cursor anchored to a tabId (DT2). `null` = not yet positioned, in
   * which case the first browse anchors on the active tab's neighbour. Browsing
   * does NOT consume the session (DT1/DT5).
   */
  candidateCursor: number | null;
}

// ─── Recovery Snapshot (local) ───────────────────────────────────────────────

export interface RecoverySnapshot {
  slotId: number;
  url: string;
  title: string;
  favicon: string;
  recoveredAt: string; // ISO 8601
}

// ─── Cycle Cursor (local) ────────────────────────────────────────────────────

export interface CycleCursor {
  slotId: number;
  /** Index into last known candidate list */
  currentIndex: number;
  /** Candidate tab IDs from last query (for reference) */
  candidateTabIds: number[];
  updatedAt: string; // ISO 8601
}

// ─── Diagnostics (local) ─────────────────────────────────────────────────────

export interface DiagnosticEntry {
  timestamp: string; // ISO 8601
  errorCode: DomainErrorCode | 'SUCCESS';
  browserType: 'chrome' | 'edge' | 'firefox';
  operationType: string;
}

// ─── Import/Export (sync config only) ────────────────────────────────────────

// (T14b/T21: the legacy export-payload / slot-decision / slot-conflict /
// import-preview types were deleted — the redesigned protocol carries
// `ExportPackage` / `ImportInspection` / `ImportApplyResult`.)

// ─── Import / Export — Iteration types (T2) ──────────────────────────────────
//
// The five dimensions are FIXED (D5/D0): slots / rules / settings / shortcuts /
// tags. `tags` is the fifth dimension and is NOT a record dimension — the tag
// table is a vocabulary carried as a whole, not a list of records with ids
// (see `ImportPartDiff` for the "part" rows it produces).

export interface ExportScope {
  /** Dimension flags — `true` when the user selected that dimension (D1). */
  slots?: boolean;
  rules?: boolean;
  settings?: boolean;
  shortcuts?: boolean;
  /**
   * The tag vocabulary (D0/S5).
   *
   * Semantics of absence follow `PortableSettings` (R24): an ABSENT flag means
   * the dimension is NOT carried, which is distinct from "carried and empty" —
   * a package with `tags: []` says "share the vocabulary, and it is empty".
   */
  tags?: boolean;
  /**
   * A-f/D-e-②: "Leave them out" — carry each rule's tag names AS THEY ARE, even
   * where the package defines no such tag.
   *
   * The OTHER way out of the same dialog needs no flag. "Include them" is
   * expressed by re-running the export with those names un-excluded, so by the
   * time the package is built every referenced name IS defined and the projection
   * below is a no-op. This flag is the one that cannot be expressed that way,
   * because it asks for the opposite of self-consistency.
   *
   * ABSENT (every ordinary export) carries a rule's names AS THEY ARE, even a name
   * whose tag this package omits — because that state is exactly what
   * `computeExportSelfConsistency` detects and the D-e dialog asks the user about.
   * Stripping during the projection would remove the difference before anyone could
   * be asked, which is the silent resolution the design forbids.
   *
   * The rule is always carried; only the unresolvable REFERENCE can be dropped, so
   * "leave them out" costs a rule a label and never costs the user the rule.
   */
  stripOrphanTagNames?: boolean;
  /** Per-record deselection within a selected dimension (D1 "展开到记录级"). */
  excludedSlotIds?: number[];
  excludedRuleIds?: string[];
  /**
   * Per-tag deselection inside the tags dimension (A5).
   *
   * Keyed by NAME, not id: a package's tag identity IS its name (A4 — the
   * package carries no tag ids). Only ever REMOVES, mirroring
   * `excludedSlotIds` (R24).
   */
  excludedTagNames?: string[];
  /**
   * Fine-grained deselection INSIDE the settings dimension (R4).
   *
   * Settings is not one indivisible value: it is three global parts plus a
   * per-slot part for each slot. Sharing "how switching works" without also
   * shipping twenty per-slot overrides is a real need, so the selection is
   * expressed at that granularity.
   *
   * Ids are the ones `settingsRecordId` produces (`'matchSettings'`,
   * `'slot:3:strategy'`, …). `undefined` = carry every part; an entry only ever
   * REMOVES, mirroring `excludedSlotIds`.
   */
  excludedSettingIds?: string[];
  /**
   * Fine-grained deselection inside the shortcuts dimension (R10).
   *
   * Keyed by command NAME (`'save-slot-3'`), because that is the identity a
   * shortcut actually has — not a slot number, since `next-match` belongs to no
   * slot. `undefined` = carry every binding.
   */
  excludedShortcutNames?: string[];
}

/** How a dimension's records combine with the target machine (A1). */
export type DimensionMode = 'incremental' | 'overwrite';

/**
 * R9/R10: one settings-part or shortcut row's outcome in the diff.
 *
 * Settings parts and shortcut bindings are NOT records (they have no id in a
 * list), so they cannot be `ImportRecordDiff`s. They are still choices the user
 * makes one at a time, though, so the diff reports them with the same vocabulary
 * the record rows use — `status` is the shared `ImportRecordStatus`, which is
 * what lets one badge component serve both kinds of row.
 */
export interface ImportPartDiff {
  /** `SettingPartId` for settings, the command name for shortcuts. */
  id: string;
  /** Human label for the row (e.g. "Match settings", "Save to slot 3"). */
  label: string;
  /** Which side of the settings part this row belongs to (drives grouping). */
  group: 'global' | 'slot' | 'global-shortcut' | 'slot-shortcut' | 'tag';
  /** Identifies the slot a per-slot row addresses (undefined for global rows). */
  slotId?: number;
  status: ImportRecordStatus;
  before: ImportFieldValue | null;
  after: ImportFieldValue | null;
  changed: boolean;
  /**
   * The row's per-facet detail, rendered by the SAME `RecordFields` the record
   * rows use — label / value / state, with the `→` written once.
   *
   * A tag's difference is not one fact: the name, the background and the text
   * colour each answer a different question, and only the third of them is visible
   * anywhere else. Optional so a diff assembled before this field still parses.
   */
  fields?: ImportFieldDiff[];
}

/** A sparse per-record override of the dimension mode (A4). `keep`=leave target. */
export interface ImportRecordOverride {
  kind: 'slot' | 'rule';
  id: number | string;
  action: 'keep' | 'take';
}

export interface ImportIntent {
  dimensionModes: {
    slots: DimensionMode;
    rules: DimensionMode;
    settings: DimensionMode;
    shortcuts: DimensionMode;
    /**
     * The tag vocabulary (D0/S5).
     *
     * `overwrite` would delete target-side tags the file does not carry, so A8
     * lets the user re-decide it as `incremental` — expressed as rewriting THIS
     * field, not as a second code path (`tagOverwriteResolution`, below).
     */
    tags: DimensionMode;
  };
  /** Seeded at file-open for every non-`added` row, then edited per row (A4). */
  recordOverrides?: ImportRecordOverride[];
  /**
   * R9: the settings PARTS the user chose to take, by `SettingPartId`.
   *
   * `undefined` = take every part the file carries (the A1 default — the same
   * "accept everything" starting point the record checkboxes use). A defined
   * array is an ALLOW-list, so unticking one part leaves the others alone
   * instead of silently turning "I did not touch it" into "do not take it".
   */
  takeSettingIds?: string[];
  /**
   * R10: the shortcut BINDINGS to take, by command name (`'save-slot-3'`).
   *
   * Same allow-list semantics as `takeSettingIds`: `undefined` = take all.
   * Keyed by command name rather than slot because `next-match` is a global
   * shortcut that belongs to no slot.
   */
  takeShortcutNames?: string[];
  /**
   * The tags to take, by NAME (a package identifies a tag by name — A4).
   *
   * Same allow-list semantics as the other two: `undefined` = take every tag the
   * file carries. A name that is declined is simply not created from the
   * VOCABULARY — but a name a TAKEN RULE references is still created, because a
   * rule cannot be honoured with a reference to a tag that does not exist (C7).
   * That is a deliberate asymmetry: declining a tag means "do not add this label",
   * never "break the records that use it".
   */
  takeTagNames?: string[];
  /**
   * A-f/D-e on the IMPORT side: "Leave them out" — carry no tag references from
   * this file.
   *
   * Deliberately the SAME name as the export-side scope flag, because it is the
   * same decision: do not carry a tag reference that cannot resolve. The
   * alternative ("Include them") needs no flag — it is the default, where a
   * referenced name is created like any other.
   *
   * Scoped at the RULE, not at the orphan names: the question the user answered was
   * whether to include the file's tags, so choosing "leave them out" means the
   * rules land without their tag references — not merely without the unresolvable
   * ones. Bullet-scoping it left the reported symptom intact (the rule still showed
   * a tag), which reads as the answer having been ignored.
   *
   * Consequence, disclosed in the dialog before it is taken: rules keep everything
   * else, and the file's tags are not attached to them.
   */
  stripOrphanTagNames?: boolean;
  /**
   * A8: how the tags dimension's `overwrite` deletion is resolved.
   *
   * `overwrite` on tags is the only mode whose default deletes DATA the file
   * does not carry (target-side tags, plus every rule reference to them). A8
   * requires the user be able to re-decide it: `'to-incremental'` is defined as
   * EQUIVALENT to rewriting `dimensionModes.tags` to `'incremental'` — one
   * reasoning chain, not a parallel implementation.
   *
   * Absent/`'cascade'` = take the `overwrite` semantics as chosen.
   */
  tagOverwriteResolution?: 'cascade' | 'to-incremental';
}

/** Default import intent: incremental + no overrides (A1 — the safer default). */
export function defaultImportIntent(): ImportIntent {
  return {
    dimensionModes: {
      slots: 'incremental',
      rules: 'incremental',
      settings: 'incremental',
      shortcuts: 'incremental',
      tags: 'incremental',
    },
  };
}

/**
 * A field value in a RENDERABLE form — never an internal comparison string, so
 * the diff's internal representation cannot leak into a consumer (A14/D9).
 * `null` (on `ImportFieldDiff`) means "this side has no value", which is
 * distinct from a value that happens to be empty.
 */
export type ImportFieldValue =
  | { kind: 'text'; value: string }
  | { kind: 'url'; value: string }
  | { kind: 'local-ref'; key: string }
  | { kind: 'recipe'; bgColor: string; text: string; textColor: string }
  /**
   * A colour, carried as its own kind rather than as `text`.
   *
   * A tag's appearance is two colours (background and text), and they are the
   * substance of what a tag IS — printing `#3366cc` as prose makes the reader
   * decode a hex string to answer "does this differ", while the row can show the
   * colour it means. Same reasoning as the `icon` facet's preview: the one thing
   * that is visual gets rendered, beside the text rather than instead of it.
   */
  | { kind: 'color'; value: string }
  /**
   * A rule's tags, as renderable chips.
   *
   * A FIELD rather than a side-channel on the row, because that is what it is: a
   * rule's tags are one of the things an import changes about it, and the review
   * panel already has a place for "which fields does this record carry, and what
   * does each become" — the Fields detail. Showing them outside it made the tags
   * the one attribute that escaped the panel's own vocabulary (and the one the
   * user had to look elsewhere for).
   *
   * The chips carry the appearance the import will actually produce, so the row
   * can render them the way the tag list does rather than as a comma-joined
   * string — see `ImportTagPreview`.
   */
  | { kind: 'tags'; tags: ImportTagPreview[] };

/** Per-field change detail inside a record (A12). */
/**
 * The facets a record can differ on. `match-url` / `match-type` carry the match
 * definition (the URL and the mode name) as plain `text` values, so a row can
 * say WHICH part of a record differs and what the two sides hold — a record
 * whose URL match moved is otherwise indistinguishable from an unchanged one.
 */
export interface ImportFieldDiff {
  /**
   * The facet that differs.
   *
   * The `tag-*` members exist because a tag's DIFFERENCE is not just its name:
   * its background and text colours are what the user is being asked to accept,
   * and a row that reported only "tag added" left the colours unstated — so an
   * incoming tag silently overwriting the look of one already on the machine was
   * invisible.
   */
  field: 'title' | 'icon' | 'match-url' | 'match-type' | 'priority'
    | 'tags'
    | 'tag-name' | 'tag-background' | 'tag-text';
  before: ImportFieldValue | null;
  after: ImportFieldValue | null;
  changed: boolean;
}

/** One record's outcome in the diff (A12). */
export type ImportRecordStatus = 'added' | 'replaced' | 'kept' | 'deleted' | 'skipped';

/**
 * The target machine's values for one record, ready to render.
 *
 * A flat, row-shaped view of what `import-diff.ts` already computes for the
 * field detail — promoted so a list can show the machine's own title, icon,
 * match definition and priority without re-deriving them (which would be a
 * second implementation of the comparison the diff owns).
 */
export interface ImportRecordBefore {
  title: ImportFieldValue | null;
  icon: ImportFieldValue | null;
  urlMatch: ImportFieldValue | null;
  matchType: ImportFieldValue | null;
  /** Rules only; `undefined` for slots. */
  priority?: number;
}

/**
 * A tag as it will look, resolved for PREVIEW.
 *
 * The same minimal shape on both sides of a record row, because the question the
 * row answers is "which tags does this carry, and what do they look like" — not
 * "which tag table did each side come from".
 */
export interface ImportTagPreview {
  name: string;
  backgroundColor: string;
  textColor: string;
}

export interface ImportRecordDiff {
  kind: 'slot' | 'rule';
  id: number | string;
  label: string;
  status: ImportRecordStatus;
  fields: ImportFieldDiff[];
  /**
   * R3/7: the rule priority the list renders inline.
   *
   * Priority is NOT one of the four change facets (A12's fields are title /
   * icon / match-url / match-type — a facet answers "did this change", and a
   * list column answers "what is it"). It is carried here as row-level DISPLAY
   * data instead of being re-derived in the UI from the package, so the list and
   * the diff can never disagree about which record a number belongs to.
   *
   * Optional: slots have no priority, and a diff assembled before this iteration
   * simply omits it.
   */
  priority?: number;
  /**
   * The TARGET MACHINE's own fields for this record, in renderable form.
   *
   * A row must describe the machine as it is — its own title, icon, match
   * definition and (for a rule) priority — because a `kept` row shows those and
   * the field detail reads `<target> → <imported>`. Before this the list borrowed
   * the FILE's values, so a record the machine already had could be described
   * with a title, URL or type that only ever existed in the package.
   *
   * `null` for an `added` record: the machine genuinely has no such record, which
   * is a different fact from "the machine has one with empty values".
   */
  before?: ImportRecordBefore | null;
  /**
   * R2/3/6/7: the icon this ROW displays, in renderable form.
   *
   * The same value also appears in `fields` as the `icon` facet, but a list row
   * needs "the icon that will be there" without walking the facet array and
   * deciding which side applies. `null` = the record ends up with no icon.
   *
   * Optional for the same compatibility reason as `priority`.
   */
  icon?: ImportFieldValue | null;
}

/** Which dimensions the package actually carried (A2/A3 three-state). */
export interface DimensionPresence {
  slots: boolean;
  rules: boolean;
  settings: boolean;
  shortcuts: boolean;
  /**
   * Whether the package carried the tag vocabulary (D0).
   *
   * REQUIRED for the same reason as the other four (R7): every shape that
   * enumerates the dimensions must be updated in one go, and a missing key here
   * would silently leave "4 dimensions, 5 cards".
   */
  tags: boolean;
}

/** Record-level + field-level diff over the package against current state (A12). */
export interface ImportDiff {
  records: ImportRecordDiff[];
  dimensions: DimensionPresence;
  /**
   * R9: the settings parts the file carries, one row each, with the SAME
   * status vocabulary the record rows use.
   *
   * Optional for backwards compatibility with a diff assembled before this
   * iteration (and for the `settings`-absent case, where there is nothing to
   * report). An empty array is meaningful: the dimension was carried but holds
   * no parts.
   */
  settingsParts?: ImportPartDiff[];
  /** R10: the shortcut bindings the file carries, one row each. */
  shortcutParts?: ImportPartDiff[];
  /**
   * The tag vocabulary, one row per tag the file carries (D0).
   *
   * Optional for the same "absent dimension reports nothing" reason as the
   * other part lists. A tag is identified by NAME here, because a package
   * carries no tag ids (A4).
   *
   * Present under `overwrite` too, where a row whose status is `deleted` is the
   * §7-item-5 DISCLOSURE: the deletion must be visible before it is committed
   * (A8 — the user may re-decide it as `incremental`, which is the same decision
   * expressed as a mode change).
   */
  tagNames?: ImportPartDiff[];
}

/** A forgiving-but-disclosed item (unknown field ignored, default filled). */
export interface TolerantItem {
  kind: string;
  detail: string;
}

/** A record skipped because it violates a domain constraint (D15). */
export interface DomainViolation {
  kind: 'slot' | 'rule';
  id: number | string;
  reason: string;
}

/** A match overlap: two records share the exact same Match URL + Match Type (D10). */
export interface MatchOverlap {
  urlMatch: UrlMatchDefinition;
  recordIds: Array<number | string>;
}

/** Read-only inspection result (D6/§6.2): what the package would do. */
export interface ImportInspection {
  diff: ImportDiff;
  dimensions: DimensionPresence;
  tolerant: TolerantItem[];
  domainViolations: DomainViolation[];
  overlaps: MatchOverlap[];
  /** configVersion read at INSPECT time — APPLY must bind to this (C3/F4). */
  configVersion: number;
}

/**
 * R6: how ONE dimension fared in an apply.
 *
 * `changed` counts the parts of that dimension the import actually took (the
 * same "not kept" rule the diff rows are drawn from, so the number and the rows
 * cannot disagree). `failed` counts the ones it could not complete: a record the
 * domain rules rejected, or a shortcut binding the platform refused to set.
 * A dimension whose import left everything alone reports `changed: 0`.
 */
export interface ImportDimensionOutcome {
  changed: number;
  failed: number;
}

/** Per-dimension outcome, keyed by the same five dimensions as `DimensionPresence`. */
export interface ImportDimensionOutcomes {
  slots: ImportDimensionOutcome;
  rules: ImportDimensionOutcome;
  settings: ImportDimensionOutcome;
  shortcuts: ImportDimensionOutcome;
  /**
   * The tag vocabulary's outcome (G-H).
   *
   * `changed` = the tag entities this import actually WROTE (created, plus the
   * reused ones it had to update); `failed` = the ones rejected by a limit or a
   * duplicate. It is NOT "how many tags the file listed" — the number has to
   * describe the write, so it can be checked against the diff rows.
   */
  tags: ImportDimensionOutcome;
}

/** Applied-result checklist (§4.3). */
export interface ImportApplyResult {
  success: boolean;
  configVersion: number;
  counts: { added: number; replaced: number; kept: number; deleted: number; skipped: number };
  /**
   * R5/R6: the per-dimension outcome, produced by APPLY itself.
   *
   * Derived server-side rather than re-counted in the UI: the report must
   * describe what the WRITE did (including the shortcut bindings, which the UI
   * cannot observe), and a second count in the renderer would drift from it.
   */
  dimensions: ImportDimensionOutcomes;
  tolerant: TolerantItem[];
  domainViolations: DomainViolation[];
  missingIcons: Array<{ kind: 'slot' | 'rule'; id: number | string }>;
  overlaps: MatchOverlap[];
  /** Chrome/Edge: manual-set guidance for the shortcut dimension (D4). */
  shortcutGuidance?: string;
  /**
   * A10/S6: how many tags this import had to CREATE because the file named a
   * tag that neither the file's vocabulary home nor the target machine knew.
   *
   * Such tags get the DEFAULT appearance, because the import side has no colour
   * source for a name the file itself did not define — a registered asymmetry
   * (§6), not an oversight. The COUNT is reported so the user is told rather
   * than left to notice the new tags later.
   */
  tagsCreatedWithDefaultAppearance?: number;
}

export interface ExportPackageSummary {
  slots: number;
  rules: number;
  settings: number;
  shortcuts: number;
}

// ─── Sync Root State ─────────────────────────────────────────────────────────

export interface SyncState {
  configVersion: number;
  /** Global tri-knob settings (directly replaces the removed legacy strategy field). */
  matchSettings: MatchRuleSettings;
  /** Global direction for single-command entries (design §3.3). */
  switchDirection: SwitchDirection;
  /** Global auto-bind default; slots may override (D14). */
  autoBindGlobal: boolean;
  slots: SlotDefinition[];
  rules: PageRule[];
  /**
   * The GLOBAL tag table (C1): one list for the whole install, referenced by
   * `PageRule.tagIds`.
   *
   * Rules store ids rather than copies so that renaming a tag is a one-cell
   * write and every reference follows automatically (C1's stated benefit).
   * There is NO cap on the number of tags (C3) — the cap is per RULE (≤8).
   */
  tags: TagDefinition[];
}

// ─── Site Snapshot (local, strictly sealed — A7/C6) ──────────────────────────

/**
 * The ORIGINAL page value captured before the first rewrite, so the `restore`
 * directive can put it back (Q19/Q20/Q28).
 *
 * Strictly sealed to `local`: it never enters `sync`, export, import or
 * diagnostics. Only `{ title, faviconHref }` is stored — never the URL or any
 * page content.
 */
export interface SiteSnapshotEntry {
  tabId: number;
  title: string | null;
  faviconHref: string | null;
  capturedAt: string; // ISO 8601
}

// ─── Local Root State ────────────────────────────────────────────────────────

export interface LocalState {
  bindings: SlotBinding[];
  cycleCursors: CycleCursor[];
  lastSuccessSlotId: number | null;
  recoverySessions: RecoverySession[];
  recoverySnapshots: RecoverySnapshot[];
  tabOverrides: TabOverride[];
  iconCache: Record<string, string>; // url -> data URI
  diagnostics: DiagnosticEntry[];
  /** Optional for backwards compatibility with pre-A7 local data. */
  siteSnapshot?: SiteSnapshotEntry[];
}

// ─── Domain Error Codes ──────────────────────────────────────────────────────

export type DomainErrorCode =
  // Request validation
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ACTION'
  // Config conflicts
  | 'CONFIG_CONFLICT'
  | 'STALE_VERSION'
  // Slot operations
  | 'SLOT_NOT_FOUND'
  | 'SLOT_EMPTY'
  | 'SLOT_ALREADY_BOUND'
  // Matching
  | 'NO_MATCH'
  | 'NO_CANDIDATES'
  // Recovery
  | 'RECOVERY_EXPIRED'
  | 'RECOVERY_NOT_FOUND'
  // Rules
  | 'RULE_CONFLICT_BLOCK'
  | 'RULE_CONFLICT_WARN'
  | 'DUPLICATE_RULE'
  | 'VERSION_CONFLICT'
  | 'RULE_INVALID_REGEX'
  | 'RULE_REGEX_TOO_LONG'
  | 'RULE_PROTECTED_URL'
  | 'RULE_NOT_FOUND'
  // Tags
  | 'TAG_NAME_DUPLICATE'
  | 'TAG_NAME_TOO_LONG'
  | 'TAG_NOT_FOUND'
  | 'TAG_LIMIT_EXCEEDED'
  | 'RULE_TAG_LIMIT_EXCEEDED'
  // The colour reaches the renderer as an inline CSS value, so a malformed one is
  // rejected at the write rather than stored (see `isTagColorValid`).
  | 'TAG_COLOR_INVALID'
  // Icons
  | 'ICON_TOO_LARGE'
  | 'ICON_INVALID_FORMAT'
  | 'ICON_DOWNLOAD_FAILED'
  // Import/Export
  | 'IMPORT_INVALID'
  | 'IMPORT_VERSION_MISMATCH'
  | 'IMPORT_CANCELLED'
  // Permissions
  | 'INCOGNITO_NOT_AUTHORIZED'
  | 'PROTECTED_PAGE'
  // Adapter/Browser
  | 'BROWSER_API_ERROR'
  | 'TAB_NOT_FOUND'
  | 'WINDOW_NOT_FOUND'
  | 'COMMAND_NOT_FOUND'
  // General
  | 'INTERNAL_ERROR'
  | 'TIMEOUT';

// ─── Candidate (for matching results) ────────────────────────────────────────

export interface TabCandidate {
  tabId: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl: string;
  isCurrentWindow: boolean;
  isIncognito: boolean;
}

// ─── Switch Result ───────────────────────────────────────────────────────────

export type SwitchOutcome =
  | { type: 'switched'; tabId: number; windowId: number; crossWindow: boolean }
  | { type: 'no_match'; slotId: number }
  | { type: 'needs_recovery'; recoveryId: string; slotId: number }
  | { type: 'incognito_blocked'; slotId: number };

// ─── Notification Types ──────────────────────────────────────────────────────

export type NotificationType =
  | 'cross_window_switch'
  | 'recovery_rebind'
  | 'no_target'
  | 'background_failure';
