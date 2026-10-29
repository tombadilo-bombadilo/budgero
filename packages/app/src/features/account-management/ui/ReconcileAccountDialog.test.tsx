import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '@budgero/core/browser';
import { ReconcileAccountDialog } from './ReconcileAccountDialog';

const reconcile = vi.fn();
vi.mock('@entities/transaction/api/useTransactions', () => ({
  useReconcileAccount: () => ({ mutateAsync: reconcile, isPending: false }),
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useCategories: () => ({ data: [{ ID: 11, Name: 'Income', BudgetID: 3 }] }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const account = {
  ID: 7,
  Name: 'Checking',
  Currency: 'USD',
  Type: 'Checking',
  BudgetID: 3,
  BalanceNative: 1250000,
  UnclearedNative: 250000,
} as unknown as Account;

describe('ReconcileAccountDialog', () => {
  it('fills the actual balance from the cleared balance in one click', async () => {
    const user = userEvent.setup();
    render(<ReconcileAccountDialog account={account} budgetId={3} />);

    await user.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(screen.queryByText(/Balances match/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Use the cleared balance as the actual balance' })
    );

    expect(screen.getByText(/Balances match/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconcile Account' })).toBeEnabled();
  });
});

describe('ReconcileAccountDialog sub-cent residue', () => {
  const residueAccount = {
    ...account,
    // 2 milliunits: displays as 0.00 but is not zero.
    BalanceNative: 2,
    UnclearedNative: 0,
    Currency: 'EUR',
  } as unknown as Account;

  it('still writes an adjustment when the entered balance differs by less than a cent', async () => {
    reconcile.mockClear();
    const user = userEvent.setup();
    render(<ReconcileAccountDialog account={residueAccount} budgetId={3} />);

    await user.click(screen.getByRole('button', { name: 'Reconcile' }));
    // The calculator cell shows a display button until clicked.
    fireEvent.click(screen.getByText('0.00').closest('[role="button"]')!);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText(/fraction of a cent/)).toBeInTheDocument();
    expect(screen.queryByText(/Balances match/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reconcile Account' }));

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0].adjustment).toMatchObject({ inflow: 0, outflow: 2 });
  });

  it('does not write an adjustment when the balances are exactly equal', async () => {
    reconcile.mockClear();
    const user = userEvent.setup();
    render(<ReconcileAccountDialog account={residueAccount} budgetId={3} />);

    await user.click(screen.getByRole('button', { name: 'Reconcile' }));
    await user.click(
      screen.getByRole('button', { name: 'Use the cleared balance as the actual balance' })
    );
    expect(screen.getByText(/Balances match/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reconcile Account' }));

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0].adjustment).toBeUndefined();
  });
});
