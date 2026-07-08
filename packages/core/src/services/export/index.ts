import type { ServiceManager } from '../service-manager.js';
import { allRows } from '../../database/sql.js';
import { MONEY_COLUMNS_BY_TABLE } from '../../database/money-columns.js';

/** CSV speaks decimal currency: convert integer-milliunit columns back. */
function milliColumnsToDecimal(
  rows: Record<string, unknown>[],
  table: string
): Record<string, unknown>[] {
  const moneyCols = MONEY_COLUMNS_BY_TABLE[table];
  if (!moneyCols || rows.length === 0) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const col of moneyCols) {
      const v = out[col];
      if (typeof v === 'number') out[col] = v / 1000;
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
      csvFiles['accounts.csv'] = arrayToCSV(milliColumnsToDecimal(accounts, 'accounts'));

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
        milliColumnsToDecimal(transactions, 'transactions')
      );

      const assignments = allRows<Record<string, unknown>>(
        db,
        'SELECT * FROM assignments ORDER BY id'
      );
      csvFiles['assignments.csv'] = arrayToCSV(milliColumnsToDecimal(assignments, 'assignments'));

      const goals = services.goals.getAllGoals();

      csvFiles['goals.csv'] = arrayToCSV(
        milliColumnsToDecimal(goals as unknown as Record<string, unknown>[], 'goals')
      );

      return csvFiles;
    } catch (error) {
      throw new Error(
        `Failed to export CSV data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
