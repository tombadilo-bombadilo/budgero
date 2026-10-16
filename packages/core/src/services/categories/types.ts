/**
 * Categories service type definitions
 * These types use PascalCase for API consistency
 */

/**
 * CategoryGroup type - represents a group of categories
 */
export interface CategoryGroup {
  ID: number;
  Name: string;
  Note: string;
  BudgetID: number;
  Position: number;
}

/**
 * Category type - represents a budget category
 */
export interface Category {
  ID: number;
  Name: string;
  Note: string;
  CategoryGroupID: number;
  BudgetID: number;
  ExcludeFromBudgetPace?: boolean;
  FundingPriority?: number;
  Position: number;
}

/** Why a category (or group) can't be deleted right now. */
export interface CategoryDeleteBlock {
  categoryId: number;
  reason: 'income' | 'income_group' | 'credit_card' | 'debt_account';
  /** The active account the category tracks payments for. */
  accountName?: string;
}

/** What deleting a category (or a whole group) removes or moves. */
export interface CategoryDeletionImpact {
  /** Categories deleted: 1, or every category in the group. */
  categories: number;
  /** Transactions and split lines in the categories (all time). */
  transactions: number;
  /** Months with a non-zero assigned amount (all time). */
  assignedMonths: number;
  /** Sum of every assignment, all months. */
  assignedTotal: number;
  goals: number;
  /** Scheduled (recurring) transactions using the categories. */
  scheduled: number;
  blocked: CategoryDeleteBlock | null;
}
