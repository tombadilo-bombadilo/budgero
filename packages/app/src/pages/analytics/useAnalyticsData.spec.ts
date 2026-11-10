import { describe, expect, it } from 'vitest';
import { asMilli, type Account } from '@budgero/core/browser';

import { buildMonthlyFlow, buildNetWorthSeries, type AnalyticsTxn } from './analytics-model';
import { adaptAnalyticsAccounts } from './useAnalyticsData';

function account(overrides: Partial<Account>): Account {
  return {
    ID: 1,
    Name: 'Checking',
    Currency: 'USD',
    Type: 'Checking',
    BalanceNative: asMilli(0),
    BudgetID: 1,
    OnBudget: true,
    ...overrides,
  };
}

describe('adaptAnalyticsAccounts', () => {
  it('keeps archived accounts in historical report scope and excludes deleted accounts', () => {
    const accounts = adaptAnalyticsAccounts([
      account({ ID: 1, Name: 'Active' }),
      account({ ID: 2, Name: 'Archived', Archived: true }),
      account({ ID: 3, Name: 'Deleted', Deleted: true }),
    ]);

    expect(accounts.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: 'Active' },
      { id: 2, name: 'Archived' },
    ]);

    const onBudgetAccountIds = new Set(
      accounts.filter((candidate) => candidate.onBudget).map((candidate) => candidate.id)
    );
    const archivedIncome: AnalyticsTxn = {
      id: 1,
      date: '2026-08-01',
      monthKey: '2026-08',
      accountId: 2,
      categoryId: 10,
      category: 'Salary',
      groupName: 'Income',
      payee: 'Employer',
      labelId: null,
      label: '',
      labelColor: null,
      inflow: 500_000,
      outflow: 0,
      isTransfer: false,
      isIncome: true,
    };

    expect(buildMonthlyFlow([archivedIncome], ['2026-08'], onBudgetAccountIds)[0]).toMatchObject({
      income: 500_000,
      net: 500_000,
    });
  });

  it('counts a lower-case credit card as debt in net worth', () => {
    const accounts = adaptAnalyticsAccounts([
      account({ ID: 1, Name: 'Checking', BalanceNative: asMilli(1_000_000) }),
      account({ ID: 2, Name: 'Card', Type: 'credit', BalanceNative: asMilli(-250_000) }),
    ]);
    expect(accounts[1].isLiability).toBe(true);
    expect(buildNetWorthSeries(accounts, [], ['2026-10'])[0]).toEqual({
      monthKey: '2026-10',
      assets: 1_000_000,
      debt: 250_000,
      netWorth: 750_000,
    });
  });
});
