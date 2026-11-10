import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compileQuestion, normalizeQuestion } from '@features/reports/lib/question';
import { QuestionResult } from './QuestionResult';
import type { QuestionQueryState } from './useQuestionQuery';

vi.mock('@shared/ui/echart', () => ({ EChart: () => null }));

afterEach(cleanup);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const spec = normalizeQuestion({
  source: 'transactions',
  aggregations: [{ op: 'spending' }],
  breakouts: [{ field: 'payee' }],
});
const compiled = compileQuestion(spec, { budgetId: 1, chartId: 'q' });
// Long names: auto turns the bar chart into a row chart.
const query: QuestionQueryState = {
  compiled,
  compileError: null,
  result: {
    columns: ['payee', 'spending'],
    rows: [['The supermarket around the corner', 10]],
    rowCount: 1,
    executionTime: 1,
  },
  resultCompiled: compiled,
  error: null,
  isRunning: false,
};

describe('QuestionResult', () => {
  it('lets Bar be picked when auto shows rows', async () => {
    const user = userEvent.setup();
    const onVisualizationChange = vi.fn();
    render(
      <QuestionResult
        spec={spec}
        query={query}
        onVisualizationChange={onVisualizationChange}
        onStackingChange={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Chart type' }));
    expect(screen.getByRole('radio', { name: 'Row' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'Bar' }));
    expect(onVisualizationChange).toHaveBeenCalledWith('bar');
  });

  it('shows a friendly error with the raw message behind Details', () => {
    render(
      <QuestionResult
        spec={spec}
        query={{ ...query, result: null, error: 'Binder Error: Referenced column "x" not found' }}
        onVisualizationChange={vi.fn()}
        onStackingChange={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('column or table that isn’t available');
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText(/Binder Error/)).not.toBeVisible();
  });
});
