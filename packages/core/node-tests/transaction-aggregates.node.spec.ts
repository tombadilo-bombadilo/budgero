import { beforeEach, describe, expect, it } from 'vitest';
import {
  NodeSqlJsAdapter,
  ServiceManager,
  type GetTransactionsByAccountRow,
  type Services,
} from '../src';
import { asMilli } from '../src/money';

// The pre-optimization partner columns, kept here as the reference output.
const LEGACY_PARTNER_COLUMNS = `
  t.ID,
  CASE WHEN t.TransferID IS NOT NULL AND t.TransferID != '' THEN
    (SELECT partner_account.OnBudget
       FROM transactions transfer_partner
       JOIN accounts partner_account ON partner_account.ID = transfer_partner.AccountID
      WHERE transfer_partner.TransferID = t.TransferID
        AND transfer_partner.ID != t.ID
      ORDER BY transfer_partner.ID
      LIMIT 1)
  ELSE NULL END AS TransferAccountOnBudget,
  CASE WHEN t.TransferID IS NOT NULL AND t.TransferID != '' THEN
    (SELECT partner_account.Name
       FROM transactions transfer_partner
       JOIN accounts partner_account ON partner_account.ID = transfer_partner.AccountID
      WHERE transfer_partner.TransferID = t.TransferID
        AND transfer_partner.ID != t.ID
      ORDER BY transfer_partner.ID
      LIMIT 1)
  ELSE NULL END AS TransferAccountName`;

type RawDb = {
  prepare(sql: string): {
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
};

describe('transaction aggregate queries (Node/sql.js)', () => {
  let adapter: NodeSqlJsAdapter;
  let services: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let card: number;
  let groceries: number;
  let uncategorized: number;
  let transfers: number;

  const sql = <T>(query: string, ...params: unknown[]) =>
    adapter.prepare(query).all(...params) as T[];
  const exec = (query: string, ...params: unknown[]) => adapter.prepare(query).run(...params);

  const add = (
    accountId: number,
    date: string,
    inflow: number,
    outflow: number,
    categoryId = groceries,
    transferId = ''
  ) =>
    services.transactions.addTransaction(
      asMilli(inflow),
      asMilli(outflow),
      accountId,
      categoryId,
      budgetId,
      date,
      'memo',
      transferId
    );

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    budgetId = await services.budgets.createBudget({
      name: 'Aggregates',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: true,
    });
    checking = (await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0))
      .ID;
    savings = (
      await services.accounts.createAccount(
        'Savings',
        budgetId,
        'savings',
        'USD',
        0,
        undefined,
        false
      )
    ).ID;
    card = (await services.accounts.createAccount('Card', budgetId, 'checking', 'USD', 0)).ID;
    const categories = services.categories.getAllCategories(budgetId);
    groceries = categories.find(
      (c) => !['Transfers', 'Uncategorized', 'Income'].includes(c.Name)
    )!.ID;
    uncategorized = categories.find((c) => c.Name === 'Uncategorized')!.ID;
    transfers = categories.find((c) => c.Name === 'Transfers')!.ID;
  });

  async function seedTransfers() {
    // Plain two-leg transfer (on-budget -> off-budget).
    await add(checking, '2026-01-05', 0, 10_000, transfers, 'tr-pair');
    await add(savings, '2026-01-05', 10_000, 0, transfers, 'tr-pair');
    // Three legs: each leg's partner is the lowest other ID.
    await add(checking, '2026-02-01', 0, 5_000, transfers, 'tr-three');
    await add(card, '2026-02-01', 2_500, 0, transfers, 'tr-three');
    await add(savings, '2026-02-01', 2_500, 0, transfers, 'tr-three');
    // A leg whose partner was removed.
    await add(card, '2026-03-01', 0, 1_000, transfers, 'tr-lonely');
    // Non-transfers with '' and NULL TransferID.
    await add(checking, '2026-03-02', 0, 700);
    const nullTransfer = await add(card, '2026-03-03', 0, 800);
    exec('UPDATE transactions SET TransferID = NULL WHERE ID = ?', nullTransfer);
  }

  it('keeps transfer partner columns identical to the legacy subqueries', async () => {
    await seedTransfers();
    const legacy = new Map(
      sql<{ ID: number; TransferAccountOnBudget: unknown; TransferAccountName: unknown }>(
        `SELECT${LEGACY_PARTNER_COLUMNS} FROM transactions t WHERE t.BudgetID = ?`,
        budgetId
      ).map((row) => [row.ID, row])
    );
    const pick = (row: GetTransactionsByAccountRow) => ({
      ID: row.ID,
      TransferAccountOnBudget: row.TransferAccountOnBudget,
      TransferAccountName: row.TransferAccountName,
    });

    const detailed = services.transactions.getAllTransactionsDetailed(budgetId);
    expect(detailed).toHaveLength(legacy.size);
    for (const row of detailed) expect(pick(row)).toEqual(legacy.get(row.ID));

    for (const accountId of [checking, savings, card]) {
      for (const row of services.transactions.getTransactionsByAccount(accountId)) {
        expect(pick(row)).toEqual(legacy.get(row.ID));
      }
    }
    const threeLeg = detailed.find(
      (row) => row.TransferID === 'tr-three' && row.Account === 'Card'
    );
    expect(threeLeg?.TransferAccountName).toBe('Checking');
    const single = services.transactions.getTransactionForAccountRegister(threeLeg!.ID);
    expect(pick(single)).toEqual(legacy.get(threeLeg!.ID));
  });

  it('uses the partial TransferID index for every transfer-partner lookup', async () => {
    await seedTransfers();
    const captured: string[] = [];
    const prepare = adapter.prepare.bind(adapter);
    adapter.prepare = ((query: string) => {
      captured.push(query);
      return prepare(query);
    }) as typeof adapter.prepare;
    try {
      services.transactions.getAllTransactionsDetailed(budgetId);
      services.transactions.getTransactionsByAccount(checking);
      services.transactions.getTransactionsByTransferID('tr-pair');
      services.transactions.getTransferRateDetails('tr-pair');
      services.monthlyBudgets.getReadyToAssignBreakdown(budgetId);
    } finally {
      adapter.prepare = prepare;
    }

    const raw = (adapter as unknown as { db: RawDb }).db;
    const plan = (query: string) => {
      const stmt = raw.prepare(`EXPLAIN QUERY PLAN ${query}`);
      const details: string[] = [];
      while (stmt.step()) details.push(String(stmt.getAsObject().detail));
      stmt.free();
      return details.join('\n');
    };
    const lookups = captured.filter((query) =>
      /\b\w+\.TransferID = t\.TransferID|\bTransferID = \?/.test(query)
    );
    expect(lookups.length).toBeGreaterThanOrEqual(5);
    for (const query of lookups) {
      const detail = plan(query);
      expect(detail, query).toContain('idx_transactions_transfer_id (TransferID=?)');
      expect(detail, query).not.toMatch(/SCAN (transactions|transfer_partner|mirror|p)\b/);
    }
  });

  it('sums future-dated rows per account like the old per-register scan', async () => {
    const cutoff = '2026-06-15';
    await add(checking, '2026-06-14', 100_000, 0);
    await add(checking, cutoff, 0, 50_000); // today is not in the future
    await add(checking, '2026-06-16', 0, 12_345);
    await add(checking, '2026-07-01', 2_000, 0);
    const foreign = await add(savings, '2026-08-01', 30_000, 0);
    // Native amounts that differ from converted ones, and a NULL native that
    // must fall back to the converted value.
    exec('UPDATE transactions SET InflowNative = 27_000 WHERE ID = ?', foreign);
    const nullNative = await add(savings, '2026-09-01', 0, 4_000);
    exec('UPDATE transactions SET OutflowNative = NULL WHERE ID = ?', nullNative);
    await add(card, '2026-01-01', 0, 9_000);

    const legacy = (accountId: number) => {
      let original = 0;
      let converted = 0;
      for (const tx of services.transactions.getTransactionsByAccount(accountId)) {
        if (!tx?.Date || tx.Date <= cutoff) continue;
        const inflow = tx.InflowConverted ?? 0;
        const outflow = tx.OutflowConverted ?? 0;
        original += (tx.InflowNative ?? inflow) - (tx.OutflowNative ?? outflow);
        converted += inflow - outflow;
      }
      return { original, converted };
    };

    const rows = services.transactions.getFutureBalanceAdjustments(budgetId, cutoff);
    const byAccount = new Map(rows.map((row) => [row.AccountID, row]));
    for (const accountId of [checking, savings, card]) {
      const row = byAccount.get(accountId);
      expect({ original: row?.Original ?? 0, converted: row?.Converted ?? 0 }).toEqual(
        legacy(accountId)
      );
    }
    expect(byAccount.get(checking)).toMatchObject({ Original: -10_345, Converted: -10_345 });
    expect(byAccount.get(savings)).toMatchObject({ Original: 23_000, Converted: 26_000 });
    expect(byAccount.has(card)).toBe(false);
  });

  it('counts uncategorized rows per account like the old client-side filter', async () => {
    await add(checking, '2026-01-01', 0, 1_000, uncategorized);
    await add(checking, '2026-01-02', 0, 1_000, uncategorized);
    await add(checking, '2026-01-03', 0, 1_000, groceries);
    await add(card, '2026-01-04', 0, 1_000, uncategorized);
    // A split parent sits on Uncategorized but is categorized by its lines.
    const splitParent = await add(card, '2026-01-05', 0, 2_000, uncategorized);
    exec(
      'INSERT INTO transaction_splits (TransactionID, CategoryID, OutflowConverted) VALUES (?, ?, ?)',
      splitParent,
      groceries,
      2_000
    );
    await add(savings, '2026-01-06', 0, 1_000, groceries);

    const legacy: Record<number, number> = {};
    for (const tx of services.transactions.getAllTransactions(budgetId)) {
      if (tx.Category === 'Split') continue;
      if (
        !tx.CategoryID ||
        tx.Category === 'Uncategorized' ||
        tx.Category === null ||
        tx.Category === undefined ||
        tx.Category === ''
      ) {
        legacy[tx.AccountId] = (legacy[tx.AccountId] ?? 0) + 1;
      }
    }

    const counts = services.transactions.getUncategorizedCountsByAccount(budgetId);
    expect(Object.fromEntries(counts.map((row) => [row.AccountID, row.Count]))).toEqual(legacy);
    expect(legacy).toEqual({ [checking]: 2, [card]: 1 });
  });

  it('limits detailed budget rows to dates after the cutoff', async () => {
    await seedTransfers();
    await add(checking, '2026-10-15', 0, 1_000);
    await add(checking, '2026-10-16', 0, 2_000);
    await add(savings, '2026-12-01', 0, 3_000, transfers, 'tr-future');
    await add(card, '2026-12-01', 3_000, 0, transfers, 'tr-future');

    const all = services.transactions.getAllTransactionsDetailed(budgetId);
    const future = services.transactions.getAllTransactionsDetailed(budgetId, '2026-10-15');
    expect(future).toEqual(all.filter((row) => row.Date > '2026-10-15'));
    expect(future).toHaveLength(3);
  });

  it('recalculates an account balance once its last transaction is deleted', async () => {
    const queries = (
      services.transactions as unknown as {
        queries: { accountHasTransactions(accountId: number): boolean };
      }
    ).queries;
    expect(queries.accountHasTransactions(checking)).toBe(false);
    const first = await add(checking, '2026-01-01', 10_000, 0);
    const second = await add(checking, '2026-01-02', 0, 4_000);
    expect(queries.accountHasTransactions(checking)).toBe(true);

    await services.transactions.deleteTransaction(first);
    expect(queries.accountHasTransactions(checking)).toBe(true);
    // Simulate drift: only a full recalculation brings this back to zero.
    exec('UPDATE accounts SET BalanceNative = BalanceNative + 7 WHERE ID = ?', checking);
    await services.transactions.deleteTransaction(second);
    expect(queries.accountHasTransactions(checking)).toBe(false);
    expect(services.accounts.getAccount(checking).BalanceNative).toBe(0);
  });
});
