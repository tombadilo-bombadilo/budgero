/**
 * Mutation History Service
 *
 * Tracks all mutations made to the database with support for undo operations.
 * Maintains a rolling history of the last 500 mutations per budget.
 */

import type { DatabaseAdapter } from '../../database/interface.js';
import { MutationHistoryQueries } from './queries.js';
import type {
  MutationHistoryEntry,
  MutationHistoryInput,
  MutationHistoryListOptions,
  ParsedMutationHistoryEntry,
  OpCall,
} from './types.js';

export class MutationHistoryService {
  private queries: MutationHistoryQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new MutationHistoryQueries(db);
  }

  /**
   * Record a new mutation in history
   *
   * @param input - Mutation details to record
   * @returns The ID of the created history entry
   */
  record(input: MutationHistoryInput): number {
    // Skip if this mutation already exists (deduplication)
    if (this.queries.exists(input.mutationId)) {
      return -1;
    }

    const id = this.queries.insert(
      input.budgetId,
      input.spaceId ?? null,
      input.mutationId,
      input.userId ?? null,
      input.op,
      JSON.stringify(input.payload),
      input.origin,
      input.undoOps ? JSON.stringify(input.undoOps) : null,
      input.redoOps ? JSON.stringify(input.redoOps) : null,
      input.status ?? 'success',
      input.errorMessage ?? null,
      input.errorCode ?? null
    );

    // Prune old entries to maintain 500 limit
    this.queries.pruneOldEntries(input.budgetId);

    return id;
  }

  /**
   * Get mutation history for a budget
   *
   * @param budgetId - Budget to get history for
   * @param options - Pagination and filter options
   * @returns Parsed mutation history entries
   */
  getHistory(
    budgetId: number,
    options: MutationHistoryListOptions = {}
  ): ParsedMutationHistoryEntry[] {
    const { limit = 100, offset = 0, includeUndone = true } = options;

    const entries = this.queries.getByBudget(budgetId, limit, offset, includeUndone);
    return entries.map((entry) => this.parseEntry(entry));
  }

  /**
   * Get mutation history for multiple budgets (e.g., all budgets in a workspace)
   *
   * @param budgetIds - Array of budget IDs to get history for
   * @param options - Pagination and filter options
   * @returns Parsed mutation history entries
   */
  getHistoryForBudgets(
    budgetIds: number[],
    options: MutationHistoryListOptions = {}
  ): ParsedMutationHistoryEntry[] {
    const { limit = 100, offset = 0, includeUndone = true } = options;

    const entries = this.queries.getByBudgets(budgetIds, limit, offset, includeUndone);
    return entries.map((entry) => this.parseEntry(entry));
  }

  /**
   * Get a single mutation by its mutation ID
   *
   * @param mutationId - The mutation ID to look up
   * @returns Parsed mutation entry or null if not found
   */
  getByMutationId(mutationId: string): ParsedMutationHistoryEntry | null {
    const entry = this.queries.getByMutationId(mutationId);
    if (!entry) return null;
    return this.parseEntry(entry);
  }

  /**
   * Get a single mutation by its database ID
   *
   * @param id - The database ID
   * @returns Parsed mutation entry or null if not found
   */
  getById(id: number): ParsedMutationHistoryEntry | null {
    const entry = this.queries.getById(id);
    if (!entry) return null;
    return this.parseEntry(entry);
  }

  /**
   * Mark a mutation as undone
   *
   * @param mutationId - The mutation ID to mark as undone
   */
  markUndone(mutationId: string): void {
    this.queries.markUndone(mutationId);
  }

  /**
   * Get the count of mutation history entries for a budget
   *
   * @param budgetId - Budget to count entries for
   * @returns Number of entries
   */
  count(budgetId: number): number {
    return this.queries.countByBudget(budgetId);
  }

  /**
   * Get the count of mutation history entries for multiple budgets
   *
   * @param budgetIds - Array of budget IDs to count entries for
   * @returns Number of entries
   */
  countForBudgets(budgetIds: number[]): number {
    return this.queries.countByBudgets(budgetIds);
  }

  /**
   * Get all mutation history (no budget filter)
   *
   * @param options - Pagination and filter options
   * @returns Parsed mutation history entries
   */
  getAllHistory(options: MutationHistoryListOptions = {}): ParsedMutationHistoryEntry[] {
    const { limit = 100, offset = 0, includeUndone = true } = options;
    const entries = this.queries.getAll(limit, offset, includeUndone);
    return entries.map((entry) => this.parseEntry(entry));
  }

  /**
   * Get total count of all mutation history entries
   *
   * @returns Number of entries
   */
  countAll(): number {
    return this.queries.countAll();
  }

  /**
   * Get mutation history for a space
   *
   * @param spaceId - Space to get history for
   * @param options - Pagination and filter options
   * @returns Parsed mutation history entries
   */
  getHistoryForSpace(
    spaceId: string,
    options: MutationHistoryListOptions = {}
  ): ParsedMutationHistoryEntry[] {
    const { limit = 100, offset = 0, includeUndone = true } = options;
    const entries = this.queries.getBySpace(spaceId, limit, offset, includeUndone);
    return entries.map((entry) => this.parseEntry(entry));
  }

  /**
   * Get count of mutation history entries for a space
   *
   * @param spaceId - Space to count entries for
   * @returns Number of entries
   */
  countForSpace(spaceId: string): number {
    return this.queries.countBySpace(spaceId);
  }

  /**
   * Clear all mutation history for a budget
   *
   * @param budgetId - Budget to clear history for
   */
  clear(budgetId: number): void {
    this.queries.deleteByBudget(budgetId);
  }

  /**
   * Clear all mutation history for a space
   *
   * @param spaceId - Space to clear history for
   */
  clearBySpace(spaceId: string): void {
    this.queries.deleteBySpace(spaceId);
  }

  /**
   * Parse a raw database entry into a typed object with parsed JSON fields
   */
  private parseEntry(entry: MutationHistoryEntry): ParsedMutationHistoryEntry {
    let payload: Record<string, unknown> = {};
    let undoOps: OpCall[] | null = null;
    let redoOps: OpCall[] | null = null;

    try {
      payload = JSON.parse(entry.Payload);
    } catch {
      payload = {};
    }

    if (entry.UndoOps) {
      try {
        undoOps = JSON.parse(entry.UndoOps);
      } catch {
        undoOps = null;
      }
    }

    if (entry.RedoOps) {
      try {
        redoOps = JSON.parse(entry.RedoOps);
      } catch {
        redoOps = null;
      }
    }

    // Failed mutations cannot be undone
    const isFailed = entry.Status === 'failed';
    const canUndo = !isFailed && undoOps !== null && undoOps.length > 0 && entry.UndoneAt === null;

    return {
      id: entry.ID,
      budgetId: entry.BudgetID,
      spaceId: entry.SpaceID,
      mutationId: entry.MutationID,
      timestamp: entry.Timestamp,
      userId: entry.UserID,
      op: entry.Op,
      payload,
      origin: entry.Origin,
      undoOps,
      redoOps,
      undoneAt: entry.UndoneAt,
      canUndo,
      status: entry.Status ?? 'success', // Default for pre-migration entries
      errorMessage: entry.ErrorMessage,
      errorCode: entry.ErrorCode,
    };
  }
}

export * from './types.js';
