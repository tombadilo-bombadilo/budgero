import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';
import {
  linesOutOfStep,
  type SplitLineAmounts,
} from '../../services/transactions/split-amounts.js';

const debugLog = createLogger('database:migrations');

type Row = Record<string, unknown>;

function rows(db: MigrationDatabase, sql: string): Row[] {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))
  );
}

const amount = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const sqlAmount = (value: number | null | undefined) =>
  value == null ? 'NULL' : String(Math.trunc(value));

/**
 * A budget currency change re-converted every transaction but left split
 * lines in the old currency (an RSD → USD change kept a 1,385.24 RSD line as
 * $1,385.24), so category activity, Available and Ready to Assign were wrong.
 * Rescale every split parent's lines back onto the parent, the same repair a
 * rate or account-currency re-conversion applies (resyncSplitLinesForAccounts).
 * Lines already in step are left untouched.
 */
export const migration084: Migration = {
  version: 84,
  description: 'Rescale split lines left in the old budget currency',
  up: (db: MigrationDatabase) => {
    const parents = rows(
      db,
      `SELECT ID, InflowConverted, OutflowConverted, InflowNative, OutflowNative
         FROM transactions t
        WHERE EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)`
    );
    let fixed = 0;
    for (const parent of parents) {
      const lines = rows(
        db,
        `SELECT ID, InflowConverted, OutflowConverted, InflowNative, OutflowNative
           FROM transaction_splits WHERE TransactionID = ${Number(parent.ID)}
          ORDER BY OrderIndex, ID`
      ).map((line): SplitLineAmounts => ({
        ID: Number(line.ID),
        InflowConverted: amount(line.InflowConverted) ?? 0,
        OutflowConverted: amount(line.OutflowConverted) ?? 0,
        InflowNative: amount(line.InflowNative),
        OutflowNative: amount(line.OutflowNative),
      }));
      const changed = linesOutOfStep(lines, {
        InflowConverted: amount(parent.InflowConverted) ?? 0,
        OutflowConverted: amount(parent.OutflowConverted) ?? 0,
        InflowNative: amount(parent.InflowNative),
        OutflowNative: amount(parent.OutflowNative),
      });
      for (const line of changed) {
        db.exec(
          `UPDATE transaction_splits
              SET InflowConverted = ${sqlAmount(line.InflowConverted)},
                  OutflowConverted = ${sqlAmount(line.OutflowConverted)},
                  InflowNative = ${sqlAmount(line.InflowNative)},
                  OutflowNative = ${sqlAmount(line.OutflowNative)}
            WHERE ID = ${line.ID}`
        );
      }
      if (changed.length > 0) fixed++;
    }
    debugLog('[Migration 84] split parents rescaled', { fixed });
  },
};
