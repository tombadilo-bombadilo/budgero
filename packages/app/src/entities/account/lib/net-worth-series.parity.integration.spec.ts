/**
 * The account page / Wealth report series used to fold every transaction of
 * the budget (getAllTransactions). They now fold per-day / per-month
 * aggregates (getBalanceHistoryRows). Same math, so the series must be
 * identical: checked here on a seeded budget with foreign-currency accounts,
 * liabilities, revaluations, same-day rows, month-end rows and future rows,
 * at several clock times.
 */
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import {
  balanceRowsToLedger,
  buildMonthlyAssetHistory,
  buildNetWorthHistory,
  monthlyAssetWindowStart,
  netWorthWindowStart,
} from './net-worth-series';

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

describe('net worth and asset history from aggregates match the whole-ledger fold', () => {
  let services: Services;
  let budgetId: number;

  beforeAll(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      await manager.initialize(await NodeSqlJsAdapter.create());
    } finally {
      cwd.mockRestore();
    }
    services = manager.getServices();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 2, 1, 9, 0));
    budgetId = await services.budgets.createBudget({
      name: 'Net worth',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    await services.currency.saveRate('EUR', 'USD', 1.1, '2024-01-01', budgetId);
    await services.currency.saveRate('GBP', 'USD', 1.25, '2024-01-01', budgetId);
    const make = async (name: string, type: string, currency: string, opening: number) =>
      (
        await services.accounts.createAccount(
          name,
          budgetId,
          type,
          currency,
          asMilli(opening),
          undefined,
          undefined,
          'Opening',
          '2024-01-15'
        )
      ).ID;
    const accounts = [
      await make('Checking', 'Checking', 'USD', 250_000),
      await make('Euro', 'Checking', 'EUR', 100_000),
      await make('Savings GBP', 'Savings', 'GBP', 400_000),
      await make('Card', 'Credit', 'USD', -50_000),
      await make('Loan', 'Loan', 'USD', -900_000),
      await make('Brokerage', 'Investment', 'EUR', 300_000),
      await make('House', 'Real Estate', 'USD', 0),
    ];
    // An account with no rows at all keeps its stored balance only.
    await make('Empty', 'Cash', 'USD', 0);
    const categories = services.categories
      .getAllCategories(budgetId)
      .filter((c) => c.Name !== 'Transfers');

    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const start = new Date(2024, 0, 20);
    for (let i = 0; i < 400; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + Math.floor(rand() * 1020)); // through ~Nov 2026
      if (i % 25 === 0) date.setDate(0); // month ends
      const account = accounts[Math.floor(rand() * accounts.length)];
      const amount = Math.floor(rand() * 200_000) + 1;
      const inflow = rand() < 0.35 ? amount : 0;
      await services.transactions.addTransaction(
        asMilli(inflow),
        asMilli(inflow ? 0 : amount),
        account,
        categories[Math.floor(rand() * categories.length)].ID,
        budgetId,
        day(date),
        `row ${i}`,
        ''
      );
    }
    // Revaluation journal rows on a few days (revalueAccounts stamps "today").
    for (const [when, eur, gbp] of [
      [new Date(2025, 5, 30, 12), 1.2, 1.3],
      [new Date(2026, 0, 1, 12), 1.05, 1.22],
      [new Date(2026, 8, 20, 12), 1.15, 1.35],
      [new Date(2026, 9, 14, 12), 1.18, 1.31],
    ] as const) {
      vi.setSystemTime(when);
      await services.currency.saveRate('EUR', 'USD', eur, day(when), budgetId);
      await services.currency.saveRate('GBP', 'USD', gbp, day(when), budgetId);
      await services.currency.revalueAccounts(budgetId);
    }
  }, 60_000);

  afterEach(() => {
    vi.setSystemTime(new Date(2026, 9, 16, 12));
  });

  const clocks = [
    new Date(2026, 9, 16, 12, 0),
    new Date(2026, 9, 16, 0, 5),
    new Date(2026, 9, 31, 23, 50),
    new Date(2026, 10, 1, 8, 0),
    new Date(2025, 1, 28, 18, 0),
  ];

  it.each(clocks)('daily net worth is identical at %s', (now) => {
    vi.setSystemTime(now);
    const accounts = services.accounts.listAccounts(budgetId);
    const ledger = services.transactions.getAllTransactions(budgetId);
    for (const periodMonths of [0.25, 0.5, 1, 3, 6, 12, 36]) {
      const rows = services.transactions.getBalanceHistoryRows(
        budgetId,
        netWorthWindowStart(periodMonths),
        'day'
      );
      expect(rows.length).toBeLessThan(ledger.length);
      const before = buildNetWorthHistory(accounts, ledger, periodMonths);
      const after = buildNetWorthHistory(accounts, balanceRowsToLedger(rows), periodMonths);
      expect(after.length).toBeGreaterThan(0);
      expect(after).toEqual(before);
    }
  });

  it.each(clocks)('monthly asset history is identical at %s', (now) => {
    vi.setSystemTime(now);
    const accounts = services.accounts.listAccounts(budgetId);
    const ledger = services.transactions.getAllTransactions(budgetId);
    const revaluations = services.currency.getBudgetRevaluations(budgetId);
    expect(revaluations.length).toBeGreaterThan(0);
    for (const months of [1, 6, 24, 40]) {
      const rows = services.transactions.getBalanceHistoryRows(
        budgetId,
        monthlyAssetWindowStart(months),
        'month'
      );
      const before = buildMonthlyAssetHistory(accounts, ledger, revaluations, months);
      const after = buildMonthlyAssetHistory(
        accounts,
        balanceRowsToLedger(rows),
        revaluations,
        months
      );
      expect(after.length).toBeGreaterThan(0);
      expect(after).toEqual(before);
    }
  });

  it('stays identical when the window start was computed before midnight', () => {
    // The query key (window start) is computed at render; the fold may run later.
    vi.setSystemTime(new Date(2026, 9, 15, 23, 59));
    const fromDay = netWorthWindowStart(1);
    const fromMonth = monthlyAssetWindowStart(24);
    vi.setSystemTime(new Date(2026, 10, 1, 0, 1));
    const accounts = services.accounts.listAccounts(budgetId);
    const ledger = services.transactions.getAllTransactions(budgetId);
    const revaluations = services.currency.getBudgetRevaluations(budgetId);
    expect(
      buildNetWorthHistory(
        accounts,
        balanceRowsToLedger(services.transactions.getBalanceHistoryRows(budgetId, fromDay, 'day')),
        1
      )
    ).toEqual(buildNetWorthHistory(accounts, ledger, 1));
    expect(
      buildMonthlyAssetHistory(
        accounts,
        balanceRowsToLedger(
          services.transactions.getBalanceHistoryRows(budgetId, fromMonth, 'month')
        ),
        revaluations,
        24
      )
    ).toEqual(buildMonthlyAssetHistory(accounts, ledger, revaluations, 24));
  });
});
