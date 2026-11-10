import { cleanup, render, screen } from '@testing-library/react';
import { normalizeQuestion, questionColumns } from '@features/reports/lib/question';
import { TrendNumberView } from './TrendNumberView';

vi.mock('@shared/ui/echart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const queryCalls = vi.hoisted(() => [] as { enabled?: boolean; spec: unknown }[]);
vi.mock('../useQuestionQuery', () => ({
  useQuestionQuery: (args: { enabled?: boolean; spec: unknown }) => {
    queryCalls.push(args);
    return {
      compiled: null,
      compileError: null,
      result: { columns: ['spending', 'count'], rows: [[50, 5]], rowCount: 1, executionTime: 1 },
      resultCompiled: null,
      error: null,
      isRunning: false,
    };
  },
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

  it('runs the previous period once for all metrics', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }, { op: 'count' }],
      filters: [{ field: 'date', op: 'between', values: ['2026-03-01', '2026-03-31'] }],
    });
    queryCalls.length = 0;
    render(
      <TrendNumberView
        result={{ columns: ['spending', 'count'], rows: [[100, 4]], rowCount: 1, executionTime: 1 }}
        columns={questionColumns(spec)}
        source="transactions"
        spec={spec}
      />
    );
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    // One hook call per render, not one per metric tile.
    const enabled = queryCalls.filter((call) => call.enabled !== false);
    expect(enabled.length).toBeGreaterThan(0);
    expect(new Set(enabled.map((call) => call.spec)).size).toBe(1);
    expect(queryCalls).toHaveLength(1);
  });

  it('does not run anything without a date filter to compare', () => {
    queryCalls.length = 0;
    render(
      <TrendNumberView result={rows} columns={questionColumns(monthly)} source="transactions" />
    );
    expect(queryCalls.every((call) => call.enabled === false)).toBe(true);
  });
});
