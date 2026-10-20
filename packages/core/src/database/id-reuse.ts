import type { DatabaseAdapter } from './interface.js';
import { allRows, getRow, run } from './sql.js';

/**
 * Redo of an op under the IDs its first run allocated.
 *
 * Undo removes the rows an op created, but the AUTOINCREMENT counters stay
 * where the op left them, so a plain redo would create the same rows under
 * new IDs (an account's opening row, its payment category, split lines, ...).
 * The redo carries the counter range the first run used per table
 * (`before`, `after`); while the redo runs, the counter is put back to
 * `before`, so the redo allocates the same IDs again. IDs in that range were
 * handed to this op's first run only (the counter only grows), so the redo
 * cannot take an ID that belonged to another row. SQLite never allocates
 * below the largest live ID, so a pinned counter cannot collide with a row
 * either, and afterwards the counter goes back to at least where it was: IDs
 * other ops burnt since stay burnt. A counter below `after` (put back by an
 * undo journal) is left alone.
 */

/** Per table: the counter before and after the op's first run (null: no counter yet). */
export type IdRange = Record<string, [before: number | null, after: number]>;

/** Counters of device-local tables: never compared or reused across devices. */
const LOCAL_TABLES = new Set([
  'mutation_history',
  'recurring_transaction_occurrences',
  'currency_rates',
]);

function hasSequenceTable(db: DatabaseAdapter): boolean {
  return Boolean(
    getRow(
      db,
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
    )
  );
}

function counter(db: DatabaseAdapter, table: string): number | null {
  const row = getRow<{ seq: number }>(db, 'SELECT seq FROM sqlite_sequence WHERE name = ?', table);
  return row ? Number(row.seq) : null;
}

function setCounter(db: DatabaseAdapter, table: string, value: number | null): void {
  if (value === null) {
    run(db, 'DELETE FROM sqlite_sequence WHERE name = ?', table);
  } else if (counter(db, table) === null) {
    run(db, 'INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', table, value);
  } else {
    run(db, 'UPDATE sqlite_sequence SET seq = ? WHERE name = ?', value, table);
  }
}

/** Every shared table's AUTOINCREMENT counter. */
export function readIdCounters(db: DatabaseAdapter): Record<string, number> {
  if (!hasSequenceTable(db)) return {};
  const out: Record<string, number> = {};
  for (const row of allRows<{ name: string; seq: number }>(
    db,
    'SELECT name, seq FROM sqlite_sequence'
  )) {
    if (!LOCAL_TABLES.has(row.name)) out[row.name] = Number(row.seq);
  }
  return out;
}

/** The counters that moved since `before` (from readIdCounters): what an op allocated. */
export function allocatedIdRange(db: DatabaseAdapter, before: Record<string, number>): IdRange {
  const range: IdRange = {};
  for (const [table, after] of Object.entries(readIdCounters(db))) {
    const start = before[table] ?? null;
    if (after > (start ?? 0)) range[table] = [start, after];
  }
  return range;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Runs `fn` with the counters of `range` put back (see the module comment). */
export async function withReusedIds<T>(
  db: DatabaseAdapter,
  range: unknown,
  fn: () => Promise<T> | T
): Promise<T> {
  const pinned: { table: string; current: number }[] = [];
  if (range && typeof range === 'object' && !Array.isArray(range) && hasSequenceTable(db)) {
    for (const [table, bounds] of Object.entries(range as Record<string, unknown>)) {
      if (LOCAL_TABLES.has(table) || !Array.isArray(bounds) || bounds.length !== 2) continue;
      const [before, after] = bounds as unknown[];
      if (!isCount(after) || (before !== null && !isCount(before)) || (before ?? 0) >= after) {
        continue;
      }
      const current = counter(db, table);
      if (current === null || current < after) continue;
      setCounter(db, table, before as number | null);
      pinned.push({ table, current });
    }
  }
  try {
    return await fn();
  } finally {
    // Never leave a counter below where it was: IDs it passed stay burnt.
    for (const { table, current } of pinned) {
      const now = counter(db, table);
      if (now === null || now < current) setCounter(db, table, current);
    }
  }
}
