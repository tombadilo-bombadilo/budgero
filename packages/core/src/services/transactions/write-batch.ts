import { DatabaseAdapter } from '../../database/interface.js';
import { atomically } from '../../database/sql.js';

/** What a queued row will look like, for later steps that need it before it exists. */
export interface PendingTransactionRow {
  AccountID: number;
  BudgetID: number;
  Date: string;
  Memo: string;
  Payee: string | null;
  LabelID: number | null;
  TransferID: string | null;
  InflowConverted: number;
  OutflowConverted: number;
  InflowNative: number;
  OutflowNative: number;
}

/** A row queued earlier in the same batch, by its step index. */
export interface BatchRowRef {
  batchIndex: number;
}

export const isBatchRowRef = (value: unknown): value is BatchRowRef =>
  typeof value === 'object' && value !== null && 'batchIndex' in value;

/**
 * Collects several service writes and commits them in ONE database
 * transaction. Services do their async work (rate lookups, conversions) when
 * a write is queued; `commit()` then runs the synchronous writes in queue
 * order, so either all of them land or none do (no compensating deletes, no
 * AUTOINCREMENT ids burned on failure).
 *
 * A service method that takes a batch returns the step index instead of the
 * new row id; `commit()` returns every step's result by index.
 */
export class TransactionWriteBatch {
  private steps: ((results: unknown[]) => unknown)[] = [];

  private rows = new Map<number, PendingTransactionRow>();

  private committed = false;

  constructor(private readonly db: DatabaseAdapter) {}

  /** Queue a synchronous write; `results` holds the earlier steps' results. */
  queue(step: (results: unknown[]) => unknown, row?: PendingTransactionRow): number {
    if (this.committed) throw new Error('This write batch was already committed.');
    const index = this.steps.length;
    this.steps.push(step);
    if (row) this.rows.set(index, row);
    return index;
  }

  /** The row a queued step will insert (for steps that depend on it). */
  pendingRow(ref: BatchRowRef): PendingTransactionRow {
    const row = this.rows.get(ref.batchIndex);
    if (!row) throw new Error(`No queued transaction at batch step ${ref.batchIndex}.`);
    return row;
  }

  /** The id an earlier step produced (only valid inside a queued step). */
  static idOf(results: unknown[], ref: number | BatchRowRef): number {
    if (typeof ref === 'number') return ref;
    const id = results[ref.batchIndex];
    if (typeof id !== 'number') throw new Error(`Batch step ${ref.batchIndex} produced no id.`);
    return id;
  }

  get size(): number {
    return this.steps.length;
  }

  /** Run every queued write in one transaction; returns each step's result. */
  commit(): unknown[] {
    if (this.committed) throw new Error('This write batch was already committed.');
    this.committed = true;
    return atomically(this.db, () => {
      const results: unknown[] = [];
      for (const step of this.steps) results.push(step(results));
      return results;
    });
  }
}
