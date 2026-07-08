import { DatabaseAdapter } from '../../database/interface.js';
import { TransactionQueries } from './queries.js';
import { PayeeListItem } from './types.js';

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
    const trimmed = (name || '').trim();
    if (!trimmed) return { cleared: 0 };

    let cleared = 0;
    this.db.transaction(() => {
      this.queries.deletePayee(budgetId, trimmed);
      cleared = this.queries.updatePayeeValue(budgetId, trimmed, '');
    });

    return { cleared };
  }
}
