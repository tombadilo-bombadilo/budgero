import { DatabaseAdapter } from '../../database/interface.js';
import { atomically, getRow, run } from '../../database/sql.js';

/**
 * Generic synced key/value state, stored in the workspace's encrypted
 * database (table synced_state) and changed only through the synced ops
 * syncedState.set / syncedState.merge, so it reaches every device of every
 * member. The server sees opaque encrypted mutations only.
 *
 * Scopes: `user:<userId>` (one member, in this workspace), `workspace`, and
 * `budget:<budgetId>`. Keys are app-defined; unknown keys are kept (newer
 * builds add keys).
 *
 * Writes carry the originating device's time (`at`, ISO-8601 UTC) and are
 * applied by time, not by arrival order, so devices replaying the same ops in
 * a different order end up with the same rows:
 * - set: the whole value, newest `at` wins; null deletes (a tombstone stays so
 *   an older set arriving later can't bring the value back).
 * - merge: a JSON object edited entry by entry; each entry keeps its own time,
 *   so two devices adding different entries both keep theirs, and removing an
 *   entry beats an older add of it. Use either set or merge for a key, not both.
 */

export const SYNCED_STATE_MAX_VALUE_LENGTH = 65_536;
const MAX_KEY_LENGTH = 128;
const MAX_ENTRY_KEY_LENGTH = 256;
const MAX_ID_LENGTH = 128;

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const SCOPE_ID_PATTERN = /^[A-Za-z0-9_.:@|-]+$/;
const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export type SyncedStateScope = 'workspace' | `user:${string}` | `budget:${number}`;

export interface SyncedStateMergePatch {
  /** Entries to add or replace. */
  set?: Record<string, unknown>;
  /** Entry keys to remove. */
  remove?: string[];
}

interface Clocks {
  /** Time of the last whole-value set (or delete). */
  base: string;
  /** Time each merge entry was last set or removed. */
  entries: Record<string, string>;
  /** Entries whose latest write was a removal. */
  removed?: string[];
}

interface Row {
  Value: string | null;
  UpdatedAt: string;
  Clocks: string | null;
}

export function isSyncedStateScope(scope: unknown): scope is SyncedStateScope {
  if (scope === 'workspace') return true;
  if (typeof scope !== 'string') return false;
  if (scope.startsWith('user:')) {
    const id = scope.slice(5);
    return id.length > 0 && id.length <= MAX_ID_LENGTH && SCOPE_ID_PATTERN.test(id);
  }
  if (scope.startsWith('budget:')) return /^budget:[1-9]\d{0,15}$/.test(scope);
  return false;
}

export function isSyncedStateKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= MAX_KEY_LENGTH && KEY_PATTERN.test(key);
}

function assertScopeAndKey(scope: unknown, key: unknown): void {
  if (!isSyncedStateScope(scope)) throw new Error(`Invalid synced state scope: ${String(scope)}`);
  if (!isSyncedStateKey(key)) throw new Error(`Invalid synced state key: ${String(key)}`);
}

function assertAt(at: unknown): asserts at is string {
  if (typeof at !== 'string' || !AT_PATTERN.test(at)) {
    throw new Error('Synced state writes need a UTC ISO time');
  }
}

function encode(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Synced state values must be JSON');
  return json;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPatch(patch: unknown): asserts patch is SyncedStateMergePatch {
  if (!isPlainObject(patch)) throw new Error('Synced state merge needs a patch');
  const { set, remove } = patch as SyncedStateMergePatch;
  if (set !== undefined && !isPlainObject(set)) throw new Error('merge.set must be an object');
  if (remove !== undefined && !Array.isArray(remove))
    throw new Error('merge.remove must be a list');
  const keys = [...Object.keys(set ?? {}), ...(remove ?? [])];
  if (keys.length === 0) throw new Error('Synced state merge changes nothing');
  for (const entry of keys) {
    if (typeof entry !== 'string' || entry === '' || entry.length > MAX_ENTRY_KEY_LENGTH) {
      throw new Error('Invalid synced state entry key');
    }
  }
  for (const value of Object.values(set ?? {})) {
    if (value === undefined) throw new Error('Synced state entries must be JSON');
    encode(value);
  }
}

/** a's write beats b's: later time, then the larger encoding (any fixed rule converges). */
function wins(atA: string, encA: string, atB: string | undefined, encB: string): boolean {
  if (atB === undefined) return true;
  if (atA !== atB) return atA > atB;
  return encA > encB;
}

function parseClocks(raw: string | null, fallback: string): Clocks {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Clocks;
      if (parsed && typeof parsed.base === 'string' && isPlainObject(parsed.entries)) return parsed;
    } catch {
      /* rebuilt below */
    }
  }
  return { base: fallback, entries: {} };
}

function parseValue(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export class SyncedStateService {
  constructor(private db: DatabaseAdapter) {}

  private row(scope: string, key: string): Row | null {
    return (
      getRow<Row>(
        this.db,
        `SELECT Value, UpdatedAt, Clocks FROM synced_state WHERE Scope = ? AND Key = ?`,
        scope,
        key
      ) ?? null
    );
  }

  /** The stored value, or undefined when there is none (never set, or deleted). */
  get(scope: SyncedStateScope, key: string): unknown {
    assertScopeAndKey(scope, key);
    return parseValue(this.row(scope, key)?.Value ?? null);
  }

  /** The value with the time it last changed; null when there is none. */
  getEntry(scope: SyncedStateScope, key: string): { value: unknown; updatedAt: string } | null {
    assertScopeAndKey(scope, key);
    const row = this.row(scope, key);
    if (!row || row.Value === null) return null;
    return { value: parseValue(row.Value), updatedAt: row.UpdatedAt };
  }

  /**
   * Throws when a set from this device would be refused: bad scope/key or a
   * value over SYNCED_STATE_MAX_VALUE_LENGTH. Run before sending the op
   * (receivers never size-check, so a replay can't fail on them).
   */
  checkSet(scope: unknown, key: unknown, value: unknown): void {
    assertScopeAndKey(scope, key);
    if (value === null || value === undefined) return;
    if (encode(value).length > SYNCED_STATE_MAX_VALUE_LENGTH) {
      throw new Error('Synced state value is too large');
    }
  }

  /** Like checkSet, for a merge: the merged object must stay under the cap. */
  checkMerge(scope: unknown, key: unknown, patch: unknown): void {
    assertScopeAndKey(scope, key);
    assertPatch(patch);
    const current = this.get(scope as SyncedStateScope, key as string);
    const next: Record<string, unknown> = { ...(isPlainObject(current) ? current : {}) };
    Object.assign(next, patch.set ?? {});
    for (const entry of patch.remove ?? []) delete next[entry];
    if (encode(next).length > SYNCED_STATE_MAX_VALUE_LENGTH) {
      throw new Error('Synced state value is too large');
    }
  }

  /** Whole-value write; null or undefined deletes. Older than the stored write: no-op. */
  set(scope: SyncedStateScope, key: string, value: unknown, at: string): boolean {
    assertScopeAndKey(scope, key);
    assertAt(at);
    let next = value === null || value === undefined ? null : encode(value);
    return atomically(this.db, () => {
      const row = this.row(scope, key);
      const clocks: Clocks = { base: at, entries: {} };
      let updatedAt = at;
      if (row) {
        const prev = parseClocks(row.Clocks, row.UpdatedAt);
        if (!wins(at, next ?? '', prev.base, row.Value ?? '')) return false;
        // Merge entries written after this set survive it, whatever the arrival order.
        const current = parseValue(row.Value);
        const newer = Object.entries(prev.entries).filter(([, entryAt]) => entryAt > at);
        const base = next === null ? null : (JSON.parse(next) as unknown);
        if (newer.length > 0 && (base === null || isPlainObject(base))) {
          const merged: Record<string, unknown> = { ...(base ?? {}) };
          const removed: string[] = [];
          for (const [entry, entryAt] of newer) {
            clocks.entries[entry] = entryAt;
            if (prev.removed?.includes(entry)) {
              delete merged[entry];
              removed.push(entry);
            } else if (isPlainObject(current) && Object.hasOwn(current, entry)) {
              merged[entry] = current[entry];
            }
            if (entryAt > updatedAt) updatedAt = entryAt;
          }
          if (removed.length > 0) clocks.removed = removed.sort();
          next = encode(sortedObject(merged));
        }
      }
      run(
        this.db,
        `INSERT INTO synced_state (Scope, Key, Value, UpdatedAt, Clocks) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(Scope, Key) DO UPDATE SET
           Value = excluded.Value, UpdatedAt = excluded.UpdatedAt, Clocks = excluded.Clocks`,
        scope,
        key,
        next,
        updatedAt,
        JSON.stringify(clocks)
      );
      return true;
    });
  }

  /** Entry-wise write into a JSON object value (see the class comment). */
  merge(scope: SyncedStateScope, key: string, patch: SyncedStateMergePatch, at: string): boolean {
    assertScopeAndKey(scope, key);
    assertAt(at);
    assertPatch(patch);
    return atomically(this.db, () => {
      const row = this.row(scope, key);
      const clocks = row ? parseClocks(row.Clocks, row.UpdatedAt) : { base: '', entries: {} };
      // A whole-value set newer than this merge wins over it.
      if (row && clocks.base > at) return false;
      const current = parseValue(row?.Value ?? null);
      const value: Record<string, unknown> = isPlainObject(current) ? { ...current } : {};
      const removed = new Set(clocks.removed ?? []);
      let changed = false;

      const apply = (entry: string, enc: string, write: () => void) => {
        const prevAt = clocks.entries[entry];
        const prevEnc = removed.has(entry)
          ? '0'
          : `1${Object.hasOwn(value, entry) ? encode(value[entry]) : ''}`;
        if (!wins(at, enc, prevAt, prevEnc)) return;
        write();
        clocks.entries[entry] = at;
        changed = true;
      };
      for (const [entry, entryValue] of Object.entries(patch.set ?? {})) {
        apply(entry, `1${encode(entryValue)}`, () => {
          value[entry] = entryValue;
          removed.delete(entry);
        });
      }
      for (const entry of patch.remove ?? []) {
        apply(entry, '0', () => {
          delete value[entry];
          removed.add(entry);
        });
      }
      if (!changed) return false;

      const next: Clocks = { base: clocks.base, entries: clocks.entries };
      if (removed.size > 0) next.removed = [...removed].sort();
      const updatedAt = row && row.UpdatedAt > at ? row.UpdatedAt : at;
      run(
        this.db,
        `INSERT INTO synced_state (Scope, Key, Value, UpdatedAt, Clocks) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(Scope, Key) DO UPDATE SET
           Value = excluded.Value, UpdatedAt = excluded.UpdatedAt, Clocks = excluded.Clocks`,
        scope,
        key,
        encode(sortedObject(value)),
        updatedAt,
        JSON.stringify(next)
      );
      return true;
    });
  }
}

/** Same entries in key order, so every device stores the same text. */
function sortedObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, value[k]])
  );
}
