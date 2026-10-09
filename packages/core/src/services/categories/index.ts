import { DatabaseAdapter } from '../../database/interface.js';
import { Category, CategoryGroup } from './types.js';
import { BudgetError, NotFoundError } from '../../types/index.js';
import { CategoryQueries } from './queries.js';
import { MonthlyBudgetQueries } from '../monthly-budgets/queries.js';
import { BudgetQueries } from '../budgets/queries.js';
import {
  getGoalFundingSettings,
  isValidFundingPriority,
  type FundingPriorityUpdate,
} from '../goals/funding.js';

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

  private validateFundingPriorities(budgetId: number, updates: FundingPriorityUpdate[]): void {
    const budget = new BudgetQueries(this.db).getBudget(budgetId);
    if (!budget) throw new NotFoundError('Budget', budgetId);
    const { CategoryPriorityMode: mode } = getGoalFundingSettings(budget);
    for (const update of updates) {
      if (!isValidFundingPriority(update.priority, mode)) {
        throw new BudgetError(
          mode === 'five-levels'
            ? 'Funding priority must be a whole number from 1 to 5'
            : 'Funding priority must be a positive safe whole number'
        );
      }
      if (this.getCategory(update.categoryId).BudgetID !== budgetId) {
        throw new BudgetError('Category must belong to the selected budget');
      }
    }
  }

  updateFundingPriorities(budgetId: number, updates: FundingPriorityUpdate[]): void {
    this.db.transaction(() => {
      this.validateFundingPriorities(budgetId, updates);
      for (const update of updates)
        this.queries.updateFundingPriority(update.categoryId, update.priority);
    });
  }

  updateCategoryDetails(
    budgetId: number,
    id: number,
    name: string,
    excludeFromBudgetPace: boolean,
    priority: number
  ): void {
    if (!name.trim()) throw new BudgetError('Category name cannot be empty');
    this.db.transaction(() => {
      this.validateFundingPriorities(budgetId, [{ categoryId: id, priority }]);
      this.queries.updateFundingPriority(id, priority);
      this.updateCategoryName(id, name.trim());
      this.updateCategoryExcludeFromBudgetPace(id, excludeFromBudgetPace);
    });
  }

  /**
   * AddCategory - Creates a new category
   */
  addCategory(
    categoryGroupId: number,
    budgetId: number,
    name: string,
    note = '',
    fundingPriority = 3,
    /** Only passed by undo/redo, to recreate a category under its original ID. */
    id?: number
  ): number {
    // Validate the category group exists
    if (!this.queries.categoryGroupExists(categoryGroupId)) {
      throw new BudgetError(`category group '${categoryGroupId}' does not exist`);
    }
    const group = this.getCategoryGroup(categoryGroupId);
    if (group.BudgetID !== budgetId) {
      throw new BudgetError('Category group must belong to the selected budget');
    }
    if (group.Name === 'Income') name = this.validateIncomeName(group, name);
    const mode = getGoalFundingSettings(
      new BudgetQueries(this.db).getBudget(budgetId)
    ).CategoryPriorityMode;
    if (!isValidFundingPriority(fundingPriority, mode))
      throw new BudgetError('Invalid funding priority');

    try {
      const categoryId = this.queries.insertCategory(
        name,
        note,
        categoryGroupId,
        budgetId,
        fundingPriority,
        id
      );
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
    this.assertEditableIncomeCategory(id);
    const group = this.getCategoryGroup(categoryGroupId);
    if (group.Name === 'Income') name = this.validateIncomeName(group, name, id);
    this.queries.updateCategory(id, note, categoryGroupId, name);
  }

  /**
   * MoveCategoryToNewGroup - Move category to new group
   */
  moveCategoryToNewGroup(newGroupId: number, categoryId: number): void {
    this.assertEditableIncomeCategory(categoryId);
    const group = this.getCategoryGroup(newGroupId);
    if (group.Name === 'Income') {
      this.validateIncomeName(group, this.getCategory(categoryId).Name, categoryId);
    }
    this.queries.moveCategoryToNewGroup(categoryId, newGroupId);
  }

  /**
   * UpdateCategoryName - Updates category name only
   */
  updateCategoryName(id: number, name: string): void {
    this.assertEditableIncomeCategory(id);
    const category = this.getCategory(id);
    const group = this.getCategoryGroup(category.CategoryGroupID);
    if (group.Name === 'Income') name = this.validateIncomeName(group, name, id);
    this.queries.updateCategoryName(id, name);
  }

  /**
   * UpdateCategoryNote - Updates category note only
   */
  updateCategoryNote(id: number, note: string): void {
    this.getCategory(id);
    this.queries.updateCategoryNote(id, note.trim());
  }

  /**
   * UpdateCategoryExcludeFromBudgetPace - Updates category exclude_from_budget_pace flag
   *
   * New method for TypeScript implementation
   */
  updateCategoryExcludeFromBudgetPace(id: number, excludeFromBudgetPace: boolean): void {
    this.assertEditableIncomeCategory(id);
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
    this.assertEditableIncomeCategory(id);
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
  /** `id` is only passed by undo/redo, to recreate a group under its original ID. */
  addCategoryGroup(name: string, budgetId: number, id?: number): number {
    try {
      const groupId = this.queries.insertCategoryGroup(name, '', budgetId, id);
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
    this.assertEditableIncomeGroup(id);
    this.queries.updateCategoryGroup(id, '', name);
  }

  /**
   * DeleteCategoryGroup - Deletes a category group
   */
  deleteCategoryGroup(id: number): void {
    this.assertEditableIncomeGroup(id);
    this.queries.deleteCategoryGroup(id);
  }

  private assertEditableIncomeCategory(id: number): void {
    const category = this.getCategory(id);
    if (
      category.Name === 'Income' &&
      this.getCategoryGroup(category.CategoryGroupID).Name === 'Income'
    ) {
      throw new BudgetError('The system Income category cannot be edited or deleted');
    }
  }

  private assertEditableIncomeGroup(id: number): void {
    if (this.getCategoryGroup(id).Name === 'Income') {
      throw new BudgetError('The system Income group cannot be edited or deleted');
    }
  }

  private validateIncomeName(group: CategoryGroup, name: string, excludeId?: number): string {
    const trimmed = name.trim();
    if (!trimmed) throw new BudgetError('Income category name cannot be empty');
    const duplicate = this.getCategoriesByGroup(group.BudgetID, group.ID).some(
      (category) =>
        category.ID !== excludeId && category.Name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) throw new BudgetError('An income category with this name already exists');
    return trimmed;
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
