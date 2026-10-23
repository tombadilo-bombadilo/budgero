import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { asMilli } from '../../money/index.js';
import { NO_SPLITS_FILTER } from '../transactions/queries.js';
import {
  Assignment,
  GetMonthlyBudgetRow,
  AssignmentsByMonthRow,
  ReadyToAssignBreakdown,
} from './types.js';
import type { RtaMode } from '../budgets/types.js';

import { createLogger } from '../../logger.js';

const debugLog = createLogger('services:monthly-budgets:queries');

// Split-aware ledger through ?2 for budget ?1. A positive credit-card balance
// is cash: spending it must not reserve the same money again for a card payment.
// ToCash marks card cash-advance legs (CASH_ADVANCE_ROW / _SPLIT; rows only in
// the Transfers category). `accounts` narrows the accounts (the cumulative
// cash-advance sum reads only cards).
const activityCte = (accounts = '') => `
  ledger_lines AS (
    SELECT t.ID AS TransactionID, t.AccountID, t.CategoryID, t.Month, t.Date,
           0 AS PartIndex, t.OutflowConverted AS TransactionOutflow,
           t.InflowConverted - t.OutflowConverted AS Amount, LOWER(a.Type) AS AccountType,
           CASE WHEN LOWER(a.Type) = 'credit' AND +t.CategoryID IN (${categoriesInGroup('Transfers')})
                THEN ${CASH_ADVANCE_ROW('t')} ELSE 0 END AS ToCash
    FROM transactions t JOIN accounts a ON a.ID = t.AccountID
    WHERE t.BudgetID = ?1 AND t.Month <= ?2 AND a.OnBudget = TRUE ${accounts} ${NO_SPLITS_FILTER}
    UNION ALL
    SELECT t.ID, t.AccountID, s.CategoryID, t.Month, t.Date, s.OrderIndex,
           t.OutflowConverted, s.InflowConverted - s.OutflowConverted, LOWER(a.Type),
           CASE WHEN LOWER(a.Type) = 'credit' THEN ${CASH_ADVANCE_SPLIT('s', 't')} ELSE 0 END
    FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID
    JOIN accounts a ON a.ID = t.AccountID
    WHERE t.BudgetID = ?1 AND t.Month <= ?2 AND a.OnBudget = TRUE ${accounts}
  ),
  ledger_balances AS (
    SELECT *, SUM(Amount) OVER (
      PARTITION BY AccountID ORDER BY Date, TransactionOutflow DESC, TransactionID, PartIndex
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS BalanceAfter
    FROM ledger_lines
  ),
  monthly_activity AS (
    SELECT *, CASE WHEN AccountType <> 'credit' THEN Amount
      ELSE MAX(0, BalanceAfter) - MAX(0, BalanceAfter - Amount) END AS Cash
    FROM ledger_balances
  )
`;

// IDs of the categories in the system group `name` (the old categories /
// category_groups join, as a filter).
function categoriesInGroup(name: 'Transfers') {
  return `
  SELECT c.ID FROM categories c
  JOIN category_groups cg ON c.CategoryGroupID = cg.ID
  WHERE cg.Name = '${name}'
`;
}

// Distinct TransferIDs with a leg on an off-budget, non-debt account (savings,
// investment, tracking). The transfer sums join an on-budget leg `t` to this
// list instead of testing "EXISTS a partner leg on such an account" per leg:
// same rows (the partner can't be t itself, t's account is on budget, and
// DISTINCT keeps one match per leg), but SQLite reads those few accounts' rows
// and then seeks the partial TransferID index per ID, instead of probing the
// partner of every transfer leg in the budget. CROSS JOIN pins that order.
// Callers add `t.TransferID <> ''` (so the partial index applies) and
// `+t.CategoryID` / `+t.BudgetID` (so the planner stays off those indexes).
const OFF_BUDGET_PARTNER_TRANSFERS = `(
  SELECT DISTINCT mirror.TransferID AS TransferID
  FROM accounts oa
  CROSS JOIN transactions mirror ON mirror.AccountID = oa.ID
  WHERE oa.OnBudget = FALSE
    AND LOWER(oa.Type) NOT IN ('credit', 'loan', 'mortgage')
    AND +mirror.TransferID != ''
)`;

// A transfer inflow on a credit account `t` is a card payment unless its
// partner leg is on another on-budget debt account (credit, loan, mortgage):
// a balance transfer moves debt, not cash, so it must not drain the card's CC
// Payment category (#69). Money already set aside for the paid-down card stays
// there; moving it to the other card's payment category is left to the user.
// The partner is the other row with the same TransferID, or for a
// split-transfer mirror (TransferID `split_transfer_<parentId>_<date>`, shared
// by sibling mirrors) the split parent. An unpaired leg stays a payment.
const DEBT_TYPES = "('credit', 'loan', 'mortgage')";
const partnerLeg = (t: string, account: string) => `(CASE
  WHEN ${t}.TransferID GLOB 'split_transfer_*' THEN EXISTS (
    SELECT 1 FROM transactions p JOIN accounts pa ON pa.ID = p.AccountID
    WHERE p.ID = CAST(substr(${t}.TransferID, 16) AS INTEGER) AND ${account})
  ELSE EXISTS (
    SELECT 1 FROM transactions p JOIN accounts pa ON pa.ID = p.AccountID
    WHERE p.TransferID = ${t}.TransferID AND p.TransferID != '' AND p.ID != ${t}.ID
      AND ${account})
END)`;
export const DEBT_PARTNER_LEG = (t: string) =>
  partnerLeg(t, `pa.OnBudget = TRUE AND LOWER(pa.Type) IN ${DEBT_TYPES}`);

// A card leg moving money out to an on-budget cash account (checking,
// savings, cash, PayPal...): a cash advance (#67). The part of it that grows
// the card's debt is new budgetable cash (YNAB: "Inflow from Debt Account");
// the part paid out of a positive card balance is cash moving between accounts.
// Same partner rules as DEBT_PARTNER_LEG; a card split line transferring to
// such an account (TransferAccountID) counts too. 1 = a row (counted only in
// the Transfers category), 2 = a split line; 0 otherwise. `t` / `s` are the
// row / split line of a credit-account line, `a` its account.
const CASH_ACCOUNT = `pa.OnBudget = TRUE AND LOWER(pa.Type) NOT IN ${DEBT_TYPES}`;
export const CASH_ADVANCE_ROW = (t: string) => `(CASE
  WHEN ${t}.TransferID != '' AND ${t}.OutflowConverted > 0 AND ${t}.ExcludeFromReadyToAssign = FALSE
    AND ${partnerLeg(t, CASH_ACCOUNT)} THEN 1 ELSE 0 END)`;
export const CASH_ADVANCE_SPLIT = (s: string, t: string) => `(CASE
  WHEN ${s}.TransferAccountID IS NOT NULL AND ${s}.OutflowConverted > 0
    AND ${t}.ExcludeFromReadyToAssign = FALSE
    AND EXISTS (SELECT 1 FROM accounts pa WHERE pa.ID = ${s}.TransferAccountID AND ${CASH_ACCOUNT})
  THEN 2 ELSE 0 END)`;

const MONTHLY_ACTIVITY_CTE = activityCte();
const CARD_ACTIVITY_CTE = activityCte("AND LOWER(a.Type) = 'credit'");

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

  getMonthlyAssignmentValues(
    assignments: { categoryId: number; month: string; budgetId: number }[]
  ): number[] {
    if (assignments.length === 0) return [];

    const values = new Map<string, number>();
    const chunkSize = 250;
    for (let index = 0; index < assignments.length; index += chunkSize) {
      const chunk = assignments.slice(index, index + chunkSize);
      const predicates = chunk.map(() => '(CategoryID = ? AND Month = ? AND BudgetID = ?)');
      const params = chunk.flatMap((assignment) => [
        assignment.categoryId,
        assignment.month,
        assignment.budgetId,
      ]);
      const rows = allRows<{
        CategoryID: number;
        Month: string;
        BudgetID: number;
        Amount: number;
      }>(
        this.db,
        `
        SELECT CategoryID, Month, BudgetID, Amount
        FROM assignments
        WHERE ${predicates.join(' OR ')}
      `,
        ...params
      );

      for (const row of rows) {
        values.set(`${row.CategoryID}:${row.Month}:${row.BudgetID}`, row.Amount);
      }
    }

    return assignments.map(
      (assignment) =>
        values.get(`${assignment.categoryId}:${assignment.month}:${assignment.budgetId}`) ?? 0
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
          { ID: number; Amount: number } | undefined;
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

  getCategoryAssignmentHelpers(
    categoryIds: number[],
    lastMonth: string
  ): { lastMonth: Record<number, number>; average: Record<number, number> } {
    const ids = [...new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0))];
    const result = {
      lastMonth: {} as Record<number, number>,
      average: {} as Record<number, number>,
    };
    for (const id of ids) {
      result.lastMonth[id] = 0;
      result.average[id] = 0;
    }

    const chunkSize = 500;
    for (let index = 0; index < ids.length; index += chunkSize) {
      const chunk = ids.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = allRows<{ CategoryID: number; LastMonth: number; Average: number }>(
        this.db,
        `
        SELECT
          CategoryID,
          COALESCE(MAX(CASE WHEN Month = ? THEN Amount END), 0) AS LastMonth,
          COALESCE(CAST(ROUND(AVG(Amount)) AS INTEGER), 0) AS Average
        FROM assignments
        WHERE CategoryID IN (${placeholders})
        GROUP BY CategoryID
      `,
        lastMonth,
        ...chunk
      );

      for (const row of rows) {
        result.lastMonth[row.CategoryID] = row.LastMonth;
        result.average[row.CategoryID] = row.Average;
      }
    }

    return result;
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
  readyToAssign(budgetId: number, asOfDate: string): ReadyToAssignBreakdown {
    // Get total income (NET of inflow - outflow for Income category) for all time.
    // Driven from the Income categories (CROSS JOIN pins the order) so SQLite
    // reads only their rows on the category index, not every row of the budget.
    const incomeResult = getRow(
      this.db,
      `
      SELECT IFNULL(SUM(t.InflowConverted - t.OutflowConverted), 0) as total_income
      FROM category_groups cg
      CROSS JOIN categories c ON c.CategoryGroupID = cg.ID
      CROSS JOIN transactions t ON t.CategoryID = c.ID
      INNER JOIN accounts acc ON t.AccountID = acc.ID
      WHERE cg.Name = 'Income'
        AND +t.BudgetID = ?1
        AND acc.OnBudget = TRUE
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
      SELECT IFNULL(SUM(t.OutflowConverted), 0) as total_offbudget_transfers
      FROM ${OFF_BUDGET_PARTNER_TRANSFERS} partner
      CROSS JOIN transactions t ON partner.TransferID = t.TransferID
      INNER JOIN accounts src ON t.AccountID = src.ID
      WHERE t.TransferID <> ''
        AND +t.CategoryID IN (${categoriesInGroup('Transfers')})
        AND +t.BudgetID = ?1
        AND src.OnBudget = TRUE
        AND t.OutflowConverted > 0
        AND t.ExcludeFromReadyToAssign = FALSE
        AND DATE(t.Date) <= DATE(?2)
    `,
      budgetId,
      asOfDate
    );
    const totalOffBudgetTransfers = offBudgetTransfersResult?.total_offbudget_transfers ?? 0;

    // Mirror of the above: money moved FROM an off-budget account (savings,
    // investment, tracking) INTO an on-budget account is fresh budgetable cash,
    // so it increases RTA. Same 'Transfers' category and non-debt off-budget
    // source conditions as the outbound leg, just the inflow side.
    const inBudgetTransfersResult = getRow<{ total_inbudget_transfers: number }>(
      this.db,
      `
      SELECT IFNULL(SUM(t.InflowConverted), 0) as total_inbudget_transfers
      FROM ${OFF_BUDGET_PARTNER_TRANSFERS} partner
      CROSS JOIN transactions t ON partner.TransferID = t.TransferID
      INNER JOIN accounts dst ON t.AccountID = dst.ID
      WHERE t.TransferID <> ''
        AND +t.CategoryID IN (${categoriesInGroup('Transfers')})
        AND +t.BudgetID = ?1
        AND dst.OnBudget = TRUE
        AND t.InflowConverted > 0
        AND t.ExcludeFromReadyToAssign = FALSE
        AND DATE(t.Date) <= DATE(?2)
    `,
      budgetId,
      asOfDate
    );
    const totalInBudgetTransfers = inBudgetTransfersResult?.total_inbudget_transfers ?? 0;

    // Journaled rate true-ups on on-budget foreign-currency accounts: the
    // budget's purchasing power moved with the market, so RTA moves with it.
    const revaluationsResult = getRow<{ total_revaluations: number }>(
      this.db,
      `
      SELECT IFNULL(SUM(r.DeltaConverted), 0) as total_revaluations
      FROM account_revaluations r
      INNER JOIN accounts a ON r.AccountID = a.ID
      WHERE r.BudgetID = ?1
        AND a.OnBudget = TRUE
        AND DATE(r.Date) <= DATE(?2)
    `,
      budgetId,
      asOfDate
    );
    const totalRevaluations = revaluationsResult?.total_revaluations ?? 0;
    const totalDebtInflows = this.cashAdvancesThrough(budgetId, asOfDate);

    const readyToAssign =
      incomeResult.total_income -
      assignmentsResult.total_assignments -
      totalOffBudgetTransfers +
      totalInBudgetTransfers +
      totalDebtInflows +
      totalRevaluations;

    debugLog(`Ready to Assign (static, all-time):`);
    debugLog(`  Total Income: ${incomeResult.total_income.toLocaleString()}`);
    debugLog(`  Total Assignments: ${assignmentsResult.total_assignments.toLocaleString()}`);
    debugLog(`  Off-budget transfers: ${totalOffBudgetTransfers.toLocaleString()}`);
    debugLog(`  On-budget transfers: ${totalInBudgetTransfers.toLocaleString()}`);
    debugLog(`  Ready to Assign: ${readyToAssign.toLocaleString()}`);

    return {
      mode: 'cumulative',
      month: asOfDate,
      income: asMilli(incomeResult.total_income),
      assignments: asMilli(assignmentsResult.total_assignments),
      futureAssignments: asMilli(0),
      offBudgetTransfers: asMilli(totalOffBudgetTransfers),
      inBudgetTransfers: asMilli(totalInBudgetTransfers),
      debtInflows: asMilli(totalDebtInflows),
      revaluations: asMilli(totalRevaluations),
      priorCashOverspend: asMilli(0),
      readyToAssign: asMilli(readyToAssign),
    };
  }

  /**
   * Cash advances dated on or before `asOfDate`: the part of each card ->
   * on-budget cash account transfer that grew the card's debt (#67).
   */
  cashAdvancesThrough(budgetId: number, asOfDate: string): number {
    const row = getRow<{ total: number }>(
      this.db,
      `
      WITH ${CARD_ACTIVITY_CTE}
      SELECT IFNULL(SUM(Cash - Amount), 0) AS total
      FROM monthly_activity
      WHERE ToCash <> 0 AND Amount < 0 AND DATE(Date) <= DATE(?3)
    `,
      budgetId,
      asOfDate.slice(0, 7),
      asOfDate
    );
    return row?.total ?? 0;
  }

  /** Reads a budget's Ready to Assign mode, defaulting to 'cumulative'. */
  getRtaMode(budgetId: number): RtaMode {
    const row = getRow<{ RtaMode: string | null }>(
      this.db,
      `SELECT RtaMode FROM budgets WHERE ID = ?`,
      budgetId
    );
    return row?.RtaMode === 'monthly' ? 'monthly' : 'cumulative';
  }

  /**
   * ReadyToAssignMonthly - YNAB-style Ready to Assign for a single month.
   *
   * Counts income and assignments only up to and including `month`, subtracts
   * prior-month cash overspending (each overspent category's negative cash
   * balance is pulled from Ready to Assign the month after it happens, rather
   * than carried inside the category). A historical month's API value is not
   * retroactively reduced by assignments made in later months; those affect
   * Ready to Assign when their own month is reached.
   * Credit-card overspending is left to the CC Payment system and never
   * deducted here.
   */
  readyToAssignMonthly(budgetId: number, month: string): ReadyToAssignBreakdown {
    const result = this.readyToAssignMonthlyBatch(budgetId, [month]).get(month);
    if (!result) {
      throw new Error(`Failed to calculate monthly Ready to Assign for ${month}`);
    }
    return result;
  }

  /**
   * ReadyToAssignMonthlyBatch - Calculates YNAB-style Ready to Assign across multiple months
   * in a single pass (O(N) instead of O(N^2)).
   */
  readyToAssignMonthlyBatch(
    budgetId: number,
    months: string[]
  ): Map<string, ReadyToAssignBreakdown> {
    const result = new Map<string, ReadyToAssignBreakdown>();
    if (months.length === 0) return result;

    const maxMonth = months.reduce((max, m) => (m > max ? m : max), months[0]);

    // 1. Grouped monthly income
    const incomeRows = allRows<{ Month: string; total: number; debt: number }>(
      this.db,
      `
      WITH ${MONTHLY_ACTIVITY_CTE}
      SELECT line.Month,
             IFNULL(SUM(CASE WHEN line.ToCash = 0
               THEN CASE WHEN line.AccountType = 'credit' THEN line.Cash ELSE line.Amount END
               ELSE 0 END), 0) AS total,
             IFNULL(SUM(CASE WHEN line.ToCash <> 0 AND line.Amount < 0
               THEN line.Cash - line.Amount ELSE 0 END), 0) AS debt
      FROM monthly_activity line
      LEFT JOIN categories c ON line.CategoryID = c.ID
      LEFT JOIN category_groups cg ON c.CategoryGroupID = cg.ID
      WHERE cg.Name = 'Income'
        OR (line.AccountType = 'credit' AND cg.Name = 'Transfers')
        OR line.ToCash <> 0
      GROUP BY line.Month
    `,
      budgetId,
      maxMonth
    );
    // Cash advances: the part of a card -> cash-account transfer that grew the
    // card's debt (#67); its positive-balance part is left out of income.
    const monthlyIncome = new Map<string, number>();
    const monthlyDebt = new Map<string, number>();
    for (const r of incomeRows) {
      monthlyIncome.set(r.Month, r.total);
      if (r.debt) monthlyDebt.set(r.Month, r.debt);
    }

    // 2. Grouped monthly assignments
    const assignmentRows = allRows<{ Month: string; total: number }>(
      this.db,
      `
      SELECT Month, IFNULL(SUM(Amount), 0) as total
      FROM assignments
      WHERE BudgetID = ?1 AND Month <= ?2
      GROUP BY Month
    `,
      budgetId,
      maxMonth
    );
    const monthlyAssignments = new Map<string, number>();
    for (const r of assignmentRows) monthlyAssignments.set(r.Month, r.total);

    // 3. Grouped monthly off-budget transfers
    const offBudgetRows = allRows<{ Month: string; total: number }>(
      this.db,
      `
      SELECT t.Month, IFNULL(SUM(t.OutflowConverted), 0) as total
      FROM ${OFF_BUDGET_PARTNER_TRANSFERS} partner
      CROSS JOIN transactions t ON partner.TransferID = t.TransferID
      INNER JOIN accounts src ON t.AccountID = src.ID
      WHERE t.TransferID <> ''
        AND +t.CategoryID IN (${categoriesInGroup('Transfers')})
        AND +t.BudgetID = ?1
        AND src.OnBudget = TRUE
        AND t.OutflowConverted > 0
        AND t.ExcludeFromReadyToAssign = FALSE
        AND t.Month <= ?2
      GROUP BY t.Month
    `,
      budgetId,
      maxMonth
    );
    const monthlyOffBudget = new Map<string, number>();
    for (const r of offBudgetRows) monthlyOffBudget.set(r.Month, r.total);

    // 4. Grouped monthly in-budget transfers
    const inBudgetRows = allRows<{ Month: string; total: number }>(
      this.db,
      `
      SELECT t.Month, IFNULL(SUM(t.InflowConverted), 0) as total
      FROM ${OFF_BUDGET_PARTNER_TRANSFERS} partner
      CROSS JOIN transactions t ON partner.TransferID = t.TransferID
      INNER JOIN accounts dst ON t.AccountID = dst.ID
      WHERE t.TransferID <> ''
        AND +t.CategoryID IN (${categoriesInGroup('Transfers')})
        AND +t.BudgetID = ?1
        AND dst.OnBudget = TRUE
        AND t.InflowConverted > 0
        AND t.ExcludeFromReadyToAssign = FALSE
        AND t.Month <= ?2
      GROUP BY t.Month
    `,
      budgetId,
      maxMonth
    );
    const monthlyInBudget = new Map<string, number>();
    for (const r of inBudgetRows) monthlyInBudget.set(r.Month, r.total);

    // 5. Grouped monthly revaluations
    const revalRows = allRows<{ Month: string; total: number }>(
      this.db,
      `
      SELECT strftime('%Y-%m', r.Date) as Month, IFNULL(SUM(r.DeltaConverted), 0) as total
      FROM account_revaluations r
      INNER JOIN accounts a ON r.AccountID = a.ID
      WHERE r.BudgetID = ?1 AND a.OnBudget = TRUE AND strftime('%Y-%m', r.Date) <= ?2
      GROUP BY strftime('%Y-%m', r.Date)
    `,
      budgetId,
      maxMonth
    );
    const monthlyReval = new Map<string, number>();
    for (const r of revalRows) monthlyReval.set(r.Month, r.total);

    // 6. Single-pass rollforward across the timeline
    const nextMonth = (() => {
      const [yearStr, monthStr] = maxMonth.split('-');
      let y = parseInt(yearStr, 10);
      let mon = parseInt(monthStr, 10);
      mon++;
      if (mon > 12) {
        mon = 1;
        y++;
      }
      return `${y}-${String(mon).padStart(2, '0')}`;
    })();

    const { priorCashOverspendDetails: allPriorCashOverspendDetails } =
      this.computeMonthlyRollforward(budgetId, nextMonth);

    // Collect all distinct months in chronological order
    const allMonthsSet = new Set<string>(months);
    for (const m of monthlyIncome.keys()) allMonthsSet.add(m);
    for (const m of monthlyAssignments.keys()) allMonthsSet.add(m);
    for (const m of monthlyOffBudget.keys()) allMonthsSet.add(m);
    for (const m of monthlyInBudget.keys()) allMonthsSet.add(m);
    for (const m of monthlyReval.keys()) allMonthsSet.add(m);
    const timeline = [...allMonthsSet].filter((m) => m <= maxMonth).sort();

    // Running cumulative totals across timeline
    const cumIncome = new Map<string, number>();
    const cumAssignments = new Map<string, number>();
    const cumOffBudget = new Map<string, number>();
    const cumInBudget = new Map<string, number>();
    const cumReval = new Map<string, number>();
    const cumDebt = new Map<string, number>();

    let runningIncome = 0;
    let runningDebt = 0;
    let runningAssignments = 0;
    let runningOffBudget = 0;
    let runningInBudget = 0;
    let runningReval = 0;

    for (const m of timeline) {
      runningIncome += monthlyIncome.get(m) ?? 0;
      runningAssignments += monthlyAssignments.get(m) ?? 0;
      runningOffBudget += monthlyOffBudget.get(m) ?? 0;
      runningInBudget += monthlyInBudget.get(m) ?? 0;
      runningReval += monthlyReval.get(m) ?? 0;
      runningDebt += monthlyDebt.get(m) ?? 0;

      cumIncome.set(m, runningIncome);
      cumDebt.set(m, runningDebt);
      cumAssignments.set(m, runningAssignments);
      cumOffBudget.set(m, runningOffBudget);
      cumInBudget.set(m, runningInBudget);
      cumReval.set(m, runningReval);
    }

    for (const month of months) {
      const inc = cumIncome.get(month) ?? runningIncome;
      const ass = cumAssignments.get(month) ?? runningAssignments;
      const off = cumOffBudget.get(month) ?? runningOffBudget;
      const inB = cumInBudget.get(month) ?? runningInBudget;
      const rev = cumReval.get(month) ?? runningReval;
      const debt = cumDebt.get(month) ?? runningDebt;

      const overspendsForMonth = allPriorCashOverspendDetails.filter((o) => o.month < month);
      const priorCashOverspend = overspendsForMonth.reduce((sum, o) => sum + o.amount, 0);

      const leftover = inc - ass - off + inB + debt + rev - priorCashOverspend;
      const readyToAssign = leftover;

      debugLog(`Ready to Assign (batch, through ${month}):`);
      debugLog(`  Income: ${inc.toLocaleString()}`);
      debugLog(`  Assignments: ${ass.toLocaleString()}`);
      debugLog(`  Off-budget transfers: ${off.toLocaleString()}`);
      debugLog(`  On-budget transfers: ${inB.toLocaleString()}`);
      debugLog(`  Prior cash overspend: ${priorCashOverspend.toLocaleString()}`);
      debugLog(`  Ready to Assign: ${readyToAssign.toLocaleString()}`);

      result.set(month, {
        mode: 'monthly',
        month,
        income: asMilli(inc),
        assignments: asMilli(ass),
        futureAssignments: asMilli(0),
        offBudgetTransfers: asMilli(off),
        inBudgetTransfers: asMilli(inB),
        debtInflows: asMilli(debt),
        revaluations: asMilli(rev),
        priorCashOverspend: asMilli(priorCashOverspend),
        readyToAssign: asMilli(readyToAssign),
        priorCashOverspendDetails: overspendsForMonth.map((o) => ({
          categoryId: o.categoryId,
          categoryName: o.categoryName,
          categoryGroupName: o.categoryGroupName,
          month: o.month,
          amount: asMilli(o.amount),
        })),
      });
    }

    return result;
  }

  /**
   * Per-category monthly series (assigned + activity split into cash vs credit)
   * for every month up to and including `throughMonth`, restricted to the
   * spendable groups. Feeds the month-by-month rollforward in monthly mode.
   */
  private getCategoryMonthlySeries(
    budgetId: number,
    throughMonth: string
  ): { CategoryID: number; Month: string; Assigned: number; Cash: number; Credit: number }[] {
    return allRows<{
      CategoryID: number;
      Month: string;
      Assigned: number;
      Cash: number;
      Credit: number;
    }>(
      this.db,
      `
      WITH ${MONTHLY_ACTIVITY_CTE}, contributions AS (
        SELECT a.CategoryID, a.Month, a.Amount AS Assigned, 0 AS Cash, 0 AS Credit
        FROM assignments a WHERE a.BudgetID = ?1 AND a.Month <= ?2
        UNION ALL
        SELECT CategoryID, Month, 0, Cash, Amount - Cash FROM monthly_activity
      )
      SELECT con.CategoryID AS CategoryID, con.Month AS Month,
             SUM(con.Assigned) AS Assigned, SUM(con.Cash) AS Cash, SUM(con.Credit) AS Credit
      FROM contributions con
      JOIN categories c ON c.ID = con.CategoryID
      JOIN category_groups cg ON cg.ID = c.CategoryGroupID
      WHERE cg.Name NOT IN ('Income', 'Transfers', 'Credit Card Payments')
      GROUP BY con.CategoryID, con.Month
      ORDER BY con.CategoryID, con.Month
    `,
      budgetId,
      throughMonth
    );
  }

  /**
   * Individual credit purchases and refunds in funding order. Monthly totals
   * lose which card made a purchase first when a category is underfunded.
   */
  private getCreditPurchasesInFundingOrder(
    budgetId: number,
    throughMonth: string
  ): { CategoryID: number; AccountID: number; Month: string; Spend: number }[] {
    return allRows<{ CategoryID: number; AccountID: number; Month: string; Spend: number }>(
      this.db,
      `
      WITH ${MONTHLY_ACTIVITY_CTE}
      SELECT con.CategoryID, con.AccountID, con.Month, con.Cash - con.Amount AS Spend
      FROM monthly_activity con
      JOIN categories c ON c.ID = con.CategoryID
      JOIN category_groups cg ON cg.ID = c.CategoryGroupID
      WHERE con.AccountType = 'credit'
        AND cg.Name NOT IN ('Income', 'Transfers', 'Credit Card Payments')
      ORDER BY con.Date, con.TransactionOutflow DESC, con.TransactionID, con.PartIndex
    `,
      budgetId,
      throughMonth
    );
  }

  /**
   * Card payments per card per month: transfers into a credit account, except
   * from another on-budget debt account (see DEBT_PARTNER_LEG).
   */
  private getCardPaymentsByMonth(
    budgetId: number,
    throughMonth: string
  ): { AccountID: number; Month: string; Payments: number }[] {
    return allRows<{ AccountID: number; Month: string; Payments: number }>(
      this.db,
      `
      SELECT t.AccountID AS AccountID, t.Month AS Month,
             COALESCE(SUM(t.InflowConverted), 0) AS Payments
      FROM transactions t
      JOIN accounts acc ON acc.ID = t.AccountID
      WHERE t.BudgetID = ?1 AND LOWER(acc.Type) = 'credit'
        AND t.Month <= ?2
        AND t.TransferID IS NOT NULL AND t.TransferID != '' AND t.InflowConverted > 0
        AND NOT ${DEBT_PARTNER_LEG('t')}
      GROUP BY t.AccountID, t.Month
    `,
      budgetId,
      throughMonth
    );
  }

  /** Assignments made directly to CC Payment categories, per category per month. */
  private getPaymentCategoryAssignmentsByMonth(
    budgetId: number,
    throughMonth: string
  ): { CategoryID: number; Month: string; Assigned: number }[] {
    return allRows<{ CategoryID: number; Month: string; Assigned: number }>(
      this.db,
      `
      SELECT a.CategoryID AS CategoryID, a.Month AS Month, SUM(a.Amount) AS Assigned
      FROM assignments a
      JOIN categories c ON c.ID = a.CategoryID
      JOIN category_groups cg ON cg.ID = c.CategoryGroupID
      WHERE a.BudgetID = ?1 AND a.Month <= ?2 AND cg.Name = 'Credit Card Payments'
      GROUP BY a.CategoryID, a.Month
    `,
      budgetId,
      throughMonth
    );
  }

  /**
   * Per-category activity for a single month, split by account kind (net;
   * negative = spending). Lets the UI distinguish cash overspend (red) from
   * credit overspend (yellow) and show the cash/credit spending breakdown.
   */
  getActivityByAccountKind(
    month: string,
    budgetId: number,
    monthly = false
  ): Map<number, { cash: number; credit: number }> {
    if (monthly) {
      const rows = allRows<{ CategoryID: number; Cash: number; Credit: number }>(
        this.db,
        `
        WITH ${MONTHLY_ACTIVITY_CTE}
        SELECT CategoryID, SUM(Cash) AS Cash, SUM(Amount - Cash) AS Credit
        FROM monthly_activity WHERE Month = ?2 GROUP BY CategoryID
      `,
        budgetId,
        month
      );
      return new Map(rows.map((row) => [row.CategoryID, { cash: row.Cash, credit: row.Credit }]));
    }
    const rows = allRows<{ CategoryID: number; Cash: number; Credit: number }>(
      this.db,
      `
      WITH contributions AS (
        SELECT s.CategoryID AS CategoryID,
               CASE WHEN LOWER(acc.Type) = 'credit' THEN 0 ELSE s.InflowConverted - s.OutflowConverted END AS Cash,
               CASE WHEN LOWER(acc.Type) = 'credit' THEN s.InflowConverted - s.OutflowConverted ELSE 0 END AS Credit
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts acc ON acc.ID = t.AccountID
        WHERE t.BudgetID = ?2 AND acc.OnBudget = TRUE AND t.Month = ?1
        UNION ALL
        SELECT t.CategoryID,
               CASE WHEN LOWER(acc.Type) = 'credit' THEN 0 ELSE t.InflowConverted - t.OutflowConverted END,
               CASE WHEN LOWER(acc.Type) = 'credit' THEN t.InflowConverted - t.OutflowConverted ELSE 0 END
        FROM transactions t
        JOIN accounts acc ON acc.ID = t.AccountID
        WHERE t.BudgetID = ?2 AND acc.OnBudget = TRUE AND t.Month = ?1
          ${NO_SPLITS_FILTER}
      )
      SELECT CategoryID, SUM(Cash) AS Cash, SUM(Credit) AS Credit
      FROM contributions
      GROUP BY CategoryID
    `,
      month,
      budgetId
    );
    const result = new Map<number, { cash: number; credit: number }>();
    for (const r of rows) result.set(r.CategoryID, { cash: r.Cash, credit: r.Credit });
    return result;
  }

  /**
   * Month-by-month rollforward for monthly RTA mode.
   *
   * Spending categories: a "total" envelope (assigned + all activity) whose
   * floored carry drives the displayed available, and a "cash" envelope
   * (assigned + cash activity) whose floored negatives are cash overspend
   * charged to RTA. Credit overspend is left to the CC Payment system.
   *
   * CC Payment categories: rolled as a running balance
   * `carry + assigned + funded − payments` (positive-carry). `funded` is the
   * covered portion of each month's credit spend — recomputed per month on the
   * floored balances (not all-time), which is what makes a later assignment NOT
   * retroactively fund an earlier credit overspend. If a payment category is
   * overpaid (goes negative) that is cash overspend and also hits RTA.
   *
   * Returns, per spendable category, its displayed available at `month`; per CC
   * Payment category, its rolled available at `month`; and the total prior cash
   * overspend to pull from Ready to Assign.
   */
  computeMonthlyRollforward(
    budgetId: number,
    month: string
  ): {
    availableByCategory: Map<number, number>;
    paymentAvailableByCategory: Map<number, number>;
    paymentActivityByCategory: Map<number, number>;
    paymentCalculationByCategory: Map<
      number,
      { previousAvailable: number; funded: number; payments: number; refunds: number }
    >;
    currentFundingByPaymentCategory: Map<number, Map<number, number>>;
    debtBreakdownByPaymentCat: Map<number, { categoryId: number; month: string; amount: number }[]>;
    priorCashOverspend: number;
    priorCashOverspendDetails: {
      categoryId: number;
      categoryName: string;
      categoryGroupName: string;
      month: string;
      amount: number;
    }[];
  } {
    const categoryMeta = new Map<number, { name: string; groupName: string }>();
    const catRows = allRows<{ ID: number; Name: string; GroupName: string }>(
      this.db,
      `
      SELECT c.ID, c.Name, cg.Name AS GroupName
      FROM categories c
      JOIN category_groups cg ON cg.ID = c.CategoryGroupID
      WHERE c.BudgetID = ?
    `,
      budgetId
    );
    for (const r of catRows) {
      categoryMeta.set(r.ID, { name: r.Name, groupName: r.GroupName });
    }

    const series = this.getCategoryMonthlySeries(budgetId, month);
    const creditSpend = this.getCreditPurchasesInFundingOrder(budgetId, month);
    const cardPayments = this.getCardPaymentsByMonth(budgetId, month);
    const paymentAssignments = this.getPaymentCategoryAssignmentsByMonth(budgetId, month);
    const cardToPaymentCat = this.getCCAccountPaymentCategoryMap(budgetId);

    // Global ascending month axis so every rollforward advances in lockstep;
    // gaps contribute a zero delta and leave the carry untouched.
    const monthSet = new Set<string>([month]);
    for (const r of series) monthSet.add(r.Month);
    for (const r of creditSpend) monthSet.add(r.Month);
    for (const r of cardPayments) monthSet.add(r.Month);
    for (const r of paymentAssignments) monthSet.add(r.Month);
    const allMonths = [...monthSet].filter((m) => m <= month).sort();

    // series[cat][month] -> {Assigned, Cash, Credit}
    const seriesByCat = new Map<
      number,
      Map<string, { Assigned: number; Cash: number; Credit: number }>
    >();
    for (const r of series) {
      let byMonth = seriesByCat.get(r.CategoryID);
      if (!byMonth) seriesByCat.set(r.CategoryID, (byMonth = new Map()));
      byMonth.set(r.Month, { Assigned: r.Assigned, Cash: r.Cash, Credit: r.Credit });
    }
    // creditSpend[cat][month] -> [{card, spend}]
    const creditByCat = new Map<number, Map<string, { card: number; spend: number }[]>>();
    for (const r of creditSpend) {
      let byMonth = creditByCat.get(r.CategoryID);
      if (!byMonth) creditByCat.set(r.CategoryID, (byMonth = new Map()));
      const list = byMonth.get(r.Month) ?? [];
      list.push({ card: r.AccountID, spend: r.Spend });
      byMonth.set(r.Month, list);
    }

    const availableByCategory = new Map<number, number>();
    // fundedByPaymentCat[paymentCatId][month] -> funded amount
    const fundedByPaymentCat = new Map<number, Map<string, number>>();
    const refundsByPaymentCat = new Map<number, Map<string, number>>();
    // refundRequests[paymentCatId][month] -> refunds per spending category, which
    // the payment pass turns into the cash each category got back (#68).
    const refundRequests = new Map<number, Map<string, { categoryId: number; amount: number }[]>>();
    const realizedRefunds = new Map<number, Map<string, number>>();
    const currentFundingByPaymentCategory = new Map<number, Map<number, number>>();
    const addFunded = (paymentCatId: number, categoryId: number, m: string, amount: number) => {
      if (m === month) {
        const sources =
          currentFundingByPaymentCategory.get(paymentCatId) ?? new Map<number, number>();
        sources.set(categoryId, (sources.get(categoryId) ?? 0) + amount);
        currentFundingByPaymentCategory.set(paymentCatId, sources);
      }
      let byMonth = fundedByPaymentCat.get(paymentCatId);
      if (!byMonth) fundedByPaymentCat.set(paymentCatId, (byMonth = new Map()));
      byMonth.set(m, (byMonth.get(m) ?? 0) + amount);
    };
    // debtByPaymentCat[paymentCatId]['catId|month'] -> unfunded credit overspend
    const debtByPaymentCat = new Map<
      number,
      Map<string, { categoryId: number; month: string; amount: number }>
    >();
    const addDebt = (paymentCatId: number, categoryId: number, m: string, amount: number) => {
      let byKey = debtByPaymentCat.get(paymentCatId);
      if (!byKey) debtByPaymentCat.set(paymentCatId, (byKey = new Map()));
      const key = `${categoryId}|${m}`;
      const existing = byKey.get(key);
      if (existing) existing.amount += amount;
      else byKey.set(key, { categoryId, month: m, amount });
    };
    let priorCashOverspend = 0;
    const priorCashOverspendDetails: {
      categoryId: number;
      categoryName: string;
      categoryGroupName: string;
      month: string;
      amount: number;
    }[] = [];

    // Spending-category pass: displayed available + per-card funding attribution.
    // The cash side (rawCash / carryCash) runs after the payment pass, which
    // decides how much of each refund came back out of a CC Payment category.
    const cashSteps = new Map<
      number,
      { m: string; assigned: number; cash: number; displayed: number }[]
    >();
    for (const [categoryId, byMonth] of seriesByCat) {
      let carryTotal = 0;
      const steps: { m: string; assigned: number; cash: number; displayed: number }[] = [];
      cashSteps.set(categoryId, steps);
      for (const m of allMonths) {
        const s = byMonth.get(m) ?? { Assigned: 0, Cash: 0, Credit: 0 };
        const availableToCover = carryTotal + s.Assigned + s.Cash; // before credit spend
        const cards = creditByCat.get(categoryId)?.get(m) ?? [];
        const refunds = new Map<number, number>();
        for (const c of cards) {
          if (c.spend < 0) refunds.set(c.card, (refunds.get(c.card) ?? 0) - c.spend);
        }
        // YNAB's observed refund behavior cancels the same card's earliest
        // purchases first, then reallocates funding to the remaining purchases.
        const purchases = cards
          .filter((c) => c.spend > 0)
          .map((c) => {
            const refunded = Math.min(c.spend, refunds.get(c.card) ?? 0);
            refunds.set(c.card, (refunds.get(c.card) ?? 0) - refunded);
            return { card: c.card, spend: c.spend - refunded };
          });
        let remaining = Math.max(
          0,
          availableToCover + [...refunds.values()].reduce((sum, value) => sum + value, 0)
        );
        for (const c of purchases) {
          const paymentCatId = cardToPaymentCat.get(c.card);
          if (!paymentCatId) continue;
          const funded = Math.min(c.spend, remaining);
          remaining -= funded;
          if (funded > 0) addFunded(paymentCatId, categoryId, m, funded);
          if (c.spend > funded) addDebt(paymentCatId, categoryId, m, c.spend - funded);
        }
        for (const [card, refund] of refunds) {
          const paymentCatId = cardToPaymentCat.get(card);
          if (!paymentCatId || refund === 0) continue;
          let byMonth = refundsByPaymentCat.get(paymentCatId);
          if (!byMonth) refundsByPaymentCat.set(paymentCatId, (byMonth = new Map()));
          byMonth.set(m, (byMonth.get(m) ?? 0) + refund);
          let requests = refundRequests.get(paymentCatId);
          if (!requests) refundRequests.set(paymentCatId, (requests = new Map()));
          const list = requests.get(m) ?? [];
          list.push({ categoryId, amount: refund });
          requests.set(m, list);
        }

        const displayed = carryTotal + s.Assigned + s.Cash + s.Credit;
        steps.push({ m, assigned: s.Assigned, cash: s.Cash, displayed });
        if (m === month) {
          availableByCategory.set(categoryId, displayed);
        } else {
          carryTotal = Math.max(0, displayed);
        }
      }
    }

    // CC Payment-category pass: running balance across all payment categories.
    const paymentAssignedByCat = new Map<number, Map<string, number>>();
    for (const r of paymentAssignments) {
      let byMonth = paymentAssignedByCat.get(r.CategoryID);
      if (!byMonth) paymentAssignedByCat.set(r.CategoryID, (byMonth = new Map()));
      byMonth.set(r.Month, r.Assigned);
    }
    const paymentsByPaymentCat = new Map<number, Map<string, number>>();
    for (const r of cardPayments) {
      const paymentCatId = cardToPaymentCat.get(r.AccountID);
      if (!paymentCatId) continue;
      let byMonth = paymentsByPaymentCat.get(paymentCatId);
      if (!byMonth) paymentsByPaymentCat.set(paymentCatId, (byMonth = new Map()));
      byMonth.set(r.Month, (byMonth.get(r.Month) ?? 0) + r.Payments);
    }

    // A payment category gives back at most what it holds; when several
    // categories' refunds hit one card in a month and only part comes back,
    // the realized amount goes to the categories in ascending CategoryID
    // order, each up to its own refund (deterministic, same as the snapshot).
    const splitRealizedRefund = (
      requests: { categoryId: number; amount: number }[] | undefined,
      m: string,
      realized: number
    ) => {
      if (!requests || realized <= 0) return;
      let left = realized;
      for (const r of [...requests].sort((a, b) => a.categoryId - b.categoryId)) {
        const share = Math.min(r.amount, left);
        if (share <= 0) break;
        left -= share;
        let byMonth = realizedRefunds.get(r.categoryId);
        if (!byMonth) realizedRefunds.set(r.categoryId, (byMonth = new Map()));
        byMonth.set(m, (byMonth.get(m) ?? 0) + share);
      }
    };
    const paymentOverspendDetails: typeof priorCashOverspendDetails = [];

    const paymentCatIds = new Set<number>(cardToPaymentCat.values());
    const paymentAvailableByCategory = new Map<number, number>();
    const paymentActivityByCategory = new Map<number, number>();
    const paymentCalculationByCategory = new Map<
      number,
      { previousAvailable: number; funded: number; payments: number; refunds: number }
    >();
    for (const paymentCatId of paymentCatIds) {
      let carry = 0;
      for (const m of allMonths) {
        const assigned = paymentAssignedByCat.get(paymentCatId)?.get(m) ?? 0;
        const funded = fundedByPaymentCat.get(paymentCatId)?.get(m) ?? 0;
        const payments = paymentsByPaymentCat.get(paymentCatId)?.get(m) ?? 0;
        const refunded = Math.min(
          refundsByPaymentCat.get(paymentCatId)?.get(m) ?? 0,
          Math.max(0, carry + assigned + funded)
        );
        splitRealizedRefund(refundRequests.get(paymentCatId)?.get(m), m, refunded);
        const activity = funded - payments - refunded;
        const raw = carry + assigned + activity;
        if (m === month) {
          paymentAvailableByCategory.set(paymentCatId, raw);
          paymentActivityByCategory.set(paymentCatId, activity);
          paymentCalculationByCategory.set(paymentCatId, {
            previousAvailable: carry,
            funded,
            payments,
            refunds: refunded,
          });
        } else {
          if (raw < 0) {
            const overspent = -raw;
            priorCashOverspend += overspent; // overpaid card = cash overspend
            const meta = categoryMeta.get(paymentCatId);
            paymentOverspendDetails.push({
              categoryId: paymentCatId,
              categoryName: meta?.name ?? `Payment Category #${paymentCatId}`,
              categoryGroupName: meta?.groupName ?? 'Credit Card Payments',
              month: m,
              amount: overspent,
            });
          }
          carry = Math.max(0, raw);
        }
      }
    }

    // Spending-category cash pass. Category cash = carried cash + assigned +
    // cash activity + the part of a card refund that came back out of the CC
    // Payment category (it was cash set aside for the card, so spending or
    // moving it later is not cash overspend). A refund of unfunded credit
    // overspend comes back as nothing and stays credit.
    for (const [categoryId, steps] of cashSteps) {
      let carryCash = 0;
      const refunds = realizedRefunds.get(categoryId);
      for (const { m, assigned, cash, displayed } of steps) {
        if (m === month) continue;
        const rawCash = carryCash + assigned + cash + (refunds?.get(m) ?? 0);
        if (rawCash < 0) {
          const overspent = -rawCash;
          priorCashOverspend += overspent;
          const meta = categoryMeta.get(categoryId);
          priorCashOverspendDetails.push({
            categoryId,
            categoryName: meta?.name ?? `Category #${categoryId}`,
            categoryGroupName: meta?.groupName ?? 'Unknown Group',
            month: m,
            amount: overspent,
          });
        }
        // Credit spending consumes positive category cash before becoming
        // debt. Carrying rawCash independently would make that funded amount
        // available again next month and understate later cash overspending.
        carryCash = Math.max(0, Math.min(rawCash, displayed));
      }
    }
    priorCashOverspendDetails.push(...paymentOverspendDetails);

    const debtBreakdownByPaymentCat = new Map<
      number,
      { categoryId: number; month: string; amount: number }[]
    >();
    for (const [paymentCatId, byKey] of debtByPaymentCat) {
      const events = [...byKey.values()]
        .filter((e) => e.amount > 0)
        .sort((a, b) => a.month.localeCompare(b.month));
      if (events.length > 0) debtBreakdownByPaymentCat.set(paymentCatId, events);
    }

    return {
      availableByCategory,
      paymentAvailableByCategory,
      paymentActivityByCategory,
      paymentCalculationByCategory,
      currentFundingByPaymentCategory,
      debtBreakdownByPaymentCat,
      priorCashOverspend,
      priorCashOverspendDetails,
    };
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
        SELECT s.CategoryID AS category_id, SUM(s.InflowConverted - s.OutflowConverted) AS net
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        WHERE t.BudgetID = ?2 AND t.Month = ?1 AND a.OnBudget = TRUE
        GROUP BY s.CategoryID
        UNION ALL
        SELECT t.CategoryID AS category_id, SUM(t.InflowConverted - t.OutflowConverted) AS net
        FROM transactions t
        JOIN accounts a ON a.ID = t.AccountID
        WHERE t.BudgetID = ?2 AND t.Month = ?1 AND a.OnBudget = TRUE
          ${NO_SPLITS_FILTER}
        GROUP BY t.CategoryID
      ),
      activity_prior AS (
        SELECT s.CategoryID AS category_id, SUM(s.InflowConverted - s.OutflowConverted) AS net
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        JOIN accounts a ON a.ID = t.AccountID
        WHERE t.BudgetID = ?2 AND t.Month < ?1 AND a.OnBudget = TRUE
        GROUP BY s.CategoryID
        UNION ALL
        SELECT t.CategoryID AS category_id, SUM(t.InflowConverted - t.OutflowConverted) AS net
        FROM transactions t
        JOIN accounts a ON a.ID = t.AccountID
        WHERE t.BudgetID = ?2 AND t.Month < ?1 AND a.OnBudget = TRUE
          ${NO_SPLITS_FILTER}
        GROUP BY t.CategoryID
      ),
      activity_month_totals AS (
        SELECT category_id, SUM(net) AS net
        FROM activity_month
        GROUP BY category_id
      ),
      activity_prior_totals AS (
        SELECT category_id, SUM(net) AS net
        FROM activity_prior
        GROUP BY category_id
      ),
      assignment_totals AS (
        SELECT
          a.CategoryID AS category_id,
          SUM(CASE WHEN a.Month = ?1 THEN a.Amount ELSE 0 END) AS assigned,
          SUM(CASE WHEN a.Month < ?1 THEN a.Amount ELSE 0 END) AS assigned_prior
        FROM assignments a
        WHERE a.BudgetID = ?2 AND a.Month <= ?1
        GROUP BY a.CategoryID
      )
      SELECT
        COALESCE(c.Name, '') AS Category,
        COALESCE(c.ID, -1) as CategoryID,
        COALESCE(c.FundingPriority, 3) AS FundingPriority,
        cg.Name AS CategoryGroup,
        cg.ID as CategoryGroupID,

        /* 1) Assigned in selected month */
        COALESCE(at.assigned, 0) AS Assigned,

        /* 2) Activity in selected month (using splits) — integer milliunit sums are exact */
        COALESCE(am.net, 0) AS Activity,

        /* 3) Available = leftover from previous months + assigned - activity */
        (
          COALESCE(at.assigned_prior, 0)
          + COALESCE(ap.net, 0)
          + COALESCE(at.assigned, 0)
          + COALESCE(am.net, 0)
        ) AS Available
      FROM category_groups cg
      LEFT JOIN categories c ON c.CategoryGroupID = cg.ID
      LEFT JOIN assignment_totals at ON at.category_id = c.ID
      LEFT JOIN activity_month_totals am ON am.category_id = c.ID
      LEFT JOIN activity_prior_totals ap ON ap.category_id = c.ID
      WHERE cg.Name != 'Income' and cg.Name != 'Transfers' and cg.Name != 'Uncategorized' and cg.BudgetID = ?2
      ORDER BY CASE WHEN cg.Name = 'Hidden Categories' THEN 1 ELSE 0 END, cg.Position, cg.Name, c.Position, c.Name
    `,
      month,
      budgetId
    );
  }

  /**
   * All-time number of transactions in a category within a budget: rows
   * without splits plus split lines (what the delete-category dialog shows).
   * Kept out of getMonthlyBudget, which used to count every row of the budget
   * on every read for this one dialog.
   */
  getCategoryTransactionCount(categoryId: number, budgetId: number): number {
    const row = getRow<{ count: number }>(
      this.db,
      `
      SELECT
        (SELECT COUNT(*) FROM transactions t
         WHERE t.CategoryID = ?1 AND t.BudgetID = ?2 ${NO_SPLITS_FILTER})
        +
        (SELECT COUNT(*) FROM transaction_splits s
         JOIN transactions t ON t.ID = s.TransactionID
         WHERE s.CategoryID = ?1 AND t.BudgetID = ?2) AS count
    `,
      categoryId,
      budgetId
    );
    return row?.count ?? 0;
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
   * getAssignedPriorToMonth for several categories in one query: categories
   * with no assignment before `month` are absent (read them as 0). Same
   * filter as the single-category version (no BudgetID filter: a category
   * belongs to one budget).
   */
  getAssignedPriorToMonthByCategory(categoryIds: number[], month: string): Map<number, number> {
    const totals = new Map<number, number>();
    if (categoryIds.length === 0) return totals;
    const rows = allRows<{ CategoryID: number; total: number }>(
      this.db,
      `
      SELECT CategoryID, COALESCE(SUM(Amount), 0) AS total
      FROM assignments
      WHERE CategoryID IN (${categoryIds.map(() => '?').join(', ')}) AND Month < ?
      GROUP BY CategoryID
    `,
      ...categoryIds,
      month
    );
    for (const row of rows) totals.set(row.CategoryID, row.total);
    return totals;
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
      SELECT COALESCE(SUM(t.InflowConverted), 0) as payments
      FROM transactions t
      WHERE t.AccountID = ?
        AND t.BudgetID = ?
        AND t.Month ${dateOp} ?
        AND t.TransferID IS NOT NULL
        AND t.TransferID != ''
        AND t.InflowConverted > 0
        AND NOT ${DEBT_PARTNER_LEG('t')}
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
            SELECT SUM(s.InflowConverted - s.OutflowConverted)
            FROM transaction_splits s
            JOIN transactions t ON t.ID = s.TransactionID
            JOIN accounts acc ON acc.ID = t.AccountID
            WHERE s.CategoryID = ?1
              AND t.BudgetID = ?3
              AND t.Month <= fm.Month
              AND acc.OnBudget = TRUE
          ), 0)
          +
          COALESCE((
            SELECT SUM(t.InflowConverted - t.OutflowConverted)
            FROM transactions t
            JOIN accounts acc ON acc.ID = t.AccountID
            WHERE t.CategoryID = ?1
              AND t.BudgetID = ?3
              AND t.Month <= fm.Month
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
    const n = ccAccountIds.length;
    const placeholders = ccAccountIds.map((_, i) => `?${i + 1}`).join(',');

    // Split-aware spending: prefer split lines for transactions that have them,
    // fall back to the parent transaction otherwise (same pattern as the
    // activity CTEs in getMonthlyBudget). Without this, CC spending recorded as
    // a split transaction would never fund the CC Payment category.
    //
    // One pass over the cards' rows up to `month` (idx_transactions_budget_account_month)
    // yields both the current-month and the prior total per (category, card). The
    // filters sit inside each UNION branch so SQLite never reads other accounts
    // or budgets; `+x.CategoryID` keeps it from driving the non-split branch by
    // the category index instead.
    const rows = allRows<{
      CategoryID: number;
      AccountID: number;
      current: number;
      prior: number;
      currentRows: number;
    }>(
      this.db,
      `
      SELECT x.CategoryID, x.AccountID,
             SUM(CASE WHEN x.Month = ?${n + 2} THEN x.OutflowConverted ELSE 0 END) AS current,
             SUM(CASE WHEN x.Month < ?${n + 2} THEN x.OutflowConverted ELSE 0 END) AS prior,
             COUNT(CASE WHEN x.Month = ?${n + 2} THEN 1 END) AS currentRows
      FROM (
        SELECT s.CategoryID AS CategoryID, t.AccountID AS AccountID,
               s.OutflowConverted AS OutflowConverted, t.Month AS Month
        FROM transactions t
        CROSS JOIN transaction_splits s ON s.TransactionID = t.ID
        WHERE t.AccountID IN (${placeholders}) AND t.BudgetID = ?${n + 1} AND t.Month <= ?${n + 2}
          AND s.OutflowConverted > 0
        UNION ALL
        SELECT t.CategoryID, t.AccountID, t.OutflowConverted, t.Month
        FROM transactions t
        WHERE t.AccountID IN (${placeholders}) AND t.BudgetID = ?${n + 1} AND t.Month <= ?${n + 2}
          AND t.OutflowConverted > 0
          ${NO_SPLITS_FILTER}
      ) x
      WHERE +x.CategoryID IN (
        SELECT c.ID FROM categories c
        JOIN category_groups cg ON c.CategoryGroupID = cg.ID
        WHERE cg.Name NOT IN ('Income', 'Transfers', 'Uncategorized', 'Credit Card Payments')
      )
      GROUP BY x.CategoryID, x.AccountID
      ORDER BY x.CategoryID, x.AccountID
    `,
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

    // Insertion order matters downstream (it orders fundingBreakdown): pairs
    // with current-month spending first, then prior-only pairs, as when these
    // were two queries.
    for (const row of rows) {
      if (row.currentRows > 0) ensure(row.CategoryID, row.AccountID).current = row.current;
    }
    for (const row of rows) {
      ensure(row.CategoryID, row.AccountID).prior = row.prior;
    }

    return result;
  }

  /**
   * Card refunds per spending category and card through `month`: non-transfer
   * inflows on credit accounts (any OnBudget), split-aware, same categories as
   * getCCSpendingByCategoryAndAccount. Cumulative CC funding nets them against
   * that card's spending in the category (#68 side finding).
   */
  getCCRefundsByCategoryAndAccount(
    month: string,
    budgetId: number
  ): Map<number, Map<number, number>> {
    const rows = allRows<{ CategoryID: number; AccountID: number; Refunds: number }>(
      this.db,
      `
      SELECT x.CategoryID AS CategoryID, x.AccountID AS AccountID, SUM(x.Amount) AS Refunds
      FROM (
        SELECT s.CategoryID AS CategoryID, t.AccountID AS AccountID, s.InflowConverted AS Amount
        FROM transactions t
        CROSS JOIN transaction_splits s ON s.TransactionID = t.ID
        WHERE t.AccountID IN (SELECT ID FROM accounts WHERE BudgetID = ?1 AND LOWER(Type) = 'credit')
          AND t.BudgetID = ?1 AND t.Month <= ?2 AND s.InflowConverted > 0
          AND (t.TransferID IS NULL OR t.TransferID = '')
        UNION ALL
        SELECT t.CategoryID, t.AccountID, t.InflowConverted
        FROM transactions t
        WHERE t.AccountID IN (SELECT ID FROM accounts WHERE BudgetID = ?1 AND LOWER(Type) = 'credit')
          AND t.BudgetID = ?1 AND t.Month <= ?2 AND t.InflowConverted > 0
          AND (t.TransferID IS NULL OR t.TransferID = '')
          ${NO_SPLITS_FILTER}
      ) x
      WHERE +x.CategoryID IN (
        SELECT c.ID FROM categories c
        JOIN category_groups cg ON c.CategoryGroupID = cg.ID
        WHERE cg.Name NOT IN ('Income', 'Transfers', 'Uncategorized', 'Credit Card Payments')
      )
      GROUP BY x.CategoryID, x.AccountID
    `,
      budgetId,
      month
    );
    const result = new Map<number, Map<number, number>>();
    for (const r of rows) {
      let byCard = result.get(r.CategoryID);
      if (!byCard) result.set(r.CategoryID, (byCard = new Map()));
      byCard.set(r.AccountID, r.Refunds);
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
   * the end of `month` (negative = debt), from the same raw InflowConverted/OutflowConverted the
   * CC funding and payment math use. Display-only: attached to CC Payment rows
   * so the UI can contrast "set aside" with "owed".
   */
  getCCAccountBalances(month: string, budgetId: number): Map<number, number> {
    const rows = allRows<{ AccountID: number; balance: number }>(
      this.db,
      `
      SELECT t.AccountID AS AccountID,
             COALESCE(SUM(t.InflowConverted - t.OutflowConverted), 0) AS balance
      FROM transactions t
      JOIN accounts a ON a.ID = t.AccountID
      WHERE t.BudgetID = ?
        AND LOWER(a.Type) = 'credit'
        AND t.Month <= ?
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
