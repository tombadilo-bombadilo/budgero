import { DatabaseAdapter } from '../../database/interface.js';
import { allRows, atomically, run } from '../../database/sql.js';
import { ValidationError } from '../../types';
import { TransactionQueries } from './queries.js';

type Row = Record<string, unknown>;

/**
 * Everything a transaction delete removes, captured so undo can put it back
 * exactly: the rows themselves (same IDs, amounts, rates, flags, reconcile
 * state), the rows deleted with them through ON DELETE CASCADE (split lines,
 * import provenance, rule-run changes), and the links other tables lose
 * through ON DELETE SET NULL (recurring occurrences, warranties, bank-sync
 * candidates). Plain data, so it travels in a synced op.
 */
export interface TransactionRestoreSnapshot {
  version: 1;
  transactions: Row[];
  dependents: { table: string; rows: Row[] }[];
  links: { table: string; column: string; rows: [rowid: number, transactionId: number][] }[];
}

interface ForeignKeyRef {
  table: string;
  column: string;
  onDelete: string;
}

/** Tables pointing at transactions(ID), read from the live schema. */
function transactionReferences(db: DatabaseAdapter): ForeignKeyRef[] {
  return allRows<{ tbl: string; from: string; on_delete: string }>(
    db,
    `SELECT m.name AS tbl, p."from" AS "from", p.on_delete AS on_delete
       FROM sqlite_master m, pragma_foreign_key_list(m.name) p
      WHERE m.type = 'table' AND p."table" = 'transactions'
      ORDER BY m.name, p.id`
  ).map((ref) => ({ table: ref.tbl, column: ref.from, onDelete: ref.on_delete.toUpperCase() }));
}

function columnsOf(db: DatabaseAdapter, table: string): Set<string> {
  return new Set(
    allRows<{ name: string }>(db, 'SELECT name FROM pragma_table_info(?)', table).map(
      (column) => column.name
    )
  );
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function selectIn(
  db: DatabaseAdapter,
  sql: (placeholders: string) => string,
  ids: number[]
): Row[] {
  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    rows.push(...allRows<Row>(db, sql(chunk.map(() => '?').join(', ')), ...chunk));
  }
  return rows;
}

export function captureRestoreSnapshot(
  db: DatabaseAdapter,
  ids: number[]
): TransactionRestoreSnapshot {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  const transactions = selectIn(
    db,
    (p) => `SELECT * FROM transactions WHERE ID IN (${p}) ORDER BY ID`,
    unique
  );
  const found = transactions.map((row) => Number(row.ID));
  const dependents: TransactionRestoreSnapshot['dependents'] = [];
  const links: TransactionRestoreSnapshot['links'] = [];
  for (const ref of transactionReferences(db)) {
    if (ref.onDelete === 'CASCADE') {
      const rows = selectIn(
        db,
        (p) =>
          `SELECT * FROM ${quote(ref.table)} WHERE ${quote(ref.column)} IN (${p}) ORDER BY rowid`,
        found
      );
      if (rows.length) dependents.push({ table: ref.table, rows });
    } else if (ref.onDelete === 'SET NULL') {
      const rows = selectIn(
        db,
        (p) =>
          `SELECT rowid AS r, ${quote(ref.column)} AS t FROM ${quote(ref.table)}
            WHERE ${quote(ref.column)} IN (${p}) ORDER BY rowid`,
        found
      ).map((row) => [Number(row.r), Number(row.t)] as [number, number]);
      if (rows.length) links.push({ table: ref.table, column: ref.column, rows });
    }
  }
  return { version: 1, transactions, dependents, links };
}

function insertRow(db: DatabaseAdapter, table: string, columns: Set<string>, row: Row): void {
  const names = Object.keys(row).filter((name) => columns.has(name));
  if (!names.includes('ID') && columns.has('ID')) {
    throw new ValidationError(`Restore of ${table} needs the row's original ID.`);
  }
  run(
    db,
    `INSERT INTO ${quote(table)} (${names.map(quote).join(', ')})
     VALUES (${names.map(() => '?').join(', ')})`,
    ...names.map((name) => row[name] ?? null)
  );
}

/**
 * Put back a captured delete in one DB transaction, then rebuild running and
 * account balances for every touched account. Fails without writing if any
 * of the rows already exists again.
 */
export function restoreTransactionSnapshot(
  db: DatabaseAdapter,
  snapshot: TransactionRestoreSnapshot,
  /** Rows deleted first, in the same transaction (undo of an edit: put the captured state back). */
  replaceIds: number[] = []
): number[] {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.transactions)) {
    throw new ValidationError('Unsupported transaction restore snapshot.');
  }
  const references = transactionReferences(db);
  const cascaded = new Set(references.filter((r) => r.onDelete === 'CASCADE').map((r) => r.table));
  const nulled = new Set(
    references.filter((r) => r.onDelete === 'SET NULL').map((r) => `${r.table}.${r.column}`)
  );
  const ids = snapshot.transactions.map((row) => Number(row.ID));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new ValidationError('Restored transactions need their original IDs.');
  }

  return atomically(db, () => {
    const queries = new TransactionQueries(db);
    const replaced = selectIn(
      db,
      (p) => `SELECT ID, AccountID FROM transactions WHERE ID IN (${p})`,
      [...new Set(replaceIds)]
    );
    queries.deleteTransactions(replaced.map((row) => Number(row.ID)));
    const taken = selectIn(db, (p) => `SELECT ID FROM transactions WHERE ID IN (${p})`, ids);
    if (taken.length) {
      throw new ValidationError(`Transaction ${taken[0].ID} already exists; nothing restored.`);
    }
    const transactionColumns = columnsOf(db, 'transactions');
    for (const row of snapshot.transactions) insertRow(db, 'transactions', transactionColumns, row);

    for (const dependent of snapshot.dependents ?? []) {
      if (!cascaded.has(dependent.table)) {
        throw new ValidationError(`Cannot restore rows of ${dependent.table}.`);
      }
      const columns = columnsOf(db, dependent.table);
      for (const row of dependent.rows) insertRow(db, dependent.table, columns, row);
    }

    for (const link of snapshot.links ?? []) {
      if (!nulled.has(`${link.table}.${link.column}`)) {
        throw new ValidationError(`Cannot restore links in ${link.table}.${link.column}.`);
      }
      for (const [rowid, transactionId] of link.rows) {
        run(
          db,
          `UPDATE ${quote(link.table)} SET ${quote(link.column)} = ?
            WHERE rowid = ? AND ${quote(link.column)} IS NULL`,
          transactionId,
          rowid
        );
      }
    }

    queries.recalculateBalancesForAccounts(
      [...snapshot.transactions, ...replaced].map((row) => Number(row.AccountID))
    );
    return ids;
  });
}
