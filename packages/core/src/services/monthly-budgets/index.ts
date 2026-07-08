import { DatabaseAdapter } from '../../database/interface.js';
import { asMilli, type MilliUnits } from '../../money/index.js';
import { getLocalDateString } from '../../utils/date.js';
import { Assignment, GetMonthlyBudgetRow, AssignmentsByMonthRow, FundingSource } from './types.js';
import { MonthlyBudgetQueries } from './queries.js';

// Re-export types for external use
export type {
  Assignment,
  GetMonthlyBudgetRow,
  AssignmentsByMonthRow,
  FundingSource,
} from './types.js';

/**
 * MonthlyBudgetService - Port of Go monthly_budgets service
 * Handles monthly budget assignments and calculations
 */
export class MonthlyBudgetService {
  private queries: MonthlyBudgetQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new MonthlyBudgetQueries(db);
  }

  /**
   * GetMonthlyBudget - Gets the complete monthly budget view with assignments, activity, and available amounts
   * Includes YNAB-style CC Payment tracking where:
   * - CC spending in real categories auto-funds the CC Payment category
   * - Payments to CC draw from the CC Payment category
   */
  getMonthlyBudget(month: string, budgetId: number): GetMonthlyBudgetRow[] {
    const rows = this.queries.getMonthlyBudget(month, budgetId);

    // Get CC Payment adjustments for YNAB-style tracking
    const ccAdjustments = this.queries.getCCPaymentAdjustments(month, budgetId);
    const ccSpendingByCategoryAndAccount = this.queries.getCCSpendingByCategoryAndAccount(
      month,
      budgetId
    );
    const ccAccountToPaymentCategory = this.queries.getCCAccountPaymentCategoryMap(budgetId);
    // Card balance per payment category — display-only context for the UI
    // (shows "owed" next to "set aside"; never feeds the Available math).
    const ccBalances = this.queries.getCCAccountBalances(month, budgetId);
    const balanceByPaymentCategory = new Map<number, number>();
    for (const [accountId, paymentCategoryId] of ccAccountToPaymentCategory) {
      balanceByPaymentCategory.set(paymentCategoryId, ccBalances.get(accountId) ?? 0);
    }

    // Per-CC-payment-category funded amount + breakdown.
    // Funding from a budgeted category is attributed to the CC payment category
    // of the card(s) that actually did the spending, proportional to each
    // card's share of spending in that category. This prevents funding from
    // being applied identically to every CC payment row.
    const fundedByPaymentCategory = new Map<number, number>();
    const breakdownByPaymentCategory = new Map<number, FundingSource[]>();

    if (ccSpendingByCategoryAndAccount.size > 0) {
      for (const row of rows) {
        const byAccount = ccSpendingByCategoryAndAccount.get(row.CategoryID);
        if (!byAccount || ccAdjustments.has(row.CategoryID)) continue;

        // Total CC spending across all cards on this category
        let totalCCSpending = 0;
        for (const sp of byAccount.values()) {
          totalCCSpending += sp.current + sp.prior;
        }
        if (totalCCSpending <= 0) continue;

        // row.Available already has CC spending subtracted; add it back to get
        // the "what would be available without any CC spending" ceiling.
        const availableBeforeCC = row.Available + totalCCSpending;
        const funded = Math.min(totalCCSpending, Math.max(0, availableBeforeCC));
        if (funded <= 0) continue;

        // Distribute funded amount proportionally per CC account
        for (const [accountId, sp] of byAccount) {
          const accountSpending = sp.current + sp.prior;
          if (accountSpending <= 0) continue;

          const paymentCategoryId = ccAccountToPaymentCategory.get(accountId);
          if (!paymentCategoryId) continue;

          // Proportional share of the funded amount; rounded to integer
          // milliunits per account (sub-milliunit drift is not worth a
          // largest-remainder pass for a tooltip breakdown)
          const accountFunded = asMilli(Math.round(funded * (accountSpending / totalCCSpending)));
          fundedByPaymentCategory.set(
            paymentCategoryId,
            (fundedByPaymentCategory.get(paymentCategoryId) || 0) + accountFunded
          );

          const breakdown = breakdownByPaymentCategory.get(paymentCategoryId) || [];
          breakdown.push({
            categoryId: row.CategoryID,
            categoryName: row.Category,
            amount: accountFunded,
          });
          breakdownByPaymentCategory.set(paymentCategoryId, breakdown);
        }
      }
    }

    if (ccAdjustments.size > 0) {
      for (const row of rows) {
        const adjustment = ccAdjustments.get(row.CategoryID);
        if (adjustment) {
          // CC Payment model:
          // - Activity = Only CC payments (negative, money leaving the "envelope" to pay the card)
          // - Available = Assigned + Funded (from budgeted CC spending) - Payments
          //
          // "Funded" only comes from categories that had budget to cover the CC spending
          // Overspent CC purchases don't fund this category - they're CC debt

          const currentPayments = adjustment.payments;
          const { priorPayments } = adjustment;

          // Activity = negative payments (money spent from this envelope to pay CC)
          row.Activity = asMilli(-currentPayments || 0);

          // Available = Assigned + Funded - Payments (all time)
          const priorAssigned = this.queries.getAssignedPriorToMonth(row.CategoryID, month);
          const totalAssigned = priorAssigned + row.Assigned;
          const totalFunded = asMilli(fundedByPaymentCategory.get(row.CategoryID) || 0);
          const totalPayments = priorPayments + currentPayments;

          row.Available = asMilli(totalAssigned + totalFunded - totalPayments);

          // Attach funding breakdown for UI tooltip (per-card)
          row.fundingBreakdown = breakdownByPaymentCategory.get(row.CategoryID) || [];
          row.totalFunded = totalFunded;
          row.cardBalance = asMilli(balanceByPaymentCategory.get(row.CategoryID) ?? 0);
        }
      }
    }

    return rows;
  }

  /**
   * GetAssignedLastMonth - Gets amount assigned to a category in a previous month
   */
  getAssignedLastMonth(month: string, categoryId: number): number {
    // Parse the incoming "YYYY-MM" string and subtract one calendar month without timezone drift
    // Avoid Date.toISOString() because it converts to UTC and can shift the month in some timezones.
    const [yStr, mStr] = (month || '').split('-');
    let year = parseInt(yStr || '0', 10);
    let mm = parseInt(mStr || '1', 10);
    if (!year || !mm) {
      // Fallback to the previous month based on system time if input is malformed
      const now = new Date();
      year = now.getFullYear();
      mm = now.getMonth() + 1;
    }
    mm -= 1; // previous month
    if (mm <= 0) {
      mm = 12;
      year -= 1;
    }
    const lastMonth = `${String(year).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
    return this.queries.getAssignedLastMonth(lastMonth, categoryId);
  }

  /**
   * GetAverageAssigned - Gets average assignment amount for a category
   */
  getAverageAssigned(categoryId: number): number {
    const avg = this.queries.getAverageAssigned(categoryId);
    return avg || 0;
  }

  /**
   * GetMonthlyAssignment - Gets a specific monthly assignment
   */
  getMonthlyAssignment(categoryId: number, month: string): Assignment | null {
    const assignment = this.queries.getMonthlyAssignment(categoryId, month);
    return assignment || null;
  }

  /**
   * UpdateMonthlyAssignment - Updates an existing monthly assignment
   */
  updateMonthlyAssignment(categoryId: number, amount: MilliUnits, month: string): void {
    this.queries.updateMonthlyAssignment(amount, categoryId, month);
  }

  /**
   * UpsertMonthlyAssignment - Inserts or updates a monthly assignment
   */
  upsertMonthlyAssignment(
    categoryId: number,
    amount: MilliUnits,
    month: string,
    budgetId: number
  ): void {
    const existingAssignment = this.queries.getMonthlyAssignment(categoryId, month);

    if (!existingAssignment) {
      this.queries.addMonthlyAssignment(categoryId, amount, month, budgetId);
    } else {
      this.queries.updateMonthlyAssignment(amount, categoryId, month);
    }
  }

  /**
   * ReassignAssignment - Moves assignments from one category to another
   */
  reassignAssignment(newCategoryId: number, oldCategoryId: number): void {
    this.queries.reassignAssignment(newCategoryId, oldCategoryId);
  }

  /**
   * GetReadyToAssign - Gets the available amount ready to assign for a budget
   * This is a static value that doesn't depend on month
   */
  getReadyToAssign(budgetId: number, asOfDate?: string): number {
    const today = asOfDate ?? getLocalDateString();
    return this.queries.readyToAssign(budgetId, today);
  }

  /**
   * GetAssignedLastMonthByCategoryIds - Gets total assigned for multiple categories in a month
   */
  getAssignedLastMonthByCategoryIds(month: string, categoryIds: number[]): number {
    const result = this.queries.getAssignedLastMonthByCategoryIds(month, categoryIds);
    return result || 0;
  }

  /**
   * GetAssignmentsByMonthForCategories - Aggregated assignments per month for selected categories between two months (inclusive)
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
    return this.queries.getAssignmentsByMonthForCategories(
      categoryIds,
      startMonth,
      endMonth,
      budgetId
    );
  }

  /**
   * HasAssignments - Checks if a category has any non-zero assignments
   */
  hasAssignments(categoryId: number): boolean {
    const count = this.queries.countAssignmentsForCategory(categoryId);
    return count > 0;
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
    return this.queries.getTotalAssignedForBudgetPace(months, budgetId);
  }

  /**
   * GetAssignedForCategoryInRange - Sum of assignments for a category from startMonth to endMonth inclusive
   */
  getAssignedForCategoryInRange(categoryId: number, startMonth: string, endMonth: string): number {
    return this.queries.getAssignedForCategoryInRange(categoryId, startMonth, endMonth);
  }

  /**
   * CheckFutureOverspending - Checks if reducing a category's assignment by `reductionAmount`
   * would cause negative Available in any future month.
   *
   * Reducing an assignment in the current month decreases Available in all future months
   * by the same delta. Returns the list of future months that would go negative.
   */
  checkFutureOverspending(
    categoryId: number,
    reductionAmount: number,
    currentMonth: string,
    budgetId: number
  ): { month: string; currentAvailable: number; projectedAvailable: number }[] {
    if (reductionAmount <= 0) return [];

    const futureMonths = this.queries.getFutureAvailableByCategory(
      categoryId,
      currentMonth,
      budgetId
    );

    const affected: {
      month: string;
      currentAvailable: number;
      projectedAvailable: number;
    }[] = [];

    for (const row of futureMonths) {
      const projected = row.Available - reductionAmount;
      if (projected < 0) {
        affected.push({
          month: row.Month,
          currentAvailable: row.Available,
          projectedAvailable: projected,
        });
      }
    }

    return affected;
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
    // Amount columns are integer milliunits. Callers may pass values derived
    // from averages/division (fractional); round each to an integer so the
    // batch path matches the single-upsert guarantee and never stores a
    // fractional amount.
    const normalized = assignments.map((a) => ({ ...a, amount: Math.round(a.amount) }));
    this.queries.batchUpsertMonthlyAssignments(normalized);
  }
}
