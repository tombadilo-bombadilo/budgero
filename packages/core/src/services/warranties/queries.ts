import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import type { Warranty, CreateWarrantyInput, UpdateWarrantyInput } from './types.js';

/**
 * WarrantyQueries - All SQL queries for warranties
 */
export class WarrantyQueries {
  constructor(private db: DatabaseAdapter) {}

  create(input: CreateWarrantyInput): number {
    const result = run(
      this.db,
      `
      INSERT INTO warranties (BudgetID, Name, ExpiresAt, Amount, TransactionID, ReceiptImage, Notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      input.budgetId,
      input.name,
      input.expiresAt,
      input.amount ?? 0,
      input.transactionId ?? null,
      input.receiptImage ?? null,
      input.notes ?? ''
    );
    return Number(result.lastInsertRowid);
  }

  getById(id: number): Warranty | undefined {
    return getRow<Warranty>(this.db, 'SELECT * FROM warranties WHERE ID = ?', id);
  }

  listByBudget(budgetId: number): Warranty[] {
    return allRows<Warranty>(
      this.db,
      'SELECT * FROM warranties WHERE BudgetID = ? ORDER BY ExpiresAt ASC',
      budgetId
    );
  }

  update(input: UpdateWarrantyInput): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('Name = ?');
      values.push(input.name);
    }
    if (input.expiresAt !== undefined) {
      fields.push('ExpiresAt = ?');
      values.push(input.expiresAt);
    }
    if (input.amount !== undefined) {
      fields.push('Amount = ?');
      values.push(input.amount);
    }
    if (input.transactionId !== undefined) {
      fields.push('TransactionID = ?');
      values.push(input.transactionId);
    }
    if (input.receiptImage !== undefined) {
      fields.push('ReceiptImage = ?');
      values.push(input.receiptImage);
    }
    if (input.notes !== undefined) {
      fields.push('Notes = ?');
      values.push(input.notes);
    }

    if (fields.length === 0) return;

    values.push(input.id);
    run(this.db, `UPDATE warranties SET ${fields.join(', ')} WHERE ID = ?`, ...values);
  }

  delete(id: number): void {
    run(this.db, 'DELETE FROM warranties WHERE ID = ?', id);
  }
}
