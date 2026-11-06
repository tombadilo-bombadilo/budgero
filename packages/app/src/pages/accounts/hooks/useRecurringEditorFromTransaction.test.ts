import {
  asMilli,
  type GetTransactionsByAccountRow,
  type Transaction,
  type TransactionSplit,
} from '@budgero/core/browser';
import { recurringInitialValuesFromTransaction } from './useRecurringEditorFromTransaction';

type TransactionRowFixture = Transaction & GetTransactionsByAccountRow;

function transactionRow(overrides: Partial<TransactionRowFixture> = {}): TransactionRowFixture {
  return {
    ID: 1,
    CategoryID: 4,
    Category: 'Transfers',
    AccountID: 1,
    Date: '2026-08-30',
    Month: '2026-08',
    Memo: '',
    Reconciled: false,
    InflowConverted: asMilli(0),
    OutflowConverted: asMilli(0),
    RunningBalanceConverted: asMilli(0),
    BudgetID: 42,
    ...overrides,
  };
}

const sourceLeg = transactionRow({
  ID: 10,
  TransferID: 'transfer-1',
  AccountID: 1,
  Date: '2026-08-29',
  Memo: 'Move savings',
  Payee: 'Savings transfer',
  OutflowConverted: asMilli(9_000),
  InflowNative: asMilli(0),
  OutflowNative: asMilli(10_000),
});

const destinationLeg = transactionRow({
  ID: 11,
  TransferID: 'transfer-1',
  AccountID: 2,
  Memo: 'Received savings',
  Payee: 'Incoming transfer',
  InflowConverted: asMilli(9_000),
  InflowNative: asMilli(117_000),
  OutflowNative: asMilli(0),
});

describe('recurringInitialValuesFromTransaction', () => {
  it.each([
    ['source', sourceLeg],
    ['destination', destinationLeg],
  ])('reconstructs the same recurring transfer from the %s leg', (_name, selectedLeg) => {
    const values = recurringInitialValuesFromTransaction(selectedLeg, selectedLeg.AccountID, [
      sourceLeg,
      destinationLeg,
    ]);

    expect(values).toMatchObject({
      direction: 'outflow',
      accountId: 1,
      toAccountId: 2,
      amount: asMilli(10_000),
      memo: 'Move savings',
      name: 'Savings transfer',
      schedule: { startDate: '2026-08-29' },
    });
  });

  it('does not flatten malformed or split transfer groups', () => {
    expect(recurringInitialValuesFromTransaction(destinationLeg, 2, [destinationLeg])).toBeNull();
  });

  it('keeps ordinary transactions as inflow or outflow templates', () => {
    const values = recurringInitialValuesFromTransaction(
      {
        ...destinationLeg,
        TransferID: undefined,
        Payee: 'Employer',
      },
      2
    );

    expect(values).toMatchObject({
      direction: 'inflow',
      accountId: 2,
      amount: asMilli(117_000),
      name: 'Employer',
    });
    expect(values?.toAccountId).toBeUndefined();
  });

  it('copies a split transaction with its lines in account currency', () => {
    const line = (overrides: Partial<TransactionSplit>): TransactionSplit => ({
      ID: 1,
      TransactionID: 20,
      Memo: '',
      InflowConverted: asMilli(0),
      OutflowConverted: asMilli(0),
      OrderIndex: 0,
      ...overrides,
    });
    const values = recurringInitialValuesFromTransaction(
      transactionRow({
        ID: 20,
        Category: 'Split',
        CategoryID: 9,
        Payee: 'Payday',
        OutflowConverted: asMilli(90),
        OutflowNative: asMilli(100),
      }),
      1,
      undefined,
      [
        line({
          CategoryID: 5,
          Memo: 'rent',
          OutflowConverted: asMilli(54),
          OutflowNative: asMilli(60),
        }),
        line({
          ID: 2,
          TransferAccountID: 3,
          Payee: 'Me',
          OutflowConverted: asMilli(36),
          OutflowNative: asMilli(40),
        }),
      ]
    );

    expect(values).toMatchObject({
      amount: asMilli(100),
      direction: 'outflow',
      categoryId: null,
      splits: [
        { categoryId: 5, transferAccountId: null, memo: 'rent', payee: '', inflow: 0, outflow: 60 },
        { categoryId: null, transferAccountId: 3, memo: '', payee: 'Me', inflow: 0, outflow: 40 },
      ],
    });
  });
});
