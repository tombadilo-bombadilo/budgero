import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { SplitDetailsDialog } from './SplitDetailsDialog';

const state = vi.hoisted(() => ({
  splits: [] as Record<string, unknown>[],
  save: vi.fn(),
}));

const accounts = [
  { ID: 1, Name: 'Checking', Currency: 'USD', OnBudget: true },
  { ID: 2, Name: 'Savings', Currency: 'USD', OnBudget: true },
  { ID: 3, Name: 'Card', Currency: 'USD', OnBudget: true },
  { ID: 4, Name: 'Old', Currency: 'USD', OnBudget: true, Archived: true },
];

vi.mock('@entities/transaction/api/useTransactions', () => ({
  useTransactionSplits: () => ({ data: state.splits, isLoading: false }),
  useSaveSplits: () => ({ mutateAsync: state.save, isPending: false }),
  useClearSplits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({ data: accounts, isLoading: false }),
}));
vi.mock('@shared/ui/calculator-cell', () => ({ CalculatorCell: () => null }));
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
    displayValue,
  }: {
    onChange: (value: string) => void;
    transferAccounts?: { ID: number; Name: string }[];
    onSelectTransfer?: (id: number) => void;
    displayValue?: string;
  }) => (
    <div>
      <span data-testid="payee-display">{displayValue ?? ''}</span>
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
  Account: 'Checking',
  Date: '2026-03-10',
  Category: 'Split',
  Memo: '',
  InflowConverted: 0,
  OutflowConverted: 10_000,
} as unknown as GetTransactionsByAccountRow;

const line = (fields: Record<string, unknown>) => ({
  ID: 1,
  CategoryID: null,
  TransferAccountID: null,
  Memo: '',
  Payee: '',
  InflowConverted: 0,
  OutflowConverted: 10_000,
  ...fields,
});

function open() {
  render(
    <SplitDetailsDialog
      transaction={transaction}
      onClose={vi.fn()}
      currentFormatter={new Intl.NumberFormat('en-US')}
      transactionCurrencyDisplay="budget"
      getPrimaryInflow={(row) => row.InflowConverted}
      getPrimaryOutflow={(row) => row.OutflowConverted}
      budgetId={1}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit splits' }));
}

const save = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return state.save.mock.calls.at(-1)?.[0].splits[0];
};

describe('SplitDetailsDialog transfer lines', () => {
  beforeEach(() => {
    state.save.mockReset();
    state.save.mockResolvedValue(undefined);
  });

  it('turns a line into a transfer when its payee names an account', () => {
    state.splits = [line({ CategoryID: 7, Payee: 'Shop' })];
    open();
    fireEvent.blur(screen.getByLabelText('payee'), { target: { value: 'Transfer : Savings' } });
    expect(save()).toMatchObject({ transfer_account_id: 2, category_id: null, payee: '' });
  });

  it('offers other open accounts in the payee picker, and retargets a transfer line', () => {
    state.splits = [line({ TransferAccountID: 2, TransferAccountName: 'Savings' })];
    open();
    expect(screen.queryByText(/Editing transfer splits is not supported/)).toBeNull();
    expect(screen.getByTestId('payee-display').textContent).toBe('Transfer: Savings');
    expect(screen.queryByRole('button', { name: 'Transfer: Checking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer: Old' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer: Card' }));
    expect(save()).toMatchObject({ transfer_account_id: 3, category_id: null });
  });

  it('turns a transfer line back into a category line', () => {
    state.splits = [line({ TransferAccountID: 2, TransferAccountName: 'Savings' })];
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Pick category' }));
    expect(save()).toMatchObject({ transfer_account_id: null, category_id: 9 });
  });

  it('keeps a payee naming its own account as plain text', () => {
    state.splits = [line({ CategoryID: 7 })];
    open();
    fireEvent.blur(screen.getByLabelText('payee'), { target: { value: 'Transfer : Checking' } });
    expect(save()).toMatchObject({
      transfer_account_id: null,
      category_id: 7,
      payee: 'Transfer : Checking',
    });
  });
});
