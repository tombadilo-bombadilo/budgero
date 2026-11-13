import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomDashboard, UnifiedReport } from '@budgero/core/browser';
import { buildSavedQuestionQuery, createQuestion } from '@features/reports/lib/question';
import { AddToDashboardDialog } from './AddToDashboardDialog';

const addChart = vi.hoisted(() =>
  vi.fn(async ({ reportId }: { reportId: string }) => ({
    id: reportId,
    charts: [{ id: 'new-table' }],
  }))
);
vi.mock('@entities/report/api/useReports', () => ({
  useAddChartToReport: () => ({ mutateAsync: addChart }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const chart = (id: string) => ({
  id,
  chartType: 'bar' as const,
  xAxisColumn: 'x',
  yAxisColumn: 'y',
  aggregateFunction: 'SUM' as const,
});
const report = (patch: Partial<UnifiedReport>): UnifiedReport => ({
  id: 'r',
  name: 'Q',
  query: 'SELECT 1',
  charts: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...patch,
});
const notebook = report({
  id: 'n',
  name: 'Spending this month',
  updatedAt: '2026-03-01',
  query: buildSavedQuestionQuery(
    createQuestion('transactions', { aggregations: [{ op: 'spending' }] }),
    'SELECT 1'
  ),
  charts: [chart('n1')],
});
const legacy = report({
  id: 's',
  name: 'Old SQL',
  updatedAt: '2026-02-01',
  charts: [chart('s1'), chart('s2')],
});
const bare = report({ id: 'b', name: 'Plain rows' });
const dashboard = { id: 'd1', name: 'Home' } as CustomDashboard;

function renderPicker(onSubmit = vi.fn(async () => undefined)) {
  render(
    <AddToDashboardDialog
      open
      onOpenChange={() => undefined}
      questions={[bare, legacy, notebook]}
      dashboards={[dashboard]}
      dashboardId="d1"
      title="Add a question"
      description="Pick one"
      confirmLabel="Add to dashboard"
      onSubmit={onSubmit}
    />
  );
  return onSubmit;
}

describe('AddToDashboardDialog', () => {
  it('lists questions newest first and adds the notebook question’s one chart', async () => {
    const user = userEvent.setup();
    const onSubmit = renderPicker();
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Spending this month'),
      expect.stringContaining('Old SQL'),
      expect.stringContaining('Plain rows'),
    ]);
    // One chart: no chart choice.
    expect(screen.queryByText('Which chart of this SQL question')).toBeNull();
    await user.type(screen.getByLabelText('Title on the dashboard (optional)'), 'Mine');
    await user.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    expect(onSubmit).toHaveBeenCalledWith({
      dashboardId: 'd1',
      reportId: 'n',
      chartId: 'n1',
      titleOverride: 'Mine',
    });
  });

  it('offers the chart choice only for an SQL question with several charts', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('option', { name: /Old SQL/ }));
    expect(screen.getByText('Which chart of this SQL question')).toBeInTheDocument();
  });

  it('adds an SQL question without a chart as a table of its rows', async () => {
    const user = userEvent.setup();
    const onSubmit = renderPicker();
    await user.click(screen.getByRole('option', { name: /Plain rows/ }));
    expect(screen.getByText(/shows its rows as a table/)).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to dashboard' })
    );
    expect(addChart).toHaveBeenCalledWith({
      reportId: 'b',
      chart: { chartType: 'table', xAxisColumn: '', yAxisColumn: '', aggregateFunction: 'SUM' },
    });
    expect(onSubmit).toHaveBeenCalledWith({
      dashboardId: 'd1',
      reportId: 'b',
      chartId: 'new-table',
    });
  });

  it('shows a home copy by its name without the internal tag', () => {
    render(
      <AddToDashboardDialog
        open
        onOpenChange={() => undefined}
        questions={[notebook]}
        question={notebook}
        dashboards={[
          { id: 'h1', name: 'Home ·a1b2', origin: 'home_default' } as CustomDashboard,
          { id: 'd2', name: 'Travel ·x9y8', origin: null } as CustomDashboard,
        ]}
        title="Add to dashboard"
        description="Pick one"
        confirmLabel="Add to dashboard"
        onSubmit={vi.fn(async () => undefined)}
      />
    );
    const picker = screen.getByLabelText('Dashboard');
    expect(picker.textContent).toBe('Home');
    expect(document.body.textContent).not.toContain('·a1b2');
  });
});
