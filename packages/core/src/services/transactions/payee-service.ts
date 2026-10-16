import { DatabaseAdapter } from '../../database/interface.js';
import { TransactionQueries } from './queries.js';
import { PayeeListItem, PayeeCategoryMemory } from './types.js';

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

  renamePayee(budgetId: number, oldName: string, newName: string): { updated: number } {
    const oldTrimmed = (oldName || '').trim();
    const newTrimmed = (newName || '').trim();
    if (!oldTrimmed || !newTrimmed || oldTrimmed === newTrimmed) {
      return { updated: 0 };
    }

    let updated = 0;
    this.db.transaction(() => {
      // Ensure destination payee exists (in case it was only in transactions)
      this.queries.insertPayee(budgetId, newTrimmed);
      updated = this.queries.updatePayeeValue(budgetId, oldTrimmed, newTrimmed);
      // Remove the old payee entry to avoid uniqueness conflicts if the destination already exists
      this.queries.deletePayee(budgetId, oldTrimmed);
    });

    return { updated };
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
