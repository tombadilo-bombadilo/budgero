import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineTransactionRow } from './InlineTransactionRow';
import type { TransactionEditorDirectories } from './transaction-editor-types';

const form = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  handleSubmit: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

const accounts = [
  { ID: 1, Name: 'Checking', Currency: 'USD' },
  { ID: 2, Name: 'Savings', Currency: 'USD' },
  { ID: 3, Name: 'Euro Card', Currency: 'EUR' },
];

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('@features/transactions/api/useAddTransactionHandler', () => ({
  useAddTransactionHandler: () => ({ handleAddTransaction: vi.fn(), handleAddTransfer: vi.fn() }),
}));
vi.mock('@features/transactions/ui/add-transaction/useAddTransactionForm', () => {
  const setter = (key: string) => (value: unknown) => {
    form.state[key] = value;
  };
  return {
    useAddTransactionForm: () => ({
      form: {
        ...form.state,
        canSubmit: form.state.amount != null,
        setTransactionType: setter('transactionType'),
        setFromAccount: setter('selectedFromAccount'),
        setToAccount: setter('selectedToAccount'),
        setAmount: setter('amount'),
        setAmountTouched: vi.fn(),
        setPayee: setter('payee'),
        setMemo: setter('memo'),
        setDate: vi.fn(),
        setCategory: vi.fn(),
        setLabelId: vi.fn(),
        convertedAmount: form.state.convertedAmount ?? null,
      },
      accounts,
      categories: [],
      handleSubmit: form.handleSubmit,
      transferInvolvesOffBudget: false,
      selectedBudget: { ID: 1, DisplayCurrency: 'USD', NumberFormat: '$1,096.56' },
      isSplit: !!form.state.isSplit,
      toggleSplit: () => {
        form.state.isSplit = !form.state.isSplit;
      },
      splitLines: form.state.splitLines ?? [],
      setSplitLines: setter('splitLines'),
      remaining: 0,
      parentSigned: 0,
      receivedAmount: form.state.receivedAmount ?? null,
      setReceivedAmount: setter('receivedAmount'),
    }),
  };
});
vi.mock('@shared/ui/calculator-cell', () => ({
  CalculatorCell: ({
    onCommit,
    className,
  }: {
    onCommit: (v: number) => void;
    className: string;
  }) => (
    <input
      aria-label={
        className.includes('success')
          ? 'inflow'
          : className.includes('destructive')
            ? 'outflow'
            : 'other'
      }
      onChange={(e) => onCommit(Number(e.target.value))}
    />
  ),
}));
vi.mock('@features/transactions/ui/cells/CategorySelectCell', () => ({
  CategorySelectCell: () => null,
}));
vi.mock('@features/transactions/ui/cells/LabelSelectCell', () => ({ LabelSelectCell: () => null }));
vi.mock('@features/transactions/ui/cells/PayeeSelectCell', () => ({ PayeeSelectCell: () => null }));
vi.mock('@features/transactions/ui/cells/AccountSelectCell', () => ({
  AccountSelectCell: () => null,
}));
vi.mock('@features/transactions/ui/cells/DatePickerCell', () => ({ DatePickerCell: () => null }));
vi.mock('@features/currencies/ui/ManualRatePrompt', () => ({ ManualRatePrompt: () => null }));
vi.mock('@entities/currency/lib/currency-utils', () => ({
  getExchangeRate: vi.fn(async () => 0.5),
  saveManualRate: vi.fn(),
}));
vi.mock('@features/payees/ui/PayeeCombobox', () => ({
  PayeeCombobox: ({
    transferAccounts,
    onSelectTransfer,
  }: {
    transferAccounts?: { ID: number; Name: string }[];
    onSelectTransfer: (id: number) => void;
  }) => (
    <div>
      {(transferAccounts ?? []).map((account) => (
        <button key={account.ID} type="button" onClick={() => onSelectTransfer(account.ID)}>
          Transfer: {account.Name}
        </button>
      ))}
    </div>
  ),
}));

const directories = {
  accounts: [],
  categories: [],
  categoryGroups: [],
  labels: [],
  payees: [],
  monthlyRows: [],
  readyToAssignAmount: 0,
} as unknown as TransactionEditorDirectories;

function renderRow(overrides: Partial<React.ComponentProps<typeof InlineTransactionRow>> = {}) {
  const props = {
    budgetId: 1,
    accountId: 1,
    hideAccountColumn: true,
    showLabelColumn: false,
    showExchangeRateColumn: false,
    showBalanceColumn: false,
    columnCount: 8,
    editorDirectories: directories,
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(
    <table>
      <tbody>
        <InlineTransactionRow {...props} />
      </tbody>
    </table>
  );
  return {
    ...props,
    rerender: () =>
      view.rerender(
        <table>
          <tbody>
            <InlineTransactionRow {...props} />
          </tbody>
        </table>
      ),
  };
}

describe('InlineTransactionRow', () => {
  beforeEach(() => {
    form.state = { memo: '', payee: '', transactionType: 'outflow', selectedFromAccount: '1' };
    form.handleSubmit.mockReset().mockResolvedValue(undefined);
    toastError.mockReset();
  });

  it('saves an outflow through the dialog form logic', async () => {
    const row = renderRow();
    fireEvent.change(screen.getByLabelText('outflow'), { target: { value: '25000' } });
    row.rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(form.state).toMatchObject({
      transactionType: 'outflow',
      selectedFromAccount: '1',
      amount: 25000,
    });
    await vi.waitFor(() => expect(form.handleSubmit).toHaveBeenCalledWith(false));
  });

  it('turns a transfer payee plus an inflow into a transfer from the other account', () => {
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer: Savings' }));
    fireEvent.change(screen.getByLabelText('inflow'), { target: { value: '10000' } });
    expect(form.state).toMatchObject({
      transactionType: 'transfer',
      selectedFromAccount: '2',
      selectedToAccount: '1',
      amount: 10000,
    });
  });

  it('keeps a cross-currency outflow transfer inline with an editable received amount', () => {
    const row = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer: Euro Card' }));
    fireEvent.change(screen.getByLabelText('outflow'), { target: { value: '5000' } });
    expect(screen.getByText(/Received in Euro Card/)).toBeInTheDocument();
    // Under the Outflow column: the caption spans the leading columns, then Inflow, Outflow.
    expect(screen.getByLabelText('other').closest('td')!.cellIndex).toBe(2);
    fireEvent.change(screen.getByLabelText('other'), { target: { value: '4600' } });
    row.rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(form.state).toMatchObject({
      transactionType: 'transfer',
      selectedFromAccount: '1',
      selectedToAccount: '3',
      amount: 5000,
      receivedAmount: 4600,
    });
    expect(row.onClose).not.toHaveBeenCalled();
  });

  it('estimates what the other account sent for a cross-currency inflow transfer', async () => {
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer: Euro Card' }));
    fireEvent.change(screen.getByLabelText('inflow'), { target: { value: '10000' } });
    expect(screen.getByText(/Sent from Euro Card/)).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(form.state).toMatchObject({
        selectedFromAccount: '3',
        selectedToAccount: '1',
        receivedAmount: 10000,
        amount: 5000,
      })
    );
  });

  it('splits into aligned line rows', () => {
    const row = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    row.rerender();
    expect(screen.getAllByTestId('inline-split-line')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    row.rerender();
    expect(screen.getAllByTestId('inline-split-line')).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove split line' })[0]);
    row.rerender();
    expect(screen.getAllByTestId('inline-split-line')).toHaveLength(2);
  });

  it('refuses both an inflow and an outflow', () => {
    const row = renderRow();
    fireEvent.change(screen.getByLabelText('inflow'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('outflow'), { target: { value: '2000' } });
    row.rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(toastError).toHaveBeenCalled();
    expect(form.handleSubmit).not.toHaveBeenCalled();
  });

  it('Escape closes the row', () => {
    const row = renderRow();
    fireEvent.keyDown(screen.getByLabelText('Memo'), { key: 'Escape' });
    expect(row.onClose).toHaveBeenCalled();
  });
});
