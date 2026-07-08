import { DatabaseAdapter } from '../../database/interface.js';
import { NotFoundError } from '../../types';
import { TransactionQueries } from './queries.js';
import { LabelListItem } from './types.js';

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

  addLabel(budgetId: number, name: string, color: string): number {
    const normalizedName = this.normalizeLabelName(name);
    const normalizedColor = this.normalizeLabelColor(color);
    return this.queries.insertLabel(budgetId, normalizedName, normalizedColor);
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
