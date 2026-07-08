import { CategoryService } from '../categories/index.js';

/**
 * Ensures a category group exists for a budget, returning its ID.
 */
export function ensureCategoryGroup(
  categoryService: CategoryService,
  budgetId: number,
  groupName: string
): number {
  const group = categoryService.getCategoryGroupByName(groupName, budgetId);
  return group ? group.ID : categoryService.addCategoryGroup(groupName, budgetId);
}

/**
 * Ensures a category (and its group) exists for a budget, returning the
 * category ID. Checks the category by name first; only when it's missing is
 * the group ensured and the category created.
 */
export function ensureCategoryWithGroup(
  categoryService: CategoryService,
  budgetId: number,
  groupName: string,
  categoryName: string,
  note: string
): number {
  const existing = categoryService.getCategoryByName(categoryName, budgetId);
  if (existing) {
    return existing.ID;
  }

  return categoryService.addCategory(
    ensureCategoryGroup(categoryService, budgetId, groupName),
    budgetId,
    categoryName,
    note
  );
}

/**
 * Ensures the auto-generated "Transfers" category (and its group) exists for a budget,
 * returning its ID. Shared by transaction creation and split-transfer mirroring.
 */
export function ensureTransferCategory(categoryService: CategoryService, budgetId: number): number {
  return ensureCategoryWithGroup(
    categoryService,
    budgetId,
    'Transfers',
    'Transfers',
    'Auto-generated category for transfer transactions'
  );
}

/**
 * Ensures the "Uncategorized" category (and its group) exists for a budget, returning its ID.
 * Budgets created before 2025-08-20 don't have it (it was added to the defaults later, with no
 * backfill migration), so flows that rely on it — e.g. split parents — create it lazily here.
 */
export function ensureUncategorizedCategory(
  categoryService: CategoryService,
  budgetId: number
): number {
  return ensureCategoryWithGroup(
    categoryService,
    budgetId,
    'Uncategorized',
    'Uncategorized',
    'Auto-generated category for uncategorized transactions'
  );
}
