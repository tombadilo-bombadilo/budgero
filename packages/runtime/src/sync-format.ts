/**
 * Sync data-format versioning.
 *
 * Format 1 (implicit — payloads with no `v` field) used decimal currency
 * floats. Format 2 (app v1.5): all monetary values in op args and stored
 * blobs are integer milliunits (1/1000 currency unit). Format 3 (app v1.19):
 * same encoding as format 2, plus the op codes listed in
 * {@link OP_CODE_FORMAT_VERSIONS}.
 *
 * Each outgoing mutation is stamped with the LOWEST format that can express
 * it ({@link mutationFormatVersion}): ops every format-2 build knows stay
 * `v: 2`, so older devices keep syncing them; an op introduced later carries
 * the format that introduced it. Older builds reject a payload whose `v` is
 * newer than they support with {@link FormatTooNewError}, which stops their
 * sync at that mutation (cursor held) and prompts for an app update instead
 * of failing to apply it and skipping it.
 *
 * Receivers normalize every payload through {@link normalizeMutationPayload}:
 * legacy payloads are upgraded in place (×1000 on money fields), payloads
 * from a NEWER format are rejected with {@link FormatTooNewError} so an
 * outdated client stops and prompts for an update instead of misinterpreting
 * data it doesn't understand.
 *
 * Adding a mutation op code: give it the next format in
 * OP_CODE_FORMAT_VERSIONS and raise MUTATION_FORMAT_VERSION to match (the
 * app's op-code-format spec fails until every op code has a format).
 */

/** First format with integer-milliunit money; payloads below it are upgraded. */
export const MILLIUNIT_FORMAT_VERSION = 2;

/** Highest mutation format this build reads (and the highest it writes). */
export const MUTATION_FORMAT_VERSION = 3;

/** Format of mutations whose op codes every milliunit build knows. */
export const BASE_MUTATION_FORMAT_VERSION = MILLIUNIT_FORMAT_VERSION;

/**
 * Format of uploaded database snapshots (X-Data-Format-Version). Snapshot
 * contents did not change with mutation format 3, so builds that only know
 * format 2 can still restore them.
 */
export const SNAPSHOT_DATA_FORMAT_VERSION = 2;

/** Sent as X-Budgero-Protocol / ?protocol= so the server can gate stale clients. */
export const SYNC_PROTOCOL_VERSION = 2;

/**
 * Op codes newer than format 2, with the mutation format that introduced
 * each. Builds that support an older format don't have these ops; stamping
 * them with their format makes those builds stop with "update required"
 * rather than quarantine the mutation and silently diverge.
 */
export const OP_CODE_FORMAT_VERSIONS: Readonly<Record<string, number>> = Object.freeze({
  'history.applyOps': 3,
  'accounts.createLinked': 3,
  'accounts.restoreDeleted': 3,
  'categories.deleteAndReassign': 3,
  'categories.restoreDeleted': 3,
  'categoryGroups.deleteAndReassign': 3,
  'importHistory.unmatch': 3,
  'labels.restore': 3,
  'payees.restore': 3,
  'recurring.restore': 3,
  'rules.redoRun': 3,
  'transactions.batchEdit': 3,
  'transactions.restore': 3,
  'transactions.restoreAmounts': 3,
  'transactions.saveSplits': 3,
});

/** Format that introduced `op` (BASE_MUTATION_FORMAT_VERSION if it predates format 3). */
export function opCodeFormatVersion(op: string): number {
  return Object.hasOwn(OP_CODE_FORMAT_VERSIONS, op)
    ? OP_CODE_FORMAT_VERSIONS[op]
    : BASE_MUTATION_FORMAT_VERSION;
}

/**
 * Lowest format a receiver must support to apply this mutation: the newest
 * op code it contains, including ops nested in a list-of-ops payload
 * (`args.ops`, e.g. history.applyOps).
 */
export function mutationFormatVersion(op: string, args?: Record<string, unknown>): number {
  let version = opCodeFormatVersion(op);
  const nested = args?.ops;
  if (Array.isArray(nested)) {
    for (const call of nested) {
      const entry = call as { op?: unknown; args?: unknown } | null;
      if (!entry || typeof entry.op !== 'string') continue;
      const entryArgs =
        entry.args && typeof entry.args === 'object'
          ? (entry.args as Record<string, unknown>)
          : undefined;
      version = Math.max(version, mutationFormatVersion(entry.op, entryArgs));
    }
  }
  return version;
}

export class FormatTooNewError extends Error {
  constructor(public readonly receivedVersion: number) {
    super(
      `Sync payload uses format v${receivedVersion}, newer than this app supports (v${MUTATION_FORMAT_VERSION}). Update the app.`
    );
    this.name = 'FormatTooNewError';
  }
}

/**
 * A synced mutation names an op code this build doesn't have (a newer build
 * wrote it without raising its format). Like FormatTooNewError it means
 * "update the app", never "skip this mutation".
 */
export class UnknownOpCodeError extends Error {
  constructor(public readonly op: string) {
    super(`Unknown mutation op code: ${op}`);
    this.name = 'UnknownOpCodeError';
  }
}

/** Errors that mean this build is too old for a synced mutation. */
export function isUpdateRequiredError(
  error: unknown
): error is FormatTooNewError | UnknownOpCodeError {
  return (
    error instanceof FormatTooNewError ||
    error instanceof UnknownOpCodeError ||
    (error instanceof Error &&
      (error.name === 'FormatTooNewError' || error.name === 'UnknownOpCodeError'))
  );
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
  if (version < MILLIUNIT_FORMAT_VERSION) {
    return {
      op: payload.op,
      args: upgradeLegacyMoneyValues(payload.args ?? {}) as Record<string, unknown>,
    };
  }
  return { op: payload.op, args: payload.args ?? {} };
}
