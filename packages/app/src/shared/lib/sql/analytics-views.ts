/**
 * The curated `transactions_analytics` view the reporting engine registers on
 * every DuckDB snapshot. Kept in its own module (no wasm imports) so tests can
 * run report SQL against it with the node DuckDB build.
 */
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
