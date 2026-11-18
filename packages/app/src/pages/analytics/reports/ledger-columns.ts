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
 * Rounded to `step` milliunits (see ledgerAverageStep); a result that rounds
 * to nothing is 0, never -0, so it can't show as a negative zero.
 */
export function ledgerAverage(total: number, monthCount: number, step = 1): number {
  if (monthCount <= 0) return 0;
  const average = Math.round(total / monthCount / step) * step;
  return average === 0 ? 0 : average;
}

/**
 * The smallest amount the display currency shows, in milliunits: 10 for two
 * decimals, 1000 for none. Finer currencies (crypto) keep whole milliunits.
 */
export function ledgerAverageStep(fractionDigits: number | undefined): number {
  if (fractionDigits === undefined || fractionDigits >= 3) return 1;
  return 10 ** (3 - Math.max(0, fractionDigits));
}
