import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { TransactionCardDetails } from './TransactionCardDetails';
import type { SplitLine } from './useMobileTransactionCardState';

const accounts = [
  { ID: 1, Name: 'Checking', Currency: 'USD', OnBudget: true },
  { ID: 2, Name: 'Savings', Currency: 'USD', OnBudget: true },
  { ID: 3, Name: 'Card', Currency: 'USD', OnBudget: true },
];

vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({ data: accounts, isLoading: false }),
}));
vi.mock('@shared/ui/calculator-cell', () => ({ CalculatorCell: () => null }));
vi.mock('@features/transactions/ui/cells/DatePickerCell', () => ({ DatePickerCell: () => null }));
vi.mock('@features/transactions/ui/cells/CategorySelectCell', () => ({
  CategorySelectCell: () => null,
}));
vi.mock('@features/transactions/ui/cells/AccountSelectCell', () => ({
  AccountSelectCell: () => null,
}));
vi.mock('@features/transactions/ui/cells/TransactionPayeeCell', () => ({
  TransactionPayeeCell: () => null,
}));
vi.mock('@features/transactions/ui/cells/LabelSelectCell', () => ({ LabelSelectCell: () => null }));
vi.mock('@features/transactions/ui/cells/ExchangeRateCell', () => ({
  ExchangeRateCell: () => null,
}));
vi.mock('@features/transactions/ui/SecondaryAmount', () => ({ SecondaryAmount: () => null }));
vi.mock('@features/category-management/ui/SearchableCategorySelect', () => ({
  SearchableCategorySelect: ({ onCategorySelect }: { onCategorySelect: (id: number) => void }) => (
    <button type="button" onClick={() => onCategorySelect(9)}>
      Pick category
    </button>
  ),
}));
vi.mock('@features/payees/ui/PayeeCombobox', () => ({
  PayeeCombobox: ({
    onChange,
    transferAccounts,
    onSelectTransfer,
  }: {
    onChange: (value: string) => void;
    transferAccounts?: { ID: number; Name: string }[];
    onSelectTransfer?: (id: number) => void;
  }) => (
    <div>
      <input aria-label="payee" onBlur={(event) => onChange(event.target.value)} />
      {(transferAccounts ?? []).map((account) => (
        <button key={account.ID} type="button" onClick={() => onSelectTransfer?.(account.ID)}>
          Transfer: {account.Name}
        </button>
      ))}
    </div>
  ),
}));

const transaction = {
  ID: 10,
  AccountID: 1,
  Date: '2026-03-10',
  Category: 'Split',
  Memo: '',
  InflowConverted: 0,
  OutflowConverted: 10_000,
} as unknown as GetTransactionsByAccountRow;

function renderCard(editSplits: SplitLine[]) {
  const onUpdateSplitLine = vi.fn();
  const formatter = new Intl.NumberFormat('en-US');
  render(
    <TransactionCardDetails
      {...({} as React.ComponentProps<typeof TransactionCardDetails>)}
      transaction={transaction}
      budgetId={1}
      selectedBudgetId={1}
      currentFormatter={formatter}
      accountLocalizer={formatter}
      globalLocalizer={formatter}
      transactionCurrencyDisplay="budget"
      getPrimaryInflow={(row) => row.InflowConverted}
      getPrimaryOutflow={(row) => row.OutflowConverted}
      getSecondaryInflow={() => 0}
      getSecondaryOutflow={() => 0}
      onCellCommit={vi.fn()}
      hideAccountColumn
      splits={[]}
      splitsLoading={false}
      editSplits={editSplits}
      showSplitSection
      canSplitTransaction
      isClearingSplits={false}
      splitSaveDisabled={false}
      remainingAmount={0}
      splitTarget={10_000}
      onUpdateSplitLine={onUpdateSplitLine}
    />
  );
  return onUpdateSplitLine;
}

const plainLine: SplitLine = {
  id: 1,
  category_id: 7,
  transfer_account_id: null,
  memo: '',
  payee: 'Shop',
  inflow: 0,
  outflow: 10_000,
};

describe('TransactionCardDetails split lines', () => {
  it('a payee naming another account makes the line a transfer', () => {
    const update = renderCard([plainLine]);
    fireEvent.blur(screen.getByLabelText('payee'), { target: { value: 'Transfer : Savings' } });
    expect(update).toHaveBeenLastCalledWith(0, {
      payee: '',
      transfer_account_id: 2,
      category_id: null,
    });
  });

  it('offers the other accounts and retargets a transfer line', () => {
    const update = renderCard([{ ...plainLine, category_id: null, transfer_account_id: 2 }]);
    expect(screen.queryByRole('button', { name: 'Transfer: Checking' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer: Card' }));
    expect(update).toHaveBeenLastCalledWith(0, {
      payee: '',
      transfer_account_id: 3,
      category_id: null,
    });
  });

  it('a plain payee turns a transfer line back into a normal one', () => {
    const update = renderCard([{ ...plainLine, category_id: null, transfer_account_id: 2 }]);
    fireEvent.blur(screen.getByLabelText('payee'), { target: { value: 'Shop' } });
    expect(update).toHaveBeenLastCalledWith(0, { payee: 'Shop', transfer_account_id: null });
  });
});
