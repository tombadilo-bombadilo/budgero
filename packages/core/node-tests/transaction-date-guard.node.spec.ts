import { describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, asMilli } from '../src';

const BAD_DATES = [
  '',
  ' ',
  'Invalid Date',
  'NaN-NaN-NaN',
  '2026-02-30',
  '2026-13-01',
  '2026-1-5',
  '2026-11-03T',
  'T08:30',
];

async function setup() {
  const adapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(adapter);
  const s = manager.getServices();
  const b = await s.budgets.createBudget({
    name: 'Dates',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const checking = await s.accounts.createAccount('Checking', b, 'checking', 'USD', 0, {}, true);
  const savings = await s.accounts.createAccount('Savings', b, 'savings', 'USD', 0, {}, true);
  const income = s.categories.getAllCategories(b).find((c) => c.Name === 'Income')!;
  const add = (date: string) =>
    s.transactions.addTransaction(
      asMilli(50_000),
      asMilli(0),
      checking.ID,
      income.ID,
      b,
      date,
      'pay'
    );
  const dateOf = (id: number) => {
    const q = adapter.prepare('SELECT Date FROM transactions WHERE ID = ?');
    const row = q.get(id) as { Date: string };
    q.finalize();
    return row.Date;
  };
  return { adapter, s, b, checking, savings, income, add, dateOf };
}

describe('transaction date guard', () => {
  it('rejects a new transaction without a calendar date', async () => {
    const c = await setup();
    for (const date of BAD_DATES) {
      await expect(c.add(date)).rejects.toThrow(/calendar date/);
    }
    expect(c.s.transactions.getTransactionsByAccount(c.checking.ID)).toHaveLength(0);
  });

  it('rejects a date cell edit that is not a calendar date', async () => {
    const c = await setup();
    const id = await c.add('2026-11-03');
    for (const date of [...BAD_DATES, null]) {
      await expect(c.s.transactions.updateTransactionColumn(id, 'Date', date)).rejects.toThrow(
        /calendar date/
      );
    }
    expect(c.dateOf(id)).toBe('2026-11-03');

    await c.s.transactions.updateTransactionColumn(id, 'Date', '2026-11-04');
    expect(c.dateOf(id)).toBe('2026-11-04');
  });

  it('rejects a bad date on a transfer leg', async () => {
    const c = await setup();
    await c.add('2026-11-03');
    const transfers = c.s.categories.getAllCategories(c.b).find((cat) => cat.Name === 'Transfers')!;
    for (const [inflow, outflow, account] of [
      [0, 10_000, c.checking.ID],
      [10_000, 0, c.savings.ID],
    ]) {
      await c.s.transactions.addTransaction(
        asMilli(inflow),
        asMilli(outflow),
        account,
        transfers.ID,
        c.b,
        '2026-11-05',
        'move',
        'date-guard-transfer'
      );
    }
    const leg = c.s.transactions
      .getTransactionsByAccount(c.savings.ID)
      .find((row) => row.TransferID)!;
    await expect(c.s.transactions.updateTransactionColumn(leg.ID, 'Date', '')).rejects.toThrow(
      /calendar date/
    );
    expect(c.dateOf(leg.ID)).toBe('2026-11-05');
  });

  it('rejects a bad date on a full row update', async () => {
    const c = await setup();
    const id = await c.add('2026-11-03');
    await expect(
      c.s.transactions.updateTransaction(
        id,
        asMilli(50_000),
        asMilli(0),
        c.checking.ID,
        c.income.ID,
        '',
        'pay'
      )
    ).rejects.toThrow(/calendar date/);
    expect(c.dateOf(id)).toBe('2026-11-03');
  });

  it('still lets a row saved with an empty date be edited, re-dated and deleted', async () => {
    const c = await setup();
    const id = await c.add('2026-11-03');
    const other = await c.add('2026-11-03');
    // What older builds could store.
    c.adapter.exec(`UPDATE transactions SET Date = '' WHERE ID IN (${id}, ${other})`);

    await c.s.transactions.updateTransactionColumn(id, 'Memo', 'found it');
    await c.s.transactions.updateTransaction(
      id,
      asMilli(60_000),
      asMilli(0),
      c.checking.ID,
      c.income.ID,
      '',
      'found it'
    );
    expect(c.dateOf(id)).toBe('');

    await c.s.transactions.updateTransactionColumn(id, 'Date', '2026-11-06');
    expect(c.dateOf(id)).toBe('2026-11-06');

    await c.s.transactions.deleteTransaction(other);
    expect(c.s.transactions.getTransactionsByAccount(c.checking.ID).map((row) => row.ID)).toEqual([
      id,
    ]);
  });
});
