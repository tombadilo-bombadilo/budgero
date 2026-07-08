import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { NO_SPLITS_FILTER } from '../transactions/queries.js';
import { Assignment, GetMonthlyBudgetRow, AssignmentsByMonthRow } from './types.js';

import { createLogger } from '../../logger.js';

const debugLog = createLogger('services:monthly-budgets:queries');

/**
 * MonthlyBudgetQueries - All SQL queries for monthly budget operations
 * Extracted from the main queries file for better organization
 */
export class MonthlyBudgetQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * AddMonthlyAssignment - Adds a new monthly assignment
   * SQL: INSERT INTO assignments (category_id, amount, month, budget_id) VALUES (?, ?, ?, ?)
   */
  addMonthlyAssignment(categoryId: number, amount: number, month: string, budgetId: number): void {
    run(
      this.db,
      `
      INSERT INTO assignments (CategoryID, Amount, Month, BudgetID) 
      VALUES (?, ?, ?, ?)
    `,
      categoryId,
      amount,
      month,
      budgetId
    );
  }

  /**
   * UpdateMonthlyAssignment - Updates an existing monthly assignment
   * SQL: UPDATE assignments SET amount = ? WHERE category_id = ? AND month = ?
   */
  updateMonthlyAssignment(amount: number, categoryId: number, month: string): void {
    run(
      this.db,
      `
      UPDATE assignments 
      SET Amount = ? 
      WHERE CategoryID = ? AND Month = ?
    `,
      amount,
      categoryId,
      month
    );
  }

  /**
   * GetMonthlyAssignment - Gets a specific monthly assignment
   * SQL: SELECT * FROM assignments WHERE category_id = ? AND month = ?
   */
  getMonthlyAssignment(categoryId: number, month: string): Assignment | undefined {
    return getRow<Assignment>(
      this.db,
      `
      SELECT * FROM assignments 
      WHERE CategoryID = ? AND Month = ?
    `,
      categoryId,
      month
    );
  }

  /**
   * ReassignAssignment - Moves assignments from one category to another.
   * If the target category already has an assignment for the same month,
   * the amounts are merged and the duplicate row is removed.
   */
  reassignAssignment(newCategoryId: number, oldCategoryId: number): void {
    this.db.transaction(() => {
      const oldAssignments = allRows<{ ID: number; Month: string; Amount: number }>(
        this.db,
        `
        SELECT ID, Month, Amount FROM assignments WHERE CategoryID = ?
      `,
        oldCategoryId
      );

      const checkStmt = this.db.prepare(`
        SELECT ID, Amount FROM assignments WHERE CategoryID = ? AND Month = ?
      `);
      const updateStmt = this.db.prepare(`
        UPDATE assignments SET Amount = ? WHERE ID = ?
      `);
      const deleteStmt = this.db.prepare(`
        DELETE FROM assignments WHERE ID = ?
      `);
      const reassignStmt = this.db.prepare(`
        UPDATE assignments SET CategoryID = ? WHERE ID = ?
      `);

      for (const old of oldAssignments) {
        const existing = checkStmt.get(newCategoryId, old.Month) as
          | { ID: number; Amount: number }
          | undefined;
        if (existing) {
          // Merge: add old amount to existing, then delete old row
          updateStmt.run(existing.Amount + old.Amount, existing.ID);
          deleteStmt.run(old.ID);
        } else {
          reassignStmt.run(newCategoryId, old.ID);
        }
      }
      checkStmt.finalize();
      updateStmt.finalize();
      deleteStmt.finalize();
      reassignStmt.finalize();
    });
  }

  /**
   * GetAssignedLastMonth - Gets amount assigned to a category in a specific month
   * SQL: SELECT amount FROM assignments WHERE month = ? AND category_id = ?
   */
  getAssignedLastMonth(month: string, categoryId: number): number {
    const result = getRow<{ Amount: number }>(
      this.db,
      `
      SELECT Amount FROM assignments 
      WHERE Month = ? AND CategoryID = ?
    `,
      month,
      categoryId
    );
    return result?.Amount || 0;
  }

  /**
   * GetAverageAssigned - Gets average assignment amount for a category
   * SQL: SELECT avg(amount) FROM assignments WHERE category_id = ?
   */
  getAverageAssigned(categoryId: number): number | null {
    // Amounts are integer milliunits; avg() is fractional, so round back to an
    // integer milliunit — the value is used directly as an assignment amount.
    const result = getRow<{ avg_amount: number }>(
      this.db,
      `
      SELECT CAST(ROUND(avg(Amount)) AS INTEGER) as avg_amount
      FROM assignments
      WHERE CategoryID = ?
    `,
      categoryId
    );
    return result?.avg_amount || null;
  }

  /**
   * GetAssignedLastMonthByCategoryIds - Gets total assigned for multiple categories in a month
   * SQL: SELECT SUM(IFNULL(amount,0)) FROM assignments WHERE month = ? AND category_id IN (...)
   */
  getAssignedLastMonthByCategoryIds(month: string, categoryIds: number[]): number | null {
    if (categoryIds.length === 0) {
      return 0;
    }

    const placeholders = categoryIds.map(() => '?').join(', ');
    const result = getRow<{ total_amount: number }>(
      this.db,
      `
      SELECT SUM(IFNULL(Amount,0)) as total_amount 
      FROM assignments 
      WHERE Month = ? AND CategoryID IN (${placeholders})
    `,
      month,
      ...categoryIds
    );
    return result?.total_amount || null;
  }

  /**
   * GetAssignmentsByMonthForCategories - Aggregated assignments per month for selected categories
   */
  getAssignmentsByMonthForCategories(
    categoryIds: number[],
    startMonth: string,
    endMonth: string,
    budgetId: number
  ): AssignmentsByMonthRow[] {
    if (categoryIds.length === 0) {
      return [];
    }

    const placeholders = categoryIds.map(() => '?').join(', ');
    return allRows<AssignmentsByMonthRow>(
      this.db,
      `
      SELECT Month, SUM(IFNULL(Amount, 0)) as TotalAssigned
      FROM assignments
      WHERE CategoryID IN (${placeholders})
        AND BudgetID = ?
        AND Month BETWEEN ? AND ?
      GROUP BY Month
      ORDER BY Month ASC
    `,
      ...categoryIds,
      budgetId,
      startMonth,
      endMonth
    );
  }

  /**
   * CountAssignmentsForCategory - Counts non-zero assignments for a category
   * SQL: SELECT COUNT(*) FROM assignments WHERE category_id = ? AND amount != 0
   */
  countAssignmentsForCategory(categoryId: number): number {
    const result = getRow(
      this.db,
      `
      SELECT COUNT(*) as count 
      FROM assignments 
      WHERE CategoryID = ? AND Amount != 0
    `,
      categoryId
    ) as { count: number };
    return result?.count || 0;
  }

  /**
   * ReadyToAssign - Calculates ready to assign amount
   * Simple static calculation: Total Income (NET) - Total Assignments (for entire budget, all time)
   */
  readyToAssign(budgetId: number, asOfDate: string): number {
    // Get total income (NET of inflow - outflow for Income category) for all time
    const incomeResult = getRow(
      this.db,
      `
      SELECT IFNULL(SUM(t.Inflow - t.Outflow), 0) as total_income
      FROM transactions t
      INNER JOIN accounts acc ON t.AccountID = acc.ID
      INNER JOIN categories c ON t.CategoryID = c.ID
      INNER JOIN category_groups cg ON c.CategoryGroupID = cg.ID
      WHERE t.BudgetID = ?1 
        AND acc.OnBudget = TRUE 
        AND cg.Name = 'Income'
        AND (t.TransferID IS NULL OR t.TransferID = '')
        AND DATE(t.Date) <= DATE(?2)
    `,
      budgetId,
      asOfDate
    ) as { total_income: number };

    // Get total assignments for all time
    const assignmentsResult = getRow(
      this.db,
      `
      SELECT IFNULL(SUM(Amount), 0) as total_assignments
      FROM assignments
      WHERE BudgetID = ?1
    `,
      budgetId
    ) as { total_assignments: number };

    // Include transfers that move money off budget (e.g., to savings or external accounts)
    // ONLY count transfers that use the "Transfers" category - user-categorized transfers
    // are treated as spending and deducted from category budgets instead of RTA
    // EXCLUDE transfers to off-budget DEBT accounts (mortgage, loan, credit) - those are handled
    // via category spending instead to avoid double-counting
    const offBudgetTransfersResult = getRow<{ total_offbudget_transfers: number }>(
      this.db,
      `
      SELECT IFNULL(SUM(t.Outflow), 0) as total_offbudget_transfers
      FROM transactions t
      INNER JOIN accounts src ON t.AccountID = src.ID
      INNER JOIN categories c ON t.CategoryID = c.ID
      INNER JOIN category_groups cg ON c.CategoryGroupID = cg.ID
      WHERE t.BudgetID = ?1
        AND src.OnBudget = TRUE
        AND t.Outflow > 0
        AND t.TransferID IS NOT NULL
        AND t.TransferID <> ''
        AND DATE(t.Date) <= DATE(?2)
        AND cg.Name = 'Transfers'
        AND EXISTS (
          SELECT 1
          FROM transactions mirror
          INNER JOIN accounts dest ON mirror.AccountID = dest.ID
          WHERE mirror.TransferID = t.TransferID
            AND mirror.ID != t.ID
            AND dest.OnBudget = FALSE
            AND LOWER(dest.Type) NOT IN ('credit', 'loan', 'mortgage')
        )
    `,
      budgetId,
      asOfDate
    );
    const totalOffBudgetTransfers = offBudgetTransfersResult?.total_offbudget_transfers ?? 0;

    const readyToAssign =
      incomeResult.total_income - assignmentsResult.total_assignments - totalOffBudgetTransfers;

    debugLog(`Ready to Assign (static, all-time):`);
    debugLog(`  Total Income: ${incomeResult.total_income.toLocaleString()}`);
    debugLog(`  Total Assignments: ${assignmentsResult.total_assignments.toLocaleString()}`);
    debugLog(`  Off-budget transfers: ${totalOffBudgetTransfers.toLocaleString()}`);
    debugLog(`  Ready to Assign: ${readyToAssign.toLocaleString()}`);

    return readyToAssign;
  }

  /**
   * GetMonthlyBudget - Gets the complete monthly budget view with assignments, activity, and available amounts
   * Complex query that matches the Go backend implementation exactly
   */
  getMonthlyBudget(month: string, budgetId: number): GetMonthlyBudgetRow[] {
    return allRows<GetMonthlyBudgetRow>(
      this.db,
      `
      WITH activity_month AS (
        -- Prefer split lines for category activity; fall back to parent transactions without splits
        SELECT s.CategoryID AS category_id, SUM(s.Inflow - s.Outflow) AS net
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        WHERE strftime('%Y-%m', t.Date) = ?1 AND a.OnBudget = TRUE
        GROUP BY s.CategoryID
        UNION ALL
        SELECT t.CategoryID AS category_id, SUM(t.Inflow - t.Outflow) AS net
        FROM transactions t
        JOIN accounts a ON a.ID = t.AccountID
        WHERE strftime('%Y-%m', t.Date) = ?1 AND a.OnBudget = TRUE
          ${NO_SPLITS_FILTER}
        GROUP BY t.CategoryID
      ),
      activity_prior AS (
        SELECT s.CategoryID AS category_id, SUM(s.Inflow - s.Outflow) AS net
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        WHERE strftime('%Y-%m', t.Date) < ?1 AND a.OnBudget = TRUE
        GROUP BY s.CategoryID
        UNION ALL
        SELECT t.CategoryID AS category_id, SUM(t.Inflow - t.Outflow) AS net
        FROM transactions t
        JOIN accounts a ON a.ID = t.AccountID
        WHERE strftime('%Y-%m', t.Date) < ?1 AND a.OnBudget = TRUE
          ${NO_SPLITS_FILTER}
        GROUP BY t.CategoryID
      )
      SELECT
        COALESCE(c.Name, '') AS Category,
        COALESCE(c.ID, -1) as CategoryID,
        cg.Name AS CategoryGroup,
        cg.ID as CategoryGroupID,
        COALESCE((
          SELECT COUNT(*) FROM (
            SELECT t.id
            FROM transactions t
            WHERE t.CategoryID = c.ID AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
            UNION ALL
            SELECT t2.ID
            FROM transaction_splits s
            JOIN transactions t2 ON t2.ID = s.TransactionID
            WHERE s.CategoryID = c.ID
          )
        ), 0) AS TotalTransactionCount,

        /* 1) Assigned in selected month */
        COALESCE((
          SELECT SUM(a.Amount)
          FROM assignments a
          WHERE a.CategoryID = c.ID AND a.Month = ?1
        ), 0) AS Assigned,

        /* 2) Activity in selected month (using splits) — integer milliunit sums are exact */
        COALESCE((
          SELECT SUM(net) FROM activity_month am WHERE am.category_id = c.id
        ), 0) AS Activity,

        /* 3) Available = leftover from previous months + assigned - activity */
        (
          COALESCE((
            SELECT SUM(a_prev.Amount) FROM assignments a_prev WHERE a_prev.CategoryID = c.ID AND a_prev.Month < ?1
          ), 0)
          +
          COALESCE((
            SELECT SUM(net) FROM activity_prior ap WHERE ap.category_id = c.id
          ), 0)
          +
          COALESCE((
            SELECT SUM(a_cur.Amount) FROM assignments a_cur WHERE a_cur.CategoryID = c.ID AND a_cur.Month = ?1
          ), 0)
          +
          COALESCE((
            SELECT SUM(net) FROM activity_month am2 WHERE am2.category_id = c.id
          ), 0)
        ) AS Available
      FROM category_groups cg
      LEFT JOIN categories c ON c.CategoryGroupID = cg.ID
      WHERE cg.Name != 'Income' and cg.Name != 'Transfers' and cg.Name != 'Uncategorized' and cg.BudgetID = ?2
      ORDER BY CASE WHEN cg.Name = 'Hidden Categories' THEN 1 ELSE 0 END, cg.Position, cg.Name, c.Position, c.Name
    `,
      month,
      budgetId
    );
  }

  /**
   * GetTotalAssignedForBudgetPace - Gets total assigned amount for categories that are NOT excluded from budget pace
   * for multiple months. This is efficient and only sums assignments for relevant categories.
   *
   * @param months Array of month strings in YYYY-MM format
   * @param budgetId Budget ID to filter by
   * @returns Total assigned amount for budget pace calculation
   */
  getTotalAssignedForBudgetPace(months: string[], budgetId: number): number {
    if (months.length === 0) return 0;

    const placeholders = months.map(() => '?').join(',');

    // Execute with months array spread and budgetId at the end
    const result = getRow<{ total_assigned: number }>(
      this.db,
      `
      SELECT COALESCE(SUM(a.Amount), 0) as total_assigned
      FROM assignments a
      INNER JOIN categories c ON a.CategoryID = c.ID
      WHERE a.Month IN (${placeholders})
        AND a.BudgetID = ?
        AND c.ExcludeFromBudgetPace = FALSE
    `,
      ...months,
      budgetId
    );

    return result?.total_assigned || 0;
  }

  /**
   * BatchUpsertMonthlyAssignments - Batch inserts or updates multiple monthly assignments in a single transaction
   * This is much faster than individual upserts for bulk operations
   *
   * @param assignments Array of assignment objects with categoryId, amount, month, and budgetId
   */
  batchUpsertMonthlyAssignments(
    assignments: { categoryId: number; amount: number; month: string; budgetId: number }[]
  ): void {
    if (assignments.length === 0) return;

    // Use a transaction for atomicity and performance
    this.db.transaction(() => {
      const checkStmt = this.db.prepare(`
        SELECT ID FROM assignments 
        WHERE CategoryID = ? AND Month = ?
      `);

      const updateStmt = this.db.prepare(`
        UPDATE assignments 
        SET Amount = ?, BudgetID = ?
        WHERE CategoryID = ? AND Month = ?
      `);

      const insertStmt = this.db.prepare(`
        INSERT INTO assignments (CategoryID, Amount, Month, BudgetID) 
        VALUES (?, ?, ?, ?)
      `);

      try {
        for (const assignment of assignments) {
          const existing = checkStmt.get(assignment.categoryId, assignment.month);

          if (existing) {
            updateStmt.run(
              assignment.amount,
              assignment.budgetId,
              assignment.categoryId,
              assignment.month
            );
          } else {
            insertStmt.run(
              assignment.categoryId,
              assignment.amount,
              assignment.month,
              assignment.budgetId
            );
          }
        }
      } finally {
        checkStmt.finalize();
        updateStmt.finalize();
        insertStmt.finalize();
      }
    });
  }

  /**
   * GetAssignedForCategoryInRange - Sums assignments for a category between two months inclusive
   * SQL: SELECT SUM(amount) FROM assignments WHERE category_id = ? AND month BETWEEN ? AND ?
   */
  getAssignedForCategoryInRange(categoryId: number, startMonth: string, endMonth: string): number {
    if (!startMonth || !endMonth) return 0;
    // Ensure correct ordering; months are stored as YYYY-MM so lexicographic compare works
    const rangeStart = startMonth <= endMonth ? startMonth : endMonth;
    const rangeEnd = startMonth <= endMonth ? endMonth : startMonth;

    const result = getRow<{ total: number }>(
      this.db,
      `
      SELECT COALESCE(SUM(Amount), 0) as total
      FROM assignments
      WHERE CategoryID = ? AND Month >= ? AND Month <= ?
    `,
      categoryId,
      rangeStart,
      rangeEnd
    );
    return result?.total || 0;
  }

  /**
   * GetAssignedPriorToMonth - Gets total assigned for a category before a given month
   * SQL: SELECT SUM(amount) FROM assignments WHERE category_id = ? AND month < ?
   */
  getAssignedPriorToMonth(categoryId: number, month: string): number {
    const result = getRow<{ total: number }>(
      this.db,
      `
      SELECT COALESCE(SUM(Amount), 0) as total
      FROM assignments
      WHERE CategoryID = ? AND Month < ?
    `,
      categoryId,
      month
    );
    return result?.total || 0;
  }

  /**
   * GetCCPaymentAdjustments - Returns CC payment category IDs and total payments to CCs
   */
  getCCPaymentAdjustments(
    month: string,
    budgetId: number
  ): Map<number, { payments: number; priorPayments: number }> {
    const result = new Map<number, { payments: number; priorPayments: number }>();

    // Get all CC accounts with their payment category IDs
    const ccAccounts = allRows<{ ID: number; Metadata: string }>(
      this.db,
      `
      SELECT ID, Metadata
      FROM accounts
      WHERE BudgetID = ? AND LOWER(Type) = 'credit' AND Metadata IS NOT NULL
    `,
      budgetId
    );

    // Transfers TO a CC, either in the given month (=) or before it (<).
    const paymentsQuery = (dateOp: '=' | '<') => `
      SELECT COALESCE(SUM(t.Inflow), 0) as payments
      FROM transactions t
      WHERE t.AccountID = ?
        AND t.BudgetID = ?
        AND strftime('%Y-%m', t.Date) ${dateOp} ?
        AND t.TransferID IS NOT NULL
        AND t.TransferID != ''
        AND t.Inflow > 0
    `;

    for (const cc of ccAccounts) {
      let ccPaymentCategoryId: number | undefined;
      try {
        const metadata = JSON.parse(cc.Metadata || '{}');
        ccPaymentCategoryId = metadata.cc_payment_category_id;
      } catch {
        continue;
      }

      if (!ccPaymentCategoryId) continue;

      // Calculate CC Payments: Transfers TO this CC (current month)
      const paymentsResult = getRow(this.db, paymentsQuery('='), cc.ID, budgetId, month) as {
        payments: number;
      };

      // Calculate CC Payments for prior months
      const priorPaymentsResult = getRow(this.db, paymentsQuery('<'), cc.ID, budgetId, month) as {
        payments: number;
      };

      const existing = result.get(ccPaymentCategoryId) || { payments: 0, priorPayments: 0 };
      result.set(ccPaymentCategoryId, {
        payments: existing.payments + (paymentsResult.payments || 0),
        priorPayments: existing.priorPayments + (priorPaymentsResult.payments || 0),
      });
    }

    return result;
  }

  /**
   * GetFutureAvailableByCategory - Computes Available for a specific category
   * across all future months (after `afterMonth`) that have assignments.
   *
   * Available(M) = cumulative_assignments(up to M) + cumulative_activity(up to M)
   *
   * Activity includes transaction splits (preferred) with fallback to parent
   * transactions that have no splits, matching the getMonthlyBudget formula.
   */
  getFutureAvailableByCategory(
    categoryId: number,
    afterMonth: string,
    budgetId: number
  ): { Month: string; Available: number }[] {
    return allRows<{ Month: string; Available: number }>(
      this.db,
      `
      SELECT
        fm.Month,
        (
          COALESCE((
            SELECT SUM(a.Amount)
            FROM assignments a
            WHERE a.CategoryID = ?1 AND a.Month <= fm.Month
          ), 0)
          +
          COALESCE((
            SELECT SUM(s.Inflow - s.Outflow)
            FROM transaction_splits s
            JOIN transactions t ON t.ID = s.TransactionID
            JOIN accounts acc ON acc.ID = t.AccountID
            WHERE s.CategoryID = ?1
              AND strftime('%Y-%m', t.Date) <= fm.Month
              AND acc.OnBudget = TRUE
          ), 0)
          +
          COALESCE((
            SELECT SUM(t.Inflow - t.Outflow)
            FROM transactions t
            JOIN accounts acc ON acc.ID = t.AccountID
            WHERE t.CategoryID = ?1
              AND strftime('%Y-%m', t.Date) <= fm.Month
              AND acc.OnBudget = TRUE
              ${NO_SPLITS_FILTER}
          ), 0)
        ) AS Available
      FROM (
        SELECT DISTINCT Month
        FROM assignments
        WHERE CategoryID = ?1 AND Month > ?2 AND BudgetID = ?3
      ) fm
      ORDER BY fm.Month ASC
    `,
      categoryId,
      afterMonth,
      budgetId
    );
  }

  /**
   * GetCCSpendingByCategoryAndAccount - Returns CC spending broken down by
   * spending category AND by the CC account that did the spending.
   *
   * Shape: Map<spendingCategoryId, Map<ccAccountId, {current, prior}>>
   *
   * The per-account dimension is required so that, when a budgeted category
   * is partially funded, the funded portion can be attributed to the specific
   * card(s) that actually spent on it (rather than spread across all cards).
   */
  getCCSpendingByCategoryAndAccount(
    month: string,
    budgetId: number
  ): Map<number, Map<number, { current: number; prior: number }>> {
    const result = new Map<number, Map<number, { current: number; prior: number }>>();

    const ccAccounts = allRows<{ ID: number }>(
      this.db,
      `
      SELECT ID FROM accounts
      WHERE BudgetID = ? AND LOWER(Type) = 'credit'
    `,
      budgetId
    );

    if (ccAccounts.length === 0) return result;

    const ccAccountIds = ccAccounts.map((a) => a.ID);
    const placeholders = ccAccountIds.map(() => '?').join(',');

    // Split-aware spending: prefer split lines for transactions that have them,
    // fall back to the parent transaction otherwise (same pattern as the
    // activity CTEs in getMonthlyBudget). Without this, CC spending recorded as
    // a split transaction would never fund the CC Payment category.
    const spendingQuery = (dateOp: '=' | '<') => `
      SELECT x.CategoryID, x.AccountID, COALESCE(SUM(x.Outflow), 0) as spending
      FROM (
        SELECT s.CategoryID AS CategoryID, t.AccountID AS AccountID, s.Outflow AS Outflow,
               t.Date AS Date, t.BudgetID AS BudgetID
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        UNION ALL
        SELECT t.CategoryID, t.AccountID, t.Outflow, t.Date, t.BudgetID
        FROM transactions t
        WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s2 WHERE s2.TransactionID = t.ID)
      ) x
      JOIN categories c ON x.CategoryID = c.ID
      JOIN category_groups cg ON c.CategoryGroupID = cg.ID
      WHERE x.AccountID IN (${placeholders})
        AND x.BudgetID = ?
        AND strftime('%Y-%m', x.Date) ${dateOp} ?
        AND x.Outflow > 0
        AND cg.Name NOT IN ('Income', 'Transfers', 'Uncategorized', 'Credit Card Payments')
      GROUP BY x.CategoryID, x.AccountID
    `;

    const currentRows = allRows<{ CategoryID: number; AccountID: number; spending: number }>(
      this.db,
      spendingQuery('='),
      ...ccAccountIds,
      budgetId,
      month
    );

    const priorRows = allRows<{ CategoryID: number; AccountID: number; spending: number }>(
      this.db,
      spendingQuery('<'),
      ...ccAccountIds,
      budgetId,
      month
    );

    const ensure = (catId: number, accId: number) => {
      let byAccount = result.get(catId);
      if (!byAccount) {
        byAccount = new Map();
        result.set(catId, byAccount);
      }
      let entry = byAccount.get(accId);
      if (!entry) {
        entry = { current: 0, prior: 0 };
        byAccount.set(accId, entry);
      }
      return entry;
    };

    for (const row of currentRows) {
      ensure(row.CategoryID, row.AccountID).current = row.spending;
    }
    for (const row of priorRows) {
      ensure(row.CategoryID, row.AccountID).prior = row.spending;
    }

    return result;
  }

  /**
   * GetCCAccountPaymentCategoryMap - Returns a map of CC accountId -> the
   * `cc_payment_category_id` stored in that account's metadata. Used to route
   * per-account funding to the correct CC Payment category.
   */
  getCCAccountPaymentCategoryMap(budgetId: number): Map<number, number> {
    const result = new Map<number, number>();
    const rows = allRows<{ ID: number; Metadata: string }>(
      this.db,
      `
      SELECT ID, Metadata FROM accounts
      WHERE BudgetID = ? AND LOWER(Type) = 'credit' AND Metadata IS NOT NULL
    `,
      budgetId
    );

    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.Metadata || '{}');
        if (metadata.cc_payment_category_id) {
          result.set(row.ID, metadata.cc_payment_category_id);
        }
      } catch {
        // skip malformed metadata
      }
    }
    return result;
  }

  /**
   * GetCCAccountBalances - Signed balance of each credit-card account as of
   * the end of `month` (negative = debt), from the same raw Inflow/Outflow the
   * CC funding and payment math use. Display-only: attached to CC Payment rows
   * so the UI can contrast "set aside" with "owed".
   */
  getCCAccountBalances(month: string, budgetId: number): Map<number, number> {
    const rows = allRows<{ AccountID: number; balance: number }>(
      this.db,
      `
      SELECT t.AccountID AS AccountID,
             COALESCE(SUM(t.Inflow - t.Outflow), 0) AS balance
      FROM transactions t
      JOIN accounts a ON a.ID = t.AccountID
      WHERE a.BudgetID = ?
        AND LOWER(a.Type) = 'credit'
        AND strftime('%Y-%m', t.Date) <= ?
      GROUP BY t.AccountID
    `,
      budgetId,
      month
    );

    const result = new Map<number, number>();
    for (const row of rows) {
      result.set(row.AccountID, row.balance || 0);
    }
    return result;
  }
}
