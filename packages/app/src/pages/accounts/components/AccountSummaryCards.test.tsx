import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LiabilityInfo } from '../account-page.utils';
import { AccountSummaryCards } from './AccountSummaryCards';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const stats = { recentCount: 0, totalInflow: 0, totalOutflow: 0 };
const loan = {
  outstanding: 10_000_000,
  apr: 0,
  minPayment: 1_000_000,
  isLiability: true,
} as LiabilityInfo;

describe('AccountSummaryCards', () => {
  it('shows a recovery fallback instead of throwing for unsafe stored money', () => {
    render(
      <AccountSummaryCards
        displayBalanceToday={37_509_668_817_561_350_000}
        displayClearedBalance={2_500}
        transactionStats={{ recentCount: 1, totalInflow: 1_000, totalOutflow: 0 }}
        displayLiabilityInfo={null}
        balanceAccountToday={0}
        formatter={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })}
      />
    );

    expect(screen.getByText('Invalid amount')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.getByText('Cleared').nextElementSibling).toHaveTextContent('$2.50');
  });

  it('shows the payoff row for an outstanding liability', () => {
    render(
      <AccountSummaryCards
        displayBalanceToday={-10_000_000}
        displayClearedBalance={-10_000_000}
        transactionStats={stats}
        displayLiabilityInfo={loan}
        balanceAccountToday={-10_000_000}
        formatter={usd}
      />
    );

    const row = screen.getByRole('button', { name: /payoff plan/i });
    expect(row).toHaveTextContent('$1,000.00/mo');
    expect(screen.queryByText('Paid off - congratulations!')).not.toBeInTheDocument();
  });

  it('shows the paid-off note instead of the payoff row', () => {
    render(
      <AccountSummaryCards
        displayBalanceToday={5_000}
        displayClearedBalance={5_000}
        transactionStats={stats}
        displayLiabilityInfo={loan}
        balanceAccountToday={5_000}
        formatter={usd}
      />
    );

    expect(screen.getByText('Paid off - congratulations!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /payoff plan/i })).not.toBeInTheDocument();
  });
});
