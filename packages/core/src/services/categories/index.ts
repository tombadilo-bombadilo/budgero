import { DatabaseAdapter } from '../../database/interface.js';
import { allRows, getRow, run } from '../../database/sql.js';
import { RowCapture, restoreRowJournal, type RowJournal } from '../../database/row-journal.js';
import {
  Category,
  CategoryGroup,
  type CategoryDeleteBlock,
  type CategoryDeletionImpact,
} from './types.js';
import { BudgetError, NotFoundError } from '../../types/index.js';
import { CategoryQueries } from './queries.js';
import { MonthlyBudgetQueries } from '../monthly-budgets/queries.js';
import { BudgetQueries } from '../budgets/queries.js';
import { TransactionQueries } from '../transactions/queries.js';
import {
  getGoalFundingSettings,
  isValidFundingPriority,
  type FundingPriorityUpdate,
} from '../goals/funding.js';

export type {
  Category,
  CategoryGroup,
  CategoryDeleteBlock,
  CategoryDeletionImpact,
} from './types.js';

/** Tables a category-delete undo may write back to. */
const CATEGORY_RESTORE_TABLES: ReadonlySet<string> = new Set([
  'category_groups',
  'categories',
  'assignments',
  'goals',
  'transactions',
  'transaction_splits',
  'recurring_transactions',
]);

const inList = (ids: number[]) => ids.map(() => '?').join(', ');

/**
 * CategoryService - Port of Go categories service
 * Handles category and category group CRUD operations
 *
 * All methods match the Go implementation in internal/categories/categories.go
 */
export class CategoryService {
  private queries: CategoryQueries;

  private monthlyBudgetQueries: MonthlyBudgetQueries;

  private transactionQueries: TransactionQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new CategoryQueries(db);
    this.monthlyBudgetQueries = new MonthlyBudgetQueries(db);
    this.transactionQueries = new TransactionQueries(db);
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
   *
   * Transactions still in the category are deleted with it (see
   * deleteCategoriesWithTransactions).
   */
  deleteCategory(id: number): void {
    this.db.transaction(() => this.deleteCategoryInTransaction(id));
  }

  /** deleteCategory for callers that already hold a transaction (BEGIN doesn't nest). */
  deleteCategoryInTransaction(id: number): void {
    this.assertCategoryDeletable(id);
    this.deleteCategoriesWithTransactions([id], () => this.queries.deleteCategory(id));
  }

  /** Throws when deleteCategory would refuse to delete this category. */
  assertCategoryDeletable(id: number): void {
    this.assertEditableIncomeCategory(id);
    const linkedAccount = this.queries.getAccountLinkedToCategory(id);
    if (linkedAccount && !linkedAccount.Archived) {
      const noun = linkedAccount.LinkType === 'cc_payment' ? 'credit card' : 'debt account';
      throw new BudgetError(
        `Cannot delete category: it tracks payments for the active "${linkedAccount.Name}" ${noun}. Archive or delete the account first.`
      );
    }
  }

  /**
   * Deleting a category cascades its transactions (FK ON DELETE CASCADE), which
   * would leave account balances counting rows that no longer exist. Delete
   * them explicitly instead — with their transfer partners and split-transfer
   * mirrors, as deleting a transaction does — then recalculate every touched
   * account. Must run inside a transaction.
   */
  private deleteCategoriesWithTransactions(categoryIds: number[], remove: () => void): void {
    const inCategories = this.transactionQueries.getTransactionsByCategoryIDs(categoryIds);
    const linked = [
      ...this.transactionQueries.getTransactionsByTransferIDs(
        inCategories
          .map((transaction) => transaction.TransferID)
          .filter((transferId): transferId is string => Boolean(transferId))
      ),
      ...this.transactionQueries.getSplitMirrorsForParents(
        inCategories
          .filter((transaction) => !transaction.TransferID)
          .map((transaction) => transaction.ID)
      ),
    ];
    const rows = [...inCategories, ...linked];

    this.transactionQueries.deleteTransactions(rows.map((transaction) => transaction.ID));
    remove();
    this.transactionQueries.recalculateBalancesForAccounts(
      rows.map((transaction) => transaction.AccountID)
    );
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
    const group = this.getCategoryGroup(id);
    const categoryIds = this.getCategoriesByGroup(group.BudgetID, id).map(
      (category) => category.ID
    );
    this.db.transaction(() =>
      this.deleteCategoriesWithTransactions(categoryIds, () => this.queries.deleteCategoryGroup(id))
    );
  }

  // ========================================
  // Atomic delete with undo (categories.deleteAndReassign,
  // categoryGroups.deleteAndReassign, categories.restoreDeleted)
  // ========================================

  /** Why this category can't be deleted, or null. Never throws for a missing category. */
  getDeletionBlock(id: number): CategoryDeleteBlock | null {
    const category = this.queries.getCategory(id);
    if (!category) return null;
    if (
      category.Name === 'Income' &&
      this.queries.getCategoryGroup(category.CategoryGroupID)?.Name === 'Income'
    ) {
      return { categoryId: id, reason: 'income' };
    }
    const linked = this.queries.getAccountLinkedToCategory(id);
    if (linked && !linked.Archived) {
      return {
        categoryId: id,
        reason: linked.LinkType === 'cc_payment' ? 'credit_card' : 'debt_account',
        accountName: linked.Name,
      };
    }
    return null;
  }

  /** Every category in the budget that can't be deleted right now (for the budget table). */
  getDeleteBlocks(budgetId: number): CategoryDeleteBlock[] {
    const blocks = new Map<number, CategoryDeleteBlock>();
    const income = this.queries.getCategoryGroupByName('Income', budgetId);
    if (income) {
      for (const category of this.getCategoriesByGroup(budgetId, income.ID)) {
        if (category.Name === 'Income') {
          blocks.set(category.ID, { categoryId: category.ID, reason: 'income' });
        }
      }
    }
    // One pass over the accounts (same rule as getAccountLinkedToCategory).
    const inBudget = new Set(this.getAllCategories(budgetId).map((category) => category.ID));
    const accounts = allRows<{ Name: string; Metadata: string | null; Archived: number }>(
      this.db,
      'SELECT Name, Metadata, Archived FROM accounts ORDER BY ID'
    );
    for (const account of accounts) {
      if (account.Archived) continue;
      let metadata: Record<string, unknown>;
      try {
        metadata = JSON.parse(account.Metadata || '{}');
      } catch {
        continue;
      }
      const links: [unknown, CategoryDeleteBlock['reason']][] = [
        [metadata.linked_category_id, 'debt_account'],
        [metadata.cc_payment_category_id, 'credit_card'],
      ];
      for (const [categoryId, reason] of links) {
        if (typeof categoryId !== 'number' || !inBudget.has(categoryId)) continue;
        if (!blocks.has(categoryId)) {
          blocks.set(categoryId, { categoryId, reason, accountName: account.Name });
        }
      }
    }
    return [...blocks.values()];
  }

  private deletionBlockMessage(block: CategoryDeleteBlock): string {
    switch (block.reason) {
      case 'income':
        return 'The system Income category cannot be edited or deleted';
      case 'income_group':
        return 'The system Income group cannot be edited or deleted';
      default:
        return `Cannot delete category: it tracks payments for the active "${block.accountName}" ${
          block.reason === 'credit_card' ? 'credit card' : 'debt account'
        }. Archive or delete the account first.`;
    }
  }

  private impactOf(categoryIds: number[]): Omit<CategoryDeletionImpact, 'blocked'> {
    if (!categoryIds.length) {
      return {
        categories: 0,
        transactions: 0,
        assignedMonths: 0,
        assignedTotal: 0,
        goals: 0,
        scheduled: 0,
      };
    }
    const ids = inList(categoryIds);
    const row = getRow<{
      transactions: number;
      assignedMonths: number;
      assignedTotal: number;
      goals: number;
      scheduled: number;
    }>(
      this.db,
      `SELECT
         (SELECT COUNT(*) FROM transactions WHERE CategoryID IN (${ids})) +
         (SELECT COUNT(*) FROM transaction_splits WHERE CategoryID IN (${ids})) AS transactions,
         (SELECT COUNT(*) FROM assignments WHERE CategoryID IN (${ids}) AND Amount <> 0) AS assignedMonths,
         (SELECT COALESCE(SUM(Amount), 0) FROM assignments WHERE CategoryID IN (${ids})) AS assignedTotal,
         (SELECT COUNT(*) FROM goals WHERE CategoryID IN (${ids})) AS goals,
         (SELECT COUNT(*) FROM recurring_transactions WHERE CategoryID IN (${ids})) AS scheduled`,
      ...categoryIds,
      ...categoryIds,
      ...categoryIds,
      ...categoryIds,
      ...categoryIds,
      ...categoryIds
    );
    return {
      categories: categoryIds.length,
      transactions: Number(row?.transactions ?? 0),
      assignedMonths: Number(row?.assignedMonths ?? 0),
      assignedTotal: Number(row?.assignedTotal ?? 0),
      goals: Number(row?.goals ?? 0),
      scheduled: Number(row?.scheduled ?? 0),
    };
  }

  /** What deleting this category removes or moves (read when the delete dialog opens). */
  getCategoryDeletionImpact(id: number): CategoryDeletionImpact {
    this.getCategory(id);
    return { ...this.impactOf([id]), blocked: this.getDeletionBlock(id) };
  }

  /** What deleting this group (and every category in it) removes or moves. */
  getCategoryGroupDeletionImpact(groupId: number): CategoryDeletionImpact {
    const group = this.getCategoryGroup(groupId);
    const categoryIds = this.getCategoriesByGroup(group.BudgetID, groupId).map((c) => c.ID);
    const blocked: CategoryDeleteBlock | null =
      group.Name === 'Income'
        ? { categoryId: categoryIds[0] ?? 0, reason: 'income_group' }
        : (categoryIds.map((id) => this.getDeletionBlock(id)).find(Boolean) ?? null);
    return { ...this.impactOf(categoryIds), blocked };
  }

  /**
   * Deletes a category in one transaction and returns a journal that undoes it
   * exactly. With `reassignTo`, its transactions, split lines, scheduled
   * transactions and assignments move there first (same steps, same order as
   * the legacy transactions.reassign + monthlyBudgets.reassignAssignment +
   * categories.delete sequence). Without it, the category must hold no
   * transactions: nothing is deleted that undo can't bring back. Its goal and
   * assignments are removed (undo restores them). Everything is validated
   * before anything is written.
   */
  deleteCategoryWithUndo(id: number, reassignTo?: number | null): RowJournal {
    return this.db.transaction(() => {
      const category = this.getCategory(id);
      this.assertDeletable([id]);
      const destination = this.validateDestination(category.BudgetID, [id], reassignTo);
      const capture = this.captureForDelete([id], destination);
      this.deleteCategoriesInTransaction([id], destination);
      return capture.finish();
    });
  }

  /** deleteCategoryWithUndo for a whole group: its categories, then the group. */
  deleteCategoryGroupWithUndo(groupId: number, reassignTo?: number | null): RowJournal {
    return this.db.transaction(() => {
      this.assertEditableIncomeGroup(groupId);
      const group = this.getCategoryGroup(groupId);
      const categoryIds = this.getCategoriesByGroup(group.BudgetID, groupId).map((c) => c.ID);
      this.assertDeletable(categoryIds);
      const destination = this.validateDestination(group.BudgetID, categoryIds, reassignTo);
      const capture = this.captureForDelete(categoryIds, destination);
      capture.addKeys('category_groups', [groupId]);
      this.deleteCategoriesInTransaction(categoryIds, destination);
      this.queries.deleteCategoryGroup(groupId);
      return capture.finish();
    });
  }

  /**
   * Throws what deleteCategoryGroupWithUndo would refuse with: the Income
   * group, or a group holding an active account's payment / linked category.
   */
  assertCategoryGroupDeletable(groupId: number): void {
    this.assertEditableIncomeGroup(groupId);
    const group = this.getCategoryGroup(groupId);
    this.assertDeletable(this.getCategoriesByGroup(group.BudgetID, groupId).map((c) => c.ID));
  }

  /** Undo of deleteCategoryWithUndo / deleteCategoryGroupWithUndo. */
  restoreDeletedCategories(journal: RowJournal): void {
    this.db.transaction(() => restoreRowJournal(this.db, journal, CATEGORY_RESTORE_TABLES));
  }

  private assertDeletable(categoryIds: number[]): void {
    for (const id of categoryIds) {
      const block = this.getDeletionBlock(id);
      if (block) throw new BudgetError(this.deletionBlockMessage(block));
    }
  }

  private validateDestination(
    budgetId: number,
    sourceIds: number[],
    reassignTo: number | null | undefined
  ): number | null {
    if (reassignTo === undefined || reassignTo === null) {
      const { transactions } = this.impactOf(sourceIds);
      if (transactions > 0) {
        throw new BudgetError(
          'This category still has transactions. Move them to another category before deleting it.'
        );
      }
      return null;
    }
    if (sourceIds.includes(reassignTo)) {
      throw new BudgetError('Choose a different destination category');
    }
    const destination = this.getCategory(reassignTo);
    if (destination.BudgetID !== budgetId) {
      throw new BudgetError('Both categories must belong to the selected budget');
    }
    for (const id of sourceIds) {
      const source = this.getCategory(id);
      if (
        this.getCategoryGroup(source.CategoryGroupID).Name === 'Income' &&
        destination.CategoryGroupID !== source.CategoryGroupID
      ) {
        throw new BudgetError(
          'Choose another income category to keep this history classified as income'
        );
      }
    }
    return reassignTo;
  }

  private captureForDelete(categoryIds: number[], destination: number | null): RowCapture {
    const capture = new RowCapture(this.db).addKeys('categories', categoryIds);
    // Merging assignments changes the destination's rows for the same months.
    if (destination !== null) capture.addWhere('assignments', 'CategoryID = ?', destination);
    return capture;
  }

  /** Moves (optionally) then deletes the categories. Runs inside a transaction. */
  private deleteCategoriesInTransaction(categoryIds: number[], destination: number | null): void {
    for (const id of categoryIds) {
      if (destination !== null) {
        for (const table of ['transactions', 'transaction_splits', 'recurring_transactions']) {
          run(this.db, `UPDATE ${table} SET CategoryID = ? WHERE CategoryID = ?`, destination, id);
        }
        this.mergeAssignmentsInto(destination, id);
      }
      this.deleteCategoriesWithTransactions([id], () => this.queries.deleteCategory(id));
    }
  }

  /** Same merge as MonthlyBudgetQueries.reassignAssignment, without its own transaction. */
  private mergeAssignmentsInto(destination: number, source: number): void {
    const rows = allRows<{ ID: number; Month: string; Amount: number }>(
      this.db,
      'SELECT ID, Month, Amount FROM assignments WHERE CategoryID = ?',
      source
    );
    for (const old of rows) {
      const existing = getRow<{ ID: number; Amount: number }>(
        this.db,
        'SELECT ID, Amount FROM assignments WHERE CategoryID = ? AND Month = ?',
        destination,
        old.Month
      );
      if (existing) {
        run(
          this.db,
          'UPDATE assignments SET Amount = ? WHERE ID = ?',
          existing.Amount + old.Amount,
          existing.ID
        );
        run(this.db, 'DELETE FROM assignments WHERE ID = ?', old.ID);
      } else {
        run(this.db, 'UPDATE assignments SET CategoryID = ? WHERE ID = ?', destination, old.ID);
      }
    }
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
