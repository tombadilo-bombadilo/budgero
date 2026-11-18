/**
 * Ledger report summary columns: Total and the per-month Average, shown after
 * the months (default) or right after Category. A personal display choice,
 * synced per user (synced state, user scope) under LEDGER_COLUMNS_KEY.
 */
export const LEDGER_COLUMNS_KEY = 'ledgerColumns';

export interface LedgerColumns {
  /** Show the Average column. */
  average: boolean;
  /** Put Total and Average before the months instead of after them. */
  summaryFirst: boolean;
}

export const DEFAULT_LEDGER_COLUMNS: LedgerColumns = { average: true, summaryFirst: false };

export function parseLedgerColumns(value: unknown): LedgerColumns {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_LEDGER_COLUMNS;
  const raw = value as Partial<Record<keyof LedgerColumns, unknown>>;
  return {
    average: typeof raw.average === 'boolean' ? raw.average : DEFAULT_LEDGER_COLUMNS.average,
    summaryFirst:
      typeof raw.summaryFirst === 'boolean'
        ? raw.summaryFirst
        : DEFAULT_LEDGER_COLUMNS.summaryFirst,
  };
}

/**
 * Average per month over every month the table shows, months without activity
 * counted as zero (the Spending report's "Avg / month" works the same way).
 * Rounded to whole milliunits.
 */
export function ledgerAverage(total: number, monthCount: number): number {
  return monthCount > 0 ? Math.round(total / monthCount) : 0;
}
