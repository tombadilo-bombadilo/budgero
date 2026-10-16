import { DatabaseAdapter } from '../../database/interface.js';
import { insertRawRow, placeholders, type RawRow } from '../../database/restore-rows.js';
import { allRows, getRow, run } from '../../database/sql.js';
import { TransactionQueries } from './queries.js';
import {
  PayeeListItem,
  PayeeCategoryMemory,
  type PayeeSnapshot,
  type RestorePayeesInput,
} from './types.js';

/**
 * PayeeService - manages the payee directory (saved payees + usage from transactions).
 */
export class PayeeService {
  private queries: TransactionQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new TransactionQueries(db);
  }

  getDistinctPayees(budgetId: number): string[] {
    return this.getPayeesWithUsage(budgetId).map((p) => p.Name);
  }

  getPayeesWithUsage(budgetId: number): PayeeListItem[] {
    const saved = this.queries.listSavedPayees(budgetId);
    const usages = this.queries.getPayeeUsageCounts(budgetId);

    const map = new Map<string, PayeeListItem>();

    // Start with usage from transactions
    for (const row of usages) {
      const key = row.Name.toLowerCase();
      map.set(key, {
        Name: row.Name,
        UsageCount: row.UsageCount,
        Source: 'transaction',
      });
    }

    // Merge saved payees and note when both sources exist
    for (const payee of saved) {
      const key = payee.Name.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        map.set(key, {
          ...existing,
          Name: payee.Name,
          Source: existing.UsageCount > 0 ? 'both' : 'saved',
        });
      } else {
        map.set(key, {
          Name: payee.Name,
          UsageCount: 0,
          Source: 'saved',
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.Name.localeCompare(b.Name, undefined, { sensitivity: 'base' })
    );
  }

  /**
   * The category this payee was last filed under, or null when the payee is
   * new or has no usable history. Backs the add-transaction form's category
   * memory; see {@link TransactionQueries.getLastCategoryForPayee} for what
   * counts as history.
   */
  getLastCategoryForPayee(budgetId: number, payee: string): PayeeCategoryMemory | null {
    const trimmed = (payee || '').trim();
    if (!trimmed) return null;
    return this.queries.getLastCategoryForPayee(budgetId, trimmed);
  }

  addPayee(budgetId: number, name: string): number {
    const trimmed = (name || '').trim();
    if (!trimmed) return 0;
    return this.queries.insertPayee(budgetId, trimmed);
  }

  /**
   * `newPayeeId` is only passed by redo: when the rename creates the
   * destination directory entry, it gets the ID the first run gave it.
   */
  renamePayee(
    budgetId: number,
    oldName: string,
    newName: string,
    newPayeeId?: number
  ): { updated: number } {
    const oldTrimmed = (oldName || '').trim();
    const newTrimmed = (newName || '').trim();
    if (!oldTrimmed || !newTrimmed || oldTrimmed === newTrimmed) {
      return { updated: 0 };
    }

    let updated = 0;
    this.db.transaction(() => {
      // Ensure destination payee exists (in case it was only in transactions)
      if (!this.findSavedPayee(budgetId, newTrimmed, true)) {
        if (newPayeeId !== undefined) {
          run(
            this.db,
            `INSERT INTO payees (ID, BudgetID, Name, Metadata) VALUES (?, ?, ?, '{}')`,
            newPayeeId,
            budgetId,
            newTrimmed
          );
        } else {
          this.queries.insertPayee(budgetId, newTrimmed);
        }
      }
      updated = this.queries.updatePayeeValue(budgetId, oldTrimmed, newTrimmed);
      // Remove the old payee entry to avoid uniqueness conflicts if the destination already exists
      this.queries.deletePayee(budgetId, oldTrimmed);
    });

    return { updated };
  }

  /** The saved directory row for `name` (exact, or case-insensitive like the unique index). */
  private findSavedPayee(budgetId: number, name: string, ignoreCase = false): RawRow | undefined {
    return getRow<RawRow>(
      this.db,
      `SELECT * FROM payees WHERE BudgetID = ? AND Name = ?${ignoreCase ? ' COLLATE NOCASE' : ''}`,
      budgetId,
      name
    );
  }

  /**
   * Everything a payee rename/delete changes for `names`: their saved
   * directory rows and the exact transaction and split rows that carry each
   * name. Undo restores exactly these (see restorePayees).
   */
  snapshotPayees(budgetId: number, names: string[]): PayeeSnapshot {
    const unique = Array.from(
      new Set((names || []).map((name) => (name || '').trim()).filter(Boolean))
    );
    const snapshot: PayeeSnapshot = { rows: [], assignments: [] };
    for (const name of unique) {
      const row = this.findSavedPayee(budgetId, name);
      if (row) snapshot.rows.push(row);
      const transactionIds = allRows<{ ID: number }>(
        this.db,
        `SELECT ID FROM transactions WHERE BudgetID = ? AND Payee = ? ORDER BY ID`,
        budgetId,
        name
      ).map((tx) => Number(tx.ID));
      const splitIds = allRows<{ ID: number }>(
        this.db,
        `SELECT ID FROM transaction_splits
         WHERE TransactionID IN (SELECT ID FROM transactions WHERE BudgetID = ?) AND Payee = ?
         ORDER BY ID`,
        budgetId,
        name
      ).map((split) => Number(split.ID));
      if (transactionIds.length || splitIds.length) {
        snapshot.assignments.push({ name, transactionIds, splitIds });
      }
    }
    return snapshot;
  }

  /** ID of the saved payee named exactly `name`, if any. */
  getSavedPayeeId(budgetId: number, name: string): number | undefined {
    const row = this.findSavedPayee(budgetId, (name || '').trim());
    return row ? Number(row.ID) : undefined;
  }

  /** Whether a saved payee matches `name` the way the unique index compares (case-insensitive). */
  hasSavedPayee(budgetId: number, name: string): boolean {
    const trimmed = (name || '').trim();
    return Boolean(trimmed && this.findSavedPayee(budgetId, trimmed, true));
  }

  /**
   * Undo of payee rename/delete, in one database transaction: drop the
   * directory entries in `removeNames` (exact name), re-insert the snapshot
   * `rows` under their original IDs, and set each name back on exactly the
   * transaction and split rows that had it.
   */
  restorePayees(budgetId: number, input: RestorePayeesInput): { restored: number } {
    let restored = 0;
    this.db.transaction(() => {
      for (const name of input.removeNames ?? []) {
        this.queries.deletePayee(budgetId, name);
      }
      for (const row of input.rows ?? []) {
        if (Number(row.BudgetID) !== budgetId) {
          throw new Error('Payee snapshot belongs to another budget');
        }
        if (this.findSavedPayee(budgetId, String(row.Name), true)) continue;
        insertRawRow(this.db, 'payees', row);
      }
      for (const { name, transactionIds = [], splitIds = [] } of input.assignments ?? []) {
        if (transactionIds.length) {
          restored += run(
            this.db,
            `UPDATE transactions SET Payee = ?
             WHERE BudgetID = ? AND ID IN (${placeholders(transactionIds.length)})`,
            name,
            budgetId,
            ...transactionIds
          ).changes;
        }
        if (splitIds.length) {
          run(
            this.db,
            `UPDATE transaction_splits SET Payee = ?
             WHERE ID IN (${placeholders(splitIds.length)})
               AND TransactionID IN (SELECT ID FROM transactions WHERE BudgetID = ?)`,
            name,
            ...splitIds,
            budgetId
          );
        }
      }
    });
    return { restored };
  }

  deletePayee(budgetId: number, name: string): { cleared: number } {
    return { cleared: this.deletePayees(budgetId, [name]).cleared };
  }

  /**
   * Delete several payees at once, clearing each from parent transactions and
   * split lines that reference it.
   *
   * One database transaction for the whole batch: deleting N payees one call
   * at a time would leave the directory half-emptied if the tab closed or a
   * write failed midway, and would emit N sync mutations for what the user
   * did as a single action. Blank/duplicate names are ignored.
   */
  deletePayees(budgetId: number, names: string[]): { deleted: number; cleared: number } {
    const unique = Array.from(
      new Set((names || []).map((name) => (name || '').trim()).filter(Boolean))
    );
    if (unique.length === 0) return { deleted: 0, cleared: 0 };

    let cleared = 0;
    this.db.transaction(() => {
      for (const name of unique) {
        this.queries.deletePayee(budgetId, name);
        cleared += this.queries.updatePayeeValue(budgetId, name, '');
      }
    });

    return { deleted: unique.length, cleared };
  }

  /**
   * Payee names only: the same list as `getPayeesWithUsage(budgetId).map((p) => p.Name)`
   * (same merge of saved and used names, same order), without counting every
   * row. For pickers; the Payees settings page still needs the counts.
   */
  getPayeeNames(budgetId: number): string[] {
    const saved = this.queries.listSavedPayees(budgetId);
    const used = this.queries.getPayeeNamesInUse(budgetId);

    const names = new Map<string, string>();
    for (const row of used) names.set(row.Name.toLowerCase(), row.Name);
    for (const payee of saved) names.set(payee.Name.toLowerCase(), payee.Name);

    return Array.from(names.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }
}
