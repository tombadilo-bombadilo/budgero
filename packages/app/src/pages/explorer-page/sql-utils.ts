/**
 * SQL query parsing and helper utilities for the Explorer page
 */

import { resultsToCsv } from '@shared/lib/sql/csv';
import { formatSQL } from '@shared/lib/sql/format';
import { isReadOnlyQuery } from '@shared/lib/sql/read-only';

export { formatSQL };

const MAX_DISPLAY_ROWS = 10000;

/**
 * Determines if a query is a SELECT-type query that returns results
 */
export function isSelectQuery(query: string): boolean {
  return isReadOnlyQuery(query);
}

/**
 * Converts query results to CSV format
 */
export function resultsToCSV(columns: string[], rows: unknown[][]): string {
  return resultsToCsv(columns, rows, { emptyValue: (cell) => String(cell || '') });
}

/**
 * Common SQL queries for quick access
 */
export const COMMON_QUERIES = [
  {
    name: 'List all tables',
    query: `SELECT
      table_name AS name,
      table_type
    FROM information_schema.tables
    WHERE table_schema = 'main' AND table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY table_type DESC, table_name;`,
  },
  {
    name: 'Analytics view columns',
    query: `SELECT
      column_name AS name,
      data_type AS type
    FROM information_schema.columns
    WHERE table_schema = 'main' AND lower(table_name) = 'transactions_analytics'
    ORDER BY ordinal_position;`,
  },
  {
    name: 'Transactions analytics preview',
    query: `SELECT
      transaction_id,
      date,
      account_name,
      payee_name,
      category_group_name,
      category_name,
      label_name,
      inflow,
      outflow
    FROM transactions_analytics
    ORDER BY TRY_CAST(date AS DATE) DESC, transaction_id DESC
    LIMIT 20;`,
  },
  {
    name: 'Database statistics',
    query: `SELECT
      (SELECT COUNT(*) FROM budgets) AS Budgets,
      (SELECT COUNT(*) FROM accounts) AS Accounts,
      (SELECT COUNT(*) FROM transactions) AS Transactions,
      (SELECT COUNT(*) FROM categories) AS Categories,
      (SELECT COUNT(*) FROM transactions_analytics) AS AnalyticsRows;`,
  },
  {
    name: 'Recent transactions',
    query: `SELECT
      transaction_id,
      date,
      account_name,
      payee_name,
      category_group_name,
      category_name,
      label_name,
      memo,
      inflow,
      outflow,
      (outflow - inflow) AS net_outflow
    FROM transactions_analytics
    ORDER BY TRY_CAST(date AS DATE) DESC, transaction_id DESC
    LIMIT 25;`,
  },
  {
    name: 'Top category spending (30d)',
    query: `SELECT
      category_group_name,
      category_name,
      ROUND(SUM(outflow), 2) AS total_outflow,
      COUNT(*) AS txn_count
    FROM transactions_analytics
    WHERE TRY_CAST(date AS DATE) >= CURRENT_DATE - INTERVAL 30 DAY
      AND outflow > 0
      AND COALESCE(category_group_name, '') NOT IN ('Transfers', 'Income')
    GROUP BY category_group_name, category_name
    ORDER BY total_outflow DESC
    LIMIT 20;`,
  },
  {
    name: 'Account balances',
    query: `SELECT
      a."Name" AS account_name,
      a."Balance" AS balance,
      a."Currency" AS currency,
      b."Name" AS budget_name
    FROM accounts a
    JOIN budgets b ON a."BudgetID" = b."ID"
    ORDER BY a."Balance" DESC;`,
  },
  {
    name: 'Top payees by spending (30d)',
    query: `SELECT
      COALESCE(payee_name, '(No payee)') AS payee,
      ROUND(SUM(outflow), 2) AS total_outflow,
      COUNT(*) AS txn_count
    FROM transactions_analytics
    WHERE TRY_CAST(date AS DATE) >= CURRENT_DATE - INTERVAL 30 DAY
      AND outflow > 0
      AND COALESCE(category_group_name, '') NOT IN ('Transfers', 'Income')
    GROUP BY COALESCE(payee_name, '(No payee)')
    ORDER BY total_outflow DESC
    LIMIT 20;`,
  },
  {
    name: 'Spending by label (90d)',
    query: `SELECT
      COALESCE(label_name, '(Unlabeled)') AS label,
      ROUND(SUM(outflow), 2) AS total_outflow,
      COUNT(*) AS txn_count
    FROM transactions_analytics
    WHERE TRY_CAST(date AS DATE) >= CURRENT_DATE - INTERVAL 90 DAY
      AND outflow > 0
      AND COALESCE(category_group_name, '') NOT IN ('Transfers', 'Income')
    GROUP BY COALESCE(label_name, '(Unlabeled)')
    ORDER BY total_outflow DESC;`,
  },
  {
    name: 'Monthly inflow vs outflow (12m)',
    query: `SELECT
      month,
      ROUND(SUM(inflow), 2) AS total_inflow,
      ROUND(SUM(outflow), 2) AS total_outflow,
      ROUND(SUM(inflow - outflow), 2) AS net_cashflow
    FROM transactions_analytics
    WHERE TRY_CAST(month AS DATE) >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL 11 MONTH
    GROUP BY month
    ORDER BY month;`,
  },
  {
    name: 'Current month by category group',
    query: `SELECT
      category_group_name,
      ROUND(SUM(outflow), 2) AS total_outflow,
      ROUND(SUM(inflow), 2) AS total_inflow,
      COUNT(*) AS txn_count
    FROM transactions_analytics
    WHERE DATE_TRUNC('month', TRY_CAST(date AS DATE)) = DATE_TRUNC('month', CURRENT_DATE)
      AND COALESCE(category_group_name, '') NOT IN ('Transfers')
    GROUP BY category_group_name
    ORDER BY total_outflow DESC;`,
  },
  {
    name: 'Split transactions overview',
    query: `SELECT
      transaction_id,
      date,
      account_name,
      payee_name,
      category_name,
      split_count,
      split_inflow,
      split_outflow,
      memo
    FROM transactions_analytics
    WHERE has_splits = TRUE
    ORDER BY split_count DESC, TRY_CAST(date AS DATE) DESC
    LIMIT 25;`,
  },
] as const;

export const MAX_ROWS = MAX_DISPLAY_ROWS;
