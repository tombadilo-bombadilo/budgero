import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { Account } from './types.js';
import { getLocalDateString } from '../../utils/date.js';

/**
 * AccountQueries - All SQL queries for accounts
 * Direct port from sql/accounts.sql
 */
export class AccountQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * CreateAccount - Creates a new account
   * SQL: CreateAccount :one
   */
  createAccount(
    name: string,
    type: string,
    currency: string,
    reconciledAt: string | null,
    balance: number,
    budgetId: number,
    metadata = '{}',
    onBudget = true,
    id?: number
  ): number {
    const result = run(
      this.db,
      `
      INSERT INTO accounts (ID, Name, Type, Currency, ReconciledAt, BalanceNative, BudgetID, Metadata, OnBudget, Position)
      VALUES (?9, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
        (SELECT COALESCE(MAX(Position), -1) + 1 FROM accounts WHERE BudgetID = ?6))
      RETURNING ID
    `,
      name,
      type,
      currency,
      reconciledAt,
      balance,
      budgetId,
      metadata,
      onBudget,
      id ?? null
    );
    return result.lastInsertRowid as number;
  }

  /**
   * GetAccount - Gets a specific account by ID
   * SQL: GetAccount :one
   */
  getAccount(id: number): Account | undefined {
    return getRow<Account>(
      this.db,
      `
      SELECT * FROM accounts
      WHERE ID = ?1
    `,
      id
    );
  }

  /**
   * ListAccounts - Gets all accounts for a budget
   * SQL: ListAccounts :many
   */
  listAccounts(budgetId: number): Account[] {
    // Future impact = rows dated after today's local date, as DATE('now',
    // 'localtime') reads it. `t.Date >= today` is implied by `DATE(t.Date) > today`
    // for every stored date form (YYYY-MM-DD, with or without a time/offset
    // suffix) and lets SQLite seek idx_transactions_account_date_id to the future
    // rows instead of reading each ledger. Both uncleared sums come from one pass
    // over the budget's rows (Cleared has no index), not two per account.
    const today = getLocalDateString();
    return allRows<Account>(
      this.db,
      `
      WITH budget_accounts AS (
        SELECT ID FROM accounts WHERE BudgetID = ?1
      ),
      future AS (
        SELECT t.AccountID AS id,
          SUM(COALESCE(t.InflowNative, t.InflowConverted) - COALESCE(t.OutflowNative, t.OutflowConverted)) AS native,
          SUM(t.InflowConverted - t.OutflowConverted) AS converted
        FROM transactions t
        WHERE t.AccountID IN (SELECT ID FROM budget_accounts)
          AND t.Date >= ?2 AND DATE(t.Date) > ?2
        GROUP BY t.AccountID
      ),
      uncleared AS (
        SELECT t.AccountID AS id,
          SUM(COALESCE(t.InflowNative, t.InflowConverted) - COALESCE(t.OutflowNative, t.OutflowConverted)) AS native,
          SUM(t.InflowConverted - t.OutflowConverted) AS converted
        FROM transactions t
        WHERE t.AccountID IN (SELECT ID FROM budget_accounts) AND t.Cleared = 0
        GROUP BY t.AccountID
      )
      SELECT a.*,
        COALESCE(f.native, 0) AS FutureImpactNative,
        COALESCE(f.converted, 0) AS FutureImpactConverted,
        COALESCE(u.native, 0) AS UnclearedNative,
        COALESCE(u.converted, 0) AS UnclearedConverted
      FROM accounts a
      LEFT JOIN future f ON f.id = a.ID
      LEFT JOIN uncleared u ON u.id = a.ID
      WHERE a.BudgetID = ?1
      ORDER BY a.Position ASC, a.ID ASC
    `,
      budgetId,
      today
    );
  }

  /**
   * BatchUpdateAccountPositions - Update Position for multiple accounts at once.
   * Used by the account-order setting (reorder within the on/off-budget group).
   */
  batchUpdateAccountPositions(updates: { id: number; position: number }[]): void {
    const stmt = this.db.prepare(`
      UPDATE accounts
      SET Position = ?2
      WHERE ID = ?1
    `);
    for (const update of updates) {
      stmt.run(update.id, update.position);
    }
    stmt.finalize();
  }

  /**
   * UpdateAccount - Updates an account
   * SQL: UpdateAccount :exec
   */
  updateAccount(
    id: number,
    name: string,
    type: string,
    currency: string,
    metadata?: string,
    onBudget?: boolean
  ): void {
    let sql = `
      UPDATE accounts
      SET Name = ?2, Type = ?3, Currency = ?4`;

    const params: (number | string | boolean)[] = [id, name, type, currency];
    let paramIndex = 5;

    if (metadata !== undefined) {
      sql += `, Metadata = ?${paramIndex}`;
      params.push(metadata);
      paramIndex++;
    }

    if (onBudget !== undefined) {
      sql += `, OnBudget = ?${paramIndex}`;
      params.push(onBudget ? 1 : 0);
    }

    sql += ` WHERE ID = ?1`;

    run(this.db, sql, ...params);
  }

  /**
   * SetArchived - Toggles the Archived flag on an account
   */
  setArchived(id: number, archived: boolean): void {
    run(
      this.db,
      `
      UPDATE accounts
      SET Archived = ?2
      WHERE ID = ?1
    `,
      id,
      archived ? 1 : 0
    );
  }

  /**
   * UpdateAccountMetadata - Updates only the metadata field of an account
   */
  updateAccountMetadata(id: number, metadata: string): void {
    run(
      this.db,
      `
      UPDATE accounts
      SET Metadata = ?2
      WHERE ID = ?1
    `,
      id,
      metadata
    );
  }

  /**
   * DeleteAccount - Deletes an account
   * SQL: DeleteAccount :exec
   */
  deleteAccount(id: number): void {
    // Explicitly ensure foreign keys are enabled for this critical operation
    this.db.exec('PRAGMA foreign_keys = ON');

    run(
      this.db,
      `
      DELETE FROM accounts
      WHERE ID = ?1
    `,
      id
    );
  }

  /**
   * GetBudget - Gets budget details by ID
   * Used for currency conversion during account creation
   */
  getBudget(budgetId: number): { ID: number; DisplayCurrency: string } | undefined {
    return getRow<{ ID: number; DisplayCurrency: string }>(
      this.db,
      `
      SELECT ID, DisplayCurrency FROM budgets
      WHERE ID = ?1
    `,
      budgetId
    );
  }
}
