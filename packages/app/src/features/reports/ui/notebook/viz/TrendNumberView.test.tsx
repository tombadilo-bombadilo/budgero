import { cleanup, render, screen } from '@testing-library/react';
import { normalizeQuestion, questionColumns } from '@features/reports/lib/question';
import { TrendNumberView } from './TrendNumberView';

vi.mock('@shared/ui/echart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

afterEach(cleanup);

const monthly = normalizeQuestion({
  source: 'transactions',
  aggregations: [{ op: 'spending' }],
  breakouts: [{ field: 'date', bucket: 'month' }],
});
const rows = {
  columns: ['month', 'spending'],
  rows: [
    ['2026-01', 80],
    ['2026-03', 120],
    ['2026-02', 100],
  ],
  rowCount: 3,
  executionTime: 1,
};

describe('TrendNumberView', () => {
  it('shows the latest month, its change vs the month before and a sparkline', () => {
    render(
      <TrendNumberView result={rows} columns={questionColumns(monthly)} source="transactions" />
    );
    expect(screen.getByText(/March 2026/)).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('+20.0%')).toBeInTheDocument();
    expect(screen.getByText(/\+\$20\.00 · vs February 2026/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Trend' })).toBeInTheDocument();
  });

  it('shows goal progress', () => {
    render(
      <TrendNumberView
        result={rows}
        columns={questionColumns(monthly)}
        source="transactions"
        display={{ goal: 200 }}
      />
    );
    expect(screen.getByText('60% of the $200.00 goal')).toBeInTheDocument();
  });

  it('says when there is nothing to compare with', () => {
    render(
      <TrendNumberView
        result={{ ...rows, rows: [['2026-03', 50]], rowCount: 1 }}
        columns={questionColumns(monthly)}
        source="transactions"
      />
    );
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('No earlier period to compare with.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Trend' })).not.toBeInTheDocument();
  });
});
