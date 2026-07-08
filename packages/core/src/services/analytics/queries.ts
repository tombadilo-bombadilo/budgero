import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows } from '../../database/sql.js';
import { PROJECTION_RATE_SQL } from '../recurring/index.js';
import { NO_SPLITS_FILTER } from '../transactions/queries.js';

export interface AnalyticsQueryOptions {
  /**
   * Treat scheduled (not yet ready) recurring occurrences as posted
   * transactions. Enabled when a report's date range extends into the future.
   * Callers are responsible for materializing occurrences far enough ahead
   * (RecurringTransactionService.ensureOccurrencesThrough).
   */
  includeProjections?: boolean;
}

/**
 * Scheduled recurring occurrences projected into the transactions shape.
 * Budget-currency amounts use the latest known exchange rate (future months
 * never have rates of their own). Synthetic IDs are negative so they can't
 * collide with real transactions or match transaction_splits rows.
 */
const PROJECTED_TRANSACTIONS_SQL = `
  SELECT
    -o.ID AS ID,
    r.CategoryID AS CategoryID,
    r.AccountID AS AccountID,
    NULL AS TransferID,
    o.DueDate AS Date,
    COALESCE(NULLIF(r.Memo, ''), r.Name) AS Memo,
    0 AS Reconciled,
    CASE WHEN r.Direction = 'inflow'
      THEN CAST(ROUND(r.Amount * ${PROJECTION_RATE_SQL}) AS INTEGER) ELSE 0 END AS Inflow,
    CASE WHEN r.Direction = 'outflow'
      THEN CAST(ROUND(r.Amount * ${PROJECTION_RATE_SQL}) AS INTEGER) ELSE 0 END AS Outflow,
    o.BudgetID AS BudgetID,
    r.Name AS Payee,
    NULL AS LabelID
  FROM recurring_transaction_occurrences o
  JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
  JOIN accounts a ON a.ID = r.AccountID
  JOIN budgets b ON b.ID = o.BudgetID
  WHERE o.Status = 'scheduled' AND r.Active = 1
`;

/**
 * Period-bucketing CASE expressions shared by the *ByPeriod queries.
 * Each CASE consumes one `?` per WHEN arm; a query using all three binds
 * `periodParams(grouping)` (12 values) after its base parameters.
 */
const PERIOD_START_CASE = `CASE
            WHEN ? = 'day' THEN Date
            WHEN ? = 'week' THEN DATE(Date, '-' || ((CAST(strftime('%w', Date) AS INTEGER) + 6) % 7) || ' days')
            WHEN ? = 'month' THEN DATE(strftime('%Y-%m-01', Date))
            WHEN ? = 'quarter' THEN DATE(
              strftime('%Y', Date) || '-' || printf(
                '%02d',
                ((CAST(strftime('%m', Date) AS INTEGER) - 1) / 3) * 3 + 1
              ) || '-01'
            )
          END AS PeriodStart`;

const PERIOD_END_CASE = `CASE
            WHEN ? = 'day' THEN PeriodStart
            WHEN ? = 'week' THEN DATE(PeriodStart, '+6 days')
            WHEN ? = 'month' THEN DATE(PeriodStart, '+1 month', '-1 day')
            WHEN ? = 'quarter' THEN DATE(PeriodStart, '+3 months', '-1 day')
          END AS PeriodEnd`;

const PERIOD_LABEL_CASE = `CASE
            WHEN ? = 'day' THEN strftime('%Y-%m-%d', PeriodStart)
            WHEN ? = 'week' THEN strftime('%Y', PeriodStart) || '-W' || printf('%02d', CAST(strftime('%W', PeriodStart) AS INTEGER))
            WHEN ? = 'month' THEN strftime('%Y-%m', PeriodStart)
            WHEN ? = 'quarter' THEN strftime('%Y', PeriodStart) || '-Q' || (((CAST(strftime('%m', PeriodStart) AS INTEGER) - 1) / 3) + 1)
          END AS Period`;

/** One `grouping` bind per `?` across the three period CASEs (3 × 4 arms). */
function periodParams(grouping: 'day' | 'week' | 'month' | 'quarter'): string[] {
  return new Array<string>(12).fill(grouping);
}

/**
 * Source relation for queries over plain (non-split) transactions. With
 * projections enabled, scheduled recurring occurrences are unioned in as if
 * they were already posted. Split-branch subqueries never need this: projected
 * rows have no transaction_splits.
 */
function transactionsSource(includeProjections?: boolean): string {
  if (!includeProjections) return 'transactions';
  return `(
    SELECT ID, CategoryID, AccountID, TransferID, Date, Memo, Reconciled, Inflow, Outflow, BudgetID, Payee, LabelID
    FROM transactions
    UNION ALL
    ${PROJECTED_TRANSACTIONS_SQL}
  )`;
}

/**
 * AnalyticsQueries - All SQL queries for analytics
 * Direct port from Go analytics service
 */
export class AnalyticsQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * GetSpendingByDatesByCategories - Get spending by dates and category groups
   * For pie chart: returns aggregated spending per category group for the entire period
   */
  getSpendingByDatesByCategories(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ) {
    const query = `
      WITH base AS (
        SELECT DATE(t.Date) AS Date, c.CategoryGroupID AS GroupID, s.Outflow AS Outflow
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        JOIN categories c ON c.ID = s.CategoryID
        WHERE t.BudgetID = ? AND DATE(t.Date) >= DATE(?) AND DATE(t.Date) <= DATE(?) AND a.OnBudget = 1 AND s.Outflow > 0
        UNION ALL
        SELECT DATE(t.Date) AS Date, c.CategoryGroupID AS GroupID, t.Outflow AS Outflow
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        JOIN categories c ON c.ID = t.CategoryID
        WHERE t.BudgetID = ? AND DATE(t.Date) >= DATE(?) AND DATE(t.Date) <= DATE(?) AND a.OnBudget = 1 AND t.Outflow > 0
          ${NO_SPLITS_FILTER}
      )
      SELECT b.Date AS Date, SUM(b.Outflow) AS Spending, cg.ID AS CategoryGroupID, cg.Name AS CategoryGroupName
      FROM base b
      LEFT JOIN category_groups cg ON cg.ID = b.GroupID
      WHERE (cg.Name != 'Transfers' OR cg.Name IS NULL)
      GROUP BY b.Date, cg.ID, cg.Name
      ORDER BY b.Date, cg.Name;
    `;

    return allRows(this.db, query, budgetId, startDate, endDate, budgetId, startDate, endDate);
  }

  /**
   * GetSpendingByDates - Get spending by dates from on-budget accounts only
   */
  getSpendingByDates(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ) {
    const query = `
      WITH RECURSIVE date_range(day) AS (
        SELECT DATE(?)
        UNION ALL
        SELECT DATE(day, '+1 day')
        FROM date_range
        WHERE day < DATE(?)
      ),
      base as (
        SELECT DATE(t.Date) as Date, s.Outflow as Outflow, cg.Name as GroupName
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ? AND a.OnBudget = 1 AND DATE(t.Date) >= DATE(?) AND DATE(t.Date) <= DATE(?) AND s.Outflow > 0
        UNION ALL
        SELECT DATE(t.Date) as Date, t.Outflow as Outflow, cg.Name as GroupName
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ? AND a.OnBudget = 1 AND DATE(t.Date) >= DATE(?) AND DATE(t.Date) <= DATE(?) AND t.Outflow > 0
          ${NO_SPLITS_FILTER}
      )
      SELECT dr.day AS Date, COALESCE(SUM(CASE WHEN base.GroupName != 'Transfers' OR base.GroupName IS NULL THEN base.Outflow ELSE 0 END), 0) AS Spending
      FROM date_range dr
      LEFT JOIN base ON base.Date = dr.day
      GROUP BY dr.day
      ORDER BY dr.day;
    `;

    return allRows(
      this.db,
      query,
      startDate,
      endDate,
      budgetId,
      startDate,
      endDate,
      budgetId,
      startDate,
      endDate
    );
  }

  /**
   * GetSpendingByCategoriesInGroup - Get spending by categories in a specific group
   */
  getSpendingByCategoriesInGroup(
    startDate: string,
    endDate: string,
    budgetId: number,
    categoryGroupId: number,
    opts?: AnalyticsQueryOptions
  ) {
    const query = `
      WITH base AS (
        -- Prefer split rows when present
        SELECT
          s.CategoryID AS CategoryID,
          s.Outflow AS Outflow
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        JOIN categories c ON c.ID = s.CategoryID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND a.OnBudget = 1
          AND s.Outflow > 0
          AND c.CategoryGroupID = ?
          AND c.BudgetID = ?

        UNION ALL

        -- Fallback to parent transactions that do not have splits
        SELECT
          t.CategoryID AS CategoryID,
          t.Outflow AS Outflow
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        JOIN categories c ON c.ID = t.CategoryID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND a.OnBudget = 1
          AND t.Outflow > 0
          AND c.CategoryGroupID = ?
          AND c.BudgetID = ?
          ${NO_SPLITS_FILTER}
      )
      SELECT
        c.ID AS CategoryID,
        c.Name AS CategoryName,
        COALESCE(SUM(base.Outflow), 0) AS Spending
      FROM base
      JOIN categories c ON c.ID = base.CategoryID
      GROUP BY c.ID, c.Name
      HAVING Spending > 0
      ORDER BY Spending DESC;
    `;

    return allRows(
      this.db,
      query,
      budgetId,
      startDate,
      endDate,
      categoryGroupId,
      budgetId,
      budgetId,
      startDate,
      endDate,
      categoryGroupId,
      budgetId
    );
  }

  getSpendingByLabels(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ) {
    const query = `
      WITH base AS (
        SELECT
          t.LabelID AS LabelID,
          s.Outflow AS Outflow,
          cg.Name AS GroupName
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND s.Outflow > 0

        UNION ALL

        SELECT
          t.LabelID AS LabelID,
          t.Outflow AS Outflow,
          cg.Name AS GroupName
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND t.Outflow > 0
          ${NO_SPLITS_FILTER}
      ),
      filtered AS (
        SELECT LabelID, Outflow
        FROM base
        WHERE GroupName IS NULL OR GroupName NOT IN ('Transfers', 'Income')
      ),
      aggregated AS (
        SELECT
          f.LabelID AS LabelID,
          COALESCE(l.Name, 'Unlabeled') AS Label,
          COALESCE(l.Color, '#9CA3AF') AS LabelColor,
          SUM(f.Outflow) AS Spending
        FROM filtered f
        LEFT JOIN labels l ON l.ID = f.LabelID
        GROUP BY f.LabelID, l.Name, l.Color
      ),
      unlabeled_fallback AS (
        SELECT
          NULL AS LabelID,
          'Unlabeled' AS Label,
          '#9CA3AF' AS LabelColor,
          0 AS Spending
        WHERE NOT EXISTS (SELECT 1 FROM aggregated WHERE LabelID IS NULL)
      )
      SELECT LabelID, Label, LabelColor, Spending
      FROM aggregated
      UNION ALL
      SELECT LabelID, Label, LabelColor, Spending
      FROM unlabeled_fallback
      ORDER BY Spending DESC, Label COLLATE NOCASE;
    `;

    return allRows(this.db, query, budgetId, startDate, endDate, budgetId, startDate, endDate);
  }

  getSpendingByPayees(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ) {
    const query = `
      WITH base AS (
        SELECT
          COALESCE(NULLIF(TRIM(t.Payee), ''), '(No payee)') AS Payee,
          s.Outflow AS Outflow,
          cg.Name AS GroupName
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND s.Outflow > 0

        UNION ALL

        SELECT
          COALESCE(NULLIF(TRIM(t.Payee), ''), '(No payee)') AS Payee,
          t.Outflow AS Outflow,
          cg.Name AS GroupName
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND t.Outflow > 0
          ${NO_SPLITS_FILTER}
      ),
      filtered AS (
        SELECT Payee, Outflow
        FROM base
        WHERE GroupName IS NULL OR GroupName NOT IN ('Transfers', 'Income')
      )
      SELECT
        Payee,
        SUM(Outflow) AS Spending
      FROM filtered
      GROUP BY Payee
      ORDER BY Spending DESC, Payee COLLATE NOCASE;
    `;

    return allRows(this.db, query, budgetId, startDate, endDate, budgetId, startDate, endDate);
  }

  // Additional queries from TypeScript implementation not in Go

  getPeriodSummary(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ) {
    const query = `
      WITH base AS (
        SELECT DATE(t.Date) AS Date, s.Outflow AS Outflow, s.Inflow AS Inflow, cg.Name AS GroupName
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND a.OnBudget = 1
        UNION ALL
        SELECT DATE(t.Date) AS Date, t.Outflow AS Outflow, t.Inflow AS Inflow, cg.Name AS GroupName
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND a.OnBudget = 1
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
      ),
      filtered_base AS (
        SELECT
          Date,
          CASE
            WHEN GroupName NOT IN ('Transfers', 'Income') OR GroupName IS NULL THEN Outflow
            ELSE 0
          END AS FilteredOutflow,
          CASE WHEN GroupName = 'Income' THEN Inflow ELSE 0 END AS Income
        FROM base
      ),
      stats AS (
        SELECT
          COALESCE(SUM(FilteredOutflow), 0) AS TotalSpending,
          COALESCE(SUM(Income), 0) AS TotalIncome,
          COUNT(*) AS TransactionCount,
          COUNT(DISTINCT Date) AS ActiveDays
        FROM filtered_base
      ),
      period AS (
        SELECT
          DATE(?) AS StartDate,
          DATE(?) AS EndDate,
          CAST(julianday(?) - julianday(?) + 1 AS INTEGER) AS PeriodDays
      )
      SELECT
        period.StartDate AS StartDate,
        period.EndDate AS EndDate,
        stats.TotalSpending AS TotalSpending,
        stats.TotalIncome AS TotalIncome,
        stats.TotalIncome - stats.TotalSpending AS NetCashflow,
        CASE
          WHEN period.PeriodDays > 0
            THEN CAST(ROUND(stats.TotalSpending * 1.0 / period.PeriodDays) AS INTEGER)
          ELSE 0
        END AS AverageDailySpending,
        stats.ActiveDays AS ActiveDays,
        period.PeriodDays AS PeriodDays,
        stats.TransactionCount AS TransactionCount
      FROM period, stats;
    `;

    return getRow(
      this.db,
      query,
      budgetId,
      startDate,
      endDate,
      budgetId,
      startDate,
      endDate,
      startDate,
      endDate,
      endDate,
      startDate
    );
  }

  getTopSpendingCategories(
    startDate: string,
    endDate: string,
    budgetId: number,
    limit = 5,
    opts?: AnalyticsQueryOptions
  ) {
    const query = `
      WITH base AS (
        SELECT
          COALESCE(c.ID, 0) AS CategoryID,
          COALESCE(c.Name, 'Uncategorized') AS CategoryName,
          cg.Name AS CategoryGroupName,
          s.Outflow AS Outflow
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND a.OnBudget = 1
          AND s.Outflow > 0
        UNION ALL
        SELECT
          COALESCE(c.ID, 0) AS CategoryID,
          COALESCE(c.Name, 'Uncategorized') AS CategoryName,
          cg.Name AS CategoryGroupName,
          t.Outflow AS Outflow
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND a.OnBudget = 1
          AND t.Outflow > 0
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
      )
      SELECT
        CategoryID,
        CategoryName,
        CategoryGroupName,
        SUM(Outflow) AS Spending
      FROM base
      WHERE CategoryGroupName IS NULL OR (CategoryGroupName NOT IN ('Transfers', 'Income'))
      GROUP BY CategoryID, CategoryName, CategoryGroupName
      HAVING SUM(Outflow) > 0
      ORDER BY Spending DESC
      LIMIT ?;
    `;

    return allRows(
      this.db,
      query,
      budgetId,
      startDate,
      endDate,
      budgetId,
      startDate,
      endDate,
      limit
    );
  }

  getIncomeExpenseByPeriod(
    startDate: string,
    endDate: string,
    budgetId: number,
    grouping: 'day' | 'week' | 'month' | 'quarter',
    accountIds?: number[],
    opts?: AnalyticsQueryOptions
  ) {
    const hasAccountFilter = Array.isArray(accountIds) && accountIds.length > 0;
    const accountFilterClause = hasAccountFilter
      ? ` AND a.ID IN (${accountIds.map(() => '?').join(', ')})`
      : '';
    const query = `
      WITH base AS (
        SELECT
          DATE(t.Date) AS Date,
          c.CategoryGroupID AS GroupID,
          cg.Name AS GroupName,
          s.Inflow AS Inflow,
          s.Outflow AS Outflow
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          ${accountFilterClause}
        UNION ALL
        SELECT
          DATE(t.Date) AS Date,
          c.CategoryGroupID AS GroupID,
          cg.Name AS GroupName,
          t.Inflow AS Inflow,
          t.Outflow AS Outflow
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          ${NO_SPLITS_FILTER}
          ${accountFilterClause}
      ),
      normalized AS (
        SELECT
          Date,
          GroupID,
          COALESCE(NULLIF(GroupName, ''), 'Uncategorized') AS CategoryGroupName,
          CASE WHEN GroupName = 'Income' THEN COALESCE(Inflow, 0) ELSE 0 END AS IncomeAmount,
          CASE
            WHEN GroupName = 'Income' THEN 0
            WHEN GroupName = 'Transfers' THEN 0
            ELSE COALESCE(Outflow, 0)
          END AS ExpenseAmount
        FROM base
        WHERE COALESCE(Inflow, 0) > 0 OR COALESCE(Outflow, 0) > 0
      ),
      periodized AS (
        SELECT
          *,
          ${PERIOD_START_CASE}
        FROM normalized
      ),
      with_bounds AS (
        SELECT
          *,
          ${PERIOD_END_CASE}
        FROM periodized
      ),
      aggregated AS (
        SELECT
          ${PERIOD_LABEL_CASE},
          PeriodStart,
          PeriodEnd,
          SUM(IncomeAmount) AS TotalIncome,
          SUM(ExpenseAmount) AS TotalExpense
        FROM with_bounds
        GROUP BY Period, PeriodStart, PeriodEnd
      )
      SELECT
        COALESCE(Period, '') AS Period,
        PeriodStart,
        PeriodEnd,
        TotalIncome,
        TotalExpense
      FROM aggregated
      ORDER BY PeriodStart;
    `;

    const accountParams = hasAccountFilter && accountIds ? accountIds : [];
    return allRows(
      this.db,
      query,
      budgetId,
      startDate,
      endDate,
      ...accountParams,
      budgetId,
      startDate,
      endDate,
      ...accountParams,
      ...periodParams(grouping)
    );
  }

  getSpendingTotalsByPeriod(
    startDate: string,
    endDate: string,
    budgetId: number,
    grouping: 'day' | 'week' | 'month' | 'quarter',
    categoryIds?: number[],
    accountIds?: number[],
    opts?: AnalyticsQueryOptions
  ) {
    const hasCategoryFilter = Array.isArray(categoryIds) && categoryIds.length > 0;
    const categoryFilterSplits = hasCategoryFilter
      ? ` AND s.CategoryID IN (${categoryIds.map(() => '?').join(', ')})`
      : '';
    const categoryFilterTransactions = hasCategoryFilter
      ? ` AND t.CategoryID IN (${categoryIds.map(() => '?').join(', ')})`
      : '';
    const hasAccountFilter = Array.isArray(accountIds) && accountIds.length > 0;
    const accountFilterClause = hasAccountFilter
      ? ` AND a.ID IN (${accountIds.map(() => '?').join(', ')})`
      : '';

    const query = `
      WITH base AS (
        SELECT
          DATE(t.Date) AS Date,
          s.Outflow AS Outflow
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND s.Outflow > 0
          AND (cg.Name != 'Transfers' OR cg.Name IS NULL)
          ${categoryFilterSplits}
          ${accountFilterClause}
        UNION ALL
        SELECT
          DATE(t.Date) AS Date,
          t.Outflow AS Outflow
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          AND t.Outflow > 0
          ${NO_SPLITS_FILTER}
          AND (cg.Name != 'Transfers' OR cg.Name IS NULL)
          ${categoryFilterTransactions}
          ${accountFilterClause}
      ),
      periodized AS (
        SELECT
          Outflow,
          ${PERIOD_START_CASE}
        FROM base
      ),
      with_bounds AS (
        SELECT
          Outflow,
          PeriodStart,
          ${PERIOD_END_CASE}
        FROM periodized
      ),
      aggregated AS (
        SELECT
          ${PERIOD_LABEL_CASE},
          PeriodStart,
          PeriodEnd,
          SUM(Outflow) AS TotalSpending
        FROM with_bounds
        GROUP BY Period, PeriodStart, PeriodEnd
      )
      SELECT
        COALESCE(Period, '') AS Period,
        PeriodStart,
        PeriodEnd,
        TotalSpending
      FROM aggregated
      ORDER BY PeriodStart;
    `;

    const categoryParams = hasCategoryFilter && categoryIds ? categoryIds : [];
    const accountParams = hasAccountFilter && accountIds ? accountIds : [];
    return allRows(
      this.db,
      query,
      budgetId,
      startDate,
      endDate,
      ...categoryParams,
      ...accountParams,
      budgetId,
      startDate,
      endDate,
      ...categoryParams,
      ...accountParams,
      ...periodParams(grouping)
    );
  }

  getCategoryTotalsByPeriod(
    startDate: string,
    endDate: string,
    budgetId: number,
    grouping: 'day' | 'week' | 'month' | 'quarter',
    categoryIds?: number[],
    accountIds?: number[],
    opts?: AnalyticsQueryOptions
  ) {
    const hasCategoryFilter = Array.isArray(categoryIds) && categoryIds.length > 0;
    const categoryFilterSplits = hasCategoryFilter
      ? ` AND s.CategoryID IN (${categoryIds.map(() => '?').join(', ')})`
      : '';
    const categoryFilterTransactions = hasCategoryFilter
      ? ` AND t.CategoryID IN (${categoryIds.map(() => '?').join(', ')})`
      : '';
    const hasAccountFilter = Array.isArray(accountIds) && accountIds.length > 0;
    const accountFilterClause = hasAccountFilter
      ? ` AND a.ID IN (${accountIds.map(() => '?').join(', ')})`
      : '';

    const query = `
      WITH base AS (
        SELECT
          DATE(t.Date) AS Date,
          s.CategoryID AS CategoryID,
          COALESCE(c.Name, 'Uncategorized') AS CategoryName,
          c.CategoryGroupID AS CategoryGroupID,
          COALESCE(NULLIF(cg.Name, ''), 'Uncategorized') AS CategoryGroupName,
          COALESCE(s.Inflow, 0) AS Inflow,
          COALESCE(s.Outflow, 0) AS Outflow
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = s.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          ${categoryFilterSplits}
          ${accountFilterClause}
        UNION ALL
        SELECT
          DATE(t.Date) AS Date,
          t.CategoryID AS CategoryID,
          COALESCE(c.Name, 'Uncategorized') AS CategoryName,
          c.CategoryGroupID AS CategoryGroupID,
          COALESCE(NULLIF(cg.Name, ''), 'Uncategorized') AS CategoryGroupName,
          COALESCE(t.Inflow, 0) AS Inflow,
          COALESCE(t.Outflow, 0) AS Outflow
        FROM ${transactionsSource(opts?.includeProjections)} t
        JOIN accounts a ON a.ID = t.AccountID
        LEFT JOIN categories c ON c.ID = t.CategoryID
        LEFT JOIN category_groups cg ON cg.ID = c.CategoryGroupID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          ${NO_SPLITS_FILTER}
          ${categoryFilterTransactions}
          ${accountFilterClause}
      ),
      filtered AS (
        SELECT
          Date,
          CategoryID,
          CategoryName,
          CategoryGroupID,
          CategoryGroupName,
          Inflow,
          CASE
            WHEN CategoryGroupName = 'Transfers' THEN 0
            ELSE Outflow
          END AS Outflow
        FROM base
      ),
      periodized AS (
        SELECT
          CategoryID,
          CategoryName,
          CategoryGroupID,
          CategoryGroupName,
          Inflow,
          Outflow,
          ${PERIOD_START_CASE}
        FROM filtered
      ),
      with_bounds AS (
        SELECT
          CategoryID,
          CategoryName,
          CategoryGroupID,
          CategoryGroupName,
          Inflow,
          Outflow,
          PeriodStart,
          ${PERIOD_END_CASE}
        FROM periodized
      )
      SELECT
        CategoryID,
        CategoryName,
        CategoryGroupID,
        CategoryGroupName,
        ${PERIOD_LABEL_CASE},
        PeriodStart,
        PeriodEnd,
        SUM(Inflow) AS TotalIncome,
        SUM(Outflow) AS TotalOutflow
      FROM with_bounds
      GROUP BY
        CategoryID,
        CategoryName,
        CategoryGroupID,
        CategoryGroupName,
        Period,
        PeriodStart,
        PeriodEnd
      ORDER BY
        PeriodStart,
        CategoryGroupName,
        CategoryName;
    `;

    const categoryParams = hasCategoryFilter && categoryIds ? categoryIds : [];
    const accountParams = hasAccountFilter && accountIds ? accountIds : [];
    return allRows(
      this.db,
      query,
      budgetId,
      startDate,
      endDate,
      ...categoryParams,
      ...accountParams,
      budgetId,
      startDate,
      endDate,
      ...categoryParams,
      ...accountParams,
      ...periodParams(grouping)
    );
  }

  /**
   * Get total balance for cash accounts only (Checking, Savings, Cash)
   */
  getOnBudgetBalance(budgetId: number, asOfDate: string) {
    return getRow(
      this.db,
      `
      WITH current_balance AS (
        SELECT COALESCE(SUM(COALESCE(BalanceConverted, Balance)), 0) AS CurrentBalance
        FROM accounts
        WHERE BudgetID = ?1
          AND OnBudget = 1
          AND LOWER(Type) IN ('checking', 'savings', 'cash')
      ),
      future_transactions AS (
        SELECT COALESCE(SUM(t.Inflow - t.Outflow), 0) AS NetChange
        FROM transactions t
        INNER JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?1
          AND a.OnBudget = 1
          AND LOWER(a.Type) IN ('checking', 'savings', 'cash')
          AND DATE(t.Date) > DATE(?2)
      )
      SELECT cb.CurrentBalance - ft.NetChange AS TotalBalance
      FROM current_balance cb
      CROSS JOIN future_transactions ft
    `,
      budgetId,
      asOfDate
    );
  }

  /**
   * Get daily balance for on-budget accounts over a date range
   */
  getOnBudgetBalanceByDates(startDate: string, endDate: string, budgetId: number) {
    return allRows(
      this.db,
      `
      WITH RECURSIVE first_cash_tx AS (
        -- Earliest cash transaction; used to clamp the series so we never render a
        -- flat back-filled baseline for dates before the user had any data.
        SELECT MIN(DATE(t.Date)) AS FirstDate
        FROM transactions t
        INNER JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND LOWER(a.Type) IN ('checking', 'savings', 'cash')
      ),
      bounds AS (
        SELECT
          MAX(DATE(?), COALESCE((SELECT FirstDate FROM first_cash_tx), DATE(?))) AS StartDay,
          DATE(?) AS EndDay
      ),
      date_range AS (
        SELECT StartDay AS day, EndDay FROM bounds WHERE StartDay <= EndDay
        UNION ALL
        SELECT DATE(day, '+1 day'), EndDay
        FROM date_range
        WHERE day < EndDay
      ),
      starting_balance AS (
        -- Get the current balance from cash accounts only (Checking, Savings, Cash)
        SELECT COALESCE(SUM(COALESCE(BalanceConverted, Balance)), 0) AS CurrentBalance
        FROM accounts
        WHERE BudgetID = ?
          AND OnBudget = 1
          AND LOWER(Type) IN ('checking', 'savings', 'cash')
      ),
      transactions_after_end AS (
        -- Get net transactions after the end date to work backwards
        SELECT COALESCE(SUM(t.Inflow - t.Outflow), 0) AS NetChange
        FROM transactions t
        INNER JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND LOWER(a.Type) IN ('checking', 'savings', 'cash')
          AND DATE(t.Date) > DATE(?)
      ),
      daily_transactions AS (
        -- Calculate daily net changes for cash accounts only
        SELECT
          DATE(t.Date) AS Date,
          SUM(t.Inflow - t.Outflow) AS DailyChange
        FROM transactions t
        INNER JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?
          AND a.OnBudget = 1
          AND LOWER(a.Type) IN ('checking', 'savings', 'cash')
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
        GROUP BY DATE(t.Date)
      ),
      daily_balances AS (
        SELECT
          d.day AS Date,
          (
            SELECT sb.CurrentBalance - ta.NetChange
            FROM starting_balance sb, transactions_after_end ta
          )
          - COALESCE(
            (
              SELECT SUM(dt.DailyChange)
              FROM daily_transactions dt
              WHERE dt.Date > d.day
            ), 0
          ) AS Balance
        FROM date_range d
      )
      SELECT Date, Balance
      FROM daily_balances
      ORDER BY Date
    `,
      budgetId, // first_cash_tx
      startDate, // bounds: MAX start
      startDate, // bounds: COALESCE fallback when no transactions
      endDate, // bounds: EndDay
      budgetId, // starting_balance
      budgetId, // transactions_after_end
      endDate, // transactions_after_end: > endDate
      budgetId, // daily_transactions
      startDate, // daily_transactions: >= startDate
      endDate // daily_transactions: <= endDate
    );
  }
}
