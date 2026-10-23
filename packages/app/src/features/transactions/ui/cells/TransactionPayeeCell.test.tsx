import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, GetTransactionsByAccountRow } from '@budgero/core/browser';
import { TransferConversionProvider } from '@features/transactions/api/transfer-conversion-context';
import { TransactionPayeeCell } from './TransactionPayeeCell';

const linkState = vi.hoisted(() => ({
  data: undefined as
    { warranty: boolean; recurringOccurrence: boolean; bankReview: boolean } | undefined,
  enabledCalls: [] as boolean[],
}));

vi.mock('@entities/payee/api/usePayees', () => ({
  usePayees: () => ({ data: [], isFetching: false }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({ data: undefined }),
}));
vi.mock('@entities/transaction/api/transactionLinks', () => ({
  useTransactionLinks: (_id: number | null, enabled: boolean) => {
    linkState.enabledCalls.push(enabled);
    return { data: enabled ? linkState.data : undefined };
  },
}));

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollIntoView = () => {};
});

const NO_LINKS = { warranty: false, recurringOccurrence: false, bankReview: false };

const accounts = [
  { ID: 1, Name: 'Checking', OnBudget: true, Archived: false },
  { ID: 2, Name: 'Savings', OnBudget: true, Archived: false },
  { ID: 3, Name: 'Brokerage', OnBudget: false, Archived: false },
] as Account[];

const plainRow = {
  ID: 41,
  AccountID: 1,
  Payee: '',
  Category: 'Groceries',
  Reconciled: false,
  TransferID: undefined,
} as unknown as GetTransactionsByAccountRow;

const transferRow = {
  ...plainRow,
  TransferID: 'tr-1',
  TransferAccountName: 'Savings',
  TransferAccountOnBudget: true,
} as unknown as GetTransactionsByAccountRow;

function setup(transaction: GetTransactionsByAccountRow, withActions = true) {
  const actions = { requestConversion: vi.fn(), requestUnlink: vi.fn() };
  const cell = (
    <TransactionPayeeCell
      budgetId={1}
      transaction={transaction}
      accounts={accounts}
      payees={['Landlord']}
      onCommit={vi.fn()}
    />
  );
  render(
    withActions ? (
      <TransferConversionProvider value={actions}>{cell}</TransferConversionProvider>
    ) : (
      cell
    )
  );
  return { actions, user: userEvent.setup() };
}

beforeEach(() => {
  linkState.data = NO_LINKS;
  linkState.enabledCalls = [];
});

describe('TransactionPayeeCell', () => {
  it('is a plain payee picker outside the transactions table', async () => {
    const { user } = setup(plainRow, false);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText(/^Transfer:/)).not.toBeInTheDocument();
    expect(screen.getByText('Landlord')).toBeInTheDocument();
    expect(linkState.enabledCalls.every((enabled) => !enabled)).toBe(true);
  });

  it('lists the other accounts and routes a pick to the conversion actions', async () => {
    const { user, actions } = setup(plainRow);

    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByText('Transfer: Checking')).not.toBeInTheDocument();
    await user.click(screen.getByText('Transfer: Savings'));

    expect(actions.requestConversion).toHaveBeenCalledExactlyOnceWith(41, 2);
  });

  it('does not look up links until the picker is opened', () => {
    setup(plainRow);

    expect(linkState.enabledCalls.every((enabled) => !enabled)).toBe(true);
  });

  it.each([
    ['a warranty', { ...NO_LINKS, warranty: true }],
    ['a recurring occurrence', { ...NO_LINKS, recurringOccurrence: true }],
    ['a bank review', { ...NO_LINKS, bankReview: true }],
  ])('does not offer conversion on a row linked to %s', async (_label, links) => {
    linkState.data = links;
    const { user } = setup(plainRow);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText(/^Transfer:/)).not.toBeInTheDocument();
    expect(screen.getByText('Landlord')).toBeInTheDocument();
  });

  it('waits for the links lookup before offering conversion', async () => {
    linkState.data = undefined;
    const { user } = setup(plainRow);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText(/^Transfer:/)).not.toBeInTheDocument();
  });

  it('offers to convert an existing transfer back, and routes the action', async () => {
    const { user, actions } = setup(transferRow);

    expect(screen.getByRole('combobox')).toHaveTextContent('Transfer: Savings');
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Convert to regular transaction'));

    expect(actions.requestUnlink).toHaveBeenCalledExactlyOnceWith(41);
  });

  it('keeps showing the partner but hides convert-back when the transfer has links', async () => {
    linkState.data = { ...NO_LINKS, warranty: true };
    const { user } = setup(transferRow);

    expect(screen.getByRole('combobox')).toHaveTextContent('Transfer: Savings');
    await user.click(screen.getByRole('combobox'));

    // The partner is still listed as the current choice; only the convert-back action is gone.
    expect(screen.getAllByText('Transfer: Savings').length).toBeGreaterThan(0);
    expect(screen.queryByText('Convert to regular transaction')).not.toBeInTheDocument();
  });

  it('hides convert-back on a reconciled transfer', async () => {
    const { user } = setup({ ...transferRow, Reconciled: true } as GetTransactionsByAccountRow);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Convert to regular transaction')).not.toBeInTheDocument();
  });

  it('offers no conversion on split or reconciled plain rows', async () => {
    const { user } = setup({ ...plainRow, Category: 'Split' } as GetTransactionsByAccountRow);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText(/^Transfer:/)).not.toBeInTheDocument();
  });
});
