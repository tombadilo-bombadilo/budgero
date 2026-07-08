/**
 * Budgets service type definitions
 * These types use PascalCase for API consistency
 */

/**
 * Budget type - represents a budget entity
 */
export interface Budget {
  ID: number;
  SpaceID: string;
  Name: string;
  DisplayCurrency: string;
  BadgeIcon: string;
  NumberFormat: string;
}

/**
 * CreateBudgetRequest - API request type for creating a budget
 */
export interface CreateBudgetRequest {
  name: string;
  space_id?: string;
  display_currency: string;
  badge_icon: string;
  number_format: string;
  create_default_categories: boolean;
}
