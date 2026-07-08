import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { TransactionQueries } from '../transactions/queries.js';
import type {
  ImportRunRecordInput,
  ImportRunSummary,
  ImportRun,
  ImportRunUndoResult,
} from './types.js';

type ImportRunRow = {
  ID: number;
  BudgetID: number;
  SourceType: string;
  SourceName: string;
  SummaryJSON: string;
  TransactionIDs: string;
  AccountIDs: string;
  CategoryIDs: string;
  Status: string;
  CreatedAt: string;
};

function parseJsonArray(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
    }
    return [];
  } catch {
    return [];
  }
}

function parseSummary(value: string): ImportRunSummary {
  try {
    const parsed = JSON.parse(value);
    return {
      transactionsImported: Number(parsed.transactionsImported) || 0,
      accountsCreated: Number(parsed.accountsCreated) || 0,
      categoriesCreated: Number(parsed.categoriesCreated) || 0,
    };
  } catch {
    return { transactionsImported: 0, accountsCreated: 0, categoriesCreated: 0 };
  }
}

function mapRow(row: ImportRunRow): ImportRun {
  return {
    id: row.ID,
    budgetId: row.BudgetID,
    sourceType: row.SourceType,
    sourceName: row.SourceName,
    summary: parseSummary(row.SummaryJSON),
    transactionIds: parseJsonArray(row.TransactionIDs),
    accountIds: parseJsonArray(row.AccountIDs),
    categoryIds: parseJsonArray(row.CategoryIDs),
    status: row.Status as ImportRun['status'],
    createdAt: row.CreatedAt,
  };
}

export class ImportHistoryService {
  constructor(private readonly db: DatabaseAdapter) {}

  recordImportRun(input: ImportRunRecordInput): number {
    const result = run(
      this.db,
      `
        INSERT INTO import_runs (
          BudgetID,
          SourceType,
          SourceName,
          SummaryJSON,
          TransactionIDs,
          AccountIDs,
          CategoryIDs,
          Status,
          CreatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now'))
      `,
      input.budgetId,
      input.sourceType,
      input.sourceName,
      JSON.stringify({
        transactionsImported: input.summary.transactionsImported,
        accountsCreated: input.summary.accountsCreated,
        categoriesCreated: input.summary.categoriesCreated,
      }),
      JSON.stringify(input.transactionIds ?? []),
      JSON.stringify(input.accountIds ?? []),
      JSON.stringify(input.categoryIds ?? [])
    );
    const insertedId =
      typeof result.lastInsertRowid === 'bigint'
        ? Number(result.lastInsertRowid)
        : (result.lastInsertRowid as number);
    return insertedId;
  }

  listImportRuns(budgetId: number, limit = 50): ImportRun[] {
    const rows = allRows<ImportRunRow>(
      this.db,
      `
        SELECT ID, BudgetID, SourceType, SourceName, SummaryJSON, TransactionIDs,
               AccountIDs, CategoryIDs, Status, CreatedAt
        FROM import_runs
        WHERE BudgetID = ?
        ORDER BY datetime(CreatedAt) DESC, ID DESC
        LIMIT ?
      `,
      budgetId,
      limit
    );
    return rows.map(mapRow);
  }

  getImportRun(id: number): ImportRun | null {
    const row = getRow<ImportRunRow>(
      this.db,
      `
        SELECT ID, BudgetID, SourceType, SourceName, SummaryJSON, TransactionIDs,
               AccountIDs, CategoryIDs, Status, CreatedAt
        FROM import_runs
        WHERE ID = ?
        LIMIT 1
      `,
      id
    );
    return row ? mapRow(row) : null;
  }

  deleteImportRun(id: number): void {
    run(this.db, `DELETE FROM import_runs WHERE ID = ?`, id);
  }

  undoImportRun(id: number): ImportRunUndoResult {
    const importRun = this.getImportRun(id);
    if (!importRun) {
      throw new Error(`Import run ${id} not found`);
    }
    if (importRun.status === 'undone') {
      return {
        runId: id,
        alreadyUndone: true,
        transactionsRemoved: 0,
        accountsRemoved: 0,
        categoriesRemoved: 0,
      };
    }

    const { transactionIds, accountIds, categoryIds, budgetId } = importRun;
    const result = this.db.transaction(() => {
      let transactionsRemoved = 0;
      let accountsRemoved = 0;
      let categoriesRemoved = 0;

      // Capture which accounts these transactions belong to BEFORE deleting.
      // Imported transactions may have landed in a pre-existing account (only
      // newly-created accounts are tracked in `accountIds`), so we must derive
      // the affected set from the transactions themselves to recalc balances.
      const affectedAccountIds = new Set<number>();
      if (transactionIds.length > 0) {
        const placeholders = transactionIds.map(() => '?').join(',');
        const rows = allRows<{ AccountID: number }>(
          this.db,
          `SELECT DISTINCT AccountID FROM transactions WHERE ID IN (${placeholders}) AND BudgetID = ?`,
          ...transactionIds,
          budgetId
        );
        for (const row of rows) {
          if (Number.isFinite(row.AccountID)) affectedAccountIds.add(row.AccountID);
        }
      }

      if (transactionIds.length > 0) {
        const placeholders = transactionIds.map(() => '?').join(',');
        const deletion = run(
          this.db,
          `DELETE FROM transactions WHERE ID IN (${placeholders}) AND BudgetID = ?`,
          ...transactionIds,
          budgetId
        );
        transactionsRemoved =
          typeof deletion.changes === 'number' ? deletion.changes : Number(deletion.changes);
      }

      // Remove categories if they now have no transactions
      for (const categoryId of categoryIds) {
        const res = getRow(
          this.db,
          `SELECT COUNT(1) as count FROM transactions WHERE CategoryID = ?`,
          categoryId
        ) as { count: number };
        const remaining = res?.count ?? 0;
        if (remaining === 0) {
          run(this.db, `DELETE FROM categories WHERE ID = ?`, categoryId);
          categoriesRemoved += 1;
        }
      }

      // Remove accounts if they now have no transactions
      for (const accountId of accountIds) {
        const res = getRow(
          this.db,
          `SELECT COUNT(1) as count FROM transactions WHERE AccountID = ?`,
          accountId
        ) as { count: number };
        const remaining = res?.count ?? 0;
        if (remaining === 0) {
          run(this.db, `DELETE FROM accounts WHERE ID = ?`, accountId);
          accountsRemoved += 1;
        }
      }

      // Recalculate balances for every affected account that still exists, so
      // account balances and per-transaction running balances stay accurate.
      // A raw DELETE alone leaves stale balances — the regular delete path does
      // this via TransactionQueries, so reuse the same recomputation here.
      const txQueries = new TransactionQueries(this.db);
      for (const accountId of affectedAccountIds) {
        const accountExists =
          getRow(this.db, `SELECT 1 FROM accounts WHERE ID = ?`, accountId) != null;
        if (accountExists) {
          txQueries.recalculateBalances(accountId);
        }
      }

      run(this.db, `UPDATE import_runs SET Status = 'undone' WHERE ID = ?`, id);

      return {
        runId: id,
        transactionsRemoved,
        accountsRemoved,
        categoriesRemoved,
        alreadyUndone: false,
      };
    });

    return result;
  }
}
