import { DatabaseAdapter } from '../../database/interface.js';
import { Category, CategoryGroup } from './types.js';
import { BudgetError, NotFoundError } from '../../types/index.js';
import { CategoryQueries } from './queries.js';
import { MonthlyBudgetQueries } from '../monthly-budgets/queries.js';

export type { Category, CategoryGroup } from './types.js';

/**
 * CategoryService - Port of Go categories service
 * Handles category and category group CRUD operations
 *
 * All methods match the Go implementation in internal/categories/categories.go
 */
export class CategoryService {
  private queries: CategoryQueries;

  private monthlyBudgetQueries: MonthlyBudgetQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new CategoryQueries(db);
    this.monthlyBudgetQueries = new MonthlyBudgetQueries(db);
  }

  /**
   * AddCategory - Creates a new category
   */
  addCategory(categoryGroupId: number, budgetId: number, name: string, note = ''): number {
    // Validate the category group exists
    if (!this.queries.categoryGroupExists(categoryGroupId)) {
      throw new BudgetError(`category group '${categoryGroupId}' does not exist`);
    }

    try {
      const categoryId = this.queries.insertCategory(name, note, categoryGroupId, budgetId);
      return categoryId;
    } catch (error) {
      throw new BudgetError(
        `failed to add category: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * GetAllCategories - Retrieves all categories for a budget
   */
  getAllCategories(budgetId: number): Category[] {
    return this.queries.getAllCategories(budgetId);
  }

  /**
   * GetCategory - Get single category by ID
   */
  getCategory(id: number): Category {
    const category = this.queries.getCategory(id);
    if (!category) {
      throw new NotFoundError('Category', id);
    }
    return category;
  }

  /**
   * UpdateCategory - Updates category
   */
  updateCategory(id: number, categoryGroupId: number, name: string, note: string): void {
    this.queries.updateCategory(id, note, categoryGroupId, name);
  }

  /**
   * MoveCategoryToNewGroup - Move category to new group
   */
  moveCategoryToNewGroup(newGroupId: number, categoryId: number): void {
    this.queries.moveCategoryToNewGroup(categoryId, newGroupId);
  }

  /**
   * UpdateCategoryName - Updates category name only
   */
  updateCategoryName(id: number, name: string): void {
    this.queries.updateCategoryName(id, name);
  }

  /**
   * UpdateCategoryExcludeFromBudgetPace - Updates category exclude_from_budget_pace flag
   *
   * New method for TypeScript implementation
   */
  updateCategoryExcludeFromBudgetPace(id: number, excludeFromBudgetPace: boolean): void {
    this.queries.updateCategoryExcludeFromBudgetPace(id, excludeFromBudgetPace);
  }

  /**
   * HasAssignments - Check if category has any assignments
   */
  hasAssignments(categoryId: number): boolean {
    try {
      const count = this.monthlyBudgetQueries.countAssignmentsForCategory(categoryId);
      return count > 0;
    } catch (error) {
      throw new BudgetError(
        `failed to count assignments for category: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * DeleteCategory - Deletes a category
   *
   * A category that is a system link for an account — a loan/mortgage
   * `linked_category_id` or a credit card `cc_payment_category_id` — cannot be
   * deleted while that account is still active, or its payment mechanics break.
   * Archiving the account releases the category (the account is no longer in
   * use), so deletion is allowed once the linked account is archived.
   */
  deleteCategory(id: number): void {
    const linkedAccount = this.queries.getAccountLinkedToCategory(id);
    if (linkedAccount && !linkedAccount.Archived) {
      const noun = linkedAccount.LinkType === 'cc_payment' ? 'credit card' : 'debt account';
      throw new BudgetError(
        `Cannot delete category: it tracks payments for the active "${linkedAccount.Name}" ${noun}. Archive or delete the account first.`
      );
    }

    this.queries.deleteCategory(id);
  }

  /**
   * AddCategoryGroup - Creates a new category group
   *
   * Note: Go version doesn't have note parameter in the signature but it's in the query
   */
  addCategoryGroup(name: string, budgetId: number): number {
    try {
      const groupId = this.queries.insertCategoryGroup(name, '', budgetId);
      return groupId;
    } catch (error) {
      throw new BudgetError(
        `failed to add category group: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * GetAllCategoryGroups - Retrieves all category groups for a budget
   */
  getAllCategoryGroups(budgetId: number): CategoryGroup[] {
    return this.queries.getAllCategoryGroups(budgetId);
  }

  /**
   * GetCategoryGroup - Get single category group by ID
   */
  getCategoryGroup(id: number): CategoryGroup {
    const group = this.queries.getCategoryGroup(id);
    if (!group) {
      throw new NotFoundError('Category group', id);
    }
    return group;
  }

  /**
   * UpdateCategoryGroup - Updates category group
   */
  updateCategoryGroup(id: number, name: string): void {
    this.queries.updateCategoryGroup(id, '', name);
  }

  /**
   * DeleteCategoryGroup - Deletes a category group
   */
  deleteCategoryGroup(id: number): void {
    this.queries.deleteCategoryGroup(id);
  }

  // ========================================
  // Additional TypeScript methods (not in Go)
  // These are kept for backward compatibility
  // ========================================

  /**
   * Get categories by group
   */
  getCategoriesByGroup(budgetId: number, groupId: number): Category[] {
    return this.getAllCategories(budgetId).filter((cat) => cat.CategoryGroupID === groupId);
  }

  /**
   * Get category by name
   */
  getCategoryByName(name: string, budgetId: number): Category | null {
    const category = this.queries.getCategoryByName(name, budgetId);
    return category || null;
  }

  /**
   * Get category group by name
   */
  getCategoryGroupByName(name: string, budgetId: number): CategoryGroup | null {
    const group = this.queries.getCategoryGroupByName(name, budgetId);
    return group || null;
  }

  /**
   * ReorderCategoryGroups - Update positions for category groups in a budget
   * Takes an array of group IDs in the desired order
   */
  reorderCategoryGroups(budgetId: number, orderedGroupIds: number[]): void {
    const updates = orderedGroupIds.map((id, index) => ({ id, position: index }));
    this.queries.batchUpdateCategoryGroupPositions(updates);
  }

  /**
   * ReorderCategories - Update positions for categories within a group
   * Takes an array of category IDs in the desired order
   */
  reorderCategories(categoryGroupId: number, orderedCategoryIds: number[]): void {
    const updates = orderedCategoryIds.map((id, index) => ({ id, position: index }));
    this.queries.batchUpdateCategoryPositions(updates);
  }

  /**
   * BulkReorder - Handle a complete reorder operation from drag-and-drop
   * Updates both group order and category order within each group
   */
  bulkReorder(
    budgetId: number,
    groupOrder: number[],
    categoryOrderByGroup: Record<number, number[]>
  ): void {
    this.reorderCategoryGroups(budgetId, groupOrder);

    for (const [groupId, categoryIds] of Object.entries(categoryOrderByGroup)) {
      if (categoryIds.length > 0) {
        this.reorderCategories(Number(groupId), categoryIds);
      }
    }
  }
}
