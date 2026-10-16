import type { DatabaseAdapter } from '../src';

/**
 * Every row of every table (and the AUTOINCREMENT counters), ordered, so two
 * dumps compare row for row. Undo tests assert dump(after undo) === dump(before).
 */
export function dumpDb(db: DatabaseAdapter): Record<string, unknown[]> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sqlite_stat1') ORDER BY name"
    )
    .all() as { name: string }[];
  const dump: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    dump[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all() as unknown[];
  }
  return dump;
}

/** dumpDb without per-database identity and wall-clock columns, to compare two databases. */
export function dumpComparable(db: DatabaseAdapter): Record<string, unknown[]> {
  const volatile = new Set(['SpaceID', 'CreatedAt', 'UpdatedAt', 'applied_at']);
  return Object.fromEntries(
    Object.entries(dumpDb(db)).map(([table, rows]) => [
      table,
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row as Record<string, unknown>).filter(([key]) => !volatile.has(key))
        )
      ),
    ])
  );
}
