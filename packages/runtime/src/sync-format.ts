/**
 * Sync data-format versioning.
 *
 * Format 2 (app v1.5): all monetary values in op args and stored blobs are
 * integer milliunits (1/1000 currency unit). Format 1 (implicit — payloads
 * with no `v` field) used decimal currency floats.
 *
 * Receivers normalize every payload through {@link normalizeMutationPayload}:
 * legacy payloads are upgraded in place (×1000 on money fields), payloads
 * from a NEWER format are rejected with {@link FormatTooNewError} so an
 * outdated client stops and prompts for an update instead of misinterpreting
 * amounts it doesn't understand.
 */

export const MUTATION_FORMAT_VERSION = 2;

/** Sent as X-Budgero-Protocol / ?protocol= so the server can gate stale clients. */
export const SYNC_PROTOCOL_VERSION = 2;

export class FormatTooNewError extends Error {
  constructor(public readonly receivedVersion: number) {
    super(
      `Sync payload uses format v${receivedVersion}, newer than this app supports (v${MUTATION_FORMAT_VERSION}). Update the app.`
    );
    this.name = 'FormatTooNewError';
  }
}

export interface VersionedMutationPayload {
  v?: number;
  op: string;
  args: Record<string, unknown>;
}

/**
 * Money-bearing arg keys (lowercased). Mirrors the conversion map in core's
 * migration 039 — kept in sync by the shared-format tests; runtime has no
 * dependency on core.
 */
const MONEY_ARG_KEYS = new Set([
  'inflow',
  'outflow',
  'infloworiginal',
  'outfloworiginal',
  'inflowbudget',
  'outflowbudget',
  'amount',
  'balance',
  'target',
]);

/** Money columns referenced by updateColumn-style ops ({columnName, newValue}). */
const MONEY_COLUMN_NAMES = new Set([
  'inflow',
  'outflow',
  'infloworiginal',
  'outfloworiginal',
  'runningbalance',
  'runningbalanceoriginal',
  'balance',
  'balanceconverted',
  'amount',
  'target',
]);

/** Recursively converts decimal money values in legacy (format-1) args to milliunits. */
export function upgradeLegacyMoneyValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeLegacyMoneyValues);
  if (value === null || typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const columnName = typeof obj.columnName === 'string' ? obj.columnName.toLowerCase() : null;
  for (const [key, v] of Object.entries(obj)) {
    const isMoneyKey =
      MONEY_ARG_KEYS.has(key.toLowerCase()) ||
      (key === 'newValue' && columnName !== null && MONEY_COLUMN_NAMES.has(columnName));
    if (isMoneyKey && typeof v === 'number' && Number.isFinite(v)) {
      out[key] = Math.round(v * 1000);
    } else {
      out[key] = upgradeLegacyMoneyValues(v);
    }
  }
  return out;
}

/**
 * Normalizes a decoded mutation payload to the current format. Upgrades
 * legacy payloads, passes current-format payloads through, throws
 * {@link FormatTooNewError} for anything from a future format.
 */
export function normalizeMutationPayload(payload: VersionedMutationPayload): {
  op: string;
  args: Record<string, unknown>;
} {
  const version = payload.v ?? 1;
  if (version > MUTATION_FORMAT_VERSION) {
    throw new FormatTooNewError(version);
  }
  if (version < MUTATION_FORMAT_VERSION) {
    return {
      op: payload.op,
      args: upgradeLegacyMoneyValues(payload.args ?? {}) as Record<string, unknown>,
    };
  }
  return { op: payload.op, args: payload.args ?? {} };
}
