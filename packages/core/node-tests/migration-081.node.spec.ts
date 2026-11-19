import initSqlJs from 'sql.js';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MigrationRunner, migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';
import { effectiveFromForStartDate } from '../src/services/goals/timeframes.js';

type MigDb = ReturnType<typeof createMigrationDatabase>;

function all(db: MigDb, sql: string): unknown[][] {
  return db.exec(sql)[0]?.values ?? [];
}

/** A database at schema v80 (one goal per category) with goals of every shape. */
async function buildV80Fixture(): Promise<MigDb> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });
  const db = createMigrationDatabase(new SQL.Database());
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  for (const m of migrations.filter((x) => x.version <= 80)) {
    try {
      if (typeof m.up === 'function') m.up(db);
      else db.exec(m.up);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
    }
    db.exec(`INSERT OR REPLACE INTO schema_migrations (version) VALUES (${m.version})`);
  }
  db.exec(`
    INSERT INTO budgets (ID, Name, DisplayCurrency, SpaceID, BadgeIcon, NumberFormat) VALUES (1, 'B', 'USD', 's1', 'dollar', '1');
    INSERT INTO category_groups (ID, Name, BudgetID) VALUES (1, 'G', 1);
    INSERT INTO categories (ID, Name, CategoryGroupID, BudgetID) VALUES
      (1, 'Groceries', 1, 1), (2, 'Insurance', 1, 1), (3, 'Odd', 1, 1), (4, 'Iso', 1, 1), (5, 'Gone', 1, 1);
    INSERT INTO goals (ID, Type, CategoryID, Target, StartDate, TargetDate, Purpose, Recurring, CycleMonths)
    VALUES
      (3, 'monthly', 1, 200000, '2020-01-01', '', 'spending', 0, NULL),
      (7, 'target-date', 2, 600000, '2021-04-01', '2021-09-30', 'savings', 1, 6),
      (8, 'monthly-savings', 3, 1000, '', '1970-01-01', 'savings', 0, NULL),
      (9, 'yearly', 4, 5000, '2022-02-01T00:00:00.000Z', '2022-12-31', 'spending', 1, NULL),
      (12, 'monthly', 5, 10, '2023-01-01', '', 'spending', 0, NULL);
    DELETE FROM goals WHERE ID = 12;
  `);
  return db;
}

describe('migration 081: goal timeframes', () => {
  let db: MigDb;
  let before: unknown[][];

  beforeAll(async () => {
    db = await buildV80Fixture();
    before = all(
      db,
      `SELECT ID, Type, CategoryID, Target, StartDate, TargetDate, Purpose, Recurring, CycleMonths
       FROM goals ORDER BY ID`
    );
    new MigrationRunner(db).runMigrations();
  });

  it('keeps every goal under its ID with all its data', () => {
    expect(
      all(
        db,
        `SELECT ID, Type, CategoryID, Target, StartDate, TargetDate, Purpose, Recurring, CycleMonths
         FROM goals ORDER BY ID`
      )
    ).toEqual(before);
  });

  it('makes each goal one open-ended timeframe starting in its StartDate month', () => {
    expect(all(db, 'SELECT ID, EffectiveFrom, EffectiveTo FROM goals ORDER BY ID')).toEqual([
      [3, '2020-01', null],
      [7, '2021-04', null],
      [8, '1970-01', null],
      [9, '2022-02', null],
    ]);
  });

  it('derives the same start month as the service does for older payloads', () => {
    for (const [startDate, from] of all(db, 'SELECT StartDate, EffectiveFrom FROM goals')) {
      expect(effectiveFromForStartDate(startDate)).toBe(from);
    }
  });

  it('keeps the AUTOINCREMENT counter past deleted goals', () => {
    expect(all(db, "SELECT seq FROM sqlite_sequence WHERE name = 'goals'")).toEqual([[12]]);
  });

  it('allows several timeframes per category but not two starting in one month', () => {
    db.exec(`INSERT INTO goals (Type, CategoryID, Target, StartDate, EffectiveFrom)
             VALUES ('monthly', 1, 250000, '2021-06-01', '2021-06')`);
    expect(all(db, 'SELECT COUNT(*) FROM goals WHERE CategoryID = 1')).toEqual([[2]]);
    expect(() =>
      db.exec(`INSERT INTO goals (Type, CategoryID, Target, StartDate, EffectiveFrom)
               VALUES ('monthly', 1, 1, '2021-06-01', '2021-06')`)
    ).toThrow(/UNIQUE/);
    expect(all(db, "SELECT seq FROM sqlite_sequence WHERE name = 'goals'")).toEqual([[13]]);
  });

  it('keeps the money guards and the category index', () => {
    const triggers = all(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'goals' ORDER BY name"
    ).flat();
    expect(triggers).toEqual([
      'goals_default_effective_from',
      'guard_goals_safe_money_insert',
      'guard_goals_safe_money_update',
    ]);
    expect(() => db.exec(`UPDATE goals SET Target = 1.5 WHERE ID = 3`)).toThrow(/money value/);
    const indexes = all(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'goals' AND sql IS NOT NULL"
    ).flat();
    expect(indexes).toContain('idx_goals_category_effective_from');
  });

  it('fills EffectiveFrom from StartDate for rows inserted without it', () => {
    db.exec(`INSERT INTO goals (ID, Type, CategoryID, Target, StartDate)
             VALUES (50, 'monthly', 4, 1, '2024-09-30')`);
    expect(all(db, 'SELECT EffectiveFrom FROM goals WHERE ID = 50')).toEqual([['2024-09']]);
  });

  it('still cascades goal deletes from their category', () => {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('DELETE FROM categories WHERE ID = 2');
    expect(all(db, 'SELECT COUNT(*) FROM goals WHERE CategoryID = 2')).toEqual([[0]]);
  });
});
