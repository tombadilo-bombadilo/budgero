import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { asMilli } from '@budgero/core/browser';
import { AvailableInfoPopover } from './AvailableInfoPopover';
import type { BudgetRow } from '../lib/budget-transforms';

vi.mock('@features/budget-planning/lib/useFormatMaskedMilli', () => ({
  useFormatMaskedMilli: () => (amount: number) => (amount / 1000).toFixed(2),
}));
vi.mock('@entities/budget/api/useMonthlyBudget', () => ({
  useUpsertAssignment: () => ({ mutate: vi.fn() }),
}));

// Radix Tooltip measures its arrow; jsdom has no ResizeObserver.
class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverMock,
  });
});

const card = (overrides: Partial<BudgetRow>): BudgetRow => ({
  id: 'card',
  name: 'Card',
  assigned: asMilli(0),
  activity: asMilli(0),
  available: asMilli(0),
  totalTransactions: 0,
  isGroup: false,
  categoryId: 7,
  fundingBreakdown: [],
  ...overrides,
});

const renderPopover = (item: BudgetRow) =>
  render(<AvailableInfoPopover item={item} globalLocalizer={new Intl.NumberFormat('en-US')} />);

describe('AvailableInfoPopover CC payment status', () => {
  it('shows one amber warning for an underfunded card and the details on click', async () => {
    const user = userEvent.setup();
    renderPopover(
      card({
        available: asMilli(10_000),
        cardBalance: asMilli(-42_000),
        debtBreakdown: [
          { categoryId: 1, categoryName: 'Groceries', month: '2026-08', amount: asMilli(42_000) },
        ],
      })
    );

    // A single trigger whose accessible name carries the amount.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const trigger = screen.getByRole('button', { name: 'Underfunded 32.00 — details' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'CC Payment Calculation' });
    expect(within(dialog).getByText('Underfunded by 32.00')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      'The card owes 42.00 but only 10.00 is set aside to pay it. Assign 32.00 here to cover it.'
    );
    expect(within(dialog).getByText('Groceries')).toBeInTheDocument();
    expect(within(dialog).getByText('Still underfunded').parentElement).toHaveTextContent('32.00');
    // The usual calculation is still there below the warning.
    expect(within(dialog).getByText('Available for payment:')).toBeInTheDocument();
  });

  it('opens from the keyboard and shows the short status as a tooltip on focus', async () => {
    const user = userEvent.setup();
    renderPopover(card({ cardBalance: asMilli(-5_000) }));

    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Underfunded 5.00 — details' });
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Underfunded 5.00');

    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toHaveTextContent('Underfunded by 5.00');
    // The tooltip steps aside while the popover is open.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('uses the same warning slot for an over-assigned card', async () => {
    const user = userEvent.setup();
    renderPopover(card({ available: asMilli(9_000), cardBalance: asMilli(-4_000) }));

    await user.click(screen.getByRole('button', { name: 'Over-assigned by 5.00 — details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Over-assigned by 5.00')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Underfunded/)).not.toBeInTheDocument();
  });

  it('keeps the neutral info trigger when the card is funded exactly', () => {
    renderPopover(card({ available: asMilli(4_000), cardBalance: asMilli(-4_000) }));
    expect(
      screen.getByRole('button', { name: 'Available calculation details' })
    ).toBeInTheDocument();
  });
});
