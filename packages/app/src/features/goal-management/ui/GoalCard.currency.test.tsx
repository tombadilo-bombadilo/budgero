import { render, screen } from '@testing-library/react';
import { GoalPurpose, GoalType, type Goal } from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';
import { GoalCard } from './GoalCard';

// Budget in USD; the goal is €1,000 at 1.10 USD per EUR.
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const goal: Goal = {
  ID: 1,
  CategoryID: 1,
  Purpose: GoalPurpose.SPENDING,
  Type: GoalType.MONTHLY,
  Target: asMilli(1_000_000),
  StartDate: '2026-09-01',
  TargetCurrency: 'EUR',
  TargetConverted: asMilli(1_100_000),
  TargetRateSource: 'official',
};
const props = {
  categoryName: 'Trip',
  currentMonth: '2026-09',
  formatter,
  finances: { available: 600_000, assigned: 600_000, activity: 0 },
};

describe('GoalCard: goal in another currency', () => {
  it('shows the target in its currency with the budget-currency amount, and measures against that', () => {
    render(<GoalCard {...props} goal={goal} />);
    const target = screen.getByTestId('goal-card-target');
    expect(target.textContent).toContain('€1,000.00');
    expect(target.textContent).toContain('$1,100.00');
    expect(screen.getByTestId('goal-card-currency-note')).toHaveTextContent(
      "Goal set in EUR, converted at today's rate."
    );
    // $1,100 − $600 available.
    expect(document.body).toHaveTextContent('Need $500.00 more available');
  });

  it('says when no rate is known yet', () => {
    render(
      <GoalCard
        {...props}
        goal={{ ...goal, TargetConverted: asMilli(1_000_000), TargetRateSource: 'missing' }}
      />
    );
    expect(screen.getByTestId('goal-card-currency-note')).toHaveTextContent(
      'No EUR exchange rate yet'
    );
  });

  it('a budget-currency goal reads as before', () => {
    render(
      <GoalCard
        {...props}
        goal={{
          ...goal,
          TargetCurrency: null,
          TargetConverted: undefined,
          TargetRateSource: undefined,
        }}
      />
    );
    expect(screen.getByTestId('goal-card-target')).toHaveTextContent('of $1,000.00');
    expect(screen.queryByTestId('goal-card-currency-note')).not.toBeInTheDocument();
  });

  it('the compact row shows a currency badge', () => {
    render(<GoalCard {...props} goal={goal} compact />);
    expect(screen.getByTestId('goal-card-currency-badge')).toHaveTextContent('EUR');
  });
});
