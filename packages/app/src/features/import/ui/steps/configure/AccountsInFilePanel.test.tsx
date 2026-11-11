import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { planAccountRoutes } from '@features/import/lib/account-routes';
import { DEFAULT_IMPORT_CONFIG, type ImportConfig } from '@features/import/model/types';
import { AccountsInFilePanel } from './AccountsInFilePanel';

afterEach(cleanup);

const accounts = [{ ID: 1, Name: 'Checking', Currency: 'USD' }];

function renderPanel(
  config: ImportConfig,
  rows: Record<string, string>[],
  budgetAccounts: { ID: number; Name: string; Currency: string; Archived?: boolean }[] = accounts
) {
  const onImportConfigChange = vi.fn();
  const plan = planAccountRoutes({
    rows,
    column: 'Account',
    accounts: budgetAccounts,
    chosen: config.accountRoutes,
    newAccountCurrency: 'EUR',
  });
  render(
    <AccountsInFilePanel
      plan={plan}
      column="Account"
      accounts={budgetAccounts}
      importConfig={config}
      onImportConfigChange={onImportConfigChange}
    />
  );
  return onImportConfigChange;
}

describe('accounts in this file', () => {
  it('derives defaults without writing them back, and stores only what the user types', () => {
    const onChange = renderPanel(DEFAULT_IMPORT_CONFIG, [
      { Account: 'checking' },
      { Account: 'Visa' },
    ]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('New account in EUR')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New account name for Visa'), {
      target: { value: 'Card' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ accountRoutes: { Visa: { kind: 'new', name: 'Card' } } })
    );
  });

  it('explains a taken name and marks the field invalid', () => {
    renderPanel(
      { ...DEFAULT_IMPORT_CONFIG, accountRoutes: { Visa: { kind: 'new', name: 'Checking' } } },
      [{ Account: 'Visa' }]
    );
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByLabelText('New account name for Visa')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });

  it('asks for an account when there is nothing to default to', () => {
    renderPanel(DEFAULT_IMPORT_CONFIG, [{ Account: 'DE89 3704' }]);
    expect(screen.getByRole('alert')).toHaveTextContent('Pick the account');
    expect(screen.getByLabelText('Account for DE89 3704')).toHaveAttribute('aria-invalid', 'true');
  });

  it('lists every account that needs a choice, even past the cap', () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({ Account: `Acct ${i + 1}` }));
    renderPanel(DEFAULT_IMPORT_CONFIG, rows, [
      ...accounts,
      { ID: 2, Name: 'Acct 53', Currency: 'USD', Archived: true },
    ]);
    expect(screen.getByLabelText('Account for Acct 53')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Account for Acct 50')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account for Acct 51')).not.toBeInTheDocument();
    expect(screen.getByText(/^4 more accounts are not listed/)).toBeInTheDocument();
  });
});
