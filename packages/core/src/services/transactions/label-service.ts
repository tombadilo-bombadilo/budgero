import { DatabaseAdapter } from '../../database/interface.js';
import { insertRawRow, placeholders, type RawRow } from '../../database/restore-rows.js';
import { allRows, getRow, run } from '../../database/sql.js';
import { NotFoundError } from '../../types';
import { TransactionQueries } from './queries.js';
import { LabelListItem, type LabelSnapshot } from './types.js';

/**
 * LabelService - manages transaction labels (CRUD + usage counts).
 */
export class LabelService {
  private queries: TransactionQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new TransactionQueries(db);
  }

  private normalizeLabelName(name: string): string {
    const normalized = (name || '').trim();
    if (!normalized) {
      throw new Error('Label name cannot be empty');
    }
    return normalized;
  }

  private normalizeLabelColor(color: string): string {
    const value = (color || '').trim().toUpperCase();
    const withHash = value.startsWith('#') ? value : `#${value}`;
    if (!/^#[0-9A-F]{6}$/.test(withHash)) {
      throw new Error('Label color must be in #RRGGBB format');
    }
    return withHash;
  }

  getLabelsWithUsage(budgetId: number): LabelListItem[] {
    return this.queries.listLabelsWithUsage(budgetId);
  }

  getLabelById(
    id: number,
    budgetId: number
  ): { ID: number; BudgetID: number; Name: string; Color: string } {
    const label = this.queries.getLabelById(id, budgetId);
    if (!label) {
      throw new NotFoundError('Label', id);
    }
    return label;
  }

  /** `id` is only passed by undo/redo, to recreate a label under its original ID. */
  addLabel(budgetId: number, name: string, color: string, id?: number): number {
    const normalizedName = this.normalizeLabelName(name);
    const normalizedColor = this.normalizeLabelColor(color);
    return this.queries.insertLabel(budgetId, normalizedName, normalizedColor, id);
  }

  updateLabel(id: number, budgetId: number, name: string, color: string): { updated: number } {
    const normalizedName = this.normalizeLabelName(name);
    const normalizedColor = this.normalizeLabelColor(color);
    const updated = this.queries.updateLabel(id, budgetId, normalizedName, normalizedColor);
    if (updated === 0) {
      throw new NotFoundError('Label', id);
    }
    return { updated };
  }

  /** The label row and the transactions carrying it, for a delete undo. */
  snapshotLabel(id: number, budgetId: number): LabelSnapshot | null {
    const row = getRow<RawRow>(
      this.db,
      'SELECT * FROM labels WHERE ID = ? AND BudgetID = ?',
      id,
      budgetId
    );
    if (!row) return null;
    const transactionIds = allRows<{ ID: number }>(
      this.db,
      'SELECT ID FROM transactions WHERE BudgetID = ? AND LabelID = ? ORDER BY ID',
      budgetId,
      id
    ).map((tx) => Number(tx.ID));
    return { row, transactionIds };
  }

  /**
   * Undo of deleteLabel, in one database transaction: re-insert the label
   * row as it was (ID included) and put it back on exactly the transactions
   * that had it.
   */
  restoreLabel(budgetId: number, snapshot: LabelSnapshot): { restored: number } {
    if (Number(snapshot.row.BudgetID) !== budgetId) {
      throw new Error('Label snapshot belongs to another budget');
    }
    const id = Number(snapshot.row.ID);
    let restored = 0;
    this.db.transaction(() => {
      insertRawRow(this.db, 'labels', snapshot.row);
      if (snapshot.transactionIds.length) {
        restored = run(
          this.db,
          `UPDATE transactions SET LabelID = ?
           WHERE BudgetID = ? AND ID IN (${placeholders(snapshot.transactionIds.length)})`,
          id,
          budgetId,
          ...snapshot.transactionIds
        ).changes;
      }
    });
    return { restored };
  }

  deleteLabel(id: number, budgetId: number): { cleared: number; deleted: number } {
    let cleared = 0;
    let deleted = 0;

    this.db.transaction(() => {
      this.getLabelById(id, budgetId);
      cleared = this.queries.clearLabelFromTransactions(budgetId, id);
      deleted = this.queries.deleteLabel(id, budgetId);
    });

    return { cleared, deleted };
  }
}
