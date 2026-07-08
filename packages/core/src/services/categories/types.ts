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
  Position: number;
}
