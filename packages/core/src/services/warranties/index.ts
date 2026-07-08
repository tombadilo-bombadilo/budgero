import { DatabaseAdapter } from '../../database/interface.js';
import type { Warranty, CreateWarrantyInput, UpdateWarrantyInput } from './types.js';
import { WarrantyQueries } from './queries.js';

export type { Warranty, CreateWarrantyInput, UpdateWarrantyInput } from './types.js';

export class WarrantyService {
  private queries: WarrantyQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new WarrantyQueries(db);
  }

  create(input: CreateWarrantyInput): number {
    return this.queries.create(input);
  }

  getById(id: number): Warranty | undefined {
    return this.queries.getById(id);
  }

  listByBudget(budgetId: number): Warranty[] {
    return this.queries.listByBudget(budgetId);
  }

  update(input: UpdateWarrantyInput): void {
    this.queries.update(input);
  }

  delete(id: number): void {
    this.queries.delete(id);
  }
}
