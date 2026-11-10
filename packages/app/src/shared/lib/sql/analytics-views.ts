/**
 * The curated `transactions_analytics` view the reporting engine registers on
 * every DuckDB snapshot. Kept in its own module (no wasm imports) so tests can
 * run report SQL against it with the node DuckDB build.
 */
/** DuckDB column type for a SQLite declared type (the snapshot copies every table). */
export function mapSQLiteTypeToDuckDb(type: string): string {
  const normalizedType = String(type ?? '')
    .trim()
    .toUpperCase();
  if (!normalizedType) return 'VARCHAR';
  if (normalizedType.includes('INT')) return 'BIGINT';
  if (
    normalizedType.includes('REAL') ||
    normalizedType.includes('FLOA') ||
    normalizedType.includes('DOUB') ||
    normalizedType.includes('NUM') ||
    normalizedType.includes('DEC')
  ) {
    return 'DOUBLE';
  }
  // SQLite stores booleans as 0/1 integers and the analytics views query them
  // that way (e.g. `account_on_budget = 1`); keep them numeric.
  if (normalizedType.includes('BOOL')) return 'BIGINT';
  if (normalizedType.includes('BLOB')) return 'BLOB';
  return 'VARCHAR';
}

export const TRANSACTIONS_ANALYTICS_VIEW_SQL = `
    CREATE OR REPLACE VIEW transactions_analytics AS
    WITH split_stats AS (
      SELECT
        "TransactionID" AS transaction_id,
        COUNT(*) AS split_count,
        -- Stored amounts are integer milliunits; analytics keeps exact
        -- DECIMAL currency units so saved reports and AI SQL stay decimal
        CAST(COALESCE(SUM("InflowConverted"), 0) / 1000.0 AS DECIMAL(18, 3)) AS split_inflow,
        CAST(COALESCE(SUM("OutflowConverted"), 0) / 1000.0 AS DECIMAL(18, 3)) AS split_outflow
      FROM transaction_splits
      GROUP BY "TransactionID"
    ),
    tx_normalized AS (
      SELECT
        t.*,
        COALESCE(
          TRY_CAST(t."Date" AS DATE),
          TRY_CAST(to_timestamp(TRY_CAST(t."Date" AS DOUBLE) / 1000) AS DATE),
          TRY_CAST(to_timestamp(TRY_CAST(t."Date" AS DOUBLE)) AS DATE),
          TRY_CAST(SUBSTR(CAST(t."Date" AS VARCHAR), 1, 10) AS DATE)
        ) AS parsed_date
      FROM transactions t
    )
    SELECT
      t."ID" AS transaction_id,
      t."CategoryID" AS category_id,
      t."AccountID" AS account_id,
      t."LabelID" AS label_id,
      t."BudgetID" AS budget_id,
      t."TransferID" AS transfer_id,
      t."Payee" AS payee,
      strftime(t.parsed_date, '%Y-%m-%d') AS date,
      strftime(DATE_TRUNC('week', t.parsed_date), '%Y-%m-%d') AS week,
      strftime(DATE_TRUNC('month', t.parsed_date), '%Y-%m-%d') AS month,
      strftime(DATE_TRUNC('quarter', t.parsed_date), '%Y-%m-%d') AS quarter,
      strftime(DATE_TRUNC('year', t.parsed_date), '%Y-%m-%d') AS year,
      t."Memo" AS memo,
      t."Reconciled" AS reconciled,
      t."Cleared" AS cleared,
      CAST(t."InflowConverted" / 1000.0 AS DECIMAL(18, 3)) AS inflow,
      CAST(t."OutflowConverted" / 1000.0 AS DECIMAL(18, 3)) AS outflow,
      CAST(t."InflowNative" / 1000.0 AS DECIMAL(18, 3)) AS inflow_original,
      CAST(t."OutflowNative" / 1000.0 AS DECIMAL(18, 3)) AS outflow_original,
      CAST(t."RunningBalanceConverted" / 1000.0 AS DECIMAL(18, 3)) AS running_balance,
      CAST(t."RunningBalanceNative" / 1000.0 AS DECIMAL(18, 3)) AS running_balance_original,
      t."ExchangeRate" AS exchange_rate,
      t."ExchangeRateOverride" AS exchange_rate_override,
      t."ConversionPending" AS conversion_pending,
      a."Name" AS account_name,
      a."Type" AS account_type,
      a."Currency" AS account_currency,
      a."OnBudget" AS account_on_budget,
      a."ReconciledAt" AS account_reconciled_at,
      b."Name" AS budget_name,
      b."DisplayCurrency" AS budget_display_currency,
      c."Name" AS category_name,
      c."Note" AS category_note,
      c."CategoryGroupID" AS category_group_id,
      c."Position" AS category_position,
      cg."Name" AS category_group_name,
      cg."Note" AS category_group_note,
      cg."Position" AS category_group_position,
      l."Name" AS label_name,
      l."Color" AS label_color,
      l."CreatedAt" AS label_created_at,
      COALESCE(NULLIF(TRIM(t."Payee"), ''), p."Name") AS payee_name,
      p."ID" AS payee_id,
      p."Metadata" AS payee_metadata,
      p."CreatedAt" AS payee_created_at,
      p."UpdatedAt" AS payee_updated_at,
      COALESCE(ss.split_count, 0) AS split_count,
      COALESCE(ss.split_inflow, 0) AS split_inflow,
      COALESCE(ss.split_outflow, 0) AS split_outflow,
      COALESCE(ss.split_count, 0) > 0 AS has_splits
    FROM tx_normalized t
    LEFT JOIN accounts a
      ON a."ID" = t."AccountID"
    LEFT JOIN budgets b
      ON b."ID" = t."BudgetID"
    LEFT JOIN categories c
      ON c."ID" = t."CategoryID"
    LEFT JOIN category_groups cg
      ON cg."ID" = c."CategoryGroupID"
    LEFT JOIN labels l
      ON l."ID" = t."LabelID" AND l."BudgetID" = t."BudgetID"
    LEFT JOIN payees p
      ON p."BudgetID" = t."BudgetID" AND LOWER(TRIM(p."Name")) = LOWER(TRIM(t."Payee"))
    LEFT JOIN split_stats ss
      ON ss.transaction_id = t."ID"
`;

/**
 * `account_balances_daily`: one row per account per day, from the account's
 * first transaction to today (CURRENT_DATE), balances carried forward over
 * days without transactions. `balance` is in the budget currency: every
 * transaction up to that day at its recorded rate plus the revaluation
 * journal (account_revaluations) up to that day, so today's row equals the
 * account's stored balance minus future-dated transactions (the Accounts
 * page). Net worth on a day = SUM(balance); liabilities are credit, loan and
 * mortgage accounts (is_liability).
 */
export const ACCOUNT_BALANCES_DAILY_VIEW_SQL = `
    CREATE OR REPLACE VIEW account_balances_daily AS
    WITH moves AS (
      SELECT account_id, TRY_CAST(date AS DATE) AS day, inflow - outflow AS flow,
        COALESCE(inflow_original, inflow) - COALESCE(outflow_original, outflow) AS flow_native
      FROM transactions_analytics
      UNION ALL
      SELECT "AccountID", TRY_CAST("Date" AS DATE),
        CAST("DeltaConverted" / 1000.0 AS DECIMAL(18, 3)), CAST(0 AS DECIMAL(18, 3))
      FROM account_revaluations
    ),
    flows AS (
      SELECT account_id, day, SUM(flow) AS flow, SUM(flow_native) AS flow_native
      FROM moves
      WHERE day IS NOT NULL AND day <= CURRENT_DATE
      GROUP BY 1, 2
    ),
    days AS (
      SELECT a."ID" AS account_id,
        CAST(UNNEST(generate_series(
          CAST(COALESCE(first.day, CURRENT_DATE) AS TIMESTAMP),
          CAST(CURRENT_DATE AS TIMESTAMP),
          INTERVAL 1 DAY
        )) AS DATE) AS day
      FROM accounts a
      LEFT JOIN (SELECT account_id, MIN(day) AS day FROM flows GROUP BY 1) first
        ON first.account_id = a."ID"
    )
    SELECT
      a."BudgetID" AS budget_id,
      a."ID" AS account_id,
      a."Name" AS account_name,
      a."Type" AS account_type,
      a."Currency" AS account_currency,
      COALESCE(CAST(a."OnBudget" AS INTEGER), 0) AS account_on_budget,
      COALESCE(CAST(a."Archived" AS INTEGER), 0) AS account_closed,
      LOWER(COALESCE(a."Type", '')) IN ('credit', 'loan', 'mortgage') AS is_liability,
      strftime(d.day, '%Y-%m-%d') AS date,
      CAST(SUM(COALESCE(f.flow, 0)) OVER w AS DECIMAL(18, 3)) AS balance,
      CAST(SUM(COALESCE(f.flow_native, 0)) OVER w AS DECIMAL(18, 3)) AS balance_original,
      CAST(COALESCE(f.flow, 0) AS DECIMAL(18, 3)) AS change
    FROM days d
    JOIN accounts a ON a."ID" = d.account_id
    LEFT JOIN flows f ON f.account_id = d.account_id AND f.day = d.day
    WINDOW w AS (PARTITION BY d.account_id ORDER BY d.day ROWS UNBOUNDED PRECEDING)
`;

/**
 * `payee_summary`: one row per budget and payee (names compared trimmed and
 * case-insensitively) over every transaction line, split lines counted under
 * their own payee; transfers and lines without a payee are left out.
 */
export const PAYEE_SUMMARY_VIEW_SQL = `
    CREATE OR REPLACE VIEW payee_summary AS
    WITH lines AS (
      SELECT t.budget_id, t.transaction_id, t.date, t.payee_name, t.category_id, t.category_name,
        t.inflow, t.outflow,
        COALESCE(t.transfer_id, '') <> '' OR COALESCE(t.category_group_name, '') = 'Transfers' AS is_transfer
      FROM transactions_analytics t
      WHERE NOT t.has_splits
      UNION ALL
      SELECT t.budget_id, t.transaction_id, t.date,
        COALESCE(NULLIF(TRIM(s."Payee"), ''), t.payee_name),
        s."CategoryID", c."Name",
        CAST(COALESCE(s."InflowConverted", 0) / 1000.0 AS DECIMAL(18, 3)),
        CAST(COALESCE(s."OutflowConverted", 0) / 1000.0 AS DECIMAL(18, 3)),
        COALESCE(t.transfer_id, '') <> '' OR COALESCE(s."TransferAccountID", 0) <> 0
          OR COALESCE(cg."Name", '') = 'Transfers'
      FROM transactions_analytics t
      JOIN transaction_splits s ON s."TransactionID" = t.transaction_id
      LEFT JOIN categories c ON c."ID" = s."CategoryID"
      LEFT JOIN category_groups cg ON cg."ID" = c."CategoryGroupID"
      WHERE t.has_splits
    ),
    kept AS (
      SELECT *, LOWER(TRIM(payee_name)) AS payee_key
      FROM lines
      WHERE NOT is_transfer AND NULLIF(TRIM(payee_name), '') IS NOT NULL
    ),
    top AS (
      SELECT budget_id, payee_key, arg_max(category_name, uses) AS top_category
      FROM (
        SELECT budget_id, payee_key, category_id, MIN(category_name) AS category_name,
          COUNT(*) * 100000000 + COALESCE(MAX(DATE_DIFF('day', DATE '1970-01-01', TRY_CAST(date AS DATE))), 0) AS uses
        FROM kept
        GROUP BY 1, 2, 3
      ) counted
      GROUP BY 1, 2
    )
    SELECT
      k.budget_id,
      MIN(TRIM(k.payee_name)) AS payee_name,
      COUNT(DISTINCT k.transaction_id) AS transaction_count,
      SUM(k.inflow) AS inflow,
      SUM(k.outflow) AS outflow,
      SUM(k.inflow - k.outflow) AS total,
      CAST(ROUND(SUM(k.inflow - k.outflow) / COUNT(DISTINCT k.transaction_id), 2) AS DECIMAL(18, 3)) AS average_amount,
      MIN(k.date) AS first_seen,
      MAX(k.date) AS last_seen,
      MIN(t.top_category) AS top_category
    FROM kept k
    LEFT JOIN top t ON t.budget_id = k.budget_id AND t.payee_key = k.payee_key
    GROUP BY k.budget_id, k.payee_key
`;

/** Every prebuilt view, in creation order (later views read earlier ones). */
export const REPORTING_VIEWS_SQL = [
  TRANSACTIONS_ANALYTICS_VIEW_SQL,
  ACCOUNT_BALANCES_DAILY_VIEW_SQL,
  PAYEE_SUMMARY_VIEW_SQL,
];
