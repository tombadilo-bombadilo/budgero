import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import {
  Transaction,
  GetTransactionsByAccountRow,
  GetTransactionsByAccountAndMonthRow,
  GetAllTransactions,
  GetTransactionsByCategoryAndMonthRow,
  TransactionSplit,
  LabelListItem,
  AccountTransactionPage,
  AccountTransactionPageOptions,
  AccountTransactionSummary,
  AccountBalanceHistoryTransaction,
  AccountFutureBalanceAdjustment,
  AccountUncategorizedCount,
  SimilarTransaction,
  SimilarTransactionQuery,
} from './types.js';
import type { Account } from '../accounts/types.js';
import type { Budget } from '../budgets/types.js';
import { asMilli, ZERO_MILLI } from '../../money/index.js';
import type { BalanceHistoryBucket, BalanceHistoryRow } from './types.js';

/**
 * Shared column list for the detailed transaction-row SELECTs.
 * Expects `FROM transactions t${TX_ROW_JOINS}` (c = categories, l = labels, a = accounts).
 * Callers that expose the account name append `a.Name as Account`.
 */
const TX_ROW_COLUMNS = `
        t.ID,
        t.Date,
        t.CategoryID,
        CASE WHEN EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
             THEN 'Split'
             ELSE c.Name END as Category,
        t.LabelID,
        l.Name as Label,
        l.Color as LabelColor,
        t.Memo,
        t.Payee,
        t.Reconciled,
        t.Cleared,
        t.InflowConverted,
        t.OutflowConverted,
        t.InflowNative,
        t.OutflowNative,
        t.RunningBalanceConverted,
        t.RunningBalanceNative,
        t.ExchangeRate,
        t.ExchangeRateOverride,
        t.TransferID,
        a.OnBudget AS AccountOnBudget,
        transfer_partner_account.OnBudget AS TransferAccountOnBudget,
        transfer_partner_account.Name AS TransferAccountName`;

/**
 * Joins the first other leg (lowest ID) of a linked transfer and its account,
 * as `transfer_partner_account`, for TX_ROW_COLUMNS. One indexed lookup per row:
 * the `!= ''` term lets SQLite use the partial idx_transactions_transfer_id.
 */
const TX_ROW_JOINS = `
      LEFT JOIN categories c ON t.CategoryID = c.ID
      LEFT JOIN labels l ON t.LabelID = l.ID
      LEFT JOIN accounts a ON t.AccountID = a.ID
      LEFT JOIN transactions transfer_partner ON transfer_partner.ID = (
        SELECT p.ID
          FROM transactions p
          JOIN accounts pa ON pa.ID = p.AccountID
         WHERE p.TransferID = t.TransferID
           AND p.TransferID != ''
           AND p.ID != t.ID
         ORDER BY p.ID
         LIMIT 1)
      LEFT JOIN accounts transfer_partner_account ON transfer_partner_account.ID = transfer_partner.AccountID`;

const SQLITE_BIND_CHUNK_SIZE = 500;
const DEFAULT_ACCOUNT_PAGE_SIZE = 200;
const MAX_ACCOUNT_PAGE_SIZE = 500;

function chunkValues<T>(values: T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += SQLITE_BIND_CHUNK_SIZE) {
    chunks.push(values.slice(index, index + SQLITE_BIND_CHUNK_SIZE));
  }
  return chunks;
}

/**
 * Excludes transactions that have split rows (those are queried through their
 * splits instead). Expects `t` as the transactions alias; the subquery uses
 * `s2` so it can sit alongside a `transaction_splits s` join.
 */
export const NO_SPLITS_FILTER = `AND NOT EXISTS (SELECT 1 FROM transaction_splits s2 WHERE s2.TransactionID = t.ID)`;

/**
 * Bounds and GLOB pattern for TransferIDs starting with `prefix`. The range and
 * the `!= ''` guard let SQLite use the partial TransferID index; GLOB keeps `_`
 * literal. The prefixes used here end in `_`, and '`' is the next character.
 */
function splitMirrorRange(prefix: string): [string, string, string] {
  return [prefix, `${prefix.slice(0, -1)}\``, `${prefix}*`];
}

/**
 * TransactionQueries - All SQL queries for transaction operations
 * Extracted from the main queries file for better organization
 */
export class TransactionQueries {
  constructor(private db: DatabaseAdapter) {}

  getLatestRunningBalances(accountId: number): {
    Date: string;
    RunningBalanceConverted: number | null;
    RunningBalanceNative: number | null;
  } | null {
    return (
      getRow<{
        Date: string;
        RunningBalanceConverted: number | null;
        RunningBalanceNative: number | null;
      }>(
        this.db,
        `
        SELECT Date, RunningBalanceConverted, RunningBalanceNative
        FROM transactions
        WHERE AccountID = ?
        ORDER BY Date DESC, ID DESC
        LIMIT 1
      `,
        accountId
      ) ?? null
    );
  }

  /**
   * GetAccountAndBudget - Loads an account row and a budget row together.
   * The budget defaults to the account's own BudgetID; pass `budgetId` to load
   * a specific one. Either row may be undefined when missing.
   */
  getAccountAndBudget(accountId: number, budgetId?: number) {
    const account = getRow<Account>(this.db, 'SELECT * FROM accounts WHERE ID = ?', accountId);

    const effectiveBudgetId = budgetId ?? account?.BudgetID;
    let budget;
    if (effectiveBudgetId != null) {
      budget = getRow<Budget>(this.db, 'SELECT * FROM budgets WHERE ID = ?', effectiveBudgetId);
    }

    return { account, budget };
  }

  /**
   * UpdateAccountBalance - Updates both original and converted account balances
   * SQL: UPDATE accounts SET balance = balance + ? - ?, balance_converted = balance_converted + ? - ? WHERE id = ?
   */
  updateAccountBalance(
    accountId: number,
    inflowOriginal: number,
    outflowOriginal: number,
    inflowConverted: number,
    outflowConverted: number
  ): void {
    run(
      this.db,
      `
      UPDATE accounts 
      SET BalanceNative = BalanceNative + ? - ?,
          BalanceConverted = COALESCE(BalanceConverted, BalanceNative) + ? - ?
      WHERE ID = ?
    `,
      inflowOriginal,
      outflowOriginal,
      inflowConverted,
      outflowConverted,
      accountId
    );
  }

  /**
   * InsertTransactionWithBalance - Inserts a new transaction with running balance
   * Always stores both original and converted amounts (they may be the same if no conversion needed)
   * SQL: INSERT INTO transactions (...) VALUES (...) RETURNING id
   */
  insertTransactionWithBalance(
    inflow: number,
    outflow: number,
    inflowOriginal: number,
    outflowOriginal: number,
    categoryId: number,
    accountId: number,
    date: string,
    memo: string,
    payee: string | null,
    budgetId: number,
    runningBalance: number,
    runningBalanceOriginal: number,
    transferId?: string | null,
    exchangeRate?: number | null,
    labelId?: number | null,
    exchangeRateOverride = false,
    excludeFromReadyToAssign = false,
    cleared = false,
    id?: number
  ): number {
    const result = run(
      this.db,
      `
      INSERT INTO transactions (
        ID, InflowConverted, OutflowConverted, InflowNative, OutflowNative, CategoryID, AccountID,
        Date, Memo, Payee, BudgetID, RunningBalanceConverted, RunningBalanceNative, TransferID,
        ExchangeRate, LabelID, ExchangeRateOverride, ExcludeFromReadyToAssign, Cleared
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id ?? null,
      inflow,
      outflow,
      inflowOriginal,
      outflowOriginal,
      categoryId,
      accountId,
      date,
      memo,
      payee,
      budgetId,
      runningBalance,
      runningBalanceOriginal,
      transferId,
      exchangeRate ?? null,
      labelId ?? null,
      exchangeRateOverride ? 1 : 0,
      excludeFromReadyToAssign ? 1 : 0,
      cleared ? 1 : 0
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * GetAllTransactions - Gets all transactions for a budget
   * SQL: SELECT * FROM transactions WHERE budget_id = ? ORDER BY date DESC, id DESC
   */
  getAllTransactions(budgetId: number, limit?: number): GetAllTransactions[] {
    const normalizedLimit =
      typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null;

    return allRows<GetAllTransactions>(
      this.db,
      `
      SELECT
        t.ID,
        t.AccountID as AccountId,
        a.Name as AccountName,
        t.Date,
        t.CategoryID,
        CASE WHEN EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
             THEN 'Split'
             ELSE c.Name END as Category,
        t.LabelID,
        l.Name as Label,
        l.Color as LabelColor,
        t.Memo,
        t.Payee,
        t.InflowConverted,
        t.OutflowConverted,
        t.RunningBalanceConverted,
        t.TransferID
      FROM transactions t
        LEFT JOIN categories c ON t.CategoryID = c.ID
        LEFT JOIN labels l ON t.LabelID = l.ID
        LEFT JOIN accounts a ON t.AccountID = a.ID
      WHERE t.BudgetID = ?
      ORDER BY t.Date DESC, t.ID DESC
      ${normalizedLimit === null ? '' : 'LIMIT ?'}
    `,
      budgetId,
      ...(normalizedLimit === null ? [] : [normalizedLimit])
    );
  }

  /**
   * GetAllTransactionsDetailed - Gets all transactions for a budget with full details
   * Returns same format as getTransactionsByAccount but for all accounts
   */
  getAllTransactionsDetailed(budgetId: number, afterDate?: string): GetTransactionsByAccountRow[] {
    return allRows<GetTransactionsByAccountRow>(
      this.db,
      `
      SELECT${TX_ROW_COLUMNS},
        t.AccountID,
        a.Name as Account
      FROM transactions t${TX_ROW_JOINS}
      WHERE t.BudgetID = ?
      ${afterDate ? 'AND t.Date > ?' : ''}
      ORDER BY t.Date DESC, t.ID DESC
    `,
      budgetId,
      ...(afterDate ? [afterDate] : [])
    );
  }

  /**
   * GetAllTransactionsAnalytics - Budget-wide rows with split parents expanded
   * into their split lines (category, payee, and amounts from the split; date,
   * account, and label from the parent). Blank split payees inherit the parent.
   * Transfer split lines carry the same
   * synthetic TransferID as their mirror rows so both sides read as a transfer.
   * For aggregation views — registers keep getAllTransactionsDetailed.
   */
  getAllTransactionsAnalytics(budgetId: number): GetTransactionsByAccountRow[] {
    return allRows<GetTransactionsByAccountRow>(
      this.db,
      `
      SELECT
        t.ID as ID,
        t.Date as Date,
        s.CategoryID,
        c.Name as Category,
        t.LabelID,
        l.Name as Label,
        l.Color as LabelColor,
        COALESCE(s.Memo, t.Memo) as Memo,
        COALESCE(NULLIF(s.Payee, ''), t.Payee) AS Payee,
        t.Reconciled,
        t.Cleared,
        s.InflowConverted,
        s.OutflowConverted,
        s.InflowNative,
        s.OutflowNative,
        NULL as RunningBalanceConverted,
        NULL as RunningBalanceNative,
        t.ExchangeRate,
        t.ExchangeRateOverride,
        CASE WHEN s.TransferAccountID IS NOT NULL
             THEN 'split_transfer_' || t.ID || '_' || t.Date
             ELSE t.TransferID END as TransferID,
        t.AccountID,
        a.Name as Account
      FROM transaction_splits s
      JOIN transactions t ON t.ID = s.TransactionID
      LEFT JOIN categories c ON s.CategoryID = c.ID
      LEFT JOIN labels l ON t.LabelID = l.ID
      LEFT JOIN accounts a ON t.AccountID = a.ID
      WHERE t.BudgetID = ?
      UNION ALL
      SELECT
        t.ID as ID,
        t.Date as Date,
        t.CategoryID,
        c.Name as Category,
        t.LabelID,
        l.Name as Label,
        l.Color as LabelColor,
        t.Memo,
        t.Payee,
        t.Reconciled,
        t.Cleared,
        t.InflowConverted,
        t.OutflowConverted,
        t.InflowNative,
        t.OutflowNative,
        t.RunningBalanceConverted,
        t.RunningBalanceNative,
        t.ExchangeRate,
        t.ExchangeRateOverride,
        t.TransferID,
        t.AccountID,
        a.Name as Account
      FROM transactions t
      LEFT JOIN categories c ON t.CategoryID = c.ID
      LEFT JOIN labels l ON t.LabelID = l.ID
      LEFT JOIN accounts a ON t.AccountID = a.ID
      WHERE t.BudgetID = ?
      ${NO_SPLITS_FILTER}
      ORDER BY Date DESC, ID DESC
    `,
      budgetId,
      budgetId
    );
  }

  /**
   * GetTransactionsByAccount - Gets transactions for a specific account with category names
   * SQL: Complex JOIN with categories and category_groups
   */
  getTransactionsByAccount(accountId: number): GetTransactionsByAccountRow[] {
    // The accounts join supplies budget state but this view does not expose its name.
    return allRows<GetTransactionsByAccountRow>(
      this.db,
      `
      SELECT${TX_ROW_COLUMNS}
      FROM transactions t${TX_ROW_JOINS}
      WHERE t.AccountID = ?
      ORDER BY t.Date DESC, t.ID DESC
    `,
      accountId
    );
  }

  /**
   * Read one bounded account-register page using a stable Date/ID keyset.
   * The extra row is used only to determine whether another page exists.
   */
  getTransactionsByAccountPage(
    accountId: number,
    options: AccountTransactionPageOptions = {}
  ): AccountTransactionPage {
    const requestedLimit = Number.isFinite(options.limit)
      ? Math.floor(options.limit as number)
      : DEFAULT_ACCOUNT_PAGE_SIZE;
    const limit = Math.min(MAX_ACCOUNT_PAGE_SIZE, Math.max(1, requestedLimit));
    const where = ['t.AccountID = ?'];
    const params: (string | number)[] = [accountId];

    if (options.fromDate) {
      where.push('t.Date >= ?');
      params.push(options.fromDate);
    }
    if (options.toDate) {
      where.push('t.Date <= ?');
      params.push(options.toDate);
    }
    if (options.cursor) {
      where.push('(t.Date, t.ID) < (?, ?)');
      params.push(options.cursor.Date, options.cursor.ID);
    }

    const fetched = allRows<GetTransactionsByAccountRow>(
      this.db,
      `
      SELECT${TX_ROW_COLUMNS}
      FROM transactions t${TX_ROW_JOINS}
      WHERE ${where.join(' AND ')}
      ORDER BY t.Date DESC, t.ID DESC
      LIMIT ?
    `,
      ...params,
      limit + 1
    );

    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    const last = rows.at(-1);
    return {
      rows,
      nextCursor: hasMore && last ? { Date: last.Date, ID: last.ID } : null,
    };
  }

  /**
   * Transactions in the same account that may be the same payment as a new
   * entry: same direction, amount within the tolerance, date within the window. Banks
   * often list a pending charge on one date and the settled one on another.
   * Transfer legs are excluded; nearest date, then closest amount, first.
   */
  findSimilarTransactions({
    accountId,
    date,
    amountNative,
    dayWindow = 7,
    toleranceBps = 100,
    limit = 3,
  }: SimilarTransactionQuery): SimilarTransaction[] {
    if (!amountNative) return [];
    // Never tighter than 0.01 (10 milliunits), so "exact" still absorbs rounding.
    const tolerance = Math.max(10, Math.round((Math.abs(amountNative) * toleranceBps) / 10_000));
    return allRows<SimilarTransaction>(
      this.db,
      `
      SELECT ID, Date, COALESCE(Payee, '') AS Payee, COALESCE(Memo, '') AS Memo, AmountNative
      FROM (
        SELECT t.ID, t.Date, t.Payee, t.Memo,
          COALESCE(t.InflowNative, t.InflowConverted, 0)
            - COALESCE(t.OutflowNative, t.OutflowConverted, 0) AS AmountNative
        FROM transactions t
        WHERE t.AccountID = ?
          AND t.Date >= date(?, ?) AND t.Date < date(?, ?)
          AND (t.TransferID IS NULL OR t.TransferID = '')
      )
      WHERE ABS(AmountNative - ?) <= ? AND (AmountNative > 0) = (? > 0)
      ORDER BY ABS(julianday(Date) - julianday(?)), ABS(AmountNative - ?), ID DESC
      LIMIT ?
    `,
      accountId,
      date,
      `-${dayWindow} days`,
      date,
      `+${dayWindow + 1} days`,
      amountNative,
      tolerance,
      amountNative,
      date,
      amountNative,
      limit
    );
  }

  /** Fetch the selected account-register date range for correctness-sensitive search. */
  getTransactionsByAccountRange(
    accountId: number,
    fromDate?: string,
    toDate?: string
  ): GetTransactionsByAccountRow[] {
    const where = ['t.AccountID = ?'];
    const params: (string | number)[] = [accountId];
    if (fromDate) {
      where.push('t.Date >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      where.push('t.Date <= ?');
      params.push(toDate);
    }

    return allRows<GetTransactionsByAccountRow>(
      this.db,
      `
      SELECT${TX_ROW_COLUMNS}
      FROM transactions t${TX_ROW_JOINS}
      WHERE ${where.join(' AND ')}
      ORDER BY t.Date DESC, t.ID DESC
    `,
      ...params
    );
  }

  /** Aggregate account-register totals without allocating and joining every transaction row. */
  getAccountTransactionSummary(
    accountId: number,
    fromDate?: string,
    toDate?: string
  ): AccountTransactionSummary {
    const where = ['t.AccountID = ?'];
    const params: (string | number)[] = [accountId];
    if (fromDate) {
      where.push('t.Date >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      where.push('t.Date <= ?');
      params.push(toDate);
    }
    const maxSafe = Number.MAX_SAFE_INTEGER;
    const moneyColumns = [
      'InflowConverted',
      'OutflowConverted',
      'InflowNative',
      'OutflowNative',
      'RunningBalanceConverted',
      'RunningBalanceNative',
    ];
    const unsafeMoney = moneyColumns
      .map(
        (column) =>
          `(t.${column} IS NOT NULL AND (typeof(t.${column}) <> 'integer' OR t.${column} > ${maxSafe} OR t.${column} < -${maxSafe}))`
      )
      .join(' OR ');

    return (
      getRow<AccountTransactionSummary>(
        this.db,
        `
        SELECT
          COUNT(*) AS TransactionCount,
          COALESCE(SUM(CASE WHEN t.TransferID IS NOT NULL AND t.TransferID != '' THEN 1 ELSE 0 END), 0) AS TransferTransactionCount,
          COALESCE(SUM(CASE
            WHEN NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
             AND (t.CategoryID IS NULL OR t.CategoryID = 0 OR c.Name IS NULL OR c.Name = '' OR c.Name = 'Uncategorized')
            THEN 1 ELSE 0 END), 0) AS UncategorizedCount,
          COALESCE(SUM(CASE WHEN t.Cleared = 0 AND t.Reconciled = 0 THEN 1 ELSE 0 END), 0) AS UnclearedCount,
          COALESCE(SUM(CASE WHEN ${unsafeMoney} THEN 1 ELSE 0 END), 0) AS UnsafeTransactionCount,
          COALESCE(SUM(t.InflowConverted), 0) AS TotalInflowConverted,
          COALESCE(SUM(t.OutflowConverted), 0) AS TotalOutflowConverted,
          COALESCE(SUM(COALESCE(t.InflowNative, t.InflowConverted)), 0) AS TotalInflowNative,
          COALESCE(SUM(COALESCE(t.OutflowNative, t.OutflowConverted)), 0) AS TotalOutflowNative
        FROM transactions t
        LEFT JOIN categories c ON t.CategoryID = c.ID
        WHERE ${where.join(' AND ')}
      `,
        ...params
      ) ?? {
        TransactionCount: 0,
        TransferTransactionCount: 0,
        UncategorizedCount: 0,
        UnclearedCount: 0,
        UnsafeTransactionCount: 0,
        TotalInflowConverted: ZERO_MILLI,
        TotalOutflowConverted: ZERO_MILLI,
        TotalInflowNative: ZERO_MILLI,
        TotalOutflowNative: ZERO_MILLI,
      }
    );
  }

  /**
   * Per-account sums of rows dated after `afterDate`, so the accounts page can
   * back future-dated entries out of today's balance without loading registers.
   */
  getFutureBalanceAdjustments(
    budgetId: number,
    afterDate: string
  ): AccountFutureBalanceAdjustment[] {
    return allRows<AccountFutureBalanceAdjustment>(
      this.db,
      `
      SELECT
        t.AccountID,
        COALESCE(SUM(
          COALESCE(t.InflowNative, t.InflowConverted, 0) - COALESCE(t.OutflowNative, t.OutflowConverted, 0)
        ), 0) AS Original,
        COALESCE(SUM(COALESCE(t.InflowConverted, 0) - COALESCE(t.OutflowConverted, 0)), 0) AS Converted
      FROM transactions t
      WHERE t.BudgetID = ? AND t.Date > ?
      GROUP BY t.AccountID
    `,
      budgetId,
      afterDate
    );
  }

  /**
   * Uncategorized transaction counts per account (split parents excluded; their
   * lines carry the categories). Same rule as the register summary's UncategorizedCount:
   * CategoryID 0, a CategoryID with no category row, or a category named
   * '' / NULL / 'Uncategorized'.
   *
   * Driven by category: `used_ids` walks the distinct CategoryIDs on
   * idx_transactions_category_date (one seek per distinct ID), `uncategorized_ids`
   * keeps the ones the rule above matches (dangling IDs included, so rows written
   * while foreign keys were off still count), and only those categories' rows
   * are read, instead of every row of the budget.
   */
  getUncategorizedCountsByAccount(budgetId: number): AccountUncategorizedCount[] {
    return allRows<AccountUncategorizedCount>(
      this.db,
      `
      WITH RECURSIVE used_ids(id) AS (
        SELECT MIN(CategoryID) FROM transactions
        UNION ALL
        SELECT (SELECT MIN(t.CategoryID) FROM transactions t WHERE t.CategoryID > used_ids.id)
        FROM used_ids
        WHERE used_ids.id IS NOT NULL
      ),
      uncategorized_ids(id) AS (
        SELECT u.id FROM used_ids u
        WHERE u.id IS NOT NULL
          AND (
            u.id = 0
            OR NOT EXISTS (
              SELECT 1 FROM categories c
              WHERE c.ID = u.id AND c.Name IS NOT NULL AND c.Name <> '' AND c.Name <> 'Uncategorized'
            )
          )
      )
      SELECT t.AccountID, COUNT(*) AS Count
      FROM uncategorized_ids u
      CROSS JOIN transactions t ON t.CategoryID = u.id
      WHERE t.BudgetID = ?
        ${NO_SPLITS_FILTER}
      GROUP BY t.AccountID
      ORDER BY t.AccountID
    `,
      budgetId
    );
  }

  accountHasTransactions(accountId: number): boolean {
    return Boolean(
      getRow<{ Found: number }>(
        this.db,
        'SELECT 1 AS Found FROM transactions WHERE AccountID = ? LIMIT 1',
        accountId
      )
    );
  }

  /**
   * Return only a chart window plus one synthetic opening-balance row. This
   * preserves exact sparkline math without loading an account's entire ledger.
   */
  getAccountBalanceHistory(
    accountId: number,
    fromDate: string,
    toDate: string
  ): AccountBalanceHistoryTransaction[] {
    const opening = getRow<{ RunningBalanceConverted: number | null }>(
      this.db,
      `
      SELECT RunningBalanceConverted
      FROM transactions
      WHERE AccountID = ? AND Date < ?
      ORDER BY Date DESC, ID DESC
      LIMIT 1
    `,
      accountId,
      fromDate
    );
    const rows = allRows<AccountBalanceHistoryTransaction>(
      this.db,
      `
      SELECT Date, InflowConverted, OutflowConverted
      FROM transactions
      WHERE AccountID = ? AND Date >= ? AND Date <= ?
      ORDER BY Date ASC, ID ASC
    `,
      accountId,
      fromDate,
      toDate
    );
    if (opening?.RunningBalanceConverted == null) return rows;
    return [
      {
        Date: '0001-01-01',
        InflowConverted: asMilli(opening.RunningBalanceConverted),
        OutflowConverted: ZERO_MILLI,
      },
      ...rows,
    ];
  }

  /** Joined register row used to patch the UI cache after a mutation completes. */
  getTransactionForAccountRegister(id: number): GetTransactionsByAccountRow | undefined {
    return getRow<GetTransactionsByAccountRow>(
      this.db,
      `
      SELECT${TX_ROW_COLUMNS},
        t.AccountID,
        a.Name AS Account
      FROM transactions t${TX_ROW_JOINS}
      WHERE t.ID = ?
    `,
      id
    );
  }

  /**
   * GetTransactionsByAccountAndMonth - Gets transactions for an account in a specific month
   * SQL: Complex JOIN with date filtering
   */
  getTransactionsByAccountAndMonth(
    accountId: number,
    month: string
  ): GetTransactionsByAccountAndMonthRow[] {
    return this.getTransactionsByAccountsAndMonth([accountId], month);
  }

  /**
   * Same rows as calling getTransactionsByAccountAndMonth for each account in turn and
   * concatenating: grouped in `accountIds` order, then Date DESC, ID DESC.
   *
   * Filters on the stored Month column (`substr(Date, 1, 7)`, the month the budget uses)
   * instead of `strftime('%Y-%m', Date)`, which was evaluated on every row of each account's
   * ledger. The Date range is the same month as a prefix range, so idx_transactions_account_date_id
   * reads only that month. Month is always 'YYYY-MM'; any other string matches nothing, as before.
   */
  getTransactionsByAccountsAndMonth(
    accountIds: readonly number[],
    month: string
  ): GetTransactionsByAccountAndMonthRow[] {
    if (accountIds.length === 0 || !/^\d{4}-\d{2}$/.test(month)) return [];
    // Smallest string above every string starting with `month` ('2026-10' -> '2026-11').
    const monthEnd = month.slice(0, 6) + String.fromCharCode(month.charCodeAt(6) + 1);
    return allRows<GetTransactionsByAccountAndMonthRow>(
      this.db,
      `
      SELECT${TX_ROW_COLUMNS},
        a.Name as Account
      FROM json_each(?) ids
      CROSS JOIN transactions t
        ON t.AccountID = ids.value AND t.Date >= ? AND t.Date < ? AND t.Month = ?${TX_ROW_JOINS}
      ORDER BY ids.key, t.Date DESC, t.ID DESC
    `,
      JSON.stringify(accountIds),
      month,
      monthEnd,
      month
    );
  }

  private getRunningBalanceColumn(
    col: 'RunningBalanceConverted' | 'RunningBalanceNative',
    accountId: number,
    date: string,
    id?: number
  ): number | null {
    const query = `
      SELECT ${col}
      FROM transactions
      WHERE AccountID = ?
        AND (Date < ? OR (Date = ? AND ID < COALESCE(?, 9223372036854775807)))
      ORDER BY Date DESC, ID DESC
      LIMIT 1
    `;
    const params = [accountId, date, date, id || null];
    const result = getRow<Record<string, number>>(this.db, query, ...params);
    return result?.[col] ?? null;
  }

  /**
   * GetRunningBalanceBefore - Gets the running balance before a specific transaction
   * SQL: SELECT running_balance FROM transactions WHERE account_id = ? AND (date < ? OR (date = ? AND id < COALESCE(?, 9223372036854775807))) ORDER BY date DESC, id DESC LIMIT 1
   */
  getRunningBalanceBefore(accountId: number, date: string, id?: number): number | null {
    return this.getRunningBalanceColumn('RunningBalanceConverted', accountId, date, id);
  }

  /**
   * GetRunningBalanceOriginalBefore - Gets the original currency running balance before a date/transaction
   */
  getRunningBalanceOriginalBefore(accountId: number, date: string, id?: number): number | null {
    return this.getRunningBalanceColumn('RunningBalanceNative', accountId, date, id);
  }

  getRunningBalancesBefore(
    accountId: number,
    date: string,
    id?: number
  ): {
    RunningBalanceConverted: number | null;
    RunningBalanceNative: number | null;
  } | null {
    return (
      getRow<{
        RunningBalanceConverted: number | null;
        RunningBalanceNative: number | null;
      }>(
        this.db,
        `
        SELECT RunningBalanceConverted, RunningBalanceNative
        FROM transactions
        WHERE AccountID = ?
          AND (Date < ? OR (Date = ? AND ID < COALESCE(?, 9223372036854775807)))
        ORDER BY Date DESC, ID DESC
        LIMIT 1
      `,
        accountId,
        date,
        date,
        id || null
      ) ?? null
    );
  }

  private bumpFutureBalancesColumn(
    col: 'RunningBalanceConverted' | 'RunningBalanceNative',
    accountId: number,
    date: string,
    id: number,
    delta: number
  ): void {
    run(
      this.db,
      `
      UPDATE transactions
      SET ${col} = ${col} + ?
      WHERE AccountID = ? AND (Date > ? OR (Date = ? AND ID > ?))
    `,
      delta,
      accountId,
      date,
      date,
      id
    );
  }

  /**
   * BumpFutureBalances - Updates running balances for all transactions after a specific date
   * SQL: UPDATE transactions SET running_balance = running_balance + ? WHERE ...
   */
  bumpFutureBalances(accountId: number, date: string, id: number, delta: number): void {
    this.bumpFutureBalancesColumn('RunningBalanceConverted', accountId, date, id, delta);
  }

  /**
   * BumpFutureBalancesOriginal - Updates original running balances for all transactions after a specific date
   */
  bumpFutureBalancesOriginal(accountId: number, date: string, id: number, delta: number): void {
    this.bumpFutureBalancesColumn('RunningBalanceNative', accountId, date, id, delta);
  }

  bumpFutureBalancesCombined(
    accountId: number,
    date: string,
    id: number,
    convertedDelta: number,
    nativeDelta: number
  ): void {
    run(
      this.db,
      `
      UPDATE transactions
      SET RunningBalanceConverted = RunningBalanceConverted + ?,
          RunningBalanceNative = RunningBalanceNative + ?
      WHERE AccountID = ? AND (Date > ? OR (Date = ? AND ID > ?))
    `,
      convertedDelta,
      nativeDelta,
      accountId,
      date,
      date,
      id
    );
  }

  private updateRunningBalanceColumn(
    col: 'RunningBalanceConverted' | 'RunningBalanceNative',
    id: number,
    runningBalance: number
  ): void {
    run(
      this.db,
      `
      UPDATE transactions
      SET ${col} = ?
      WHERE ID = ?
    `,
      runningBalance,
      id
    );
  }

  /**
   * UpdateRunningBalance - Updates running balance for a specific transaction
   * SQL: UPDATE transactions SET running_balance = ? WHERE id = ?
   */
  updateRunningBalance(id: number, runningBalance: number): void {
    this.updateRunningBalanceColumn('RunningBalanceConverted', id, runningBalance);
  }

  /**
   * UpdateRunningBalanceOriginal - Updates original running balance for a specific transaction
   * SQL: UPDATE transactions SET RunningBalanceNative = ? WHERE ID = ?
   */
  updateRunningBalanceOriginal(id: number, runningBalance: number): void {
    this.updateRunningBalanceColumn('RunningBalanceNative', id, runningBalance);
  }

  /**
   * GetTransactionByID - Gets a specific transaction by ID
   * SQL: SELECT * FROM transactions WHERE id = ?
   */
  getTransactionByID(id: number): Transaction | undefined {
    return getRow<Transaction>(
      this.db,
      `
      SELECT * FROM transactions 
      WHERE ID = ?
    `,
      id
    );
  }

  /**
   * GetTransactionsByCategory - Gets all transactions for a category
   * SQL: SELECT * FROM transactions WHERE category_id = ? ORDER BY date DESC
   */
  getTransactionsByCategory(categoryId: number): Transaction[] {
    return allRows<Transaction>(
      this.db,
      `
      SELECT * FROM transactions 
      WHERE CategoryID = ? 
      ORDER BY Date DESC
    `,
      categoryId
    );
  }

  /**
   * UpdateTransaction - Updates a transaction with both original and converted amounts
   * SQL: UPDATE transactions SET ... WHERE id = ?
   */
  updateTransaction(
    id: number,
    inflow: number,
    outflow: number,
    inflowOriginal: number,
    outflowOriginal: number,
    categoryId: number,
    accountId: number,
    date: string,
    memo: string,
    payee: string | null
  ): void {
    run(
      this.db,
      `
      UPDATE transactions 
      SET InflowConverted = ?, OutflowConverted = ?, InflowNative = ?, OutflowNative = ?, 
          CategoryID = ?, AccountID = ?, Date = ?, Memo = ?, Payee = ?
      WHERE ID = ?
    `,
      inflow,
      outflow,
      inflowOriginal,
      outflowOriginal,
      categoryId,
      accountId,
      date,
      memo,
      payee,
      id
    );
  }

  /**
   * UpdateTransactionWithOriginal - Updates a transaction when editing original amounts
   * This method updates both original and converted amounts, maintaining the currency conversion
   */
  updateTransactionWithOriginal(
    id: number,
    inflowOriginal: number,
    outflowOriginal: number,
    inflowConverted: number,
    outflowConverted: number,
    categoryId: number,
    accountId: number,
    date: string,
    memo: string,
    payee: string | null
  ): void {
    run(
      this.db,
      `
      UPDATE transactions 
      SET InflowNative = ?, OutflowNative = ?, 
          InflowConverted = ?, OutflowConverted = ?,
          CategoryID = ?, AccountID = ?, Date = ?, Memo = ?, Payee = ?
      WHERE ID = ?
    `,
      inflowOriginal,
      outflowOriginal,
      inflowConverted,
      outflowConverted,
      categoryId,
      accountId,
      date,
      memo,
      payee,
      id
    );
  }

  /**
   * Set or clear ConversionPending flag on a transaction
   */
  setConversionPending(id: number, pending: boolean): void {
    run(
      this.db,
      `
      UPDATE transactions 
      SET ConversionPending = ?
      WHERE ID = ?
    `,
      pending ? 1 : 0,
      id
    );
  }

  /**
   * SetExchangeRate - Updates the exchange rate and override flag for a transaction
   */
  setExchangeRate(id: number, rate: number | null, override: boolean): void {
    run(
      this.db,
      `
      UPDATE transactions
      SET ExchangeRate = ?, ExchangeRateOverride = ?
      WHERE ID = ?
    `,
      rate,
      override ? 1 : 0,
      id
    );
  }

  /**
   * RecalculateBalances - Recalculates all running balances for an account
   * This is needed after updating transactions to ensure balance consistency
   */
  recalculateBalances(accountId: number): void {
    this.recalculateBalancesForAccounts([accountId]);
  }

  /**
   * Recalculate running and account balances for several accounts in set-based SQL.
   */
  recalculateBalancesForAccounts(accountIds: number[]): void {
    const ids = [...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0))];

    for (const chunk of chunkValues(ids)) {
      const placeholders = chunk.map(() => '?').join(', ');

      run(
        this.db,
        `
        WITH balances AS MATERIALIZED (
          SELECT
            ID,
            SUM(COALESCE(InflowConverted, 0) - COALESCE(OutflowConverted, 0)) OVER (
              PARTITION BY AccountID
              ORDER BY Date ASC, ID ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS RunningConverted,
            SUM(COALESCE(InflowNative, 0) - COALESCE(OutflowNative, 0)) OVER (
              PARTITION BY AccountID
              ORDER BY Date ASC, ID ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS RunningNative
          FROM transactions
          WHERE AccountID IN (${placeholders})
        )
        UPDATE transactions
        SET RunningBalanceConverted = balances.RunningConverted,
            RunningBalanceNative = balances.RunningNative
        FROM balances
        WHERE transactions.ID = balances.ID
          AND (transactions.RunningBalanceConverted IS NOT balances.RunningConverted
            OR transactions.RunningBalanceNative IS NOT balances.RunningNative)
      `,
        ...chunk
      );

      run(
        this.db,
        `
        UPDATE accounts
        SET BalanceNative = COALESCE((
              SELECT SUM(COALESCE(t.InflowNative, 0) - COALESCE(t.OutflowNative, 0))
              FROM transactions t
              WHERE t.AccountID = accounts.ID
            ), 0),
            BalanceConverted = COALESCE((
              SELECT SUM(COALESCE(t.InflowConverted, 0) - COALESCE(t.OutflowConverted, 0))
              FROM transactions t
              WHERE t.AccountID = accounts.ID
            ), 0) + COALESCE((
              SELECT SUM(r.DeltaConverted)
              FROM account_revaluations r
              WHERE r.AccountID = accounts.ID
            ), 0)
        WHERE ID IN (${placeholders})
      `,
        ...chunk
      );
    }
  }

  /**
   * Recalculate one account's running balances from the row at (fromDate, fromId)
   * onward in ledger order (Date, ID), seeded with the stored balances of the row
   * just before it, then the account balances. For a write that changed only rows
   * at or after that point (an amount edit, or a date move with `fromDate` = the
   * earlier of the old and new date) this gives the same balances as
   * recalculateBalances, without reading and rewriting the whole ledger: the rows
   * before it are untouched and already correct, as every write path keeps them.
   * Rows that already hold the right value are not rewritten. Falls back to the
   * full recalculation when the seed row has no stored balances or the rows
   * before it turn out not to add up.
   */
  recalculateBalancesFrom(accountId: number, fromDate: string, fromId: number): void {
    const seed = getRow<{
      RunningBalanceConverted: number | null;
      RunningBalanceNative: number | null;
    }>(
      this.db,
      `
      SELECT RunningBalanceConverted, RunningBalanceNative
      FROM transactions
      WHERE AccountID = ?1 AND (Date < ?2 OR (Date = ?2 AND ID < ?3))
      ORDER BY Date DESC, ID DESC
      LIMIT 1
    `,
      accountId,
      fromDate,
      fromId
    );
    if (seed && (seed.RunningBalanceConverted === null || seed.RunningBalanceNative === null)) {
      this.recalculateBalancesForAccounts([accountId]);
      return;
    }

    run(
      this.db,
      `
      WITH balances AS MATERIALIZED (
        SELECT
          ID,
          ?4 + SUM(COALESCE(InflowConverted, 0) - COALESCE(OutflowConverted, 0)) OVER (
            ORDER BY Date ASC, ID ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS RunningConverted,
          ?5 + SUM(COALESCE(InflowNative, 0) - COALESCE(OutflowNative, 0)) OVER (
            ORDER BY Date ASC, ID ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS RunningNative
        FROM transactions
        WHERE AccountID = ?1 AND (Date > ?2 OR (Date = ?2 AND ID >= ?3))
      )
      UPDATE transactions
      SET RunningBalanceConverted = balances.RunningConverted,
          RunningBalanceNative = balances.RunningNative
      FROM balances
      WHERE transactions.ID = balances.ID
        AND (transactions.RunningBalanceConverted IS NOT balances.RunningConverted
          OR transactions.RunningBalanceNative IS NOT balances.RunningNative)
    `,
      accountId,
      fromDate,
      fromId,
      seed?.RunningBalanceConverted ?? 0,
      seed?.RunningBalanceNative ?? 0
    );

    // Account balances: the same sums over every row as the full recalculation.
    // They must equal the last row's running balance; if not, some row before
    // `fromDate` was already off, so recalculate the account in full (which also
    // repairs those rows, as the full recalculation always did).
    const totals = getRow<{ native: number; converted: number }>(
      this.db,
      `
      SELECT COALESCE(SUM(COALESCE(InflowNative, 0) - COALESCE(OutflowNative, 0)), 0) AS native,
             COALESCE(SUM(COALESCE(InflowConverted, 0) - COALESCE(OutflowConverted, 0)), 0) AS converted
      FROM transactions
      WHERE AccountID = ?
    `,
      accountId
    );
    const last = getRow<{ RunningBalanceConverted: number; RunningBalanceNative: number }>(
      this.db,
      `
      SELECT RunningBalanceConverted, RunningBalanceNative
      FROM transactions
      WHERE AccountID = ?
      ORDER BY Date DESC, ID DESC
      LIMIT 1
    `,
      accountId
    );
    const native = totals?.native ?? 0;
    const converted = totals?.converted ?? 0;
    if (
      (last?.RunningBalanceNative ?? 0) !== native ||
      (last?.RunningBalanceConverted ?? 0) !== converted
    ) {
      this.recalculateBalancesForAccounts([accountId]);
      return;
    }
    run(
      this.db,
      `
      UPDATE accounts
      SET BalanceNative = ?2,
          BalanceConverted = ?3 + COALESCE((
            SELECT SUM(r.DeltaConverted)
            FROM account_revaluations r
            WHERE r.AccountID = accounts.ID
          ), 0)
      WHERE ID = ?1
    `,
      accountId,
      native,
      converted
    );
  }

  getTransactionsByIDs(ids: number[]): Transaction[] {
    const normalized = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    return chunkValues(normalized).flatMap((chunk) => {
      const placeholders = chunk.map(() => '?').join(', ');
      return allRows<Transaction>(
        this.db,
        `SELECT * FROM transactions WHERE ID IN (${placeholders})`,
        ...chunk
      );
    });
  }

  getTransactionsByCategoryIDs(categoryIds: number[]): Transaction[] {
    const normalized = [...new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0))];
    return chunkValues(normalized).flatMap((chunk) => {
      const placeholders = chunk.map(() => '?').join(', ');
      return allRows<Transaction>(
        this.db,
        `SELECT * FROM transactions WHERE CategoryID IN (${placeholders})`,
        ...chunk
      );
    });
  }

  getTransactionsByTransferIDs(transferIds: string[]): Transaction[] {
    const normalized = [...new Set(transferIds.filter(Boolean))];
    return chunkValues(normalized).flatMap((chunk) => {
      const placeholders = chunk.map(() => '?').join(', ');
      return allRows<Transaction>(
        this.db,
        `SELECT * FROM transactions WHERE TransferID IN (${placeholders}) AND TransferID != ''`,
        ...chunk
      );
    });
  }

  /**
   * DeleteTransaction - Deletes a transaction
   * SQL: DELETE FROM transactions WHERE id = ?
   */
  deleteTransaction(id: number): void {
    run(
      this.db,
      `
      DELETE FROM transactions 
      WHERE ID = ?
    `,
      id
    );
  }

  deleteTransactions(ids: number[]): void {
    const normalized = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    for (const chunk of chunkValues(normalized)) {
      const placeholders = chunk.map(() => '?').join(', ');
      run(this.db, `DELETE FROM transactions WHERE ID IN (${placeholders})`, ...chunk);
    }
  }

  /**
   * MoveTransactionToAccount - Moves a transaction to a different account
   * SQL: UPDATE transactions SET account_id = ? WHERE id = ?
   */
  moveTransactionToAccount(id: number, accountId: number): void {
    run(
      this.db,
      `
      UPDATE transactions 
      SET AccountID = ? 
      WHERE ID = ?
    `,
      accountId,
      id
    );
  }

  /**
   * RecategorizeTransaction - Changes the category of a transaction
   * SQL: UPDATE transactions SET category_id = ? WHERE id = ?
   */
  recategorizeTransaction(id: number, categoryId: number): void {
    run(
      this.db,
      `
      UPDATE transactions 
      SET CategoryID = ? 
      WHERE ID = ?
    `,
      categoryId,
      id
    );
  }

  /** Keep the shared category invariant for a simple linked transfer. */
  recategorizeTransfer(transferId: string, categoryId: number): void {
    run(
      this.db,
      `
      UPDATE transactions
      SET CategoryID = ?
      WHERE TransferID = ? AND TransferID != ''
    `,
      categoryId,
      transferId
    );
  }

  /**
   * ReassignTransactionCategories - Moves all transactions from one category to another
   * SQL: UPDATE transactions SET category_id = ? WHERE category_id = ?
   */
  reassignTransactionCategories(newCategoryId: number, oldCategoryId: number): void {
    this.db.transaction(() => {
      run(
        this.db,
        'UPDATE transactions SET CategoryID = ? WHERE CategoryID = ?',
        newCategoryId,
        oldCategoryId
      );
      // Split lines and scheduled transactions also retain their category when
      // the source is deleted by the shared category reassignment flow.
      run(
        this.db,
        'UPDATE transaction_splits SET CategoryID = ? WHERE CategoryID = ?',
        newCategoryId,
        oldCategoryId
      );
      run(
        this.db,
        'UPDATE recurring_transactions SET CategoryID = ? WHERE CategoryID = ?',
        newCategoryId,
        oldCategoryId
      );
    });
  }

  /**
   * GetTransactionsByTransferID - Gets transactions by transfer ID
   * SQL: SELECT * FROM transactions WHERE transfer_id = ? ORDER BY date DESC
   */
  getTransactionsByTransferID(transferId: string): Transaction[] {
    return allRows<Transaction>(
      this.db,
      `
      SELECT * FROM transactions 
      WHERE TransferID = ? AND TransferID != ''
      ORDER BY Date DESC
    `,
      transferId
    );
  }

  isOnBudgetToOnBudgetTransfer(transactionId: number): boolean {
    const row = getRow<{ LegCount: number; OnBudgetLegCount: number }>(
      this.db,
      `
      SELECT
        COUNT(*) AS LegCount,
        SUM(CASE WHEN a.OnBudget = 1 THEN 1 ELSE 0 END) AS OnBudgetLegCount
      FROM transactions transfer_leg
      JOIN accounts a ON a.ID = transfer_leg.AccountID
      WHERE transfer_leg.TransferID = (
        SELECT TransferID FROM transactions WHERE ID = ?
      )
        AND transfer_leg.TransferID IS NOT NULL
        AND transfer_leg.TransferID != ''
    `,
      transactionId
    );
    return Number(row?.LegCount) === 2 && Number(row?.OnBudgetLegCount) === 2;
  }

  /**
   * Mirror rows created for a split parent's transfer lines. Matched by the
   * `split_transfer_<parentId>_` prefix so rows keyed by an older parent date
   * are still found. GLOB keeps `_` literal.
   */
  getSplitMirrorTransactions(parentId: number): Transaction[] {
    return allRows<Transaction>(
      this.db,
      `SELECT * FROM transactions
       WHERE TransferID != '' AND TransferID >= ? AND TransferID < ? AND TransferID GLOB ?`,
      ...splitMirrorRange(`split_transfer_${parentId}_`)
    );
  }

  /** Split-transfer mirrors belonging to any of the given parents. */
  getSplitMirrorsForParents(parentIds: number[]): Transaction[] {
    const parents = new Set(parentIds);
    if (parents.size === 0) return [];
    return allRows<Transaction>(
      this.db,
      `SELECT * FROM transactions
       WHERE TransferID != '' AND TransferID >= ? AND TransferID < ? AND TransferID GLOB ?`,
      ...splitMirrorRange('split_transfer_')
    ).filter((row) =>
      parents.has(Number(/^split_transfer_(\d+)_/.exec(row.TransferID ?? '')?.[1]))
    );
  }

  /** Re-key a split parent's mirrors to the parent's current date. */
  rekeySplitMirrors(parentId: number, date: string): void {
    run(
      this.db,
      `UPDATE transactions SET Date = ?, TransferID = ?
       WHERE TransferID != '' AND TransferID >= ? AND TransferID < ? AND TransferID GLOB ?`,
      date,
      `split_transfer_${parentId}_${date}`,
      ...splitMirrorRange(`split_transfer_${parentId}_`)
    );
  }

  /**
   * Delete transactions by transfer ID (used to remove old split mirrors)
   */
  deleteTransactionsByTransferID(transferId: string): void {
    run(
      this.db,
      `
      DELETE FROM transactions WHERE TransferID = ? AND TransferID != ''
    `,
      transferId
    );
  }

  /**
   * GetTransactionsByCategoryAndMonth - Gets transactions for a specific category and month from on-budget accounts only
   * SQL: Complex JOIN with categories and date filtering
   */
  getTransactionsByCategoryAndMonth(
    budgetId: number,
    categoryName: string,
    month: string
  ): GetTransactionsByCategoryAndMonthRow[] {
    const result = allRows<GetTransactionsByCategoryAndMonthRow>(
      this.db,
      `
      WITH split_rows AS (
        SELECT
          t.ID,
          t.Date,
          COALESCE(s.Memo, t.Memo) as Memo,
          COALESCE(NULLIF(s.Payee, ''), t.Payee) as Payee,
          t.LabelID as LabelID,
          l.Name as Label,
          l.Color as LabelColor,
          COALESCE(s.InflowConverted, 0) as InflowConverted,
          COALESCE(s.OutflowConverted, 0) as OutflowConverted,
          NULL as RunningBalanceConverted,
          t.AccountID,
          a.Name as Account,
          c.Name as Category,
          c.ID as CategoryID,
          t.ExchangeRate,
          t.ExchangeRateOverride
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        LEFT JOIN categories c ON s.CategoryID = c.ID
        LEFT JOIN labels l ON t.LabelID = l.ID
        LEFT JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?
          AND c.Name = ?
          AND strftime('%Y-%m', t.Date) = ?
          AND a.OnBudget = TRUE
      ),
      base_rows AS (
        SELECT
          t.ID,
          t.Date,
          t.Memo,
          t.Payee as Payee,
          t.LabelID as LabelID,
          l.Name as Label,
          l.Color as LabelColor,
          t.InflowConverted,
          t.OutflowConverted,
          t.RunningBalanceConverted,
          t.AccountID,
          a.Name as Account,
          c.Name as Category,
          c.ID as CategoryID,
          t.ExchangeRate,
          t.ExchangeRateOverride
        FROM transactions t
        LEFT JOIN categories c ON t.CategoryID = c.ID
        LEFT JOIN labels l ON t.LabelID = l.ID
        LEFT JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?
          AND c.Name = ?
          AND strftime('%Y-%m', t.Date) = ?
          AND a.OnBudget = TRUE
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
      )
      SELECT * FROM split_rows
      UNION ALL
      SELECT * FROM base_rows
      ORDER BY Date DESC, ID DESC
    `,
      budgetId,
      categoryName,
      month,
      budgetId,
      categoryName,
      month
    );
    const transactions = (result || []) as GetTransactionsByCategoryAndMonthRow[];
    return transactions;
  }

  getTransactionsByCategoryAndRange(
    budgetId: number,
    categoryId: number | null,
    startDate: string,
    endDate: string,
    accountIds?: number[]
  ): GetTransactionsByCategoryAndMonthRow[] {
    const hasAccountFilter = Array.isArray(accountIds) && accountIds.length > 0;
    const accountFilterClause = hasAccountFilter
      ? ` AND a.ID IN (${accountIds.map(() => '?').join(', ')})`
      : '';

    const splitCategoryCondition =
      categoryId === null ? 's.CategoryID IS NULL' : 's.CategoryID = ?';
    const baseCategoryCondition = categoryId === null ? 't.CategoryID IS NULL' : 't.CategoryID = ?';

    const query = `
      WITH split_rows AS (
        SELECT
          t.ID,
          t.Date,
          COALESCE(s.Memo, t.Memo) AS Memo,
          COALESCE(NULLIF(s.Payee, ''), t.Payee) AS Payee,
          t.LabelID AS LabelID,
          l.Name AS Label,
          l.Color AS LabelColor,
          COALESCE(s.InflowConverted, 0) AS InflowConverted,
          COALESCE(s.OutflowConverted, 0) AS OutflowConverted,
          NULL AS RunningBalanceConverted,
          t.AccountID,
          a.Name AS Account,
          COALESCE(c.Name, 'Uncategorized') AS Category,
          COALESCE(s.CategoryID, c.ID) AS CategoryID,
          t.ExchangeRate,
          t.ExchangeRateOverride
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        LEFT JOIN categories c ON s.CategoryID = c.ID
        LEFT JOIN labels l ON t.LabelID = l.ID
        LEFT JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          ${accountFilterClause}
          AND ${splitCategoryCondition}
      ),
      base_rows AS (
        SELECT
          t.ID,
          t.Date,
          t.Memo,
          t.Payee AS Payee,
          t.LabelID AS LabelID,
          l.Name AS Label,
          l.Color AS LabelColor,
          t.InflowConverted,
          t.OutflowConverted,
          t.RunningBalanceConverted,
          t.AccountID,
          a.Name AS Account,
          COALESCE(c.Name, 'Uncategorized') AS Category,
          t.CategoryID AS CategoryID,
          t.ExchangeRate,
          t.ExchangeRateOverride
        FROM transactions t
        LEFT JOIN categories c ON t.CategoryID = c.ID
        LEFT JOIN labels l ON t.LabelID = l.ID
        LEFT JOIN accounts a ON t.AccountID = a.ID
        WHERE t.BudgetID = ?
          AND DATE(t.Date) >= DATE(?)
          AND DATE(t.Date) <= DATE(?)
          ${accountFilterClause}
          AND ${baseCategoryCondition}
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = t.ID)
      )
      SELECT * FROM split_rows
      UNION ALL
      SELECT * FROM base_rows
      ORDER BY Date DESC, ID DESC;
    `;

    const params: (string | number)[] = [budgetId, startDate, endDate];
    if (hasAccountFilter && accountIds) {
      params.push(...accountIds);
    }
    if (categoryId !== null) {
      params.push(categoryId);
    }

    const params2: (string | number)[] = [budgetId, startDate, endDate];
    if (hasAccountFilter && accountIds) {
      params2.push(...accountIds);
    }
    if (categoryId !== null) {
      params2.push(categoryId);
    }

    return allRows<GetTransactionsByCategoryAndMonthRow>(this.db, query, ...params, ...params2);
  }

  listSavedPayees(
    budgetId: number
  ): { ID: number; Name: string; CreatedAt?: string; UpdatedAt?: string }[] {
    return allRows<{ ID: number; Name: string; CreatedAt?: string; UpdatedAt?: string }>(
      this.db,
      `
      SELECT ID, Name, CreatedAt, UpdatedAt
      FROM payees
      WHERE BudgetID = ?
      ORDER BY Name COLLATE NOCASE
    `,
      budgetId
    );
  }

  insertPayee(budgetId: number, name: string): number {
    const result = run(
      this.db,
      `
      INSERT INTO payees (BudgetID, Name, Metadata)
      VALUES (?, ?, '{}')
      ON CONFLICT(BudgetID, Name) DO NOTHING
    `,
      budgetId,
      name
    );
    return Number(result.lastInsertRowid) || 0;
  }

  deletePayee(budgetId: number, name: string): void {
    run(this.db, `DELETE FROM payees WHERE BudgetID = ? AND Name = ?`, budgetId, name);
  }

  /**
   * The category the payee was last filed under, for the add-transaction
   * form's category memory. Returns null when the payee is new or has no
   * usable history.
   *
   * Deliberately narrow about what counts as "history":
   *  - a split line counts only when it has its own payee and category
   *  - transfers aren't spending, so they're excluded
   *  - "Uncategorized" means the user never chose, so it isn't a memory
   * Payee matching is case-insensitive, matching how the payee directory
   * treats names.
   */
  getLastCategoryForPayee(
    budgetId: number,
    payee: string
  ): { CategoryID: number; CategoryName: string; Date: string } | null {
    const row = getRow<{ CategoryID: number; CategoryName: string; Date: string }>(
      this.db,
      `
      SELECT history.CategoryID, c.Name AS CategoryName, history.Date
      FROM (
        SELECT t.CategoryID, t.Date, t.ID AS TransactionID, 0 AS SplitOrder
        FROM transactions t
        WHERE t.BudgetID = ?
          AND t.Payee = ? COLLATE NOCASE
          AND (t.TransferID IS NULL OR t.TransferID = '')
          ${NO_SPLITS_FILTER}

        UNION ALL

        SELECT s.CategoryID, t.Date, t.ID AS TransactionID, s.OrderIndex AS SplitOrder
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        WHERE t.BudgetID = ?
          AND s.Payee = ? COLLATE NOCASE
          AND (s.TransferAccountID IS NULL OR s.TransferAccountID = 0)
      ) history
      JOIN categories c ON c.ID = history.CategoryID
      WHERE history.CategoryID IS NOT NULL
        AND history.CategoryID > 0
        AND c.Name <> 'Uncategorized'
      ORDER BY history.Date DESC, history.TransactionID DESC, history.SplitOrder DESC
      LIMIT 1
    `,
      budgetId,
      payee,
      budgetId,
      payee
    );
    return row ?? null;
  }

  getPayeeUsageCounts(budgetId: number): { Name: string; UsageCount: number }[] {
    return allRows<{ Name: string; UsageCount: number }>(
      this.db,
      `
      SELECT Name, SUM(UsageCount) AS UsageCount
      FROM (
        SELECT Payee AS Name, COUNT(*) AS UsageCount
        FROM transactions
        WHERE BudgetID = ?
          AND Payee IS NOT NULL
          AND TRIM(Payee) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM transaction_splits s
            WHERE s.TransactionID = transactions.ID
              AND s.Payee IS NOT NULL
              AND TRIM(s.Payee) <> ''
          )
        GROUP BY Payee

        UNION ALL

        SELECT s.Payee AS Name, COUNT(*) AS UsageCount
        FROM transaction_splits s
        JOIN transactions t ON t.ID = s.TransactionID
        WHERE t.BudgetID = ?
          AND s.Payee IS NOT NULL
          AND TRIM(s.Payee) <> ''
        GROUP BY s.Payee
      ) usage
      GROUP BY Name COLLATE NOCASE
      ORDER BY Name COLLATE NOCASE
    `,
      budgetId,
      budgetId
    );
  }

  updatePayeeValue(budgetId: number, oldName: string, newName: string | null): number {
    const transactions = run(
      this.db,
      `
      UPDATE transactions
      SET Payee = ?
      WHERE BudgetID = ? AND Payee = ?
    `,
      newName,
      budgetId,
      oldName
    );
    const splits = run(
      this.db,
      `
      UPDATE transaction_splits
      SET Payee = ?
      WHERE TransactionID IN (SELECT ID FROM transactions WHERE BudgetID = ?)
        AND Payee = ?
    `,
      newName,
      budgetId,
      oldName
    );
    return (transactions?.changes ?? 0) + (splits?.changes ?? 0);
  }

  listLabelsWithUsage(budgetId: number): LabelListItem[] {
    return allRows<LabelListItem>(
      this.db,
      `
      SELECT
        l.ID,
        l.Name,
        l.Color,
        COUNT(t.ID) as UsageCount
      FROM labels l
      LEFT JOIN transactions t
        ON t.LabelID = l.ID
       AND t.BudgetID = l.BudgetID
      WHERE l.BudgetID = ?
      GROUP BY l.ID, l.Name, l.Color
      ORDER BY l.Name COLLATE NOCASE
    `,
      budgetId
    );
  }

  getLabelById(
    id: number,
    budgetId: number
  ): { ID: number; BudgetID: number; Name: string; Color: string } | undefined {
    return getRow<{ ID: number; BudgetID: number; Name: string; Color: string }>(
      this.db,
      `
      SELECT ID, BudgetID, Name, Color
      FROM labels
      WHERE ID = ? AND BudgetID = ?
      LIMIT 1
    `,
      id,
      budgetId
    );
  }

  insertLabel(budgetId: number, name: string, color: string, id?: number): number {
    const result = run(
      this.db,
      `
      INSERT INTO labels (ID, BudgetID, Name, Color)
      VALUES (?, ?, ?, ?)
    `,
      id ?? null,
      budgetId,
      name,
      color
    );
    return Number(result.lastInsertRowid) || 0;
  }

  updateLabel(id: number, budgetId: number, name: string, color: string): number {
    const result = run(
      this.db,
      `
      UPDATE labels
      SET Name = ?, Color = ?, UpdatedAt = datetime('now')
      WHERE ID = ? AND BudgetID = ?
    `,
      name,
      color,
      id,
      budgetId
    );
    return result?.changes ?? 0;
  }

  deleteLabel(id: number, budgetId: number): number {
    const result = run(
      this.db,
      `
      DELETE FROM labels
      WHERE ID = ? AND BudgetID = ?
    `,
      id,
      budgetId
    );
    return result?.changes ?? 0;
  }

  clearLabelFromTransactions(budgetId: number, labelId: number): number {
    const result = run(
      this.db,
      `
      UPDATE transactions
      SET LabelID = NULL
      WHERE BudgetID = ? AND LabelID = ?
    `,
      budgetId,
      labelId
    );
    return result?.changes ?? 0;
  }

  updateTransactionLabel(transactionId: number, labelId: number | null): number {
    const result = run(
      this.db,
      `
      UPDATE transactions
      SET LabelID = ?
      WHERE ID = ?
    `,
      labelId,
      transactionId
    );
    return result?.changes ?? 0;
  }

  updateTransactionMemo(transactionId: number, memo: string): void {
    run(this.db, `UPDATE transactions SET Memo = ? WHERE ID = ?`, memo, transactionId);
  }

  updateTransactionPayee(transactionId: number, payee: string | null): void {
    run(this.db, `UPDATE transactions SET Payee = ? WHERE ID = ?`, payee, transactionId);
  }

  updateTransactionDate(transactionId: number, date: string): void {
    run(this.db, `UPDATE transactions SET Date = ? WHERE ID = ?`, date, transactionId);
  }

  /**
   * Lock transactions up to `date` as reconciled. With `clearedOnly`, only
   * cleared rows are locked and uncleared ones stay open; without it (the
   * legacy behaviour, kept for replaying older reconcile ops) every row is.
   * Reconciled rows are always cleared.
   */
  markTransactionsAsReconciled(accountId: number, date: string, clearedOnly = false): void {
    run(
      this.db,
      `
      UPDATE transactions
      SET Reconciled = TRUE, Cleared = TRUE
      WHERE AccountID = ? AND Date <= ? AND Reconciled = FALSE
        ${clearedOnly ? 'AND Cleared = TRUE' : ''}
    `,
      accountId,
      date
    );
  }

  /** Unlock specific reconciled rows of an account (undo of a reconcile). */
  unmarkTransactionsAsReconciled(accountId: number, ids: number[]): void {
    for (const chunk of chunkValues(ids)) {
      run(
        this.db,
        `UPDATE transactions SET Reconciled = FALSE
          WHERE AccountID = ? AND ID IN (${chunk.map(() => '?').join(', ')})`,
        accountId,
        ...chunk
      );
    }
  }

  /**
   * Mark transactions cleared or uncleared. Reconciled rows are locked and
   * left untouched. Returns the IDs whose status actually changed.
   */
  setTransactionsCleared(ids: number[], cleared: boolean): number[] {
    const changed: number[] = [];
    for (const chunk of chunkValues(ids)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = allRows<{ ID: number }>(
        this.db,
        `SELECT ID FROM transactions
          WHERE ID IN (${placeholders}) AND Reconciled = FALSE AND Cleared != ?`,
        ...chunk,
        cleared ? 1 : 0
      );
      if (!rows.length) continue;
      const targets = rows.map((row) => row.ID);
      run(
        this.db,
        `UPDATE transactions SET Cleared = ? WHERE ID IN (${targets.map(() => '?').join(', ')})`,
        cleared ? 1 : 0,
        ...targets
      );
      changed.push(...targets);
    }
    return changed;
  }

  /**
   * UpdateAccountReconciledAt - Updates the reconciled_at timestamp for an account
   * SQL: UPDATE accounts SET reconciled_at = ? WHERE id = ?
   */
  updateAccountReconciledAt(accountId: number, reconciledAt: string | null): void {
    run(
      this.db,
      `
      UPDATE accounts 
      SET ReconciledAt = ? 
      WHERE ID = ?
    `,
      reconciledAt,
      accountId
    );
  }

  /**
   * Split helpers
   */
  deleteSplitsForTransaction(transactionId: number): void {
    run(this.db, `DELETE FROM transaction_splits WHERE TransactionID = ?`, transactionId);
  }

  insertSplitLine(split: Omit<TransactionSplit, 'ID'>): number {
    const result = run(
      this.db,
      `
      INSERT INTO transaction_splits (
        TransactionID, CategoryID, TransferAccountID, Memo, Payee,
        InflowConverted, OutflowConverted, InflowNative, OutflowNative, PairID, OrderIndex
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      split.TransactionID,
      split.CategoryID ?? null,
      split.TransferAccountID ?? null,
      split.Memo,
      split.Payee ?? '',
      split.InflowConverted,
      split.OutflowConverted,
      split.InflowNative ?? null,
      split.OutflowNative ?? null,
      split.PairID ?? null,
      split.OrderIndex ?? 0
    );
    return Number(result.lastInsertRowid);
  }

  getSplitsForTransaction(transactionId: number): TransactionSplit[] {
    return allRows<TransactionSplit>(
      this.db,
      `
      SELECT
        s.*,
        c.Name AS CategoryName,
        a.Name AS TransferAccountName
      FROM transaction_splits s
      LEFT JOIN categories c ON s.CategoryID = c.ID
      LEFT JOIN accounts a ON s.TransferAccountID = a.ID
      WHERE s.TransactionID = ?
      ORDER BY s.OrderIndex, s.ID
    `,
      transactionId
    );
  }

  /**
   * UpdateTransferMemosForAccountRename - Updates all transfer memos when an account is renamed
   * Replaces "Transfer from {oldName}" with "Transfer from {newName}"
   * and "to {oldName}" with "to {newName}" (legacy "Transfer from X to Y" memos),
   * plus either side of the current "X → Y: memo" format on transfer rows.
   */
  updateTransferMemosForAccountRename(budgetId: number, oldName: string, newName: string): number {
    // Two patterns: "Transfer from {name}" (source side) and " to {name}"
    // (destination in the "Transfer from X to Y" format — the leading space
    // keeps the match specific and avoids false positives).
    let changes = 0;
    for (const [pattern, replacement] of [
      [`Transfer from ${oldName}`, `Transfer from ${newName}`],
      [` to ${oldName}`, ` to ${newName}`],
    ]) {
      const result = run(
        this.db,
        `
        UPDATE transactions
        SET Memo = REPLACE(Memo, ?, ?)
        WHERE BudgetID = ?
          AND Memo LIKE ?
      `,
        pattern,
        replacement,
        budgetId,
        `%${pattern}%`
      );
      // Matches previous behavior: the returned count is the last pattern's.
      changes = result.changes || 0;
    }

    // Current format: "{source} → {destination}[: memo][ (conversion)]".
    const rows = allRows<{ ID: number; Memo: string }>(
      this.db,
      `
        SELECT ID, Memo FROM transactions
        WHERE BudgetID = ? AND TransferID IS NOT NULL AND TransferID != ''
          AND instr(Memo, ?) > 0
      `,
      budgetId,
      TRANSFER_MEMO_ARROW
    );
    for (const row of rows) {
      const memo = renameInTransferMemo(row.Memo, oldName, newName);
      if (memo === row.Memo) continue;
      run(this.db, 'UPDATE transactions SET Memo = ? WHERE ID = ?', memo, row.ID);
      changes += 1;
    }
    return changes;
  }

  /**
   * Payee names used by a budget's transactions and split lines, without usage
   * counts. Same rows, order and case-folding as {@link getPayeeUsageCounts}
   * (a parent's payee is skipped when its split lines carry payees), so the
   * directory built from it matches the usage directory name for name. The
   * per-branch GROUP BY and the outer aggregate keep SQLite's choice of
   * spelling for case variants the same as in the usage query.
   */
  getPayeeNamesInUse(budgetId: number): { Name: string }[] {
    return allRows<{ Name: string }>(
      this.db,
      `
      SELECT Name, COUNT(*) AS Spellings
      FROM (
        SELECT Payee AS Name
        FROM transactions
        WHERE BudgetID = ?
          AND Payee IS NOT NULL
          AND TRIM(Payee) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM transaction_splits s
            WHERE s.TransactionID = transactions.ID
              AND s.Payee IS NOT NULL
              AND TRIM(s.Payee) <> ''
          )
        GROUP BY Payee

        UNION ALL

        SELECT s.Payee AS Name
        FROM transaction_splits s
        CROSS JOIN transactions t ON t.ID = s.TransactionID
        WHERE t.BudgetID = ?
          AND s.Payee IS NOT NULL
          AND TRIM(s.Payee) <> ''
        GROUP BY s.Payee
      ) used
      GROUP BY Name COLLATE NOCASE
      ORDER BY Name COLLATE NOCASE
    `,
      budgetId,
      budgetId
    );
  }

  /**
   * The newest uncategorized transactions of a budget (split parents excluded),
   * newest first. Same rows and order as filtering {@link getAllTransactions}
   * by the uncategorized rule (CategoryID 0, a missing category, or one named
   * '' / 'Uncategorized'), but driven from the category index instead of
   * reading the whole ledger.
   */
  getRecentUncategorizedTransactions(budgetId: number, limit: number): GetAllTransactions[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
    const named = allRows<{ ID: number }>(
      this.db,
      `SELECT ID FROM categories WHERE Name IS NULL OR Name = '' OR Name = 'Uncategorized'`
    );
    // Rows can only point at a missing category while foreign keys are off;
    // the distinct-ID pass walks the category index, not the table.
    const missing = allRows<{ ID: number }>(
      this.db,
      `
      SELECT d.CategoryID AS ID
      FROM (SELECT DISTINCT CategoryID FROM transactions) d
      WHERE d.CategoryID IS NOT NULL
        AND d.CategoryID <> 0
        AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.ID = d.CategoryID)
    `
    );
    const ids = [0, ...named.map((row) => row.ID), ...missing.map((row) => row.ID)];
    return allRows<GetAllTransactions>(
      this.db,
      `
      SELECT
        t.ID,
        t.AccountID as AccountId,
        a.Name as AccountName,
        t.Date,
        t.CategoryID,
        c.Name as Category,
        t.LabelID,
        l.Name as Label,
        l.Color as LabelColor,
        t.Memo,
        t.Payee,
        t.InflowConverted,
        t.OutflowConverted,
        t.RunningBalanceConverted,
        t.TransferID
      FROM transactions t
        LEFT JOIN categories c ON t.CategoryID = c.ID
        LEFT JOIN labels l ON t.LabelID = l.ID
        LEFT JOIN accounts a ON t.AccountID = a.ID
      WHERE +t.BudgetID = ?
        AND t.CategoryID IN (${ids.map(() => '?').join(', ')})
        ${NO_SPLITS_FILTER}
      ORDER BY t.Date DESC, t.ID DESC
      LIMIT ?
    `,
      budgetId,
      ...ids,
      normalizedLimit
    );
  }

  /**
   * Aggregated ledger rows for balance-history charts: one row per account for
   * everything dated before `fromDate` (dated at the account's first
   * transaction), then one row per account and day (or month) from
   * `fromDate` on. Rows whose Date is not a canonical YYYY-MM-DD date are
   * grouped by their exact Date string so callers can treat them as before.
   */
  getBalanceHistoryRows(
    budgetId: number,
    fromDate: string,
    bucket: BalanceHistoryBucket
  ): BalanceHistoryRow[] {
    const inWindowKey = bucket === 'month' ? 'substr(Date, 1, 7)' : 'Date';
    return allRows<BalanceHistoryRow>(
      this.db,
      `
      SELECT
        AccountID AS AccountId,
        MIN(Date) AS Date,
        COALESCE(SUM(COALESCE(InflowConverted, 0) - COALESCE(OutflowConverted, 0)), 0) AS Net
      FROM transactions
      WHERE BudgetID = ?
      GROUP BY
        AccountID,
        CASE
          WHEN date(Date) IS NOT Date THEN 'x' || Date
          WHEN Date < ? THEN ''
          ELSE ${inWindowKey}
        END
    `,
      budgetId,
      fromDate
    );
  }
}

const TRANSFER_MEMO_ARROW = ' → ';

/** Swaps an account name in a "{source} → {destination}: memo" transfer memo. */
export function renameInTransferMemo(memo: string, oldName: string, newName: string): string {
  const arrow = memo.indexOf(TRANSFER_MEMO_ARROW);
  if (arrow < 0) return memo;
  let source = memo.slice(0, arrow);
  let rest = memo.slice(arrow + TRANSFER_MEMO_ARROW.length);
  if (source === oldName) source = newName;
  const after = rest.slice(oldName.length);
  if (
    rest.startsWith(oldName) &&
    (after === '' || after.startsWith(':') || after.startsWith(' ('))
  ) {
    rest = newName + after;
  }
  return `${source}${TRANSFER_MEMO_ARROW}${rest}`;
}
