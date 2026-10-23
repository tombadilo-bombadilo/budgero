/** The part of a sql.js Statement used to materialise result rows. */
export interface SqlJsRowSource {
  step(): boolean;
  get(): unknown[];
  getColumnNames(): string[];
}

/**
 * Same object as sql.js `getAsObject()`: keys in column order, values from `get()`, and a
 * duplicated column name keeps its first position and the value of its last occurrence.
 */
function toRowObject(names: string[], values: unknown[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (let i = 0; i < names.length; i += 1) row[names[i]] = values[i];
  return row;
}

/** The current row (after a successful `step()`), as `getAsObject()` returns it. */
export function readRow(stmt: SqlJsRowSource): Record<string, unknown> {
  return toRowObject(stmt.getColumnNames(), stmt.get());
}

/**
 * Steps through every remaining row and returns them as `getAsObject()` would, but reads the
 * column names once per statement instead of once per row (`getAsObject()` re-reads and
 * UTF-8-decodes every name for every row, which dominates large results).
 */
export function readAllRows(stmt: SqlJsRowSource): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let names: string[] | undefined;
  while (stmt.step()) {
    names ??= stmt.getColumnNames();
    rows.push(toRowObject(names, stmt.get()));
  }
  return rows;
}
