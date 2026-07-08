import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { Category, CategoryGroup } from './types.js';

/**
 * CategoryQueries - All SQL queries for categories and category groups
 * Ported from sql/categories.sql and sql/category_groups.sql
 */
export class CategoryQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * GetMaxCategoryGroupPosition - Get the maximum position for category groups in a budget
   */
  getMaxCategoryGroupPosition(budgetId: number): number {
    const result = getRow<{ maxPos: number }>(
      this.db,
      `
      SELECT COALESCE(MAX(Position), -1) as maxPos
      FROM category_groups
      WHERE BudgetID = ?1
    `,
      budgetId
    );
    return result?.maxPos ?? -1;
  }

  /**
   * GetMaxCategoryPosition - Get the maximum position for categories within a group
   */
  getMaxCategoryPosition(categoryGroupId: number): number {
    const result = getRow<{ maxPos: number }>(
      this.db,
      `
      SELECT COALESCE(MAX(Position), -1) as maxPos
      FROM categories
      WHERE CategoryGroupID = ?1
    `,
      categoryGroupId
    );
    return result?.maxPos ?? -1;
  }

  /**
   * InsertCategoryGroup - Creates a new category group
   * SQL: INSERT INTO category_groups (name, note, budget_id, position) VALUES (?1, ?2, ?3, ?4) RETURNING id;
   */
  insertCategoryGroup(name: string, note: string, budgetId: number): number {
    const maxPos = this.getMaxCategoryGroupPosition(budgetId);
    const position = maxPos + 1;

    const result = run(
      this.db,
      `
      INSERT INTO category_groups (Name, Note, BudgetID, Position)
      VALUES (?1, ?2, ?3, ?4)
    `,
      name,
      note,
      budgetId,
      position
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * GetAllCategoryGroups - Retrieves all category groups for a budget
   * SQL: SELECT * FROM category_groups WHERE budget_id = ?1 ORDER BY Position, Name;
   */
  getAllCategoryGroups(budgetId: number): CategoryGroup[] {
    return allRows<CategoryGroup>(
      this.db,
      `
      SELECT *
      FROM category_groups
      WHERE BudgetID = ?1
      ORDER BY CASE WHEN Name = 'Hidden Categories' THEN 1 ELSE 0 END, Position ASC, Name ASC
    `,
      budgetId
    );
  }

  /**
   * CategoryGroupExists - Check if category group exists
   * SQL: SELECT id FROM category_groups WHERE id = ?1;
   */
  categoryGroupExists(id: number): boolean {
    const result = getRow(
      this.db,
      `
      SELECT ID
      FROM category_groups
      WHERE ID = ?1
    `,
      id
    );
    return !!result;
  }

  /**
   * UpdateCategoryGroup - Updates category group
   * SQL: UPDATE category_groups SET note = ?2, name = ?3 WHERE id = ?1;
   */
  updateCategoryGroup(id: number, note: string, name: string): void {
    run(
      this.db,
      `
      UPDATE category_groups
      SET Note = ?2, Name = ?3
      WHERE ID = ?1
    `,
      id,
      note,
      name
    );
  }

  /**
   * DeleteCategoryGroup - Deletes a category group
   * SQL: DELETE FROM category_groups WHERE id = ?1;
   */
  deleteCategoryGroup(id: number): void {
    // Explicitly ensure foreign keys are enabled for this critical operation
    this.db.exec('PRAGMA foreign_keys = ON');

    run(
      this.db,
      `
      DELETE FROM category_groups
      WHERE ID = ?1
    `,
      id
    );
  }

  /**
   * GetCategoryGroup - Get single category group by ID
   * SQL: SELECT * FROM category_groups WHERE id = ?1;
   */
  getCategoryGroup(id: number): CategoryGroup | undefined {
    return getRow<CategoryGroup>(
      this.db,
      `
      SELECT *
      FROM category_groups
      WHERE ID = ?1
    `,
      id
    );
  }

  /**
   * GetCategoryGroupByName - Get category group by name and budget
   * SQL: SELECT id FROM category_groups WHERE name = ?1 AND budget_id = ?2;
   */
  getCategoryGroupByName(name: string, budgetId: number): CategoryGroup | undefined {
    return getRow<CategoryGroup>(
      this.db,
      `
      SELECT *
      FROM category_groups
      WHERE Name = ?1 AND BudgetID = ?2
    `,
      name,
      budgetId
    );
  }

  /**
   * InsertCategory - Creates a new category
   * SQL: INSERT INTO categories (name, note, category_group_id, budget_id, exclude_from_budget_pace, position) VALUES (?1, ?2, ?3, ?4, 0, ?5) RETURNING id;
   */
  insertCategory(name: string, note: string, categoryGroupId: number, budgetId: number): number {
    const maxPos = this.getMaxCategoryPosition(categoryGroupId);
    const position = maxPos + 1;

    const result = run(
      this.db,
      `
      INSERT INTO categories (Name, Note, CategoryGroupID, BudgetID, ExcludeFromBudgetPace, Position)
      VALUES (?1, ?2, ?3, ?4, 0, ?5)
    `,
      name,
      note,
      categoryGroupId,
      budgetId,
      position
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * GetAllCategories - Retrieves all categories for a budget
   * SQL: SELECT * FROM categories WHERE budget_id = ?1 ORDER BY CategoryGroupID, Position, Name;
   */
  getAllCategories(budgetId: number): Category[] {
    return allRows<Category>(
      this.db,
      `
      SELECT *
      FROM categories
      WHERE BudgetID = ?1
      ORDER BY CategoryGroupID, Position ASC, Name ASC
    `,
      budgetId
    );
  }

  /**
   * MoveCategoryToNewGroup - Move category to new group
   * SQL: UPDATE categories SET category_group_id = :new_category_group_id, position = :new_position WHERE id = :category_id;
   *
   * Note: Go uses named parameters, we use positional
   */
  moveCategoryToNewGroup(categoryId: number, newCategoryGroupId: number): void {
    const maxPos = this.getMaxCategoryPosition(newCategoryGroupId);
    const position = maxPos + 1;

    run(
      this.db,
      `
      UPDATE categories
      SET CategoryGroupID = ?1, Position = ?3
      WHERE ID = ?2
    `,
      newCategoryGroupId,
      categoryId,
      position
    );
  }

  /**
   * UpdateCategory - Updates category
   * SQL: UPDATE categories SET name = ?4, note = ?2, category_group_id = ?3 WHERE id = ?1;
   */
  updateCategory(id: number, note: string, categoryGroupId: number, name: string): void {
    run(
      this.db,
      `
      UPDATE categories
      SET Name = ?4, Note = ?2, CategoryGroupID = ?3
      WHERE ID = ?1
    `,
      id,
      note,
      categoryGroupId,
      name
    );
  }

  /**
   * UpdateCategoryName - Updates category name only
   * SQL: UPDATE categories SET name = ?2 WHERE id = ?1;
   */
  updateCategoryName(id: number, name: string): void {
    run(
      this.db,
      `
      UPDATE categories
      SET Name = ?2
      WHERE ID = ?1
    `,
      id,
      name
    );
  }

  /**
   * UpdateCategoryExcludeFromBudgetPace - Updates category exclude_from_budget_pace flag
   * SQL: UPDATE categories SET exclude_from_budget_pace = ?2 WHERE id = ?1;
   */
  updateCategoryExcludeFromBudgetPace(id: number, excludeFromBudgetPace: boolean): void {
    run(
      this.db,
      `
      UPDATE categories
      SET ExcludeFromBudgetPace = ?2
      WHERE ID = ?1
    `,
      id,
      excludeFromBudgetPace ? 1 : 0
    );
  }

  /**
   * DeleteCategory - Deletes a category
   * SQL: DELETE FROM categories WHERE id = ?1;
   */
  deleteCategory(id: number): void {
    // Explicitly ensure foreign keys are enabled for this critical operation
    this.db.exec('PRAGMA foreign_keys = ON');

    run(
      this.db,
      `
      DELETE FROM categories
      WHERE ID = ?1
    `,
      id
    );
  }

  /**
   * GetAccountLinkedToCategory - Finds an account whose metadata references this
   * category as a system link: `linked_category_id` (loan/mortgage — the payment
   * IS the expense) or `cc_payment_category_id` (credit card — YNAB-style payment
   * mechanics). Returns the account plus its archived state and which link type,
   * or null. Callers use this to block deleting a system category out from under
   * an active account.
   */
  getAccountLinkedToCategory(
    categoryId: number
  ): { ID: number; Name: string; Archived: boolean; LinkType: 'linked' | 'cc_payment' } | null {
    const rows = allRows<{ ID: number; Name: string; Metadata: string; Archived: number }>(
      this.db,
      `
      SELECT ID, Name, Metadata, Archived
      FROM accounts
      WHERE Metadata LIKE '%"linked_category_id":%' || ?1 || '%'
         OR Metadata LIKE '%"cc_payment_category_id":%' || ?1 || '%'
    `,
      categoryId
    );

    // Double-check by parsing JSON — the LIKE is a coarse prefilter and can
    // match substrings (e.g. 12 inside 123) or the wrong key.
    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.Metadata || '{}');
        const archived = Boolean(row.Archived);
        if (metadata.linked_category_id === categoryId) {
          return { ID: row.ID, Name: row.Name, Archived: archived, LinkType: 'linked' };
        }
        if (metadata.cc_payment_category_id === categoryId) {
          return { ID: row.ID, Name: row.Name, Archived: archived, LinkType: 'cc_payment' };
        }
      } catch {
        // Skip rows with invalid JSON
      }
    }

    return null;
  }

  /**
   * GetCategory - Get single category by ID
   * SQL: SELECT * FROM categories WHERE id = ?1;
   */
  getCategory(id: number): Category | undefined {
    const result = getRow<Category>(
      this.db,
      `
      SELECT *
      FROM categories
      WHERE ID = ?1
    `,
      id
    );
    if (result && result.ExcludeFromBudgetPace !== undefined) {
      result.ExcludeFromBudgetPace = Boolean(result.ExcludeFromBudgetPace);
    }
    return result;
  }

  /**
   * GetCategoryByName - Get category by name and budget
   * SQL: SELECT id FROM categories WHERE name = ?1 AND budget_id = ?2;
   */
  getCategoryByName(name: string, budgetId: number): Category | undefined {
    const result = getRow<Category>(
      this.db,
      `
      SELECT *
      FROM categories
      WHERE Name = ?1 AND BudgetID = ?2
    `,
      name,
      budgetId
    );
    if (result && result.ExcludeFromBudgetPace !== undefined) {
      result.ExcludeFromBudgetPace = Boolean(result.ExcludeFromBudgetPace);
    }
    return result;
  }

  /**
   * BatchUpdateCategoryGroupPositions - Update positions for multiple category groups
   */
  batchUpdateCategoryGroupPositions(updates: { id: number; position: number }[]): void {
    const stmt = this.db.prepare(`
      UPDATE category_groups
      SET Position = ?2
      WHERE ID = ?1
    `);
    for (const update of updates) {
      stmt.run(update.id, update.position);
    }
    stmt.finalize();
  }

  /**
   * BatchUpdateCategoryPositions - Update positions for multiple categories
   */
  batchUpdateCategoryPositions(updates: { id: number; position: number }[]): void {
    const stmt = this.db.prepare(`
      UPDATE categories
      SET Position = ?2
      WHERE ID = ?1
    `);
    for (const update of updates) {
      stmt.run(update.id, update.position);
    }
    stmt.finalize();
  }

  /**
   * UpdateCategoryPosition - Update position for a single category
   */
  updateCategoryPosition(id: number, position: number): void {
    run(
      this.db,
      `
      UPDATE categories
      SET Position = ?2
      WHERE ID = ?1
    `,
      id,
      position
    );
  }
}
