import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoffSimulator } from './PayoffSimulator';

// jsdom has no layout: skip the drawer's chart and stub ResizeObserver (slider).
vi.mock('@shared/ui/echart', () => ({ EChart: () => null }));
globalThis.ResizeObserver ??= class {
  observe() {}

  unobserve() {}

  disconnect() {}
} as unknown as typeof ResizeObserver;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

describe('PayoffSimulator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 15));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows payment, payoff month and interest in one row', () => {
    // $10,000 at 0% paid $1,000 a month: 10 months, no interest.
    render(
      <PayoffSimulator outstanding={10_000_000} apr={0} formatter={usd} initial={1_000_000} />
    );

    const row = screen.getByRole('button', { name: /payoff plan/i });
    expect(row).toHaveTextContent('$1,000.00/mo');
    expect(row).toHaveTextContent('Nov 2026 · 10 months');
    expect(row).toHaveTextContent('Interest (from now)$0.00');
    expect(row).toHaveTextContent('Adjust');
  });

  it('opens the payment plan drawer when the row is clicked', async () => {
    const user = userEvent.setup();
    render(
      <PayoffSimulator outstanding={10_000_000} apr={0} formatter={usd} initial={1_000_000} />
    );

    expect(screen.queryByText('Payment Plan')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /payoff plan/i }));
    expect(await screen.findByText('Payment Plan')).toBeInTheDocument();
    expect(screen.getByText(/Estimates assume fixed payments/)).toBeInTheDocument();
  });

  it('says the payment is too low when it never pays the debt off', () => {
    // 24% APR on $10,000 is $200 interest a month; $100 never pays it down.
    render(<PayoffSimulator outstanding={10_000_000} apr={24} formatter={usd} initial={100_000} />);

    const row = screen.getByRole('button', { name: /payoff plan/i });
    expect(row).toHaveTextContent('$100.00/mo');
    expect(row).toHaveTextContent('Payment too low');
    expect(row).not.toHaveTextContent('Payoff date');
    expect(row).not.toHaveTextContent('Interest (from now)');
  });
});
