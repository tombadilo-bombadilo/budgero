import type { DatabaseAdapter } from '../../database/interface.js';
import {
  isRowJournal,
  journaledTables,
  recordRowChanges,
  recordRowChangesAsync,
  restoreRowJournal,
  type RowJournal,
} from '../../database/row-journal.js';
import { atomically } from '../../database/sql.js';

/**
 * Exact undo for any synchronous change: `record` journals every row the
 * change writes, `restore` puts them all back (see recordRowChanges). The
 * journal is plain JSON, so it travels as an undo op's payload and every
 * device restores the same rows.
 */
export class RowJournalService {
  constructor(private readonly db: DatabaseAdapter) {}

  /** `journal` is null when the recording could not be completed (no exact undo then). */
  record<T>(change: () => T): { result: T; journal: RowJournal | null } {
    return recordRowChanges(this.db, change);
  }

  /** record() for a change that awaits; nothing else may write meanwhile. */
  recordAsync<T>(change: () => Promise<T>): Promise<{ result: T; journal: RowJournal | null }> {
    return recordRowChangesAsync(this.db, change);
  }

  /** Puts back what `journal` recorded, in one transaction (all or nothing). */
  restore(journal: unknown): void {
    if (!isRowJournal(journal)) throw new Error('Nothing to restore');
    atomically(this.db, () => restoreRowJournal(this.db, journal, journaledTables(this.db)));
  }
}
