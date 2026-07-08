/**
 * Canonical list of integer-milliunit money columns in the schema.
 * Single source of truth for migration 039 (conversion + verification) and
 * boundaries that must re-present milliunits as decimals (CSV export).
 */
export const MONEY_COLUMNS_BY_TABLE: Readonly<Record<string, readonly string[]>> = {
  accounts: ['Balance', 'BalanceConverted'],
  transactions: [
    'Inflow',
    'Outflow',
    'InflowOriginal',
    'OutflowOriginal',
    'RunningBalance',
    'RunningBalanceOriginal',
  ],
  transaction_splits: ['Inflow', 'Outflow', 'InflowOriginal', 'OutflowOriginal'],
  assignments: ['Amount'],
  goals: ['Target'],
  recurring_transactions: ['Amount'],
  warranties: ['Amount'],
};

/** Flat (table, column) pairs. */
export const MONEY_COLUMNS: readonly (readonly [string, string])[] = Object.entries(
  MONEY_COLUMNS_BY_TABLE
).flatMap(([table, cols]) => cols.map((c) => [table, c] as const));
