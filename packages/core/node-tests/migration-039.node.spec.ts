import initSqlJs from 'sql.js';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MigrationRunner, migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';
import { MONEY_COLUMNS } from '../src/database/migrations/039-convert-money-columns-to-integer-milliunits.js';
import { DatabaseNewerThanAppError } from '../src/types/index.js';

type MigDb = ReturnType<typeof createMigrationDatabase>;

function one(db: MigDb, sql: string): unknown {
  return db.exec(sql)[0]?.values[0]?.[0];
}

/** Builds a DB at schema v38 (pre-milliunits) seeded with float money data. */
async function buildV38Fixture(): Promise<MigDb> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });
  const db = createMigrationDatabase(new SQL.Database());
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  for (const m of migrations.filter((x) => x.version <= 38)) {
    try {
      if (typeof m.up === 'function') m.up(db);
      else db.exec(m.up);
    } catch (error) {
      // The real runner tolerates re-applied column adds the same way
      if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
    }
    db.exec(`INSERT OR REPLACE INTO schema_migrations (version) VALUES (${m.version})`);
  }

  // Seed float-era data. FKs are off on a raw sql.js DB, so parent budget /
  // category rows are unnecessary for what this test asserts.
  db.exec(`
    INSERT INTO accounts (ID, Name, Currency, Type, Balance, BalanceConverted, BudgetID)
    VALUES (1, 'Checking', 'EUR', 'checking', 149.79, NULL, 1);

    INSERT INTO transactions (ID, CategoryID, AccountID, Date, Inflow, Outflow,
      InflowOriginal, OutflowOriginal, RunningBalance, BudgetID, ExchangeRate)
    VALUES
      (1, 1, 1, '2026-01-01', 100.10, 0, 91.0, 0, 0, 1, 1.1),
      (2, 1, 1, '2026-01-02', 0, ${0.1 + 0.2}, NULL, NULL, 0, 1, NULL),
      (3, 1, 1, '2026-01-03', 0, 50.00, NULL, NULL, 0, 1, NULL);

    -- Splits off by 0.25 units: legal under the old whole-unit validation
    INSERT INTO transaction_splits (ID, TransactionID, Memo, Inflow, Outflow)
    VALUES (1, 3, 'a', 0, 25.10), (2, 3, 'b', 0, 24.65);

    INSERT INTO assignments (ID, CategoryID, Amount, Month, BudgetID)
    VALUES (1, 1, 250.505, '2026-01', 1);
    INSERT INTO goals (ID, Type, CategoryID, Target, StartDate)
    VALUES (1, 'monthly', 1, 1000.004, '2026-01-01');
    INSERT INTO recurring_transactions (ID, BudgetID, AccountID, Name, Amount, Direction, ScheduleJSON)
    VALUES (1, 1, 1, 'Netflix', 9.99, 'outflow', '{}');
    INSERT INTO warranties (ID, BudgetID, Name, ExpiresAt, Amount)
    VALUES (1, 1, 'Laptop', '2027-01-01', 299.99);
    INSERT INTO custom_currency_rates (FromCurrency, ToCurrency, Rate, StartDate, BudgetID)
    VALUES ('EUR', 'USD', 1.2345, '2026-01-01', 1);
  `);
  return db;
}

describe('migration 039: REAL money -> INTEGER milliunits', () => {
  let db: MigDb;
  let preIndexCount: number;

  beforeAll(async () => {
    db = await buildV38Fixture();
    preIndexCount = one(
      db,
      `SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
       AND tbl_name IN ('transactions','transaction_splits','accounts','assignments','goals','recurring_transactions','warranties')`
    ) as number;
    new MigrationRunner(db).runMigrations();
  });

  it('reaches the latest schema version', () => {
    const latest = Math.max(...migrations.map((m) => m.version));
    expect(latest).toBeGreaterThanOrEqual(39);
    expect(one(db, 'SELECT MAX(version) FROM schema_migrations')).toBe(latest);
  });

  it('stores every money value as round(old * 1000), typed INTEGER', () => {
    const expected: [string, number][] = [
      [`SELECT Inflow FROM transactions WHERE ID = 1`, 100100],
      [`SELECT InflowOriginal FROM transactions WHERE ID = 1`, 91000],
      [`SELECT Outflow FROM transactions WHERE ID = 2`, 300], // 0.1 + 0.2 artifact
      [`SELECT Outflow FROM transactions WHERE ID = 3`, 50000],
      [`SELECT Amount FROM assignments WHERE ID = 1`, 250505],
      [`SELECT Target FROM goals WHERE ID = 1`, 1000004],
      [`SELECT Amount FROM recurring_transactions WHERE ID = 1`, 9990],
      [`SELECT Amount FROM warranties WHERE ID = 1`, 299990],
    ];
    for (const [sql, value] of expected) {
      expect(one(db, sql), sql).toBe(value);
    }
    for (const [table, column] of MONEY_COLUMNS) {
      const bad = one(
        db,
        `SELECT COUNT(*) FROM ${table} WHERE ${column} IS NOT NULL AND typeof(${column}) != 'integer'`
      );
      expect(bad, `${table}.${column} should hold only integers`).toBe(0);
    }
  });

  it('leaves rate columns as REAL', () => {
    expect(one(db, `SELECT Rate FROM custom_currency_rates`)).toBeCloseTo(1.2345, 10);
    expect(one(db, `SELECT ExchangeRate FROM transactions WHERE ID = 1`)).toBeCloseTo(1.1, 10);
    expect(one(db, `SELECT typeof(ExchangeRate) FROM transactions WHERE ID = 1`)).toBe('real');
  });

  it('reconciles split sets exactly to their parent totals', () => {
    expect(
      one(db, `SELECT SUM(Inflow - Outflow) FROM transaction_splits WHERE TransactionID = 3`)
    ).toBe(-50000);
    // Largest line absorbed the -250 remainder
    expect(one(db, `SELECT Outflow FROM transaction_splits WHERE ID = 1`)).toBe(25350);
    expect(one(db, `SELECT Outflow FROM transaction_splits WHERE ID = 2`)).toBe(24650);
  });

  it('recomputes running balances and account balances in service order', () => {
    const rbs = db.exec(`SELECT RunningBalance FROM transactions ORDER BY Date ASC, ID ASC`);
    expect(rbs[0].values.map((v) => v[0])).toEqual([100100, 99800, 49800]);
    // Balance = final original-currency sum; BalanceConverted = final converted sum
    expect(one(db, `SELECT Balance FROM accounts WHERE ID = 1`)).toBe(91000);
    expect(one(db, `SELECT BalanceConverted FROM accounts WHERE ID = 1`)).toBe(49800);
  });

  it('preserves the generated Month column and explicit indexes', () => {
    expect(one(db, `SELECT Month FROM transactions WHERE ID = 1`)).toBe('2026-01');
    const postIndexCount = one(
      db,
      `SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
       AND tbl_name IN ('transactions','transaction_splits','accounts','assignments','goals','recurring_transactions','warranties')`
    );
    expect(postIndexCount).toBe(preIndexCount);
  });

  it('keeps AUTOINCREMENT working after the rebuild', () => {
    // The fixture intentionally has no budget/category parent rows; this test
    // is about sqlite_sequence surviving the rebuild, not FK integrity.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`INSERT INTO transactions (CategoryID, AccountID, Date, Inflow, Outflow, BudgetID)
             VALUES (1, 1, '2026-01-04', 1000, 0, 1)`);
    expect(one(db, `SELECT MAX(ID) FROM transactions`)).toBe(4);
  });

  it('refuses to run against a database from a newer app version', () => {
    const newerVersion = Math.max(...migrations.map((m) => m.version)) + 1;
    db.exec(`INSERT OR REPLACE INTO schema_migrations (version) VALUES (${newerVersion})`);
    expect(() => new MigrationRunner(db).runMigrations()).toThrow(DatabaseNewerThanAppError);
    db.exec(`DELETE FROM schema_migrations WHERE version = ${newerVersion}`);
  });
});
