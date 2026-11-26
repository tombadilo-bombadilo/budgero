import { fireEvent, render, screen, within } from '@testing-library/react';
import { GoalPurpose, GoalType, type Goal } from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';
import { GoalCard } from './GoalCard';

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const base = {
  categoryName: 'Groceries',
  currentMonth: '2026-09',
  formatter,
};

function goal(fields: Partial<Goal>): Goal {
  return {
    ID: 1,
    CategoryID: 1,
    Purpose: GoalPurpose.SPENDING,
    Type: GoalType.MONTHLY,
    Target: asMilli(700_000),
    StartDate: '2026-01-01',
    ...fields,
  };
}

const headline = () => screen.getByTestId('goal-card-headline');
const details = () => screen.queryByTestId('goal-card-details');

describe('GoalCard full view layout', () => {
  it('monthly available: one headline, one call to action, only rows that add something', () => {
    // $400 left after spending $200: the month started with $600 of $700, $100 short.
    render(
      <GoalCard
        {...base}
        goal={goal({})}
        finances={{ available: 400_000, assigned: 600_000, activity: -200_000 }}
      />
    );
    expect(headline()).toHaveTextContent('$600.00');
    expect(headline()).toHaveTextContent('86%');
    expect(screen.getByTestId('goal-card-target')).toHaveTextContent('of $700.00');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // The shortfall appears once: in the status line.
    expect(document.body.textContent?.match(/\$100\.00/g)?.length).toBe(1);
    expect(screen.getByTestId('goal-card-status')).toHaveTextContent('Need $100.00 more available');
    expect(document.body).not.toHaveTextContent('Assign $100.00 to reach your target');

    // Target and "Still Needed" are not repeated; balance, assigned and spending are.
    const rows = details()!;
    expect(rows).not.toHaveTextContent('Target Available');
    expect(rows).not.toHaveTextContent('Still Needed');
    expect(rows).toHaveTextContent('Currently Available$400.00');
    expect(rows).toHaveTextContent('Assigned This Month$600.00');
    expect(rows).toHaveTextContent('Activity$200.00');
    // No caption line under each row, and no colons.
    expect(rows).not.toHaveTextContent('Current balance');
    expect(rows).not.toHaveTextContent(':');
    // The caption is still there as a hover hint.
    expect(within(rows).getByText('Currently Available')).toHaveAttribute(
      'title',
      'Current balance'
    );
  });

  it("doesn't repeat the category name under the title", () => {
    render(
      <GoalCard {...base} goal={goal({})} finances={{ available: 0, assigned: 0, activity: 0 }} />
    );
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    expect(screen.getByText('Monthly Available Target')).toBeInTheDocument();
  });

  it('keeps "How it works" closed until asked', () => {
    render(
      <GoalCard {...base} goal={goal({})} finances={{ available: 0, assigned: 0, activity: 0 }} />
    );
    expect(document.body).not.toHaveTextContent('Leftover balance rolls into next month');
    fireEvent.click(screen.getByTestId('goal-card-how-it-works'));
    expect(document.body).toHaveTextContent('Leftover balance rolls into next month');
  });

  it('a funded goal shows the good news once', () => {
    render(
      <GoalCard
        {...base}
        goal={goal({})}
        finances={{ available: 700_000, assigned: 700_000, activity: 0 }}
      />
    );
    expect(screen.getByTestId('goal-card-status')).toHaveTextContent('Target available!');
    expect(document.body).not.toHaveTextContent('Target met — category is fully funded');
    expect(headline()).toHaveTextContent('100%');
  });

  it('monthly allocation: measures this month against the monthly target', () => {
    render(
      <GoalCard
        {...base}
        goal={goal({
          Purpose: GoalPurpose.SAVINGS,
          Type: GoalType.MONTHLY_SAVINGS,
          Target: asMilli(500_000),
        })}
        finances={{ available: 1_300_000, assigned: 300_000, activity: 0 }}
      />
    );
    expect(headline()).toHaveTextContent('$300.00');
    expect(headline()).toHaveTextContent('60%');
    expect(screen.getByTestId('goal-card-target')).toHaveTextContent('of $500.00');
    expect(screen.getByTestId('goal-card-status')).toHaveTextContent(
      'Save $200.00 more this month'
    );
    // The balance it has built up is a detail; this month's amount isn't repeated.
    expect(details()).toHaveTextContent('Total Saved$1,300.00');
    expect(details()).not.toHaveTextContent('Saved This Month');
    expect(details()).not.toHaveTextContent('Still Needed');
  });

  it('target balance: the balance against the target', () => {
    render(
      <GoalCard
        {...base}
        goal={goal({
          Purpose: GoalPurpose.SAVINGS,
          Type: GoalType.TARGET_BALANCE,
          Target: asMilli(5_000_000),
        })}
        finances={{ available: 1_000_000, assigned: 1_000_000, activity: 0 }}
      />
    );
    expect(headline()).toHaveTextContent('$1,000.00');
    expect(headline()).toHaveTextContent('20%');
    expect(screen.getByTestId('goal-card-status')).toHaveTextContent(
      'Need $4,000.00 more available'
    );
    expect(details()).not.toHaveTextContent('Currently Available');
    expect(details()).not.toHaveTextContent('Still Needed');
    expect(details()).toHaveTextContent('Assigned This Month$1,000.00');
  });

  it.each([
    ['allocation', GoalPurpose.SAVINGS, GoalType.TARGET_DATE, 'Yearly Allocation Target'],
    ['available', GoalPurpose.SPENDING, GoalType.YEARLY, 'Yearly Available Target'],
  ])(
    'yearly %s: progress over the whole target, this month in the status line',
    (_name, purpose, type, title) => {
      render(
        <GoalCard
          {...base}
          goal={goal({
            Purpose: purpose,
            Type: type,
            Target: asMilli(1_200_000),
            TargetDate: '2026-12-31',
          })}
          finances={{
            available: 300_000,
            assigned: 100_000,
            activity: 0,
            historicalAssignments: [{ month: '2026-08', amount: 200_000 }],
          }}
        />
      );
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(headline()).toHaveTextContent('$300.00');
      expect(headline()).toHaveTextContent('25%');
      expect(screen.getByTestId('goal-card-target')).toHaveTextContent('of $1,200.00');
      // The status line is about this month; the rest of the gap is a detail row.
      expect(screen.getByTestId('goal-card-status')).toHaveTextContent('this month');
      expect(details()).toHaveTextContent('Still Needed$900.00');
      expect(details()).toHaveTextContent('Target Date');
      expect(details()).toHaveTextContent('Months Remaining');
      expect(document.body.textContent).not.toMatch(/[{}]/);
    }
  );

  it('a repeating goal keeps its cadence badge', () => {
    render(
      <GoalCard
        {...base}
        goal={goal({
          Type: GoalType.YEARLY,
          Target: asMilli(1_200_000),
          TargetDate: '2026-12-31',
          Recurring: true,
          CycleMonths: 6,
        })}
        finances={{ available: 0, assigned: 0, activity: 0 }}
      />
    );
    expect(document.body).toHaveTextContent(/Repeats every 6 months/i);
  });

  it('shows the timeframe when the goal only applies to some months', () => {
    render(
      <GoalCard
        {...base}
        goal={goal({})}
        finances={{ available: 0, assigned: 0, activity: 0 }}
        timeframeLabel="Nov 2026 onwards"
      />
    );
    expect(screen.getByTestId('goal-timeframe-label')).toHaveTextContent(
      'Applies: Nov 2026 onwards'
    );
  });
});
