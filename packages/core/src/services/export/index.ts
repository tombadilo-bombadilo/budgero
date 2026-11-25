import type { ServiceManager } from '../service-manager.js';
import { allRows } from '../../database/sql.js';
import { MONEY_COLUMNS_BY_TABLE } from '../../database/money-columns.js';
import { FIAT_SCALE, getCurrencyScale } from '../../currencies/index.js';
import { goalRow } from '../goals/types.js';

/** Native-side columns are stored at the account currency's scale; everything
 * else is budget-currency milliunits. */
const NATIVE_COLUMNS = new Set([
  'BalanceNative',
  'InflowNative',
  'OutflowNative',
  'RunningBalanceNative',
]);

/** CSV speaks decimal currency: convert integer scaled columns back.
 * `scaleForRow` supplies the storage scale of a row's native columns. */
function moneyColumnsToDecimal(
  rows: Record<string, unknown>[],
  table: string,
  scaleForRow?: (row: Record<string, unknown>) => number
): Record<string, unknown>[] {
  const moneyCols = MONEY_COLUMNS_BY_TABLE[table];
  if (!moneyCols || rows.length === 0) return rows;
  return rows.map((row) => {
    const out = { ...row };
    const nativeScale = scaleForRow ? scaleForRow(row) : FIAT_SCALE;
    for (const col of moneyCols) {
      const v = out[col];
      if (typeof v === 'number') {
        out[col] = v / (NATIVE_COLUMNS.has(col) ? nativeScale : FIAT_SCALE);
      }
    }
    return out;
  });
}

export interface ExportService {
  /**
   * Export the entire database as a SQLite file
   */
  exportDatabase(): Promise<Uint8Array>;

  /**
   * Export all data as CSV files
   */
  exportCSV(): Promise<Record<string, string>>;
}

export class DatabaseExportService implements ExportService {
  constructor(private serviceManager: ServiceManager) {}

  async exportDatabase(): Promise<Uint8Array> {
    const db = this.serviceManager.getDatabase();
    return db.backup();
  }

  async exportCSV(): Promise<Record<string, string>> {
    const csvFiles: Record<string, string> = {};

    const arrayToCSV = (data: Record<string, unknown>[]): string => {
      if (!data || data.length === 0) {
        return '';
      }

      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(','),
        ...data.map((row) =>
          headers
            .map((header) => {
              const value = row[header];
              if (value == null) {
                return '';
              }
              // Escape and quote values that contain commas, quotes, or newlines
              const stringValue = String(value);
              if (
                stringValue.includes(',') ||
                stringValue.includes('"') ||
                stringValue.includes('\n')
              ) {
                return `"${stringValue.replace(/"/g, '""')}"`;
              }
              return stringValue;
            })
            .join(',')
        ),
      ].join('\n');

      return csvContent;
    };

    try {
      const db = this.serviceManager.getDatabase();
      const services = this.serviceManager.getServices();

      const budgets = services.budgets.getAllBudgets();
      csvFiles['budgets.csv'] = arrayToCSV(budgets as unknown as Record<string, unknown>[]);

      const accounts = allRows<Record<string, unknown>>(db, 'SELECT * FROM accounts ORDER BY id');
      csvFiles['accounts.csv'] = arrayToCSV(
        moneyColumnsToDecimal(accounts, 'accounts', (row) =>
          getCurrencyScale(String(row.Currency ?? ''))
        )
      );
      const accountScaleById = new Map<unknown, number>(
        accounts.map((row) => [row.ID, getCurrencyScale(String(row.Currency ?? ''))])
      );

      const categories = allRows<Record<string, unknown>>(
        db,
        'SELECT * FROM categories ORDER BY id'
      );
      csvFiles['categories.csv'] = arrayToCSV(categories);

      const categoryGroups = allRows<Record<string, unknown>>(
        db,
        'SELECT * FROM category_groups ORDER BY id'
      );
      csvFiles['category_groups.csv'] = arrayToCSV(categoryGroups);

      const transactions = allRows<Record<string, unknown>>(
        db,
        'SELECT * FROM transactions ORDER BY id'
      );
      csvFiles['transactions.csv'] = arrayToCSV(
        moneyColumnsToDecimal(
          transactions,
          'transactions',
          (row) => accountScaleById.get(row.AccountID) ?? FIAT_SCALE
        )
      );

      const assignments = allRows<Record<string, unknown>>(
        db,
        'SELECT * FROM assignments ORDER BY id'
      );
      csvFiles['assignments.csv'] = arrayToCSV(moneyColumnsToDecimal(assignments, 'assignments'));

      // Stored columns only (no computed budget-currency conversions).
      const goals = services.goals.getAllGoals().map(goalRow);

      csvFiles['goals.csv'] = arrayToCSV(
        moneyColumnsToDecimal(goals as unknown as Record<string, unknown>[], 'goals')
      );

      return csvFiles;
    } catch (error) {
      throw new Error(
        `Failed to export CSV data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
