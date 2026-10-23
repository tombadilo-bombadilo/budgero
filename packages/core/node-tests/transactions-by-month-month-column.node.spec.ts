import { describe, it, expect, beforeAll } from 'vitest';
import type { Database } from 'sql.js';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';
import { asMilli } from '../src/money/index.js';

// getTransactionsByAccountAndMonth / getTransactionsByAccountsAndMonth filter on the stored
// Month column (substr(Date, 1, 7)) instead of strftime('%Y-%m', Date). These tests compare
// them with the previous SQL, verbatim, for every account x month, including key order.

const OLD_SQL_COLUMNS = `
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

const OLD_SQL = `
      SELECT${OLD_SQL_COLUMNS},
        a.Name as Account
      FROM transactions t
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
      LEFT JOIN accounts transfer_partner_account ON transfer_partner_account.ID = transfer_partner.AccountID
      WHERE t.AccountID = ? AND strftime('%Y-%m', t.Date) = ?
      ORDER BY t.Date DESC, t.ID DESC
    `;

type Row = Record<string, unknown>;
type Services = ReturnType<ServiceManager['getServices']>;

/** JSON with key order kept, so a reordered or retyped column shows up as a diff. */
const exact = (rows: unknown): string =>
  JSON.stringify(rows, (_k, v: unknown) => (v === null ? 'NULL' : v));

let adapter: NodeSqlJsAdapter;
let services: Services;
let budgetId: number;
let accountIds: number[];
let months: string[];

const oldRows = (accountId: number, month: string): Row[] =>
  adapter.prepare(OLD_SQL).all(accountId, month) as Row[];

beforeAll(async () => {
  adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  services = sm.getServices();
  budgetId = await services.budgets.createBudget({
    name: 'Months',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const checking = await services.accounts.createAccount(
    'Checking',
    budgetId,
    'checking',
    'USD',
    0
  );
  const card = await services.accounts.createAccount('Card', budgetId, 'credit card', 'USD', 0);
  const savings = await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0);
  const brokerage = await services.accounts.createAccount(
    'Brokerage',
    budgetId,
    'other asset',
    'USD',
    0
  );
  const empty = await services.accounts.createAccount('Empty', budgetId, 'cash', 'USD', 0);
  accountIds = [checking.ID, card.ID, savings.ID, brokerage.ID, empty.ID];
  const groupId = services.categories.addCategoryGroup('Group', budgetId);
  const food = services.categories.addCategory(groupId, budgetId, 'Food');
  const rent = services.categories.addCategory(groupId, budgetId, 'Rent');

  // Deterministic spread over 2025-11 .. 2026-03, incl. month edges and same-day ties.
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const days = ['01', '02', '15', '28', '29', '30', '31'];
  const monthList = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
  for (let i = 0; i < 160; i += 1) {
    const m = monthList[Math.floor(rnd() * monthList.length)];
    let d = days[Math.floor(rnd() * days.length)];
    if (m === '2026-02' && Number(d) > 28) d = '28';
    if (m === '2025-11' && d === '31') d = '30';
    const account = accountIds[Math.floor(rnd() * 4)];
    const inflow = rnd() < 0.3;
    await services.transactions.addTransaction(
      asMilli(inflow ? Math.round(rnd() * 100000) : 0),
      asMilli(inflow ? 0 : Math.round(rnd() * 100000)),
      account,
      rnd() < 0.5 ? food : rent,
      budgetId,
      `${m}-${d}`,
      `t${i}`,
      '',
      rnd() < 0.5 ? `Payee ${i % 5}` : undefined
    );
  }
  // transfers (TransferAccount* columns), incl. one to an off-budget account
  const transfer = async (from: number, to: number, amount: number, date: string, id: string) => {
    await services.transactions.addTransaction(
      asMilli(0),
      asMilli(amount),
      from,
      rent,
      budgetId,
      date,
      'Transfer',
      id
    );
    await services.transactions.addTransaction(
      asMilli(amount),
      asMilli(0),
      to,
      rent,
      budgetId,
      date,
      'Transfer',
      id
    );
  };
  await transfer(checking.ID, savings.ID, 50000, '2026-01-31', 'tr-savings');
  await transfer(checking.ID, brokerage.ID, 25000, '2026-02-01', 'tr-brokerage');
  months = ['2025-10', ...monthList, '2026-04'];
});

describe('transactions by account and month on the Month column', () => {
  it('has data in every account but the empty one', () => {
    const counts = accountIds.map(
      (id) =>
        (
          adapter
            .prepare('SELECT COUNT(*) AS n FROM transactions WHERE AccountID = ?')
            .get(id) as Row
        ).n
    );
    expect(counts.slice(0, 4).every((n) => Number(n) > 10)).toBe(true);
    expect(counts[4]).toBe(0);
  });

  it('Month equals strftime(%Y-%m, Date) for every row', () => {
    const row = adapter
      .prepare(
        "SELECT COUNT(*) AS n, SUM(Month IS NOT strftime('%Y-%m', Date)) AS diff FROM transactions"
      )
      .get() as Row;
    expect(Number(row.n)).toBeGreaterThan(150);
    expect(row.diff).toBe(0);
  });

  it('getTransactionsByAccountAndMonth returns exactly the old rows for every account x month', () => {
    let nonEmpty = 0;
    for (const id of accountIds)
      for (const m of months) {
        const expected = oldRows(id, m);
        if (expected.length) nonEmpty += 1;
        expect(exact(services.transactions.getTransactionsByAccountAndMonth(id, m))).toBe(
          exact(expected)
        );
      }
    expect(nonEmpty).toBeGreaterThan(15);
  });

  it('getTransactionsByAccountsAndMonth equals the per-account results concatenated', () => {
    const orders = [
      accountIds,
      [...accountIds].reverse(),
      [accountIds[2], accountIds[0]],
      [accountIds[1], accountIds[1]], // duplicates repeat rows, like repeated calls
      [accountIds[4]],
      [999999],
      [],
    ];
    for (const ids of orders)
      for (const m of months)
        expect(exact(services.transactions.getTransactionsByAccountsAndMonth(ids, m))).toBe(
          exact(ids.flatMap((id) => oldRows(id, m)))
        );
  });

  it('a month that is not YYYY-MM matches nothing, as with strftime', () => {
    for (const m of ['', '2026', '2026-1', '2026-01-15', '2026-01%', "2026-0'", '20xx-01'])
      for (const id of accountIds.slice(0, 2)) {
        expect(oldRows(id, m)).toEqual([]);
        expect(services.transactions.getTransactionsByAccountAndMonth(id, m)).toEqual([]);
        expect(services.transactions.getTransactionsByAccountsAndMonth([id], m)).toEqual([]);
      }
  });

  it('sums the same AtAGlance totals (spent, biggest outflows) across all accounts', () => {
    for (const m of months) {
      const oldAll = accountIds.flatMap((id) => oldRows(id, m));
      const newAll = services.transactions.getTransactionsByAccountsAndMonth(accountIds, m);
      const spent = (rows: Row[]) =>
        rows.reduce((s, r) => s + (Number(r.OutflowConverted) || 0), 0);
      expect(spent(newAll as unknown as Row[])).toBe(spent(oldAll));
    }
  });

  it('reads only the month range of each account (idx_transactions_account_date_id)', () => {
    let captured: { sql: string; params: unknown[] } | undefined;
    const original = adapter.prepare.bind(adapter);
    adapter.prepare = (sql: string) => {
      const stmt = original(sql);
      return {
        ...stmt,
        all: (...params: unknown[]) => {
          captured = { sql, params };
          return stmt.all(...params);
        },
      };
    };
    try {
      services.transactions.getTransactionsByAccountsAndMonth(accountIds, '2026-01');
    } finally {
      adapter.prepare = original;
    }
    expect(captured).toBeDefined();
    const raw = (adapter as unknown as { db: Database }).db;
    const stmt = raw.prepare(`EXPLAIN QUERY PLAN ${captured!.sql}`);
    stmt.bind(captured!.params as never);
    const details: string[] = [];
    while (stmt.step()) details.push(String(stmt.getAsObject().detail));
    stmt.free();
    expect(details.join(' | ')).toMatch(
      /SEARCH t USING INDEX idx_transactions_account_date_id \(AccountID=\? AND Date>\? AND Date<\?\)/
    );
    expect(details.join(' | ')).not.toMatch(/SCAN t\b/);
  });
});
