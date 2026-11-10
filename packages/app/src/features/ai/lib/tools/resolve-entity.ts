import { z } from 'zod';

/**
 * One "which account/category did the model mean" lookup, shared by the confirm
 * card and the write so both always land on the same entity.
 *
 * Order: a known ID, then a case-insensitive exact name, then a two-way
 * substring match. More than one candidate is never picked from: the caller
 * gets all of them back.
 */
export type EntityResolution<T> =
  | { kind: 'found'; entity: T }
  | { kind: 'ambiguous'; candidates: T[] }
  /** An ID or name was given, but nothing matches it. */
  | { kind: 'not_found' }
  /** Neither an ID nor a name was given. */
  | { kind: 'unspecified' };

export function resolveEntity<T extends { ID: number; Name: string }>(
  entities: readonly T[],
  id: number | null | undefined,
  name: string | null | undefined
): EntityResolution<T> {
  // An ID the budget doesn't have (models sometimes make one up) counts as no
  // ID, so the name is matched instead.
  if (id != null) {
    const byId = entities.find((e) => e.ID === id);
    if (byId) return { kind: 'found', entity: byId };
  }

  const query = name?.trim().toLowerCase();
  if (!query) return { kind: id != null ? 'not_found' : 'unspecified' };

  const named = entities
    .map((entity) => ({ entity, name: entity.Name.trim().toLowerCase() }))
    .filter((e) => e.name !== '');
  const exact = named.filter((e) => e.name === query);
  const candidates = (
    exact.length > 0 ? exact : named.filter((e) => e.name.includes(query) || query.includes(e.name))
  ).map((e) => e.entity);

  if (candidates.length === 0) return { kind: 'not_found' };
  if (candidates.length > 1) return { kind: 'ambiguous', candidates };
  return { kind: 'found', entity: candidates[0] };
}

export function listNames(entities: readonly { Name: string }[]): string {
  return entities
    .map((e) => e.Name.trim())
    .filter(Boolean)
    .join(', ');
}

const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Models often send numbers as strings; anything else is left for the schema to reject. */
function numericStringToNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return NUMERIC.test(trimmed) ? Number(trimmed) : value;
}

/** A positive amount: a number or a numeric string, never a boolean, null or "". */
export const positiveAmount = () =>
  z.preprocess(
    numericStringToNumber,
    z.number({ error: 'must be a positive number' }).positive('must be a positive number')
  );

/** A row ID: a positive integer (or a numeric string of one). */
export const entityId = () =>
  z.preprocess(
    numericStringToNumber,
    z
      .number({ error: 'must be a positive whole number' })
      .int('must be a positive whole number')
      .positive('must be a positive whole number')
  );

/** A calendar date, YYYY-MM-DD. */
export const isoDate = () => z.iso.date('must be a date in YYYY-MM-DD format');

function stripNulls(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, stripNulls(v)])
  );
}

/**
 * Many models send null for a field they leave out. Read-only tools treat a
 * null field as absent, so their `.optional()` fields keep plain types.
 */
export const withoutNulls = <T extends z.ZodType>(schema: T) => z.preprocess(stripNulls, schema);
