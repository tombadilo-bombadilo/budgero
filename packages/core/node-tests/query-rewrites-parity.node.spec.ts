import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';
import { AccountQueries } from '../src/services/accounts/queries';
import { MonthlyBudgetQueries } from '../src/services/monthly-budgets/queries';
import { TransactionQueries } from '../src/services/transactions/queries';

// Reference (pre-rewrite) SQL for the queries rewritten for speed. Each test
// builds edge-case rows (several budgets, off-budget debt and non-debt
// accounts, splits, dangling and zero category IDs written with foreign keys
// off, odd date strings) and checks the new code returns exactly what these
// return.

const NO_SPLITS = `AND NOT EXISTS (SELECT 1 FROM transaction_splits s2 WHERE s2.TransactionID = t.ID)`;

const LEGACY_UNCATEGORIZED = `
  SELECT t.AccountID, COUNT(*) AS Count
  FROM transactions t
  LEFT JOIN categories c ON t.CategoryID = c.ID
  WHERE t.BudgetID = ?
    ${NO_SPLITS}
    AND (t.CategoryID IS NULL OR t.CategoryID = 0 OR c.Name IS NULL OR c.Name = '' OR c.Name = 'Uncategorized')
  GROUP BY t.AccountID`;

const LEGACY_INCOME = `
  SELECT IFNULL(SUM(t.InflowConverted - t.OutflowConverted), 0) as total
  FROM transactions t
  INNER JOIN accounts acc ON t.AccountID = acc.ID
  INNER JOIN categories c ON t.CategoryID = c.ID
  INNER JOIN category_groups cg ON c.CategoryGroupID = cg.ID
  WHERE t.BudgetID = ?1
    AND acc.OnBudget = TRUE
    AND cg.Name = 'Income'
    AND (t.TransferID IS NULL OR t.TransferID = '')
    AND DATE(t.Date) <= DATE(?2)`;

const legacyTransfers = (direction: 'off' | 'in', grouped: boolean) => {
  const amount = direction === 'off' ? 'OutflowConverted' : 'InflowConverted';
  return `
  SELECT ${grouped ? 't.Month,' : ''} IFNULL(SUM(t.${amount}), 0) as total
  FROM transactions t
  INNER JOIN accounts leg ON t.AccountID = leg.ID
  INNER JOIN categories c ON t.CategoryID = c.ID
  INNER JOIN category_groups cg ON c.CategoryGroupID = cg.ID
  WHERE t.BudgetID = ?1
    AND leg.OnBudget = TRUE
    AND t.${amount} > 0
    AND t.TransferID IS NOT NULL
    AND t.TransferID <> ''
    AND t.ExcludeFromReadyToAssign = FALSE
    AND ${grouped ? 't.Month <= ?2' : 'DATE(t.Date) <= DATE(?2)'}
    AND cg.Name = 'Transfers'
    AND EXISTS (
      SELECT 1
      FROM transactions mirror
      INNER JOIN accounts other ON mirror.AccountID = other.ID
      WHERE mirror.TransferID = t.TransferID
        AND mirror.TransferID != ''
        AND mirror.ID != t.ID
        AND other.OnBudget = FALSE
        AND LOWER(other.Type) NOT IN ('credit', 'loan', 'mortgage')
    )
  ${grouped ? 'GROUP BY t.Month' : ''}`;
};

const legacyCCSpending = (placeholders: string, dateOp: '=' | '<') => `
  SELECT x.CategoryID, x.AccountID, COALESCE(SUM(x.OutflowConverted), 0) as spending
  FROM (
    SELECT s.CategoryID AS CategoryID, t.AccountID AS AccountID, s.OutflowConverted AS OutflowConverted,
           t.Month AS Month, t.BudgetID AS BudgetID
    FROM transaction_splits s
    JOIN transactions t ON t.ID = s.TransactionID
    UNION ALL
    SELECT t.CategoryID, t.AccountID, t.OutflowConverted, t.Month, t.BudgetID
    FROM transactions t
    WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s2 WHERE s2.TransactionID = t.ID)
  ) x
  JOIN categories c ON x.CategoryID = c.ID
  JOIN category_groups cg ON c.CategoryGroupID = cg.ID
  WHERE x.AccountID IN (${placeholders})
    AND x.BudgetID = ?
    AND x.Month ${dateOp} ?
    AND x.OutflowConverted > 0
    AND cg.Name NOT IN ('Income', 'Transfers', 'Uncategorized', 'Credit Card Payments')
  GROUP BY x.CategoryID, x.AccountID`;

const LEGACY_LIST_ACCOUNTS = `
  SELECT a.*,
    COALESCE((
      SELECT SUM(COALESCE(t.InflowNative, t.InflowConverted) - COALESCE(t.OutflowNative, t.OutflowConverted))
      FROM transactions t
      WHERE t.AccountID = a.ID AND DATE(t.Date) > DATE('now', 'localtime')
    ), 0) AS FutureImpactNative,
    COALESCE((
      SELECT SUM(t.InflowConverted - t.OutflowConverted)
      FROM transactions t
      WHERE t.AccountID = a.ID AND DATE(t.Date) > DATE('now', 'localtime')
    ), 0) AS FutureImpactConverted,
    COALESCE((
      SELECT SUM(COALESCE(t.InflowNative, t.InflowConverted) - COALESCE(t.OutflowNative, t.OutflowConverted))
      FROM transactions t
      WHERE t.AccountID = a.ID AND t.Cleared = 0
    ), 0) AS UnclearedNative,
    COALESCE((
      SELECT SUM(t.InflowConverted - t.OutflowConverted)
      FROM transactions t
      WHERE t.AccountID = a.ID AND t.Cleared = 0
    ), 0) AS UnclearedConverted
  FROM accounts a
  WHERE a.BudgetID = ?1
  ORDER BY a.Position ASC, a.ID ASC`;

const LEGACY_TRANSACTION_COUNTS = `
  SELECT category_id, SUM(count) AS count FROM (
    SELECT t.CategoryID AS category_id, COUNT(*) AS count
    FROM transactions t
    WHERE t.BudgetID = ?1 ${NO_SPLITS}
    GROUP BY t.CategoryID
    UNION ALL
    SELECT s.CategoryID AS category_id, COUNT(*) AS count
    FROM transaction_splits s
    JOIN transactions t ON t.ID = s.TransactionID
    WHERE t.BudgetID = ?1
    GROUP BY s.CategoryID
  ) GROUP BY category_id`;

type Row = Record<string, unknown>;

describe('rewritten budget / account queries return the pre-rewrite results', () => {
  let adapter: NodeSqlJsAdapter;
  let services: Services;
  let seq = 0;

  const all = <T = Row>(query: string, ...params: unknown[]) =>
    adapter.prepare(query).all(...params) as T[];
  const run = (query: string, ...params: unknown[]) => adapter.prepare(query).run(...params);
  const id = (query: string, ...params: unknown[]) => Number(run(query, ...params).lastInsertRowid);

  const budget = (name: string) =>
    services.budgets.createBudget({
      name,
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: false,
    });
  const group = (budgetId: number, name: string) =>
    id(`INSERT INTO category_groups (Name, BudgetID) VALUES (?, ?)`, name, budgetId);
  const category = (budgetId: number, groupId: number, name: string) =>
    id(
      `INSERT INTO categories (Name, CategoryGroupID, BudgetID) VALUES (?, ?, ?)`,
      name,
      groupId,
      budgetId
    );
  const account = (budgetId: number, name: string, type: string, onBudget: boolean) =>
    id(
      `INSERT INTO accounts (Name, Currency, Type, BudgetID, OnBudget, Position) VALUES (?, 'USD', ?, ?, ?, ?)`,
      name,
      type,
      budgetId,
      onBudget ? 1 : 0,
      ++seq
    );
  const tx = (
    budgetId: number,
    accountId: number,
    categoryId: number | string,
    date: string,
    inflow: number,
    outflow: number,
    extra: {
      transferId?: string | null;
      exclude?: boolean;
      cleared?: boolean;
      nativeIn?: number | null;
      nativeOut?: number | null;
    } = {}
  ) =>
    id(
      `INSERT INTO transactions (CategoryID, AccountID, TransferID, Date, InflowConverted, OutflowConverted,
         InflowNative, OutflowNative, BudgetID, ExcludeFromReadyToAssign, Cleared)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      categoryId,
      accountId,
      extra.transferId ?? null,
      date,
      inflow,
      outflow,
      extra.nativeIn === undefined ? inflow : extra.nativeIn,
      extra.nativeOut === undefined ? outflow : extra.nativeOut,
      budgetId,
      extra.exclude ? 1 : 0,
      extra.cleared ? 1 : 0
    );
  const split = (parentId: number, categoryId: number | null, inflow: number, outflow: number) =>
    id(
      `INSERT INTO transaction_splits (TransactionID, CategoryID, InflowConverted, OutflowConverted) VALUES (?, ?, ?, ?)`,
      parentId,
      categoryId,
      inflow,
      outflow
    );

  /** Two budgets of rows covering the edge cases of every rewritten query. */
  const seed = async () => {
    const ids: Record<string, number> = {};
    for (const b of ['A', 'B']) {
      const budgetId = await budget(b);
      ids[`budget${b}`] = budgetId;
      const income = group(budgetId, 'Income');
      const transfers = group(budgetId, 'Transfers');
      const uncategorized = group(budgetId, 'Uncategorized');
      const ccGroup = group(budgetId, 'Credit Card Payments');
      const spend = group(budgetId, 'Everyday');
      const hidden = group(budgetId, 'Hidden Categories');
      ids[`salary${b}`] = category(budgetId, income, 'Salary');
      ids[`bonus${b}`] = category(budgetId, income, 'Bonus');
      ids[`xfer${b}`] = category(budgetId, transfers, 'Transfers');
      ids[`uncat${b}`] = category(budgetId, uncategorized, 'Uncategorized');
      ids[`blank${b}`] = category(budgetId, spend, '');
      ids[`ccpay${b}`] = category(budgetId, ccGroup, 'Visa');
      ids[`food${b}`] = category(budgetId, spend, 'Food');
      ids[`fuel${b}`] = category(budgetId, spend, 'Fuel');
      ids[`old${b}`] = category(budgetId, hidden, 'Old stuff');
      // A spending category literally named 'Uncategorized' outside the system group.
      ids[`fakeUncat${b}`] = category(budgetId, spend, 'Uncategorized');

      ids[`chk${b}`] = account(budgetId, 'Checking', 'checking', true);
      ids[`chk2${b}`] = account(budgetId, 'Checking 2', 'checking', true);
      ids[`cc${b}`] = account(budgetId, 'Visa', 'credit', true);
      ids[`cc2${b}`] = account(budgetId, 'Amex', 'Credit', true);
      ids[`savOff${b}`] = account(budgetId, 'Savings', 'savings', false);
      ids[`invOff${b}`] = account(budgetId, 'Brokerage', 'investment', false);
      ids[`loanOff${b}`] = account(budgetId, 'Car loan', 'loan', false);
      ids[`mortOff${b}`] = account(budgetId, 'Mortgage', 'Mortgage', false);
      ids[`ccOff${b}`] = account(budgetId, 'Old card', 'credit', false);
    }
    const A = ids.budgetA;
    const B = ids.budgetB;
    let n = 0;
    const leg = (
      budgetId: number,
      accountId: number,
      cat: number,
      date: string,
      inflow: number,
      outflow: number,
      transferId: string,
      exclude = false
    ) => tx(budgetId, accountId, cat, date, inflow, outflow, { transferId, exclude });

    // Income: on/off budget, transfer-marked, future, odd date strings, other budget.
    tx(A, ids.chkA, ids.salaryA, '2026-09-30', 500_000, 0);
    tx(A, ids.chkA, ids.bonusA, '2026-10-15', 70_000, 0);
    tx(A, ids.chkA, ids.bonusA, '2026-10-15 23:30:00', 1_000, 0); // DATE() = 2026-10-15
    tx(A, ids.chkA, ids.salaryA, '2026-10-16', 9_000_000, 0); // after asOf
    tx(A, ids.chkA, ids.salaryA, '2026-10-16T01:00:00+05:00', 33_000, 0); // DATE() = 2026-10-15
    tx(A, ids.chkA, ids.salaryA, 'garbage', 44_000, 0); // DATE() is NULL
    tx(A, ids.savOffA, ids.salaryA, '2026-09-01', 12_000, 0); // off budget
    tx(A, ids.chkA, ids.salaryA, '2026-09-02', 13_000, 0, { transferId: 'inc-xfer' });
    tx(A, ids.chkA, ids.salaryA, '2026-09-03', 0, 2_500, { transferId: '' }); // refund-like
    tx(A, ids.chkA, ids.salaryB, '2026-09-04', 7_777, 0); // budget A row, budget B category
    tx(B, ids.chkB, ids.salaryB, '2026-09-05', 600_000, 0);

    // Transfers (Transfers category unless noted), on-budget leg first.
    const pair = (
      budgetId: number,
      from: number,
      to: number,
      date: string,
      amount: number,
      opts: { fromCat?: number; toCat?: number; exclude?: boolean; id?: string } = {}
    ) => {
      const transferId = opts.id ?? `t${++n}`;
      const cat = budgetId === A ? ids.xferA : ids.xferB;
      leg(budgetId, from, opts.fromCat ?? cat, date, 0, amount, transferId, opts.exclude);
      leg(budgetId, to, opts.toCat ?? cat, date, amount, 0, transferId, opts.exclude);
      return transferId;
    };
    pair(A, ids.chkA, ids.savOffA, '2025-01-10', 100_000);
    pair(A, ids.chkA, ids.invOffA, '2025-02-10', 200_000);
    pair(A, ids.chkA, ids.loanOffA, '2025-03-10', 300_000); // debt: excluded
    pair(A, ids.chkA, ids.mortOffA, '2025-03-11', 310_000); // 'Mortgage': excluded via LOWER
    pair(A, ids.chkA, ids.ccOffA, '2025-03-12', 320_000); // off-budget card: excluded
    pair(A, ids.chkA, ids.chk2A, '2025-04-10', 400_000); // on to on: excluded
    pair(A, ids.chkA, ids.savOffA, '2025-05-10', 500_000, { fromCat: ids.foodA }); // categorized
    pair(A, ids.chkA, ids.savOffA, '2025-06-10', 600_000, { exclude: true });
    pair(A, ids.chkA, ids.savOffA, '2026-10-20', 700_000); // after asOf
    pair(A, ids.chkA, ids.savOffA, '2026-10-15 22:00:00', 710_000); // same day, time suffix
    pair(A, ids.savOffA, ids.chkA, '2025-07-10', 800_000); // inbound
    pair(A, ids.invOffA, ids.chk2A, '2025-08-10', 900_000); // inbound
    pair(A, ids.loanOffA, ids.chkA, '2025-09-10', 1_000_000); // inbound from debt: excluded
    pair(A, ids.savOffA, ids.ccA, '2025-09-11', 1_100_000); // inbound onto an on-budget card
    // Three legs on one TransferID, two of them off budget: counted once.
    const triple = pair(A, ids.chkA, ids.savOffA, '2025-10-10', 120_000);
    leg(A, ids.invOffA, ids.xferA, '2025-10-10', 1, 0, triple);
    // Partner leg sits in budget B's off-budget savings (cross-budget TransferID).
    pair(A, ids.chkA, ids.chk2A, '2025-11-10', 130_000, { id: 'cross' });
    leg(B, ids.savOffB, ids.xferB, '2025-11-10', 130_000, 0, 'cross');
    // Off-budget leg with an empty or NULL TransferID never pairs.
    tx(A, ids.chkA, ids.xferA, '2025-12-10', 0, 140_000, { transferId: '' });
    tx(A, ids.savOffA, ids.xferA, '2025-12-10', 140_000, 0, { transferId: '' });
    tx(A, ids.chkA, ids.xferA, '2025-12-11', 0, 150_000, { transferId: null });
    pair(B, ids.chkB, ids.savOffB, '2025-01-10', 999_000); // other budget

    // Card spending: plain, split (lines on spending, system and NULL categories),
    // refunds, system categories, other budget, several months.
    for (const [month, scale] of [
      ['2026-08', 1],
      ['2026-09', 2],
      ['2026-10', 3],
      ['2026-11', 4],
    ] as const) {
      tx(A, ids.ccA, ids.foodA, `${month}-05`, 0, 1_000 * scale);
      tx(A, ids.cc2A, ids.foodA, `${month}-06`, 0, 1_100 * scale);
      tx(A, ids.ccA, ids.fuelA, `${month}-07`, 0, 1_200 * scale);
      tx(A, ids.ccA, ids.foodA, `${month}-08`, 300 * scale, 0); // refund
      tx(A, ids.ccA, ids.uncatA, `${month}-09`, 0, 1_300 * scale); // system group
      tx(A, ids.ccA, ids.oldA, `${month}-10`, 0, 1_400 * scale); // hidden group
      const parent = tx(A, ids.cc2A, ids.foodA, `${month}-11`, 0, 5_000 * scale);
      split(parent, ids.fuelA, 0, 2_000 * scale);
      split(parent, ids.ccpayA, 0, 1_000 * scale);
      split(parent, null, 0, 1_500 * scale);
      split(parent, ids.foodA, 500, 0);
      tx(A, ids.chkA, ids.foodA, `${month}-12`, 0, 9_000 * scale); // not a card
      tx(B, ids.ccB, ids.foodB, `${month}-05`, 0, 7_000 * scale);
    }
    tx(A, ids.cc2A, ids.fuelA, '2026-09-20', 0, 50);
    // For 2026-10 the lower card ID only has prior spending in this category and
    // the higher one current spending: the map must list the current pair first.
    tx(A, ids.ccA, ids.fakeUncatA, '2026-09-25', 0, 70);
    tx(A, ids.cc2A, ids.fakeUncatA, '2026-10-25', 0, 80);
    tx(A, ids.ccA, ids.foodB, '2026-10-21', 0, 60); // budget A card, budget B category

    // Uncategorized: system category, blank name, the look-alike, split parents,
    // other budget, then rows only possible with foreign keys off.
    tx(A, ids.chkA, ids.uncatA, '2026-01-01', 0, 1);
    tx(A, ids.chk2A, ids.blankA, '2026-01-02', 0, 1);
    tx(A, ids.chkA, ids.fakeUncatA, '2026-01-03', 0, 1);
    const uncatParent = tx(A, ids.chkA, ids.uncatA, '2026-01-04', 0, 10);
    split(uncatParent, ids.foodA, 0, 10);
    tx(A, ids.savOffA, ids.uncatB, '2026-01-05', 0, 1);
    tx(B, ids.chkB, ids.uncatB, '2026-01-06', 0, 1);
    adapter.setForeignKeysSuspended(true);
    tx(A, ids.chkA, 0, '2026-01-07', 0, 1);
    tx(A, ids.cc2A, 987_654, '2026-01-08', 0, 1); // dangling
    tx(A, ids.chk2A, 'not-a-number', '2026-01-09', 0, 1); // text in an INTEGER column
    tx(A, ids.chkA, -5, '2026-01-10', 0, 1);
    const orphanParent = tx(A, ids.chkA, 0, '2026-01-11', 0, 4);
    split(orphanParent, ids.foodA, 0, 4);
    tx(B, ids.chkB, 0, '2026-01-12', 0, 1);
    adapter.setForeignKeysSuspended(false);

    // Listed-account sums: today / tomorrow / time and offset suffixes,
    // cleared mix, NULL natives that fall back to converted amounts.
    tx(A, ids.chk2A, ids.foodA, '2026-10-15', 0, 11, { cleared: true });
    tx(A, ids.chk2A, ids.foodA, '2026-10-16', 0, 13);
    tx(A, ids.chk2A, ids.foodA, '2026-10-15 23:59:59', 0, 17);
    tx(A, ids.chk2A, ids.foodA, '2026-10-15T23:00:00-05:00', 0, 19, { cleared: true });
    tx(A, ids.chk2A, ids.foodA, '2026-10-16 00:30:00+02:00', 0, 23);
    tx(A, ids.chk2A, ids.foodA, '2027-01-01', 29, 0, { nativeIn: null });
    tx(A, ids.chk2A, ids.foodA, '2026-12-01', 0, 31, { nativeOut: 37 });
    return ids;
  };

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getUncategorizedCountsByAccount matches the full-budget scan', async () => {
    const ids = await seed();
    const queries = new TransactionQueries(adapter);
    for (const budgetId of [ids.budgetA, ids.budgetB, 424242]) {
      const legacy = all(LEGACY_UNCATEGORIZED, budgetId);
      expect(queries.getUncategorizedCountsByAccount(budgetId)).toEqual(legacy);
    }
    // the edge rows above are really counted
    expect(queries.getUncategorizedCountsByAccount(ids.budgetA).length).toBeGreaterThan(2);
  });

  it('cumulative Ready to Assign sums match the account-driven queries', async () => {
    const ids = await seed();
    const queries = new MonthlyBudgetQueries(adapter);
    for (const budgetId of [ids.budgetA, ids.budgetB]) {
      for (const asOf of ['2025-06-30', '2026-10-14', '2026-10-15', '2026-10-16', '2030-01-01']) {
        const one = (query: string) => all<{ total: number }>(query, budgetId, asOf)[0]?.total ?? 0;
        const got = queries.readyToAssign(budgetId, asOf);
        expect(got.income).toBe(one(LEGACY_INCOME));
        expect(got.offBudgetTransfers).toBe(one(legacyTransfers('off', false)));
        expect(got.inBudgetTransfers).toBe(one(legacyTransfers('in', false)));
      }
    }
    const a = queries.readyToAssign(ids.budgetA, '2026-10-15');
    expect(a.offBudgetTransfers).toBeGreaterThan(0);
    expect(a.inBudgetTransfers).toBeGreaterThan(0);
  });

  it('monthly Ready to Assign transfer sums match the per-leg EXISTS queries', async () => {
    const ids = await seed();
    const queries = new MonthlyBudgetQueries(adapter);
    const months = ['2025-01', '2025-06', '2025-10', '2025-11', '2026-10', '2026-11'];
    const cumulative = (direction: 'off' | 'in', budgetId: number, month: string) =>
      all<{ Month: string; total: number }>(legacyTransfers(direction, true), budgetId, '9999-12')
        .filter((r) => r.Month <= month)
        .reduce((sum, r) => sum + r.total, 0);
    for (const budgetId of [ids.budgetA, ids.budgetB]) {
      const batch = queries.readyToAssignMonthlyBatch(budgetId, months);
      for (const month of months) {
        expect(batch.get(month)?.offBudgetTransfers, month).toBe(
          cumulative('off', budgetId, month)
        );
        expect(batch.get(month)?.inBudgetTransfers, month).toBe(cumulative('in', budgetId, month));
      }
    }
  });

  it('getCCSpendingByCategoryAndAccount matches the two UNION scans, map order included', async () => {
    const ids = await seed();
    const queries = new MonthlyBudgetQueries(adapter);
    const legacy = (month: string, budgetId: number) => {
      const cards = all<{ ID: number }>(
        `SELECT ID FROM accounts WHERE BudgetID = ? AND LOWER(Type) = 'credit'`,
        budgetId
      ).map((a) => a.ID);
      const result = new Map<number, Map<number, { current: number; prior: number }>>();
      if (!cards.length) return result;
      const placeholders = cards.map(() => '?').join(',');
      const ensure = (cat: number, acc: number) => {
        if (!result.has(cat)) result.set(cat, new Map());
        const byAccount = result.get(cat)!;
        if (!byAccount.has(acc)) byAccount.set(acc, { current: 0, prior: 0 });
        return byAccount.get(acc)!;
      };
      for (const r of all<{ CategoryID: number; AccountID: number; spending: number }>(
        legacyCCSpending(placeholders, '='),
        ...cards,
        budgetId,
        month
      ))
        ensure(r.CategoryID, r.AccountID).current = r.spending;
      for (const r of all<{ CategoryID: number; AccountID: number; spending: number }>(
        legacyCCSpending(placeholders, '<'),
        ...cards,
        budgetId,
        month
      ))
        ensure(r.CategoryID, r.AccountID).prior = r.spending;
      return result;
    };
    const ordered = (m: Map<number, Map<number, { current: number; prior: number }>>) =>
      [...m].map(([cat, byAccount]) => [cat, [...byAccount]]);
    for (const budgetId of [ids.budgetA, ids.budgetB, 424242]) {
      for (const month of ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2027-01']) {
        expect(
          ordered(queries.getCCSpendingByCategoryAndAccount(month, budgetId)),
          `${budgetId} ${month}`
        ).toEqual(ordered(legacy(month, budgetId)));
      }
    }
  });

  it('listAccounts matches DATE(now, localtime) and the per-account uncleared scans', async () => {
    const ids = await seed();
    const queries = new AccountQueries(adapter);
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const at of [
      new Date(2026, 9, 15, 0, 0, 1),
      new Date(2026, 9, 15, 12, 0, 0),
      new Date(2026, 9, 15, 23, 59, 59),
      new Date(2026, 9, 16, 0, 0, 0),
      new Date(2026, 11, 31, 23, 0, 0),
    ]) {
      vi.setSystemTime(at);
      for (const budgetId of [ids.budgetA, ids.budgetB]) {
        expect(queries.listAccounts(budgetId), at.toString()).toEqual(
          all(LEGACY_LIST_ACCOUNTS, budgetId)
        );
      }
    }
  });

  it('getCategoryTransactionCount matches the old in-query counts', async () => {
    const ids = await seed();
    for (const budgetId of [ids.budgetA, ids.budgetB]) {
      const legacy = new Map(
        all<{ category_id: number; count: number }>(LEGACY_TRANSACTION_COUNTS, budgetId).map(
          (r) => [r.category_id, r.count]
        )
      );
      const categoryIds = all<{ ID: number }>('SELECT ID FROM categories').map((c) => c.ID);
      for (const categoryId of [...categoryIds, 0, 987_654, -1]) {
        expect(
          services.monthlyBudgets.getCategoryTransactionCount(categoryId, budgetId),
          `${budgetId}/${categoryId}`
        ).toBe(legacy.get(categoryId) ?? 0);
      }
    }
  });
});

describe('balances after an in-place edit equal a full recalculation', () => {
  let adapter: NodeSqlJsAdapter;
  let services: Services;
  let queries: TransactionQueries;

  const snapshot = () => ({
    rows: adapter
      .prepare(
        'SELECT ID, AccountID, RunningBalanceConverted, RunningBalanceNative FROM transactions ORDER BY ID'
      )
      .all(),
    accounts: adapter
      .prepare('SELECT ID, BalanceNative, BalanceConverted FROM accounts ORDER BY ID')
      .all(),
  });
  // Recompute every account from scratch and check nothing moves.
  const expectConsistent = (label: string) => {
    const before = snapshot();
    const accountIds = (before.accounts as { ID: number }[]).map((a) => a.ID);
    queries.recalculateBalancesForAccounts(accountIds);
    expect(before, label).toEqual(snapshot());
  };

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    queries = new TransactionQueries(adapter);
  });

  it('keeps running and account balances identical through amount, date and rate edits', async () => {
    const budgetId = await services.budgets.createBudget({
      name: 'Balances',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: true,
    });
    const food = services.categories
      .getAllCategories(budgetId)
      .find((c) => c.Name !== 'Transfers' && c.Name !== 'Uncategorized')!.ID;
    const transfersCat = services.categories
      .getAllCategories(budgetId)
      .find((c) => c.Name === 'Transfers')!.ID;
    const checking = (
      await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
    ).ID;
    const savings = (
      await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
    ).ID;
    // deterministic pseudo-random sequence
    let state = 7;
    const rnd = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const day = () =>
      `2026-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(
        1 + Math.floor(rnd() * 3)
      ).padStart(2, '0')}`; // few distinct days: many same-day rows
    const ids: number[] = [];
    for (let i = 0; i < 60; i++) {
      const out = rnd() < 0.7;
      const amount = asMilli(10 * (1 + Math.floor(rnd() * 5000)));
      ids.push(
        await services.transactions.addTransaction(
          out ? asMilli(0) : amount,
          out ? amount : asMilli(0),
          checking,
          food,
          budgetId,
          day(),
          `r${i}`
        )
      );
    }
    for (let i = 0; i < 4; i++) {
      const transferId = `xfer-${i}`;
      const date = day();
      await services.transactions.addTransaction(
        asMilli(0),
        asMilli(1000 * (i + 1)),
        checking,
        transfersCat,
        budgetId,
        date,
        'x',
        transferId
      );
      await services.transactions.addTransaction(
        asMilli(1000 * (i + 1)),
        asMilli(0),
        savings,
        transfersCat,
        budgetId,
        date,
        'x',
        transferId
      );
    }
    expectConsistent('initial');

    const transferLegs = adapter
      .prepare(`SELECT ID FROM transactions WHERE TransferID LIKE 'xfer-%' ORDER BY ID`)
      .all() as { ID: number }[];
    for (let step = 0; step < 60; step++) {
      const target = ids[Math.floor(rnd() * ids.length)];
      const pickColumn = rnd();
      if (pickColumn < 0.3) {
        await services.transactions.updateTransactionColumn(
          target,
          'OutflowNative',
          10 * Math.floor(rnd() * 9000)
        );
      } else if (pickColumn < 0.5) {
        await services.transactions.updateTransactionColumn(
          target,
          'InflowConverted',
          10 * Math.floor(rnd() * 9000)
        );
      } else if (pickColumn < 0.75) {
        await services.transactions.updateTransactionColumn(target, 'Date', day());
      } else if (pickColumn < 0.85) {
        const legId = transferLegs[Math.floor(rnd() * transferLegs.length)].ID;
        await services.transactions.updateTransactionColumn(legId, 'Date', day());
      } else if (pickColumn < 0.95) {
        const legId = transferLegs[Math.floor(rnd() * transferLegs.length)].ID;
        await services.transactions.updateTransactionColumn(
          legId,
          'OutflowConverted',
          10 * Math.floor(rnd() * 9000)
        );
      } else {
        const current = services.transactions.getTransactionByID(target);
        await services.transactions.updateTransaction(
          target,
          asMilli(current.InflowNative ?? 0),
          asMilli(10 * Math.floor(rnd() * 9000)),
          checking,
          food,
          day(),
          'moved'
        );
      }
      expectConsistent(`step ${step}`);
    }
  });

  it('rewrites only the rows whose balance changes and still heals stale ones', () => {
    // recalculateBalancesForAccounts skips unchanged rows; a stale row is still fixed.
    return (async () => {
      const budgetId = await services.budgets.createBudget({
        name: 'Heal',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: 'dollar',
        create_default_categories: true,
      });
      const cat = services.categories.getAllCategories(budgetId)[0].ID;
      const acct = (
        await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
      ).ID;
      for (let i = 1; i <= 10; i++)
        await services.transactions.addTransaction(
          asMilli(0),
          asMilli(100 * i),
          acct,
          cat,
          budgetId,
          `2026-01-${String(i).padStart(2, '0')}`,
          ''
        );
      const expected = snapshot();
      adapter
        .prepare(
          `UPDATE transactions SET RunningBalanceConverted = 1, RunningBalanceNative = NULL
           WHERE ID = (SELECT MAX(ID) FROM transactions WHERE AccountID = ?)`
        )
        .run(acct);
      adapter.prepare('UPDATE accounts SET BalanceNative = 5 WHERE ID = ?').run(acct);
      queries.recalculateBalancesForAccounts([acct]);
      expect(snapshot()).toEqual(expected);

      // An edit after a row whose stored balance is off: the rows from the edit on
      // no longer add up to the account total, so the whole account is recalculated.
      const rows = adapter
        .prepare('SELECT ID FROM transactions WHERE AccountID = ? ORDER BY Date, ID')
        .all(acct) as { ID: number }[];
      adapter
        .prepare(
          'UPDATE transactions SET RunningBalanceConverted = RunningBalanceConverted + 7 WHERE ID = ?'
        )
        .run(rows[5].ID);
      await services.transactions.updateTransactionColumn(rows[6].ID, 'OutflowNative', 4_321);
      expectConsistent('after an edit next to a stale row');
    })();
  });
});
