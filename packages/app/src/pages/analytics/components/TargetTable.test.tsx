import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildTargetReport } from '../target-report';
import { TargetTable } from './TargetTable';
import { GoalFundingList } from './GoalFundingList';

const report = buildTargetReport([
  {
    monthKey: '2026-10',
    rows: [
      {
        categoryId: 1,
        category: 'Rent',
        group: 'Bills',
        assigned: 100_000,
        spent: 0,
        target: 100_000,
        funded: 100_000,
      },
      {
        categoryId: 2,
        category: 'Phone',
        group: 'Bills',
        assigned: 0,
        spent: 0,
        target: null,
        funded: 0,
      },
      {
        categoryId: 3,
        category: 'Travel',
        group: 'Fun',
        assigned: 0,
        spent: 0,
        target: 50_000,
        funded: 0,
      },
    ],
  },
]);
const money = (milli: number) => `$${(milli / 1000).toFixed(2)}`;

describe('TargetTable', () => {
  it('starts with groups folded and unfolds one on click', async () => {
    const user = userEvent.setup();
    render(<TargetTable report={report} money={money} monthCount={1} isLoading={false} />);
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.queryByText('Rent')).toBeNull();

    await user.click(screen.getByText('Bills'));
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.queryByText('Travel')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('Travel')).toBeInTheDocument();
  });
});

describe('GoalFundingList', () => {
  it('lists only groups with goals, folded, and opens to their goals', async () => {
    const user = userEvent.setup();
    render(
      <GoalFundingList
        groups={report.groups}
        money={money}
        positiveColor="green"
        progressColor="blue"
      />
    );
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Fun')).toBeInTheDocument();
    expect(screen.queryByText('Rent')).toBeNull();

    await user.click(screen.getByText('Bills'));
    expect(screen.getByText('Rent')).toBeInTheDocument();
    // Categories without a goal stay out of the funding list.
    expect(screen.queryByText('Phone')).toBeNull();
  });
});
