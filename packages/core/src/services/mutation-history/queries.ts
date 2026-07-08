/**
 * Database queries for mutation history
 */

import type { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import type { MutationHistoryEntry, MutationOrigin, MutationStatus } from './types.js';

const MAX_ENTRIES_PER_BUDGET = 500;

export class MutationHistoryQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Insert a new mutation history entry
   */
  insert(
    budgetId: number,
    spaceId: string | null,
    mutationId: string,
    userId: string | null,
    op: string,
    payload: string,
    origin: MutationOrigin,
    undoOps: string | null,
    redoOps: string | null,
    status: MutationStatus = 'success',
    errorMessage: string | null = null,
    errorCode: string | null = null
  ): number {
    const result = run(
      this.db,
      `
      INSERT INTO mutation_history (BudgetID, SpaceID, MutationID, UserID, Op, Payload, Origin, UndoOps, RedoOps, Status, ErrorMessage, ErrorCode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      budgetId,
      spaceId,
      mutationId,
      userId,
      op,
      payload,
      origin,
      undoOps,
      redoOps,
      status,
      errorMessage,
      errorCode
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Shared list query: `where` is a full WHERE clause (or '' for none);
   * `includeUndone: false` appends the UndoneAt filter.
   */
  private list(
    where: string,
    params: (string | number)[],
    limit: number,
    offset: number,
    includeUndone: boolean
  ): MutationHistoryEntry[] {
    const undoneClause = includeUndone ? '' : `${where ? 'AND' : 'WHERE'} UndoneAt IS NULL`;
    return allRows<MutationHistoryEntry>(
      this.db,
      `
      SELECT * FROM mutation_history
      ${where} ${undoneClause}
      ORDER BY Timestamp DESC
      LIMIT ? OFFSET ?
    `,
      ...params,
      limit,
      offset
    );
  }

  /**
   * Shared count query: `where` is a full WHERE clause (or '' for none).
   */
  private count(where: string, params: (string | number)[]): number {
    const result = getRow<{ count: number }>(
      this.db,
      `
      SELECT COUNT(*) as count FROM mutation_history ${where}
    `,
      ...params
    );
    return result?.count || 0;
  }

  /**
   * Get mutation history entries for a budget
   */
  getByBudget(
    budgetId: number,
    limit = 100,
    offset = 0,
    includeUndone = true
  ): MutationHistoryEntry[] {
    return this.list('WHERE BudgetID = ?', [budgetId], limit, offset, includeUndone);
  }

  /**
   * Get mutation history entries for multiple budgets
   */
  getByBudgets(
    budgetIds: number[],
    limit = 100,
    offset = 0,
    includeUndone = true
  ): MutationHistoryEntry[] {
    if (budgetIds.length === 0) return [];

    const placeholders = budgetIds.map(() => '?').join(', ');
    return this.list(
      `WHERE BudgetID IN (${placeholders})`,
      budgetIds,
      limit,
      offset,
      includeUndone
    );
  }

  /**
   * Get a single mutation history entry by mutation ID
   */
  getByMutationId(mutationId: string): MutationHistoryEntry | undefined {
    return getRow<MutationHistoryEntry>(
      this.db,
      `
      SELECT * FROM mutation_history WHERE MutationID = ?
    `,
      mutationId
    );
  }

  /**
   * Get a single mutation history entry by ID
   */
  getById(id: number): MutationHistoryEntry | undefined {
    return getRow<MutationHistoryEntry>(
      this.db,
      `
      SELECT * FROM mutation_history WHERE ID = ?
    `,
      id
    );
  }

  /**
   * Mark a mutation as undone
   */
  markUndone(mutationId: string): void {
    run(
      this.db,
      `
      UPDATE mutation_history
      SET UndoneAt = datetime('now')
      WHERE MutationID = ?
    `,
      mutationId
    );
  }

  /**
   * Count entries for a budget
   */
  countByBudget(budgetId: number): number {
    return this.count('WHERE BudgetID = ?', [budgetId]);
  }

  /**
   * Count entries for multiple budgets
   */
  countByBudgets(budgetIds: number[]): number {
    if (budgetIds.length === 0) return 0;

    const placeholders = budgetIds.map(() => '?').join(', ');
    return this.count(`WHERE BudgetID IN (${placeholders})`, budgetIds);
  }

  /**
   * Get all mutation history entries (no budget filter)
   */
  getAll(limit = 100, offset = 0, includeUndone = true): MutationHistoryEntry[] {
    return this.list('', [], limit, offset, includeUndone);
  }

  /**
   * Count all entries (no budget filter)
   */
  countAll(): number {
    return this.count('', []);
  }

  /**
   * Get mutation history entries for a space
   */
  getBySpace(
    spaceId: string,
    limit = 100,
    offset = 0,
    includeUndone = true
  ): MutationHistoryEntry[] {
    return this.list('WHERE SpaceID = ?', [spaceId], limit, offset, includeUndone);
  }

  /**
   * Count entries for a space
   */
  countBySpace(spaceId: string): number {
    return this.count('WHERE SpaceID = ?', [spaceId]);
  }

  /**
   * Prune old entries to keep only the latest MAX_ENTRIES_PER_BUDGET
   */
  pruneOldEntries(budgetId: number): number {
    const result = run(
      this.db,
      `
      DELETE FROM mutation_history
      WHERE BudgetID = ?
        AND ID NOT IN (
          SELECT ID FROM mutation_history
          WHERE BudgetID = ?
          ORDER BY Timestamp DESC
          LIMIT ?
        )
    `,
      budgetId,
      budgetId,
      MAX_ENTRIES_PER_BUDGET
    );
    return result.changes || 0;
  }

  /**
   * Delete all entries for a budget
   */
  deleteByBudget(budgetId: number): void {
    run(
      this.db,
      `
      DELETE FROM mutation_history WHERE BudgetID = ?
    `,
      budgetId
    );
  }

  /**
   * Delete all entries for a space
   */
  deleteBySpace(spaceId: string): void {
    run(
      this.db,
      `
      DELETE FROM mutation_history WHERE SpaceID = ?
    `,
      spaceId
    );
  }

  /**
   * Check if a mutation ID already exists
   */
  exists(mutationId: string): boolean {
    const result = getRow(
      this.db,
      `
      SELECT 1 FROM mutation_history WHERE MutationID = ? LIMIT 1
    `,
      mutationId
    );
    return !!result;
  }
}
