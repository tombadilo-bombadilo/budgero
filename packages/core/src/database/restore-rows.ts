import { DatabaseAdapter } from './interface.js';
import { allRows, run } from './sql.js';

/** A row exactly as `SELECT *` returned it, for undo snapshots. */
export type RawRow = Record<string, string | number | null>;

/** Tables whose rows undo may re-insert verbatim. */
const RESTORABLE_TABLES = new Set([
  'payees',
  'labels',
  'recurring_transactions',
  'recurring_transaction_occurrences',
]);

function tableColumns(db: DatabaseAdapter, table: string): Set<string> {
  if (!RESTORABLE_TABLES.has(table)) {
    throw new Error(`Table ${table} cannot be restored from a snapshot`);
  }
  return new Set(
    allRows<{ name: string }>(db, `SELECT name FROM pragma_table_info(?)`, table).map(
      (column) => column.name
    )
  );
}

/**
 * Re-insert `row` (a `SELECT *` snapshot) with every column it had, its ID
 * included, so undo brings back the exact row. Unknown columns (a snapshot
 * from another schema version) are ignored. `omit` drops columns, e.g. an ID
 * that is only meaningful on the device that took the snapshot.
 */
export function insertRawRow(
  db: DatabaseAdapter,
  table: string,
  row: RawRow,
  options: { omit?: string[]; orIgnore?: boolean } = {}
): number {
  const known = tableColumns(db, table);
  const omit = new Set(options.omit ?? []);
  const columns = Object.keys(row).filter((column) => known.has(column) && !omit.has(column));
  if (columns.length === 0) throw new Error(`Empty ${table} snapshot`);
  const result = run(
    db,
    `INSERT ${options.orIgnore ? 'OR IGNORE ' : ''}INTO ${table} (${columns
      .map((column) => `"${column}"`)
      .join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ...columns.map((column) => row[column] ?? null)
  );
  return result.changes;
}

/** Positional placeholders for an `IN (...)` list. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
