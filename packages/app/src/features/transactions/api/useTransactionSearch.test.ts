import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { parseSearchQuery } from '@shared/lib/search-query-parser';
import { asMilli } from '@shared/lib/currency/milli';
import {
  decimalSeparatorOf,
  filterTransactions,
  useTransactionSearch,
} from './useTransactionSearch';
import { displayCurrencyFormatter, makeAmountAccessors } from '../lib/amount-accessors';

const row = (ID: number, extra: Partial<GetTransactionsByAccountRow>) =>
  ({
    ID,
    Date: '2026-09-01',
    Memo: '',
    Payee: '',
    Category: 'Food',
    CategoryID: 1,
    InflowConverted: 0,
    OutflowConverted: 1_000,
    RunningBalanceConverted: null,
    Reconciled: false,
    Cleared: false,
    ...extra,
  }) as GetTransactionsByAccountRow;

const rows = [
  row(1, {}),
  row(2, { Cleared: true }),
  row(3, { Cleared: true, Reconciled: true }),
  row(-4, { IsProjected: true, Cleared: undefined }),
];

const ids = (query: string) =>
  filterTransactions(
    rows,
    parseSearchQuery(query, [], []),
    { uncategorized: false, uncleared: false },
    (tx) => tx.InflowConverted,
    (tx) => tx.OutflowConverted
  ).map((tx) => tx.ID);

describe('filterTransactions cleared status', () => {
  it('treats reconciled rows as cleared and never matches projected rows', () => {
    expect(ids('uncleared')).toEqual([1]);
    expect(ids('cleared')).toEqual([2, 3]);
    expect(ids('reconciled')).toEqual([3]);
  });
});

describe('filterTransactions quick filters', () => {
  it('uncleared toggle keeps only real, uncleared rows', () => {
    expect(
      filterTransactions(
        rows,
        parseSearchQuery('', [], []),
        { uncategorized: false, uncleared: true },
        (tx) => tx.InflowConverted,
        (tx) => tx.OutflowConverted
      ).map((tx) => tx.ID)
    ).toEqual([1]);
  });
});

describe('filterTransactions search terms', () => {
  const data = [
    row(1, { Payee: 'Amazon', Memo: 'USB cable', Category: 'Electronics', Label: 'Work' }),
    row(2, { Payee: 'Corner Shop', Memo: 'coffee beans', Category: 'Groceries' }),
    row(3, { Payee: 'Shop Corner', Memo: '', Category: 'Groceries', Label: 'Trip' }),
    row(4, {
      Payee: '',
      Memo: 'rent',
      Category: 'Transfers',
      TransferID: 't1',
      TransferAccountName: 'Savings',
      InflowConverted: asMilli(0),
      OutflowConverted: asMilli(500_000),
    }),
    row(5, {
      Payee: '',
      Category: 'Split',
      SplitPayees: '[["Costco",null,1],["Pharmacy",null,1]]',
      OutflowConverted: asMilli(80_000),
    }),
    row(6, {
      Payee: 'Employer',
      Category: 'Income',
      InflowConverted: asMilli(2_000_000),
      OutflowConverted: asMilli(0),
    }),
    row(7, { Payee: 'Gym', Category: '', CategoryID: 0, Cleared: true }),
    row(-8, { Payee: 'Netflix', Category: 'Fun', IsProjected: true, Cleared: undefined }),
    row(9, {
      Payee: 'Bakery',
      Memo: 'croissant',
      Category: 'Groceries',
      OutflowConverted: asMilli(25_500),
    }),
  ];
  const categories = ['Electronics', 'Groceries', 'Transfers', 'Income', 'Fun'];
  const labels = ['Work', 'Trip'];
  const find = (query: string, decimalSeparator: '.' | ',' = '.') =>
    filterTransactions(
      data,
      parseSearchQuery(query, categories, labels, { decimalSeparator }),
      { uncategorized: false, uncleared: false },
      (tx) => tx.InflowConverted,
      (tx) => tx.OutflowConverted
    ).map((tx) => tx.ID);

  it('matches every word, each in any field', () => {
    expect(find('corner shop')).toEqual([2, 3]);
    expect(find('shop beans')).toEqual([2]);
    expect(find('AMAZON cable')).toEqual([1]);
    expect(find('amazon beans')).toEqual([]);
  });

  it('matches quoted text as one phrase', () => {
    expect(find('"corner shop"')).toEqual([2]);
    expect(find('"shop corner"')).toEqual([3]);
  });

  it('searches one field with a prefix', () => {
    expect(find('payee:shop')).toEqual([2, 3]);
    expect(find('memo:coffee')).toEqual([2]);
    expect(find('payee:coffee')).toEqual([]);
    expect(find('category:groc')).toEqual([2, 3, 9]);
    expect(find('label:tr')).toEqual([3]);
  });

  it('finds transfers and split lines by payee', () => {
    expect(find('payee:savings')).toEqual([4]);
    expect(find('pharmacy')).toEqual([5]);
  });

  it('leaves out negated words, fields, categories and labels', () => {
    expect(find('-groceries')).toEqual([1, 4, 5, 6, 7, -8]);
    expect(find('groceries -payee:corner')).toEqual([9]);
    expect(find('groceries -"corner shop"')).toEqual([3, 9]);
    expect(find('-label:trip groceries')).toEqual([2, 9]);
    expect(find('not shop groceries')).toEqual([9]);
  });

  it('negates types, statuses and states', () => {
    expect(find('-transfers -inflows')).toEqual([1, 2, 3, 5, 7, -8, 9]);
    // Projected rows have no status, so a status filter skips them either way.
    expect(find('not uncleared')).toEqual([7]);
    expect(find('-split -upcoming -transfers groceries')).toEqual([2, 3, 9]);
  });

  it('filters on states', () => {
    expect(find('uncategorized')).toEqual([7]);
    expect(find('has:category gym')).toEqual([]);
    expect(find('split')).toEqual([5]);
    expect(find('upcoming')).toEqual([-8]);
    expect(find('has:memo')).toEqual([1, 2, 4, 9]);
    expect(find('no:memo groceries')).toEqual([3]);
    expect(find('has:label')).toEqual([1, 3]);
    expect(find('no:label groceries')).toEqual([2, 9]);
    expect(find('no:payee')).toEqual([]);
  });

  it('filters amounts between two numbers, with either decimal mark', () => {
    expect(find('between 20 and 80')).toEqual([5, 9]);
    expect(find('=25,50')).toEqual([9]);
    expect(find('=25,50', ',')).toEqual([9]);
    expect(find('over 1.000', ',')).toEqual([6]);
    expect(find('over 1 000')).toEqual([6]);
  });

  it('combines everything with AND', () => {
    expect(find('groceries outflows over 10 under 30 -memo:coffee')).toEqual([9]);
  });
});

describe('amount search follows the currency the table shows', () => {
  // A EUR account in an RSD budget: €250 is about RSD 29,300.
  const eurRows = [
    row(1, {
      OutflowConverted: asMilli(29_300_000),
      OutflowNative: asMilli(250_000),
    }),
    row(2, {
      OutflowConverted: asMilli(11_700_000),
      OutflowNative: asMilli(100_000),
    }),
  ];
  const find = (query: string, display: 'budget' | 'account') => {
    const { getPrimaryInflow, getPrimaryOutflow } = makeAmountAccessors(display);
    return filterTransactions(
      eurRows,
      parseSearchQuery(query, [], []),
      { uncategorized: false, uncleared: false },
      getPrimaryInflow,
      getPrimaryOutflow
    ).map((tx) => tx.ID);
  };

  it('compares account-currency amounts when the Account Currency toggle is on', () => {
    expect(find('> 200', 'account')).toEqual([1]);
    expect(find('between 50 and 150', 'account')).toEqual([2]);
  });

  it('compares budget-currency amounts otherwise', () => {
    expect(find('> 200', 'budget')).toEqual([1, 2]);
    expect(find('> 20000', 'budget')).toEqual([1]);
  });

  it('labels and reads amounts with the formatter of the shown currency', () => {
    const budget = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'RSD' });
    const account = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
    expect(displayCurrencyFormatter('account', budget, account)).toBe(account);
    expect(displayCurrencyFormatter('budget', budget, account)).toBe(budget);
    expect(decimalSeparatorOf(displayCurrencyFormatter('account', budget, account))).toBe(',');
  });
});

describe('useTransactionSearch suggestions', () => {
  const categories = ['Hrana i Piće', 'Hrana', 'Rent'];
  const labels = ['Hranarina'];
  const options = { payeeNames: ['Hranko doo', 'Maxi'], accountNames: [] };

  const setup = () =>
    renderHook(() => useTransactionSearch(categories, labels, undefined, options));

  it('suggests after a minus and inserts the quoted, negated name', () => {
    const { result } = setup();
    act(() => {
      result.current.setIsSearchFocused(true);
      result.current.setSearchQuery('last month -Hra');
    });
    expect(result.current.suggestions.map((s) => `${s.kind}:${s.name}`)).toEqual([
      'category:Hrana i Piće',
      'category:Hrana',
      'label:Hranarina',
      'payee:Hranko doo',
    ]);
    expect(result.current.activeTerm?.excludes).toBe(true);
    let caret: number | null = null;
    act(() => {
      caret = result.current.handleSelectSuggestion(result.current.suggestions[0]);
    });
    expect(result.current.searchQuery).toBe('last month -category:"Hrana i Piće" ');
    expect(caret).toBe(result.current.searchQuery.length);
    expect(result.current.parsedQuery.excludedCategories).toEqual(['Hrana i Piće']);
    // The caret is now after a space: nothing is being typed, so no list.
    expect(result.current.suggestions).toEqual([]);
  });

  it('reads typed amounts with the decimal mark of the shown currency', () => {
    const account = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
    const { result } = renderHook(() =>
      useTransactionSearch([], [], undefined, { amountFormatter: account })
    );
    act(() => result.current.setSearchQuery('> 1.500'));
    expect(result.current.parsedQuery.amountFilters).toEqual([{ operator: 'over', amount: 1500 }]);
  });
});
