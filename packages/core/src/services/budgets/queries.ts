import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { Budget } from './types.js';

/**
 * BudgetQueries - All SQL queries for budgets
 * Ported from sql/budgets.sql
 */
export class BudgetQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * InsertBudget - Creates a new budget
   * SQL: INSERT INTO budgets (name, display_currency, badge_icon, number_format) VALUES (?, ?, ?, ?) RETURNING id;
   */
  insertBudget(
    spaceId: string,
    name: string,
    displayCurrency: string,
    badgeIcon: string,
    numberFormat: string
  ): number {
    const result = run(
      this.db,
      `
      INSERT INTO budgets (SpaceID, Name, DisplayCurrency, BadgeIcon, NumberFormat)
      VALUES (?, ?, ?, ?, ?)
    `,
      spaceId,
      name,
      displayCurrency,
      badgeIcon,
      numberFormat
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * GetAllBudgets - Retrieves all budgets
   * SQL: SELECT * FROM budgets;
   */
  getAllBudgets(spaceId?: string): Budget[] {
    const sql = spaceId ? 'SELECT * FROM budgets WHERE SpaceID = ?' : 'SELECT * FROM budgets';
    return spaceId ? allRows<Budget>(this.db, sql, spaceId) : allRows<Budget>(this.db, sql);
  }

  /**
   * GetBudget - Retrieves a single budget by ID
   * SQL: SELECT * FROM budgets WHERE id = ?;
   */
  getBudget(id: number): Budget | null {
    const result = getRow<Budget>(this.db, 'SELECT * FROM budgets WHERE ID = ?', id);
    return result || null;
  }

  /**
   * UpdateBudgetName - Updates budget name
   * SQL: UPDATE budgets SET name = :new_name WHERE id = :budget_id;
   *
   * Note: Go uses named parameters, we use positional
   */
  updateBudgetName(budgetId: number, newName: string): void {
    run(
      this.db,
      `
      UPDATE budgets
      SET Name = ?
      WHERE ID = ?
    `,
      newName,
      budgetId
    );
  }

  /**
   * UpdateBudgetCurrency - Updates budget currency
   * SQL: UPDATE budgets SET display_currency = :new_currency WHERE id = :budget_id;
   */
  updateBudgetCurrency(budgetId: number, newCurrency: string): void {
    run(
      this.db,
      `
      UPDATE budgets
      SET DisplayCurrency = ?
      WHERE ID = ?
    `,
      newCurrency,
      budgetId
    );
  }

  /**
   * UpdateBudgetIcon - Updates budget icon
   * SQL: UPDATE budgets SET badge_icon = :new_icon WHERE id = :budget_id;
   */
  updateBudgetIcon(budgetId: number, newIcon: string): void {
    run(
      this.db,
      `
      UPDATE budgets
      SET BadgeIcon = ?
      WHERE ID = ?
    `,
      newIcon,
      budgetId
    );
  }

  /**
   * UpdateBudgetNumberFormat - Updates budget number format
   * SQL: UPDATE budgets SET number_format = :new_number_format WHERE id = :budget_id;
   */
  updateBudgetNumberFormat(budgetId: number, newNumberFormat: string): void {
    run(
      this.db,
      `
      UPDATE budgets
      SET NumberFormat = ?
      WHERE ID = ?
    `,
      newNumberFormat,
      budgetId
    );
  }

  /**
   * DeleteBudget - Deletes a budget
   * SQL: DELETE FROM budgets WHERE id = ?;
   */
  deleteBudget(budgetId: number): void {
    // Explicitly ensure foreign keys are enabled for this critical operation
    this.db.exec('PRAGMA foreign_keys = ON');

    run(this.db, 'DELETE FROM budgets WHERE ID = ?', budgetId);
  }
}
