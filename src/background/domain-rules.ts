/**
 * Domain constraint partition (D14/D15).
 *
 * Replaces the old "reject the whole package on the first unsafe regex" gate.
 * A record that violates a domain constraint (unsafe regex, out-of-range slot
 * id, unknown match type, over-long value) is collected per-record with a
 * reason; every other record is still accepted.
 *
 * Safety is unchanged (design §6.1): the B4 patterns are never executed, only
 * statically validated, so skipping a record is equivalent to rejecting it —
 * with a one-record blast radius instead of the whole file.
 */

import { validateRegex, MAX_REGEX_LENGTH } from '@shared/url-utils';
import type { UrlMatchType } from '@shared/types';

/** Maximum length of a non-regex URL value (mirrors the regex cap by intent). */
export const MAX_URL_LENGTH = 2048;

export interface DomainRecord {
  kind: 'slot' | 'rule';
  id: number | string;
  urlMatch: { type: UrlMatchType; value: string };
}

export interface DomainRejection {
  kind: 'slot' | 'rule';
  id: number | string;
  reason: string;
}

export interface DomainPartition<T extends DomainRecord> {
  accepted: T[];
  rejectedWithReason: DomainRejection[];
}

const VALID_SLOT_MIN = 1;
const VALID_SLOT_MAX = 10;

/**
 * Partition records into accepted / rejected-with-reason.
 *
 * Extraction order matches the old gate (rules before slots) so reasons stay
 * recognizable, but the return shape is now a full partition.
 */
export function partitionByDomainRules<T extends DomainRecord>(records: T[]): DomainPartition<T> {
  const accepted: T[] = [];
  const rejectedWithReason: DomainRejection[] = [];

  for (const record of records) {
    const reason = findViolation(record);
    if (reason) {
      rejectedWithReason.push({ kind: record.kind, id: record.id, reason });
    } else {
      accepted.push(record);
    }
  }

  return { accepted, rejectedWithReason };
}

/** Return a human-readable reason when `record` violates a constraint, else null. */
export function findViolation(record: DomainRecord): string | null {
  if (record.kind === 'slot') {
    if (typeof record.id !== 'number' || !Number.isInteger(record.id)) {
      return `Slot id must be an integer (got ${String(record.id)})`;
    }
    if (record.id < VALID_SLOT_MIN || record.id > VALID_SLOT_MAX) {
      return `Slot id ${String(record.id)} is out of range (must be ${String(VALID_SLOT_MIN)}..${String(VALID_SLOT_MAX)})`;
    }
  }

  const match: unknown = record.urlMatch;
  if (!match || typeof match !== 'object') {
    return 'Missing or invalid urlMatch';
  }
  const { type, value } = match as { type?: unknown; value?: unknown };
  if (type !== 'exact' && type !== 'regex') {
    return `Invalid urlMatch type: ${String(type)}`;
  }
  if (typeof value !== 'string') {
    return 'urlMatch value must be a string';
  }

  const label = `${record.kind === 'rule' ? 'Rule' : 'Slot'} ${String(record.id)}`;

  if (type === 'regex') {
    const check = validateRegex(value);
    if (!check.valid) {
      const detail = check.message ?? check.error ?? 'rejected';
      return `${label} has an unsafe regex: ${detail}`;
    }
    return null;
  }

  if (value.length > MAX_URL_LENGTH) {
    return `${label} exceeds the ${String(MAX_URL_LENGTH)} character URL limit`;
  }
  return null;
}

export { MAX_REGEX_LENGTH };