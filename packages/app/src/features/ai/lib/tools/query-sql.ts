import { z } from 'zod';
import { getErrorMessage } from '@shared/lib/errors';
import type { ToolContext, ToolExecutionResult } from './types';

export const querySqlSchema = z.object({
  sql: z
    .string()
    .describe('A single read-only SQL statement (SELECT/WITH) for the DuckDB analytics engine.'),
});

export type QuerySqlArgs = z.infer<typeof querySqlSchema>;

/** Max rows pulled from DuckDB for a chat query (keeps token usage sane). */
const MAX_SQL_ROWS = 200;
/** Max rows actually rendered back into the model's context. */
const MAX_RENDER_ROWS = 100;

/**
 * Schema/usage doc injected into the tool description. budgetId is interpolated
 * so the model always scopes to the active budget.
 */
export function buildSqlToolDescription(budgetId: number, liveSchema = ''): string {
  const schemaBlock = liveSchema
    ? `\nLIVE SCHEMA (authoritative — the exact columns/tables in THIS database; prefer these over the names below):\n${liveSchema}\n`
    : '';
  return `Run a READ-ONLY SQL query (DuckDB dialect) against the analytics database and get rows back. Use this for open-ended analytical questions that the simpler tools can't answer (trends, multi-dimensional breakdowns, custom aggregations, "what if" slicing).
${schemaBlock}
RULES
- Read-only only: a single SELECT or WITH statement. No INSERT/UPDATE/DELETE/DDL.
- ALWAYS scope to the active budget: include "WHERE budget_id = ${budgetId}" (or "b.budget_id = ${budgetId}" / "t.budget_id = ${budgetId}" when joining).
- Use double quotes for identifiers only if needed; the snake_case columns below need no quoting.
- This is DuckDB SQL (Postgres-like). Use DuckDB functions (date_trunc, strftime, generate_series, ILIKE) — not SQLite/MySQL-only ones.
- date/week/month/quarter/year are TEXT, not DATE. Compare them against plain string literals ("t.date >= '2025-06-01'"), NEVER typed DATE literals ("DATE '2025-06-01'").
- In any JOIN or multi-CTE query, QUALIFY every column with its table/CTE alias (e.g. h.month, combined.total) to avoid "ambiguous reference" errors, and alias your aggregates.
- Use ONLY the transactions_analytics view. Do NOT SELECT from raw tables like accounts/categories/budgets — they use different (PascalCase) column names and querying them will fail. The view already contains account_name, account_currency, account_on_budget, category_name, etc.
- The "User's Budget Context" / ACCOUNTS summary in the system prompt is a human-readable digest, NOT the database schema. Column names there (e.g. balance_in_RSD, native_balance) are NOT SQL columns. ONLY the columns listed below / in LIVE SCHEMA exist.
- There is NO stored balance column. A balance = SUM(inflow - outflow). Current balance per on-budget account: SELECT account_name, SUM(inflow - outflow) AS balance FROM transactions_analytics WHERE budget_id = ${budgetId} AND account_on_budget = 1 GROUP BY account_name.

MAIN VIEW: transactions_analytics (one row per transaction)
- budget_id, transaction_id, date (TEXT 'YYYY-MM-DD'), week, month, quarter, year (each a truncated 'YYYY-MM-DD' string for GROUP BY)
- payee_name, memo, account_name, account_type, account_currency, account_on_budget (int 0/1)
- category_name, category_group_name, label_name
- inflow, outflow  → amounts in the budget's DISPLAY currency (budget_display_currency). Use these for totals.
- inflow_original, outflow_original → amounts in the account's NATIVE currency (account_currency). Do NOT sum across different currencies.
- transfer_id → identifies transfers (see below). account_on_budget (int: 1=on-budget, 0=off-budget).
- running_balance, reconciled, has_splits, split_count, split_inflow, split_outflow
Spending = SUM(outflow). Income = SUM(inflow). An expense row has outflow > 0; income has inflow > 0.

TRANSFERS (critical — they are NOT spending or income)
- A transfer moves money between the user's own accounts (e.g. savings → checking). Both legs exist as rows with an outflow/inflow, so they will inflate SUM(outflow)/SUM(inflow) if not excluded.
- Identify a transfer by transfer_id, NOT by category/payee text (do not regex on "Transfer"): a row is a transfer when COALESCE(transfer_id, '') <> ''.
- For any spending/income/velocity/average analysis, EXCLUDE transfers: add "AND COALESCE(transfer_id, '') = ''".

ON-BUDGET vs OFF-BUDGET ACCOUNTS
- account_on_budget is an integer flag: 1 = on-budget (checking/savings/cash — counts toward the budget and Ready to Assign), 0 = off-budget (tracking accounts: investments, loans, etc. — tracked for net worth but NOT budget spending/income).
- For budget spending analysis, restrict to on-budget: add "AND account_on_budget = 1". For net worth across everything, include all accounts.
- Starting/opening balance rows are setup entries, not spending — exclude with "AND COALESCE(payee_name,'') NOT ILIKE '%starting balance%'" when measuring spending.

OTHER TABLES (raw, PascalCase columns — run DESCRIBE <table> to inspect):
accounts, categories, category_groups, payees, budgets, labels, transaction_splits,
recurring_transactions, recurring_transaction_occurrences, currency_rates.

EXAMPLES (note the transfer + on-budget exclusions on spending queries)
- Top categories by spend this year:
  SELECT category_name, SUM(outflow) AS spent FROM transactions_analytics WHERE budget_id = ${budgetId} AND date >= '2026-01-01' AND COALESCE(transfer_id,'') = '' AND account_on_budget = 1 GROUP BY category_name ORDER BY spent DESC LIMIT 10
- Monthly spending trend (transfers excluded):
  SELECT month, SUM(outflow) AS spent FROM transactions_analytics WHERE budget_id = ${budgetId} AND COALESCE(transfer_id,'') = '' AND account_on_budget = 1 GROUP BY month ORDER BY month
- Average spend per transaction by week (excludes transfers + starting balances):
  SELECT week, COUNT(*) AS txns, SUM(outflow) AS spent, AVG(outflow) AS avg_txn FROM transactions_analytics WHERE budget_id = ${budgetId} AND outflow > 0 AND COALESCE(transfer_id,'') = '' AND account_on_budget = 1 GROUP BY week ORDER BY week
- Five biggest expenses (real spending only):
  SELECT date, payee_name, outflow FROM transactions_analytics WHERE budget_id = ${budgetId} AND outflow > 0 AND COALESCE(transfer_id,'') = '' ORDER BY outflow DESC LIMIT 5
- Total transferred between accounts (the thing to exclude above):
  SELECT SUM(outflow) AS transferred FROM transactions_analytics WHERE budget_id = ${budgetId} AND COALESCE(transfer_id,'') <> '' AND outflow > 0
- Balance per account (native + currency):
  SELECT account_name, account_currency, MAX(running_balance_original) AS native_balance FROM transactions_analytics WHERE budget_id = ${budgetId} GROUP BY account_name, account_currency

Results are capped at ${MAX_SQL_ROWS} rows — aggregate in SQL rather than pulling raw rows.`;
}

/**
 * Fetch the live analytics schema (DESCRIBE the main view + list tables) as a
 * compact one-line summary. Injected into the tool descriptions so the model
 * always sees the real columns/tables before writing SQL.
 */
export async function loadAnalyticsSchema(context: ToolContext): Promise<string> {
  if (!context.runReadOnlyQuery) return '';
  try {
    const cols = await context.runReadOnlyQuery('DESCRIBE transactions_analytics', {
      maxRows: 300,
    });
    const colNames = cols.rows.map((r) => String(r[0])).join(', ');
    if (!colNames) return '';
    let tables = '';
    try {
      const t = await context.runReadOnlyQuery('SHOW TABLES', { maxRows: 300 });
      tables = t.rows.map((r) => String(r[0])).join(', ');
    } catch {
      // SHOW TABLES is best-effort.
    }
    return `transactions_analytics(${colNames}).${tables ? ` Other tables: ${tables}.` : ''}`;
  } catch {
    return '';
  }
}

/**
 * On a failed query, fetch the live schema so the error we hand back to the
 * model is actionable — it can then fix column/table names in one shot.
 */
export async function getSchemaHint(context: ToolContext): Promise<string> {
  const schema = await loadAnalyticsSchema(context);
  if (!schema) return '';
  return `\n\nLive schema: ${schema}\nThere is no "months" table — use the month column (a 'YYYY-MM-DD' string) to bucket by month, or generate_series for a date spine.`;
}

function renderResult(columns: string[], rows: unknown[][]): string {
  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    const s = String(v);
    return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  };

  const shown = rows.slice(0, MAX_RENDER_ROWS);
  const lines = [columns.join(' | '), ...shown.map((r) => r.map(fmt).join(' | '))];
  if (rows.length > shown.length) {
    lines.push(`... (${rows.length - shown.length} more rows not shown)`);
  }
  return lines.join('\n');
}

export async function executeQuerySql(
  args: QuerySqlArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  if (!context.runReadOnlyQuery) {
    return {
      success: false,
      message: 'SQL querying is not available in this session.',
      error: 'runReadOnlyQuery not provided',
    };
  }

  try {
    const result = await context.runReadOnlyQuery(args.sql, { maxRows: MAX_SQL_ROWS });

    if (result.rowCount === 0) {
      return {
        success: true,
        message: 'Query ran successfully but returned no rows.',
        data: result,
      };
    }

    const table = renderResult(result.columns, result.rows);
    return {
      success: true,
      message: `Returned ${result.rowCount} row(s):\n${table}`,
      data: result,
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Unknown error');
    // Surface the DB error + live schema so the model can fix and retry in one shot.
    const schemaHint = await getSchemaHint(context);
    return {
      success: false,
      message: `SQL error: ${message}.${schemaHint}\nFix the query (read-only SELECT/WITH only) and try again.`,
      error: message,
    };
  }
}
