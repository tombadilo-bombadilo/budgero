import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { buildCurrencyLocalizer } from '@shared/store/useUiStore';
import { AccountGroupSection } from './AccountGroupSection';

vi.mock('./AccountSparkline', () => ({ AccountSparkline: () => null }));

const eur = buildCurrencyLocalizer('EUR', '1.096,56 $')!;
const formatCurrency = (value: number) => eur.format(value / 1000);
const formatInCurrency = (currency: string, value: number) =>
  buildCurrencyLocalizer(currency, '1.096,56 $')!.format(value / 1000);

function renderGroup(
  accounts: Parameters<typeof AccountGroupSection>[0]['accounts'],
  extra: Partial<Parameters<typeof AccountGroupSection>[0]> = {}
) {
  return render(
    <MemoryRouter>
      <AccountGroupSection
        title="Cash"
        accounts={accounts}
        isOpen
        onToggle={() => {}}
        trend={{ change: 0, percentage: 0 }}
        periodLabel="1 month"
        periodMonths={1}
        chartColor="red"
        formatCurrency={formatCurrency}
        budgetCurrency="EUR"
        formatInCurrency={formatInCurrency}
        {...extra}
      />
    </MemoryRouter>
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('a')!;

describe('AccountGroupSection balances', () => {
  it('leads with the native balance of a foreign-currency account, in its own format', () => {
    renderGroup([
      {
        ID: 1,
        Name: 'Chase',
        Currency: 'USD',
        Balance: 1_234_560,
        BalanceNative: 1_234_560,
        BalanceConverted: 1_100_000,
      },
    ]);
    const row = within(rowOf('Chase'));
    expect(row.getByTestId('account-native-balance').textContent).toContain(
      formatInCurrency('USD', 1_234_560)
    );
    // The budget-currency equivalent stays visible as secondary text.
    expect(row.getByTestId('account-converted-balance').textContent).toContain(
      formatCurrency(1_100_000)
    );
    expect(formatInCurrency('USD', 1_234_560)).not.toEqual(formatCurrency(1_234_560));
  });

  it('shows budget-currency accounts once, in the budget currency', () => {
    renderGroup([
      {
        ID: 2,
        Name: 'Checking',
        Currency: 'EUR',
        BalanceNative: 500_000,
        BalanceConverted: 500_000,
      },
    ]);
    const row = within(rowOf('Checking'));
    expect(row.queryByTestId('account-native-balance')).toBeNull();
    expect(rowOf('Checking').textContent).toContain(formatCurrency(500_000));
  });

  it('keeps the group total in the budget currency', () => {
    renderGroup([
      {
        ID: 1,
        Name: 'Chase',
        Currency: 'USD',
        BalanceNative: 1_000_000,
        BalanceConverted: 900_000,
      },
      {
        ID: 2,
        Name: 'Checking',
        Currency: 'EUR',
        BalanceNative: 100_000,
        BalanceConverted: 100_000,
      },
    ]);
    // Header total: 900 + 100 converted, not 1,000 USD + 100 EUR native.
    expect(screen.getByTestId('account-group-total').textContent).toBe(formatCurrency(1_000_000));
  });

  it('shows liabilities as positive amounts in both currencies', () => {
    renderGroup(
      [
        {
          ID: 3,
          Name: 'Amex',
          Currency: 'USD',
          Balance: -250_000,
          BalanceNative: -250_000,
          BalanceConverted: -230_000,
        },
      ],
      { isLiability: true }
    );
    const row = within(rowOf('Amex'));
    expect(row.getByTestId('account-native-balance').textContent).toContain(
      formatInCurrency('USD', 250_000)
    );
    expect(row.getByTestId('account-converted-balance').textContent).toContain(
      formatCurrency(230_000)
    );
  });

  it('formats crypto accounts with the coin format', () => {
    renderGroup([
      {
        ID: 4,
        Name: 'Wallet',
        Currency: 'BTC',
        Balance: 50_000_000,
        BalanceNative: 50_000_000,
        BalanceConverted: 30_000_000,
      },
    ]);
    const row = within(rowOf('Wallet'));
    expect(row.getByTestId('account-native-balance').textContent).toContain('0,5 BTC');
  });
});
