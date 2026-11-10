import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BreakdownTable } from './LedgerTable';

describe('BreakdownTable', () => {
  const money = (milli: number) => `$${(milli / 1000).toFixed(2)}`;

  it('shows amount, share and a trend line per row', () => {
    render(
      <BreakdownTable
        title="Categories"
        nameHeader="Name"
        total={200_000}
        money={money}
        rows={[
          { key: 'a', name: 'Groceries', amount: 150_000, trend: [10, 20, 30] },
          { key: 'b', name: 'Fuel', amount: 50_000, trend: [5] },
        ]}
      />
    );
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    const groceries = screen.getByRole('rowheader', { name: 'Groceries' }).closest('tr')!;
    expect(within(groceries).getByText('$150.00')).toBeInTheDocument();
    expect(within(groceries).getByText('75%')).toBeInTheDocument();
    expect(within(groceries).getByTestId('sparkline')).toBeInTheDocument();
    // A single month has no trend to draw.
    const fuel = screen.getByRole('rowheader', { name: 'Fuel' }).closest('tr')!;
    expect(within(fuel).queryByTestId('sparkline')).not.toBeInTheDocument();
  });

  it('turns drillable rows into disclosure buttons', () => {
    const onSelect = vi.fn();
    render(
      <BreakdownTable
        title="Groups"
        nameHeader="Name"
        total={120_000}
        money={money}
        showTrend={false}
        rows={[{ key: 'other', name: 'Other spending (3 groups)', amount: 120_000, onSelect }]}
      />
    );
    expect(screen.queryByRole('columnheader', { name: 'Monthly trend' })).not.toBeInTheDocument();
    const control = screen.getByRole('button', { name: /Other spending/ });
    expect(control).not.toHaveAttribute('aria-expanded');
    fireEvent.click(control);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
