import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { SplitDetailsDialog } from './SplitDetailsDialog';
import { useReconciledEditConfirmStore } from '../reconciled-edit/reconciled-edit-confirm';

const state = vi.hoisted(() => ({
  splits: [] as Record<string, unknown>[],
  save: vi.fn(),
  unlocked: [] as number[],
  unlockCheck: vi.fn(),
}));

// The core's split-save check: which reconciled mirrors a save would unlock.
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({
      transactions: {
        getTransactionByID: () => ({ AccountID: 1, BudgetID: 1, Date: '2026-03-10' }),
        splitSaveUnlocksMirrors: async (...args: unknown[]) => {
          state.unlockCheck(...args);
          return state.unlocked;
        },
      },
      splits: {
        quoteMirrorAmounts: async (_parent: unknown, lines: unknown[], received: number[]) =>
          lines.map((_line, index) =>
            received[index]
              ? {
                  InflowNative: received[index],
                  OutflowNative: 0,
                  InflowConverted: 1,
                  OutflowConverted: 0,
                }
              : null
          ),
      },
    }),
  }),
}));

const accounts = [
  { ID: 1, Name: 'Checking', Currency: 'USD', OnBudget: true },
  { ID: 2, Name: 'Savings', Currency: 'USD', OnBudget: true },
  { ID: 3, Name: 'Card', Currency: 'USD', OnBudget: true },
  { ID: 4, Name: 'Old', Currency: 'USD', OnBudget: true, Archived: true },
  { ID: 5, Name: 'Euro', Currency: 'EUR', OnBudget: true },
  { ID: 6, Name: 'Mortgage', Currency: 'USD', OnBudget: false },
];

vi.mock('@entities/transaction/api/useTransactions', () => ({
  useTransactionSplits: () => ({ data: state.splits, isLoading: false }),
  useSaveSplits: () => ({ mutateAsync: state.save, isPending: false }),
  useClearSplits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({ data: accounts, isLoading: false }),
}));
vi.mock('@shared/ui/calculator-cell', () => ({
  CalculatorCell: ({
    value,
    onCommit,
    'data-testid': testId,
  }: {
    value: number;
    onCommit: (value: number) => void;
    'data-testid'?: string;
  }) =>
    testId ? (
      <input
        data-testid={testId}
        defaultValue={String(value)}
        key={value}
        onBlur={(event) => onCommit(Number(event.target.value))}
      />
    ) : null,
}));
vi.mock('@entities/currency/lib/currency-utils', () => ({
  getExchangeRate: vi.fn(async () => 0.9),
}));
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

const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(state.save).toHaveBeenCalled());
  return state.save.mock.calls.at(-1)?.[0].splits[0];
};

describe('SplitDetailsDialog transfer lines', () => {
  beforeEach(() => {
    state.save.mockReset();
    state.save.mockResolvedValue(undefined);
  });

  it('turns a line into a transfer when its payee names an account', async () => {
    state.splits = [line({ CategoryID: 7, Payee: 'Shop' })];
    open();
    fireEvent.blur(screen.getByLabelText('payee'), { target: { value: 'Transfer : Savings' } });
    expect(await save()).toMatchObject({ transfer_account_id: 2, category_id: null, payee: '' });
  });

  it('offers other open accounts in the payee picker, and retargets a transfer line', async () => {
    state.splits = [line({ TransferAccountID: 2, TransferAccountName: 'Savings' })];
    open();
    expect(screen.queryByText(/Editing transfer splits is not supported/)).toBeNull();
    expect(screen.getByTestId('payee-display').textContent).toBe('Transfer: Savings');
    expect(screen.queryByRole('button', { name: 'Transfer: Checking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer: Old' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer: Card' }));
    expect(await save()).toMatchObject({ transfer_account_id: 3, category_id: null });
  });

  it('locks the category of a transfer to an on-budget account; a plain payee frees it', async () => {
    state.splits = [line({ TransferAccountID: 2, TransferAccountName: 'Savings' })];
    open();
    expect(screen.getByTestId('split-transfer-category-locked')).toHaveTextContent('Transfers');
    expect(screen.queryByRole('button', { name: 'Pick category' })).toBeNull();
    fireEvent.blur(screen.getByLabelText('payee'), { target: { value: 'Shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick category' }));
    expect(await save()).toMatchObject({ transfer_account_id: null, category_id: 9 });
  });

  it('a line to an off-budget account keeps its transfer when it gets a category', async () => {
    state.splits = [line({ TransferAccountID: 6, TransferAccountName: 'Mortgage' })];
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Pick category' }));
    expect(await save()).toMatchObject({ transfer_account_id: 6, category_id: 9 });
  });

  it('saves the stored received amount of a cross-currency line, and a typed one', async () => {
    const mirror = {
      InflowNative: 8_800,
      OutflowNative: 0,
      InflowConverted: 9_700,
      OutflowConverted: 0,
    };
    state.splits = [line({ TransferAccountID: 5, Mirror: mirror, MirrorPinned: true })];
    open();
    expect(screen.getByText('Received in Euro (EUR)')).toBeInTheDocument();
    // An entered (pinned) amount is sent again, so it stays pinned.
    expect(await save()).toMatchObject({ transfer_account_id: 5, received_amount: 8_800 });

    state.save.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Edit splits' }));
    const input = screen.getByTestId('split-received-amount');
    fireEvent.change(input, { target: { value: '8500' } });
    fireEvent.blur(input);
    expect(await save()).toMatchObject({ received_amount: 8_500 });
    expect(useReconciledEditConfirmStore.getState().pending).toBeNull();
  });

  it('an estimate is shown but not sent: the mirror keeps the usual conversion', async () => {
    const mirror = {
      InflowNative: 8_800,
      OutflowNative: 0,
      InflowConverted: 9_700,
      OutflowConverted: 0,
    };
    state.splits = [line({ TransferAccountID: 5, Mirror: mirror, MirrorPinned: false })];
    open();
    expect(screen.getByTestId('split-received-amount')).toHaveValue('8800');
    expect(await save()).toMatchObject({ transfer_account_id: 5, received_amount: null });
  });

  it('explains why Save waits while a new cross-currency line has no amount', async () => {
    const { getExchangeRate } = await import('@entities/currency/lib/currency-utils');
    vi.mocked(getExchangeRate).mockResolvedValue(null);
    state.splits = [line({ TransferAccountID: 2, TransferAccountName: 'Savings' })];
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer: Euro' }));
    expect(await screen.findByTestId('split-save-hint')).toHaveTextContent(
      'Enter the amount received in Euro'
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    vi.mocked(getExchangeRate).mockResolvedValue(0.9);
  });

  it('asks before a new received amount unlocks a reconciled mirror', async () => {
    state.unlocked = [99];
    const mirror = {
      InflowNative: 8_800,
      OutflowNative: 0,
      InflowConverted: 9_700,
      OutflowConverted: 0,
    };
    state.splits = [
      line({ TransferAccountID: 5, Mirror: mirror, MirrorPinned: true, MirrorReconciled: true }),
    ];
    open();
    const input = screen.getByTestId('split-received-amount');
    fireEvent.change(input, { target: { value: '8500' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useReconciledEditConfirmStore.getState().pending?.kind).toBe('row'));
    useReconciledEditConfirmStore.getState().settle(false);
    await Promise.resolve();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.unlockCheck).toHaveBeenCalledWith(10, {
      splits: [
        expect.objectContaining({
          TransferAccountID: 5,
          Mirror: expect.objectContaining({ InflowNative: 8_500 }),
        }),
      ],
    });
    state.unlocked = [];
  });

  it("shows each line's payee when not editing, and a transfer line's target", () => {
    state.splits = [
      line({ ID: 1, CategoryID: 7, CategoryName: 'Food', Payee: 'Walmart' }),
      line({ ID: 2, TransferAccountID: 5, TransferAccountName: 'Euro' }),
    ];
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
    expect(screen.getByText('Walmart')).toBeInTheDocument();
    expect(screen.getByText('→ Euro')).toBeInTheDocument();
  });

  it('keeps a payee naming its own account as plain text', async () => {
    state.splits = [line({ CategoryID: 7 })];
    open();
    fireEvent.blur(screen.getByLabelText('payee'), { target: { value: 'Transfer : Checking' } });
    expect(await save()).toMatchObject({
      transfer_account_id: null,
      category_id: 7,
      payee: 'Transfer : Checking',
    });
  });

  it('wraps an extremely long transaction memo without expanding the dialog grid', () => {
    const longMemo = 'A transaction with an extremely long memo breaks the layout - '.repeat(20);
    state.splits = [];
    render(
      <SplitDetailsDialog
        transaction={{ ...transaction, Memo: longMemo }}
        onClose={vi.fn()}
        currentFormatter={new Intl.NumberFormat('en-US')}
        transactionCurrencyDisplay="budget"
        getPrimaryInflow={(row) => row.InflowConverted}
        getPrimaryOutflow={(row) => row.OutflowConverted}
        budgetId={1}
      />
    );
    const content = document.querySelector('[data-slot="dialog-content"]');
    const header = document.querySelector('[data-slot="dialog-header"]');
    const description = document.querySelector('[data-slot="dialog-description"]');
    expect(content).toHaveClass('grid-cols-1');
    expect(header).toHaveClass('min-w-0');
    expect(description).toHaveClass(
      'min-w-0',
      'whitespace-normal',
      'break-words',
      '[overflow-wrap:anywhere]'
    );
    expect(description).not.toHaveClass('truncate');
    expect(description).toHaveTextContent(longMemo.trim());
  });
});
