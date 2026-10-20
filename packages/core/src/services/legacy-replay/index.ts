import { DatabaseAdapter } from '../../database/interface.js';
import { allRows, getRow } from '../../database/sql.js';
import { TransactionQueries } from '../transactions/queries.js';

/** SQLite bind-parameter chunk (as in the transaction queries). */
const CHUNK = 500;

const placeholders = (values: unknown[]) => values.map(() => '?').join(', ');

const validIds = (ids: readonly unknown[]): number[] => [
  ...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)),
];

/**
 * Read-only checks for "would a v1.18 build apply this op differently?".
 *
 * Several existing op codes kept their name and args but changed what they do
 * to the data in specific situations (split parents, split-transfer mirrors,
 * categories that still hold transactions, ...). Builds that only know
 * mutation format 2 run the old code, so a call that hits one of those
 * situations would leave their database different from ours. The app asks
 * these checks on the originating device, before the op runs, and stamps such
 * calls with mutation format 3: format-2 builds then stop with "update
 * required" instead of applying them the old way.
 *
 * Every check answers for the database as it is NOW (before the op), errs
 * towards true when unsure, and never writes.
 */
export class LegacyReplayService {
  private readonly queries: TransactionQueries;

  constructor(private readonly db: DatabaseAdapter) {
    this.queries = new TransactionQueries(db);
  }

  /**
   * Edits of a split parent's amount, date, account or rate now also rescale
   * its lines and move / re-convert its mirror rows (A4, A19, A20); older
   * builds update the parent alone.
   */
  isSplitParent(transactionId: number): boolean {
    return this.queries.getSplitsForTransaction(Number(transactionId)).length > 0;
  }

  /**
   * Replacing or clearing a split parent's lines deletes its existing mirror
   * rows. Older builds do that without fixing the target accounts' balances
   * (A3) and only find mirrors keyed by the parent's current date.
   */
  hasSplitMirrors(transactionId: number): boolean {
    return this.queries.getSplitMirrorTransactions(Number(transactionId)).length > 0;
  }

  /**
   * True when deleting `ids` removes a different set of rows than older
   * builds remove (their getTransactionsForDelete: the rows, plus every row
   * sharing a TransferID, plus a split parent's mirrors keyed by its CURRENT
   * date). The current code differs in two cases only:
   *  - a split-transfer mirror whose parent still exists (and is not itself a
   *    transfer leg) now takes the parent and all its mirrors with it (A21);
   *  - a split parent's mirrors keyed by an older parent date are now found.
   * Both are checked set-wise (a few queries per 500 ids, whatever the size of
   * the selection), without building either delete set.
   */
  deleteDiffersFromLegacy(ids: number[]): boolean {
    const requested = validIds(ids);
    if (!requested.length) return false;
    const rows = this.queries.getTransactionsByIDs(requested);
    const selected = new Set(rows.map((row) => Number(row.ID)));
    const parentIds = validIds(
      rows.map((row) => /^split_transfer_(\d+)_/.exec(row.TransferID ?? '')?.[1])
    ).filter((parentId) => !selected.has(parentId));
    if (this.queries.getTransactionsByIDs(parentIds).some((parent) => !parent.TransferID)) {
      return true;
    }
    const parents = rows.filter((row) => !row.TransferID).map((row) => Number(row.ID));
    for (let index = 0; index < parents.length; index += CHUNK) {
      const chunk = parents.slice(index, index + CHUNK);
      // A mirror of the parent (TransferID split_transfer_<id>_*, range + GLOB
      // so the TransferID index is used) under a key other than its current date.
      const row = getRow<{ Found: number }>(
        this.db,
        `SELECT 1 AS Found FROM transactions t
          WHERE t.ID IN (${placeholders(chunk)})
            AND EXISTS (SELECT 1 FROM transaction_splits s
                         WHERE s.TransactionID = t.ID AND s.TransferAccountID)
            AND EXISTS (SELECT 1 FROM transactions m
                         WHERE m.TransferID != ''
                           AND m.TransferID >= 'split_transfer_' || t.ID || '_'
                           AND m.TransferID < 'split_transfer_' || t.ID || '\`'
                           AND m.TransferID GLOB 'split_transfer_' || t.ID || '_*'
                           AND m.TransferID != 'split_transfer_' || t.ID || '_' || t.Date)
          LIMIT 1`,
        ...chunk
      );
      if (row) return true;
    }
    return false;
  }

  /**
   * Rate re-conversions now bring split lines back in step with their
   * parents in the affected accounts (resyncSplitLinesForAccounts); older
   * builds leave lines that are out of step as they are.
   */
  hasSplitLinesOutOfStep(accountIds: number[]): boolean {
    const ids = validIds(accountIds);
    for (let index = 0; index < ids.length; index += CHUNK) {
      const chunk = ids.slice(index, index + CHUNK);
      if (this.splitLinesOutOfStep(`t.AccountID IN (${placeholders(chunk)})`, chunk)) return true;
    }
    return false;
  }

  /** hasSplitLinesOutOfStep for every account of the budget. */
  budgetHasSplitLinesOutOfStep(budgetId: number): boolean {
    return this.splitLinesOutOfStep('t.BudgetID = ?', [budgetId]);
  }

  /**
   * Whether a split parent matching `where` has lines that linesOutOfStep
   * would rescale, in one aggregate query: the lines' converted net differs
   * from the parent's, or (when every line has native amounts) their native
   * net differs from the parent's native net (native falling back to converted
   * per side).
   */
  private splitLinesOutOfStep(where: string, params: unknown[]): boolean {
    const row = getRow<{ Found: number }>(
      this.db,
      `SELECT 1 AS Found
         FROM transactions t
         JOIN (SELECT TransactionID,
                      SUM(COALESCE(InflowConverted, 0) - COALESCE(OutflowConverted, 0)) AS Converted,
                      SUM(COALESCE(InflowNative, 0) - COALESCE(OutflowNative, 0)) AS Native,
                      SUM(InflowNative IS NULL AND OutflowNative IS NULL) AS NoNative
                 FROM transaction_splits
                GROUP BY TransactionID) s ON s.TransactionID = t.ID
        WHERE ${where}
          AND (s.Converted != COALESCE(t.InflowConverted, 0) - COALESCE(t.OutflowConverted, 0)
            OR (s.NoNative = 0
                AND s.Native != COALESCE(t.InflowNative, t.InflowConverted, 0)
                              - COALESCE(t.OutflowNative, t.OutflowConverted, 0)))
        LIMIT 1`,
      ...params
    );
    return Boolean(row);
  }

  /**
   * Whether any of these accounts' stored balances (account totals or the
   * last running balance) disagree with their rows. Writes that create split
   * mirrors now recalculate the mirror accounts in full, which repairs such
   * drift (left by older builds, A3); older builds adjust the stored values
   * incrementally and keep it. Drift in the middle of a ledger only is not
   * checked (no write path is known to leave it).
   */
  accountsOutOfBalance(accountIds: number[]): boolean {
    const ids = validIds(accountIds);
    for (let index = 0; index < ids.length; index += CHUNK) {
      const chunk = ids.slice(index, index + CHUNK);
      const row = getRow<{ Found: number }>(
        this.db,
        `WITH sums AS (
           SELECT a.ID, a.BalanceNative, a.BalanceConverted,
                  COALESCE((SELECT SUM(COALESCE(t.InflowNative, 0) - COALESCE(t.OutflowNative, 0))
                              FROM transactions t WHERE t.AccountID = a.ID), 0) AS Native,
                  COALESCE((SELECT SUM(COALESCE(t.InflowConverted, 0) - COALESCE(t.OutflowConverted, 0))
                              FROM transactions t WHERE t.AccountID = a.ID), 0) AS Converted,
                  COALESCE((SELECT SUM(r.DeltaConverted) FROM account_revaluations r
                             WHERE r.AccountID = a.ID), 0) AS Revalued,
                  (SELECT t.ID FROM transactions t WHERE t.AccountID = a.ID
                    ORDER BY t.Date DESC, t.ID DESC LIMIT 1) AS LastID
             FROM accounts a
            WHERE a.ID IN (${placeholders(chunk)}))
         SELECT 1 AS Found
           FROM sums
           LEFT JOIN transactions last ON last.ID = sums.LastID
          WHERE sums.BalanceNative IS NOT sums.Native
             -- older builds add to COALESCE(BalanceConverted, BalanceNative)
             OR COALESCE(sums.BalanceConverted, sums.BalanceNative) IS NOT sums.Converted + sums.Revalued
             OR (last.ID IS NOT NULL
                 AND (last.RunningBalanceNative IS NOT sums.Native
                   OR last.RunningBalanceConverted IS NOT sums.Converted))
          LIMIT 1`,
        ...chunk
      );
      if (row) return true;
    }
    return false;
  }

  /** Accounts that the transfer lines of these split parents point at. */
  splitTransferTargets(transactionIds: number[]): number[] {
    const ids = validIds(transactionIds);
    const targets: number[] = [];
    for (let index = 0; index < ids.length; index += CHUNK) {
      const chunk = ids.slice(index, index + CHUNK);
      targets.push(
        ...allRows<{ TransferAccountID: number }>(
          this.db,
          `SELECT DISTINCT TransferAccountID FROM transaction_splits
            WHERE TransactionID IN (${placeholders(chunk)}) AND TransferAccountID`,
          ...chunk
        ).map((row) => Number(row.TransferAccountID))
      );
    }
    return validIds(targets);
  }

  /**
   * Whether the budget has split parents in accounts held in a currency other
   * than the budget's (optionally only `currencies`): rate changes re-convert
   * those parents, and now their lines with them (A20).
   */
  hasForeignSplitParents(budgetId: number, currencies?: string[]): boolean {
    const filter = currencies?.filter((code) => typeof code === 'string' && code) ?? [];
    const row = getRow<{ Found: number }>(
      this.db,
      `SELECT 1 AS Found
         FROM transactions t
         JOIN accounts a ON a.ID = t.AccountID
         JOIN budgets b ON b.ID = t.BudgetID
        WHERE t.BudgetID = ?
          AND a.Currency != b.DisplayCurrency
          ${filter.length ? `AND a.Currency IN (${placeholders(filter)})` : ''}
          AND EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
        LIMIT 1`,
      budgetId,
      ...filter
    );
    return Boolean(row);
  }

  /** Whether any account of these (or, without ids, of the budget) holds a split parent. */
  hasSplitParents(budgetId: number, transactionIds?: number[]): boolean {
    const ids = transactionIds ? validIds(transactionIds) : [];
    if (transactionIds && !ids.length) return false;
    const row = getRow<{ Found: number }>(
      this.db,
      `SELECT 1 AS Found FROM transactions t
        WHERE t.BudgetID = ?
          ${ids.length ? `AND t.ID IN (${placeholders(ids)})` : ''}
          AND EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
        LIMIT 1`,
      budgetId,
      ...ids
    );
    return Boolean(row);
  }

  /**
   * Account currency changes now re-sync the account's split lines with the
   * re-converted parents.
   */
  accountHasSplitParents(accountId: number): boolean {
    const row = getRow<{ Found: number }>(
      this.db,
      `SELECT 1 AS Found FROM transactions t
        WHERE t.AccountID = ?
          AND EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
        LIMIT 1`,
      accountId
    );
    return Boolean(row);
  }

  /**
   * Deleting a category (or every category of a group) that still holds
   * transactions now also deletes their transfer partners and split mirrors
   * and recalculates the accounts (A5); older builds let the rows cascade and
   * leave the balances as they were.
   */
  categoriesHoldTransactions(categoryIds: number[]): boolean {
    const ids = validIds(categoryIds);
    if (!ids.length) return false;
    const row = getRow<{ Found: number }>(
      this.db,
      `SELECT 1 AS Found FROM transactions WHERE CategoryID IN (${placeholders(ids)}) LIMIT 1`,
      ...ids
    );
    return Boolean(row);
  }

  /** categoriesHoldTransactions for every category in a group. */
  categoryGroupHoldsTransactions(groupId: number): boolean {
    const row = getRow<{ Found: number }>(
      this.db,
      `SELECT 1 AS Found FROM transactions t
         JOIN categories c ON c.ID = t.CategoryID
        WHERE c.CategoryGroupID = ?
        LIMIT 1`,
      groupId
    );
    return Boolean(row);
  }

  /**
   * Deleting a loan / mortgage / credit card account deletes the categories it
   * owns. Rows OTHER accounts hold in them (the checking side of loan
   * payments) now move to Uncategorized (A7); older builds cascade-delete them.
   */
  accountDeleteMovesOtherRows(accountId: number): boolean {
    const account = getRow<{ BudgetID: number; Name: string; Metadata: string | null }>(
      this.db,
      'SELECT BudgetID, Name, Metadata FROM accounts WHERE ID = ?',
      accountId
    );
    if (!account) return false;
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(account.Metadata || '{}') as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    const owned = [metadata.linked_category_id, metadata.cc_payment_category_id].filter(
      (value): value is number => typeof value === 'number'
    );
    // deleteAccount's by-name fallback for accounts without metadata links
    const byName = allRows<{ ID: number }>(
      this.db,
      `SELECT c.ID FROM categories c
         JOIN category_groups g ON g.ID = c.CategoryGroupID
        WHERE c.BudgetID = ? AND c.Name = ? AND g.Name IN ('Liabilities', 'Credit Card Payments')`,
      account.BudgetID,
      account.Name
    ).map((row) => row.ID);
    const categories = validIds([...owned, ...byName]);
    if (!categories.length) return false;
    const list = placeholders(categories);
    const row = getRow<{ Found: number }>(
      this.db,
      `SELECT 1 AS Found WHERE
         EXISTS (SELECT 1 FROM transactions
                  WHERE CategoryID IN (${list}) AND AccountID != ?)
         OR EXISTS (SELECT 1 FROM transaction_splits s
                      JOIN transactions t ON t.ID = s.TransactionID
                     WHERE s.CategoryID IN (${list}) AND t.AccountID != ?)`,
      ...categories,
      accountId,
      ...categories,
      accountId
    );
    return Boolean(row);
  }
}
