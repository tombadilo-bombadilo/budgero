import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';
import { MONEY_COLUMNS } from '../money-columns.js';

export { MONEY_COLUMNS } from '../money-columns.js';

const debugLog = createLogger('database:migrations');

/**
 * Converts every monetary column from REAL (decimal currency units) to
 * INTEGER milliunits (1/1000 of a unit): value -> ROUND(value * 1000).
 * Rate columns (currency_rates, manual/custom rates, transactions.ExchangeRate)
 * stay REAL — they are dimensionless factors, not money.
 *
 * SQLite cannot alter a column's type, so each affected table is rebuilt via
 * the documented procedure: create the new table, copy converted rows, drop
 * the old table, rename. The migration runner suspends FK enforcement for the
 * whole run — with FKs on, dropping the old `transactions` would
 * cascade-delete `transaction_splits`/`warranties` rows.
 *
 * After the rebuild, two repairs run:
 *  - split lines are adjusted (largest line absorbs the remainder) so each
 *    split set sums exactly to its parent — the old float validation rounded
 *    to whole units, so stored data can legitimately be off by sub-unit noise;
 *  - running balances and account balances are recomputed with the exact
 *    ordering `recalculateBalances` uses (Date ASC, ID ASC), since rounding
 *    each row independently invalidates previously accumulated float sums.
 */

interface TableRebuild {
  table: string;
  /** CREATE TABLE DDL for the milliunit version, named `<table>__mu`. */
  createSql: string;
  /** Copyable columns in DDL order — excludes generated columns (transactions.Month). */
  columns: string[];
  /** Subset of `columns` converted with ROUND(col * 1000). */
  money: string[];
}

const REBUILDS: TableRebuild[] = [
  {
    table: 'accounts',
    createSql: `
      CREATE TABLE accounts__mu (
        ID                INTEGER PRIMARY KEY AUTOINCREMENT,
        Name              TEXT NOT NULL,
        Currency          TEXT NOT NULL,
        Type              TEXT NOT NULL,
        ReconciledAt      DATE,
        Balance           INTEGER NOT NULL DEFAULT 0,
        BalanceConverted  INTEGER DEFAULT NULL,
        BudgetID          INTEGER NOT NULL, Metadata TEXT, OnBudget BOOLEAN NOT NULL DEFAULT TRUE, Archived INTEGER NOT NULL DEFAULT 0, Position INTEGER,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    columns: [
      'ID',
      'Name',
      'Currency',
      'Type',
      'ReconciledAt',
      'Balance',
      'BalanceConverted',
      'BudgetID',
      'Metadata',
      'OnBudget',
      'Archived',
      'Position',
    ],
    money: ['Balance', 'BalanceConverted'],
  },
  {
    table: 'transactions',
    createSql: `
      CREATE TABLE transactions__mu (
        ID                     INTEGER PRIMARY KEY AUTOINCREMENT,
        CategoryID             INTEGER NOT NULL,
        AccountID              INTEGER NOT NULL,
        TransferID             TEXT DEFAULT NULL,
        Date                   TEXT    NOT NULL,
        Month                  TEXT GENERATED ALWAYS AS (substr(Date, 1, 7)) STORED,
        Memo                   TEXT    NOT NULL DEFAULT '',
        Reconciled             BOOLEAN NOT NULL DEFAULT FALSE,
        Inflow                 INTEGER NOT NULL DEFAULT 0,
        Outflow                INTEGER NOT NULL DEFAULT 0,
        InflowOriginal         INTEGER DEFAULT NULL,
        OutflowOriginal        INTEGER DEFAULT NULL,
        RunningBalance         INTEGER DEFAULT 0,
        RunningBalanceOriginal INTEGER DEFAULT NULL,
        BudgetID               INTEGER NOT NULL, Payee TEXT DEFAULT '', ExchangeRate REAL DEFAULT NULL, ExchangeRateOverride BOOLEAN NOT NULL DEFAULT 0, LabelID INTEGER DEFAULT NULL, ConversionPending BOOLEAN NOT NULL DEFAULT 0,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (AccountID)  REFERENCES accounts(ID)    ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (BudgetID)   REFERENCES budgets(ID)     ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    columns: [
      'ID',
      'CategoryID',
      'AccountID',
      'TransferID',
      'Date',
      'Memo',
      'Reconciled',
      'Inflow',
      'Outflow',
      'InflowOriginal',
      'OutflowOriginal',
      'RunningBalance',
      'RunningBalanceOriginal',
      'BudgetID',
      'Payee',
      'ExchangeRate',
      'ExchangeRateOverride',
      'LabelID',
      'ConversionPending',
    ],
    money: [
      'Inflow',
      'Outflow',
      'InflowOriginal',
      'OutflowOriginal',
      'RunningBalance',
      'RunningBalanceOriginal',
    ],
  },
  {
    table: 'transaction_splits',
    createSql: `
      CREATE TABLE transaction_splits__mu (
        ID                  INTEGER PRIMARY KEY AUTOINCREMENT,
        TransactionID       INTEGER NOT NULL,
        CategoryID          INTEGER,
        TransferAccountID   INTEGER,
        Memo                TEXT NOT NULL DEFAULT '',
        Inflow              INTEGER NOT NULL DEFAULT 0,
        Outflow             INTEGER NOT NULL DEFAULT 0,
        InflowOriginal      INTEGER DEFAULT NULL,
        OutflowOriginal     INTEGER DEFAULT NULL,
        PairID              TEXT DEFAULT NULL,
        OrderIndex          INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (TransactionID) REFERENCES transactions(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE SET NULL ON UPDATE CASCADE,
        FOREIGN KEY (TransferAccountID) REFERENCES accounts(ID) ON DELETE SET NULL ON UPDATE CASCADE
      )`,
    columns: [
      'ID',
      'TransactionID',
      'CategoryID',
      'TransferAccountID',
      'Memo',
      'Inflow',
      'Outflow',
      'InflowOriginal',
      'OutflowOriginal',
      'PairID',
      'OrderIndex',
    ],
    money: ['Inflow', 'Outflow', 'InflowOriginal', 'OutflowOriginal'],
  },
  {
    table: 'assignments',
    createSql: `
      CREATE TABLE assignments__mu (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        CategoryID   INTEGER NOT NULL,
        Amount       INTEGER NOT NULL,
        Month        TEXT    NOT NULL,
        BudgetID     INTEGER NOT NULL,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (BudgetID)   REFERENCES budgets(ID)     ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    columns: ['ID', 'CategoryID', 'Amount', 'Month', 'BudgetID'],
    money: ['Amount'],
  },
  {
    table: 'goals',
    createSql: `
      CREATE TABLE goals__mu (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        Type         TEXT NOT NULL,
        CategoryID   INTEGER NOT NULL UNIQUE,
        Target       INTEGER NOT NULL,
        StartDate    TEXT NOT NULL,
        TargetDate   TEXT NOT NULL DEFAULT '1970-01-01', Purpose TEXT NOT NULL DEFAULT 'spending', Recurring INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    columns: [
      'ID',
      'Type',
      'CategoryID',
      'Target',
      'StartDate',
      'TargetDate',
      'Purpose',
      'Recurring',
    ],
    money: ['Target'],
  },
  {
    table: 'recurring_transactions',
    createSql: `
      CREATE TABLE recurring_transactions__mu (
        ID                INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID          INTEGER NOT NULL,
        AccountID         INTEGER NOT NULL,
        CategoryID        INTEGER,
        Name              TEXT NOT NULL,
        Memo              TEXT NOT NULL DEFAULT '',
        Amount            INTEGER NOT NULL,
        Direction         TEXT NOT NULL CHECK(Direction IN ('inflow','outflow')),
        ScheduleJSON      TEXT NOT NULL,
        NotifyDaysBefore  INTEGER NOT NULL DEFAULT 0,
        LastOccurrenceDate TEXT DEFAULT NULL,
        Active            BOOLEAN NOT NULL DEFAULT 1,
        CreatedAt         TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt         TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (AccountID) REFERENCES accounts(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE SET NULL ON UPDATE CASCADE
      )`,
    columns: [
      'ID',
      'BudgetID',
      'AccountID',
      'CategoryID',
      'Name',
      'Memo',
      'Amount',
      'Direction',
      'ScheduleJSON',
      'NotifyDaysBefore',
      'LastOccurrenceDate',
      'Active',
      'CreatedAt',
      'UpdatedAt',
    ],
    money: ['Amount'],
  },
  {
    table: 'warranties',
    createSql: `
      CREATE TABLE warranties__mu (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID      INTEGER NOT NULL,
        Name          TEXT NOT NULL,
        ExpiresAt     TEXT NOT NULL,
        TransactionID INTEGER DEFAULT NULL,
        ReceiptImage  BLOB DEFAULT NULL,
        Notes         TEXT NOT NULL DEFAULT '',
        CreatedAt     TEXT NOT NULL DEFAULT (datetime('now')), Amount INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (TransactionID) REFERENCES transactions(ID) ON DELETE SET NULL ON UPDATE CASCADE
      )`,
    columns: [
      'ID',
      'BudgetID',
      'Name',
      'ExpiresAt',
      'TransactionID',
      'ReceiptImage',
      'Notes',
      'CreatedAt',
      'Amount',
    ],
    money: ['Amount'],
  },
];

function assertForeignKeysOff(db: MigrationDatabase): void {
  const res = db.exec('PRAGMA foreign_keys');
  const on = res.length > 0 && res[0].values.length > 0 && res[0].values[0][0] === 1;
  if (!on) return;
  // Defense in depth: a rebuild with FKs enforced would cascade-delete child
  // rows on DROP. The runner should have suspended them; abort (and roll the
  // transaction back) rather than destroy data.
  db.exec('PRAGMA foreign_keys = OFF'); // no-op inside a transaction
  const recheck = db.exec('PRAGMA foreign_keys');
  if (recheck.length > 0 && recheck[0].values[0]?.[0] === 1) {
    throw new Error(
      'Migration 39 requires foreign-key enforcement to be suspended by the migration runner'
    );
  }
}

function rebuildTable(db: MigrationDatabase, spec: TableRebuild): void {
  const selectExprs = spec.columns
    .map((c) => (spec.money.includes(c) ? `CAST(ROUND(${c} * 1000) AS INTEGER) AS ${c}` : c))
    .join(', ');
  db.exec(spec.createSql);
  db.exec(
    `INSERT INTO ${spec.table}__mu (${spec.columns.join(', ')})
     SELECT ${selectExprs} FROM ${spec.table}`
  );
  db.exec(`DROP TABLE ${spec.table}`);
  db.exec(`ALTER TABLE ${spec.table}__mu RENAME TO ${spec.table}`);
}

/**
 * Adjusts split lines so each set sums exactly to its parent transaction (the
 * parent total is the authoritative, bank-matching amount). The line with the
 * largest absolute net absorbs the remainder — the standard largest-remainder
 * fix. Remainders are sub-unit rounding noise the old whole-unit validation
 * let through.
 */
function reconcileSplits(db: MigrationDatabase): number {
  const mismatches = db.exec(`
    SELECT t.ID, (t.Inflow - t.Outflow) - SUM(s.Inflow - s.Outflow) AS delta
    FROM transactions t
    JOIN transaction_splits s ON s.TransactionID = t.ID
    GROUP BY t.ID
    HAVING delta != 0
  `);
  const rows = mismatches[0]?.values ?? [];
  for (const [txId, delta] of rows as [number, number][]) {
    const victim = db.exec(`
      SELECT ID, Inflow - Outflow AS net FROM transaction_splits
      WHERE TransactionID = ${txId}
      ORDER BY ABS(Inflow - Outflow) DESC, ID DESC LIMIT 1
    `);
    const [splitId, net] = victim[0].values[0] as [number, number];
    const newNet = net + delta;
    db.exec(`
      UPDATE transaction_splits
      SET Inflow = ${newNet >= 0 ? newNet : 0}, Outflow = ${newNet >= 0 ? 0 : -newNet}
      WHERE ID = ${splitId}
    `);
  }
  return rows.length;
}

/**
 * Recomputes RunningBalance/RunningBalanceOriginal and account balances with
 * the exact semantics of TransactionQueries.recalculateBalances: per account,
 * ordered by Date ASC, ID ASC; Balance = final original-currency balance,
 * BalanceConverted = final budget-currency balance.
 */
function recomputeBalances(db: MigrationDatabase): void {
  db.exec(`
    CREATE TEMP TABLE mig039_rb AS
    SELECT ID,
      SUM(Inflow - Outflow) OVER w AS rb,
      SUM(COALESCE(InflowOriginal, 0) - COALESCE(OutflowOriginal, 0)) OVER w AS rbo
    FROM transactions
    WINDOW w AS (PARTITION BY AccountID ORDER BY Date ASC, ID ASC ROWS UNBOUNDED PRECEDING)
  `);
  db.exec(`CREATE INDEX mig039_rb_id ON mig039_rb(ID)`);
  db.exec(`
    UPDATE transactions SET
      RunningBalance = (SELECT rb FROM mig039_rb WHERE mig039_rb.ID = transactions.ID),
      RunningBalanceOriginal = (SELECT rbo FROM mig039_rb WHERE mig039_rb.ID = transactions.ID)
  `);
  db.exec(`
    UPDATE accounts SET
      Balance = (
        SELECT SUM(COALESCE(t.InflowOriginal, 0) - COALESCE(t.OutflowOriginal, 0))
        FROM transactions t WHERE t.AccountID = accounts.ID
      ),
      BalanceConverted = (
        SELECT SUM(t.Inflow - t.Outflow)
        FROM transactions t WHERE t.AccountID = accounts.ID
      )
    WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.AccountID = accounts.ID)
  `);
  db.exec(`DROP TABLE mig039_rb`);
}

/** Money-bearing keys inside accounts.Metadata JSON (rates/terms are not money). */
const METADATA_MONEY_KEYS = ['debt_total', 'paid_so_far', 'min_payment_monthly'] as const;

/**
 * Money-bearing keys inside stored op JSON (mutation history undo/redo ops,
 * rule-run rollback metadata). Lowercased for case-insensitive matching.
 */
const OP_MONEY_KEYS = new Set([
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

/** DB money columns referenced by `updateColumn`-style ops ({columnName, newValue}). */
const OP_MONEY_COLUMNS = new Set(MONEY_COLUMNS.map(([, col]) => col.toLowerCase()));

/**
 * Recursively converts decimal money values in parsed op JSON to milliunits.
 * Handles both named amount keys and the {columnName, newValue} pattern where
 * newValue is only money when columnName names a money column.
 */
function convertOpValueMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convertOpValueMoney);
  if (value === null || typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const columnName = typeof obj.columnName === 'string' ? obj.columnName.toLowerCase() : null;
  // Rule condition {field: 'amount', value} / adjust action {type: 'amount.adjust_value', payload: {delta}}
  const fieldIsAmount = obj.field === 'amount';
  const isAmountDeltaAction = obj.type === 'amount.adjust_value';
  for (const [key, v] of Object.entries(obj)) {
    const isMoneyKey =
      OP_MONEY_KEYS.has(key.toLowerCase()) ||
      (key === 'newValue' && columnName !== null && OP_MONEY_COLUMNS.has(columnName)) ||
      (key === 'value' && fieldIsAmount) ||
      (key === 'delta' && isAmountDeltaAction);
    if (isMoneyKey && typeof v === 'number' && Number.isFinite(v)) {
      out[key] = Math.round(v * 1000);
    } else if (isAmountDeltaAction && key === 'payload' && v !== null && typeof v === 'object') {
      const payload = { ...(v as Record<string, unknown>) };
      if (typeof payload.delta === 'number' && Number.isFinite(payload.delta)) {
        payload.delta = Math.round(payload.delta * 1000);
      }
      out[key] = payload;
    } else {
      out[key] = convertOpValueMoney(v);
    }
  }
  return out;
}

/**
 * Converts stored op JSON columns: mutation history payload/undo/redo ops and
 * rule-run change records. Without this, undoing or rolling back a
 * pre-migration change would write decimal dollars into integer columns.
 * Unparseable JSON is nulled for undo/redo (safe: undo unavailable) and left
 * as-is for display-only columns.
 */
function convertStoredOpJson(db: MigrationDatabase): void {
  const convert = (raw: string | null): string | null | undefined => {
    if (raw == null || raw === '') return undefined;
    try {
      return JSON.stringify(convertOpValueMoney(JSON.parse(raw)));
    } catch {
      return null;
    }
  };
  const escape = (s: string) => s.replace(/'/g, "''");

  const history = db.exec(`SELECT ID, Payload, UndoOps, RedoOps FROM mutation_history`);
  for (const [id, payload, undoOps, redoOps] of (history[0]?.values ?? []) as [
    number,
    string | null,
    string | null,
    string | null,
  ][]) {
    const sets: string[] = [];
    const p = convert(payload);
    if (p !== undefined) sets.push(`Payload = ${p === null ? 'Payload' : `'${escape(p)}'`}`);
    const u = convert(undoOps);
    if (u !== undefined) sets.push(`UndoOps = ${u === null ? 'NULL' : `'${escape(u)}'`}`);
    const r = convert(redoOps);
    if (r !== undefined) sets.push(`RedoOps = ${r === null ? 'NULL' : `'${escape(r)}'`}`);
    if (sets.length > 0) db.exec(`UPDATE mutation_history SET ${sets.join(', ')} WHERE ID = ${id}`);
  }

  // Rule definitions: amount conditions ({field:'amount', value}) and amount
  // actions (amount.set {amount} / amount.adjust_value {delta}) hold money
  const rules = db.exec(`SELECT ID, ConditionsJSON, ActionsJSON FROM transaction_rules`);
  for (const [id, conditions, actions] of (rules[0]?.values ?? []) as [
    number,
    string | null,
    string | null,
  ][]) {
    const sets: string[] = [];
    const c = convert(conditions);
    if (c !== undefined && c !== null) sets.push(`ConditionsJSON = '${escape(c)}'`);
    const a = convert(actions);
    if (a !== undefined && a !== null) sets.push(`ActionsJSON = '${escape(a)}'`);
    if (sets.length > 0)
      db.exec(`UPDATE transaction_rules SET ${sets.join(', ')} WHERE ID = ${id}`);
  }

  const changes = db.exec(
    `SELECT ID, Field, OldValue, NewValue, Metadata FROM transaction_rule_run_changes`
  );
  for (const [id, field, oldValue, newValue, metadata] of (changes[0]?.values ?? []) as [
    number,
    string | null,
    string | null,
    string | null,
    string | null,
  ][]) {
    const sets: string[] = [];
    // OldValue/NewValue are JSON scalars; money only when Field names a money column
    const fieldIsMoney = field !== null && OP_MONEY_COLUMNS.has(field.toLowerCase());
    for (const [col, raw] of [
      ['OldValue', oldValue],
      ['NewValue', newValue],
    ] as const) {
      if (!fieldIsMoney || raw == null) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) sets.push(`${col} = '${Math.round(n * 1000)}'`);
    }
    const m = convert(metadata);
    if (m !== undefined && m !== null) sets.push(`Metadata = '${escape(m)}'`);
    if (sets.length > 0) {
      db.exec(`UPDATE transaction_rule_run_changes SET ${sets.join(', ')} WHERE ID = ${id}`);
    }
  }
}

/** Converts decimal money values inside accounts.Metadata JSON to milliunits. */
function convertMetadataMoney(db: MigrationDatabase): void {
  const rows = db.exec(
    `SELECT ID, Metadata FROM accounts WHERE Metadata IS NOT NULL AND Metadata != ''`
  );
  for (const [id, raw] of (rows[0]?.values ?? []) as [number, string][]) {
    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(raw);
    } catch {
      continue; // unparseable metadata is left as-is
    }
    let changed = false;
    for (const key of METADATA_MONEY_KEYS) {
      const value = metadata[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        metadata[key] = Math.round(value * 1000);
        changed = true;
      }
    }
    if (changed) {
      const escaped = JSON.stringify(metadata).replace(/'/g, "''");
      db.exec(`UPDATE accounts SET Metadata = '${escaped}' WHERE ID = ${id}`);
    }
  }
}

export const migration039: Migration = {
  version: 39,
  description: 'Convert money columns from REAL to INTEGER milliunits',
  up: (db: MigrationDatabase) => {
    assertForeignKeysOff(db);

    // Indexes on rebuilt tables are dropped with them — capture and replay.
    const savedIndexes = db.exec(`
      SELECT sql FROM sqlite_master
      WHERE type = 'index' AND sql IS NOT NULL
        AND tbl_name IN (${REBUILDS.map((r) => `'${r.table}'`).join(', ')})
    `);

    for (const spec of REBUILDS) {
      rebuildTable(db, spec);
    }

    for (const [sql] of savedIndexes[0]?.values ?? []) {
      db.exec(sql as string);
    }

    const repaired = reconcileSplits(db);
    if (repaired > 0) {
      debugLog(`[Migration 39] Reconciled ${repaired} split sets to their parent totals`);
    }
    recomputeBalances(db);
    convertMetadataMoney(db);
    convertStoredOpJson(db);
  },
  verify: (db: MigrationDatabase) => {
    try {
      for (const [table, column] of MONEY_COLUMNS) {
        const res = db.exec(
          `SELECT COUNT(*) FROM ${table} WHERE ${column} IS NOT NULL AND typeof(${column}) != 'integer'`
        );
        if ((res[0]?.values[0]?.[0] as number) !== 0) {
          debugLog(`[Migration 39] Non-integer values remain in ${table}.${column}`);
          return false;
        }
      }
      const splitCheck = db.exec(`
        SELECT COUNT(*) FROM (
          SELECT t.ID FROM transactions t
          JOIN transaction_splits s ON s.TransactionID = t.ID
          GROUP BY t.ID
          HAVING (t.Inflow - t.Outflow) != SUM(s.Inflow - s.Outflow)
        )
      `);
      if ((splitCheck[0]?.values[0]?.[0] as number) !== 0) {
        debugLog('[Migration 39] Split sets do not reconcile to parents');
        return false;
      }
      return true;
    } catch (error) {
      debugLog('[Migration 39] verification failed', { error });
      return false;
    }
  },
};
