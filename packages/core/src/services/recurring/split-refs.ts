/**
 * Category and account IDs inside recurring templates' split lines
 * (recurring_transactions.SplitsJSON). The database can't see them (no foreign
 * key reaches into the JSON), so whatever deletes or merges a category or
 * deletes an account calls these in the same transaction. Templates are
 * visited in ID order and lines keep their order and keys, so every device
 * replaying the op writes the same JSON.
 */
import type { DatabaseAdapter } from '../../database/interface.js';
import { allRows, run } from '../../database/sql.js';
import { safeParseJSON } from '../../utils/json.js';
import type { RecurringSplitLine } from './types.js';

interface SplitTemplate {
  id: number;
  lines: RecurringSplitLine[];
}

function splitTemplates(db: DatabaseAdapter): SplitTemplate[] {
  return allRows<{ ID: number | bigint; SplitsJSON: string }>(
    db,
    `SELECT ID, SplitsJSON FROM recurring_transactions
      WHERE SplitsJSON IS NOT NULL AND SplitsJSON != '' ORDER BY ID`
  ).flatMap((row) => {
    const lines = safeParseJSON<RecurringSplitLine[] | null>(row.SplitsJSON, null);
    return Array.isArray(lines) && lines.length ? [{ id: Number(row.ID), lines }] : [];
  });
}

/** How many templates have a split line in one of these categories. */
export function countSplitTemplatesInCategories(
  db: DatabaseAdapter,
  categoryIds: number[]
): number {
  if (!categoryIds.length) return 0;
  const ids = new Set(categoryIds);
  return splitTemplates(db).filter(({ lines }) =>
    lines.some((line) => line?.categoryId != null && ids.has(Number(line.categoryId)))
  ).length;
}

/**
 * Moves split lines out of `categoryIds`: to `destination`, or to no category
 * (null) when the categories are deleted without one, as ON DELETE SET NULL
 * does for a template's own category. A line left without a category must get
 * one before its template can post again. Returns the templates rewritten.
 */
export function moveSplitLinesOutOfCategories(
  db: DatabaseAdapter,
  categoryIds: number[],
  destination: number | null
): number[] {
  if (!categoryIds.length) return [];
  const ids = new Set(categoryIds);
  const rewritten: number[] = [];
  for (const { id, lines } of splitTemplates(db)) {
    if (!lines.some((line) => line?.categoryId != null && ids.has(Number(line.categoryId)))) {
      continue;
    }
    const next = lines.map((line) =>
      line?.categoryId != null && ids.has(Number(line.categoryId))
        ? { ...line, categoryId: destination }
        : line
    );
    run(
      db,
      'UPDATE recurring_transactions SET SplitsJSON = ? WHERE ID = ?',
      JSON.stringify(next),
      id
    );
    rewritten.push(id);
  }
  return rewritten;
}

/**
 * Deletes the templates with a split line that transfers to `accountId` (with
 * their occurrences; posted transactions stay), as deleting a template's own
 * account or a recurring transfer's destination does. Returns their IDs.
 */
export function deleteSplitTemplatesTransferringTo(
  db: DatabaseAdapter,
  accountId: number
): number[] {
  const doomed = splitTemplates(db)
    .filter(({ lines }) =>
      lines.some(
        (line) => line?.transferAccountId != null && Number(line.transferAccountId) === accountId
      )
    )
    .map(({ id }) => id);
  for (const id of doomed) run(db, 'DELETE FROM recurring_transactions WHERE ID = ?', id);
  return doomed;
}
