import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

/**
 * Goal timeframes: a category's goal becomes a chain of rows, each applying
 * from its EffectiveFrom month (YYYY-MM) until the next row starts or its
 * EffectiveTo month (inclusive) passes. StartDate keeps its old meaning (the
 * anchor of target-date and repeating cycles); it is not the timeframe.
 *
 * SQLite can't drop the UNIQUE on CategoryID in place, so the table is
 * rebuilt under the same IDs (the runner suspends foreign keys for the whole
 * run, as for migrations 039 and 043). Every existing goal becomes the only
 * timeframe of its category, starting in its StartDate's month. The earliest
 * timeframe applies back to the start of the budget and an open-ended one
 * forever, so every month keeps the goal it had.
 *
 * Rows inserted without EffectiveFrom (an older build's undo payload, which
 * doesn't know the column) get their StartDate's month from a trigger: the
 * same value this migration derives, so every device stores the same row.
 */
const GOAL_COLUMNS = [
  'ID',
  'Type',
  'CategoryID',
  'Target',
  'StartDate',
  'TargetDate',
  'Purpose',
  'Recurring',
  'CycleMonths',
];

/** SQL twin of effectiveFromForStartDate (services/goals/timeframes.ts). */
const EFFECTIVE_FROM_FOR_START_DATE = `CASE
  WHEN StartDate GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]*' THEN substr(StartDate, 1, 7)
  ELSE '1970-01'
END`;

export const migration081: Migration = {
  version: 81,
  description: 'Goal timeframes: several goals per category, each for a range of months',
  up: (db: MigrationDatabase) => {
    // Triggers (safe-money guards) and indexes go with the dropped table.
    const saved = db.exec(`
      SELECT type, name, sql FROM sqlite_master
      WHERE tbl_name = 'goals' AND sql IS NOT NULL AND type IN ('index', 'trigger')
    `);

    db.exec(`
      CREATE TABLE goals__tf (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        Type          TEXT NOT NULL,
        CategoryID    INTEGER NOT NULL,
        Target        INTEGER NOT NULL,
        StartDate     TEXT NOT NULL,
        TargetDate    TEXT NOT NULL DEFAULT '1970-01-01',
        Purpose       TEXT NOT NULL DEFAULT 'spending',
        Recurring     INTEGER NOT NULL DEFAULT 0,
        CycleMonths   INTEGER NULL,
        EffectiveFrom TEXT NULL,
        EffectiveTo   TEXT NULL,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    db.exec(`
      INSERT INTO goals__tf (${GOAL_COLUMNS.join(', ')}, EffectiveFrom, EffectiveTo)
      SELECT ${GOAL_COLUMNS.join(', ')}, ${EFFECTIVE_FROM_FOR_START_DATE}, NULL FROM goals
    `);
    // The AUTOINCREMENT counter moves with the rows only up to MAX(ID); keep
    // the old one so IDs of deleted goals are never handed out again.
    const seq = db.exec(`SELECT seq FROM sqlite_sequence WHERE name = 'goals'`);
    const oldSeq = seq[0]?.values[0]?.[0];
    db.exec(`DROP TABLE goals`);
    db.exec(`ALTER TABLE goals__tf RENAME TO goals`);
    if (typeof oldSeq === 'number') {
      db.exec(`DELETE FROM sqlite_sequence WHERE name = 'goals'`);
      db.exec(`INSERT INTO sqlite_sequence (name, seq) VALUES ('goals', ${Math.trunc(oldSeq)})`);
    }

    for (const [type, name, sql] of saved[0]?.values ?? []) {
      // The old single-column index is superseded by the composite one.
      if (type === 'index' && name === 'idx_goals_category_id') continue;
      db.exec(String(sql));
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_category_effective_from ON goals(CategoryID, EffectiveFrom)`
    );
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS goals_default_effective_from
      AFTER INSERT ON goals
      FOR EACH ROW WHEN NEW.EffectiveFrom IS NULL
      BEGIN
        UPDATE goals SET EffectiveFrom = ${EFFECTIVE_FROM_FOR_START_DATE.replace(/StartDate/g, 'NEW.StartDate')}
        WHERE ID = NEW.ID;
      END
    `);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(goals)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      if (!['EffectiveFrom', 'EffectiveTo', 'CycleMonths'].every((c) => columns.includes(c))) {
        return false;
      }
      const trigger = db.exec(
        `SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'goals_default_effective_from'`
      );
      if (!trigger.length) return false;
      // No unique index on CategoryID alone may survive.
      const indexes = db.exec(`PRAGMA index_list(goals)`)?.[0]?.values ?? [];
      for (const [, name, unique] of indexes) {
        if (unique !== 1) continue;
        const cols = db.exec(`PRAGMA index_info('${String(name).replace(/'/g, "''")}')`);
        const names = cols?.[0]?.values?.map((row: unknown[]) => row[2]) ?? [];
        if (names.length === 1 && names[0] === 'CategoryID') return false;
      }
      return true;
    } catch (error) {
      debugLog('[Migration 81] verification failed', { error });
      return false;
    }
  },
};
