import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { UnifiedReport } from '@budgero/core/browser';
import {
  buildSavedBuilderQuery,
  compileReportSpec,
  createDefaultSpec,
} from '@features/reports/lib/report-builder';

const builderSpec = createDefaultSpec({ measure: 'net', groupBy: 'month', chartType: 'line' });
const builderSql = compileReportSpec(builderSpec, { budgetId: 1 }).sql;
const builderReport: UnifiedReport = {
  id: 'r-builder',
  name: 'Net by month',
  query: buildSavedBuilderQuery(builderSpec, builderSql),
  charts: [
    {
      id: 'chart-1',
      chartType: 'line',
      xAxisColumn: 'label',
      yAxisColumn: 'value',
      aggregateFunction: 'SUM',
    },
  ],
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};
const sqlReport: UnifiedReport = {
  id: 'r-sql',
  name: 'Plain SQL',
  query: 'SELECT 1 AS x',
  charts: [],
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const explorer = {
  sqlQuery: '',
  savedReports: [builderReport, sqlReport],
  setSqlQuery: vi.fn(),
  setEditingReport: vi.fn(),
  setSelectedChartConfig: vi.fn(),
  setShowReportsDialog: vi.fn(),
  setShowSaveReportDialog: vi.fn(),
  setSidebarOpen: vi.fn(),
  executeQuery: vi.fn(() => Promise.resolve()),
  handleLoadReport: vi.fn(),
  handleEditReport: vi.fn(),
};

vi.mock('./hooks/useExplorerState', () => ({
  useExplorerState: () => ({
    ...explorer,
    queryResult: null,
    isExecuting: false,
    error: null,
    tableSchema: [],
    expandedTables: new Set(),
    sidebarOpen: false,
    showReportsDialog: false,
    showSaveReportDialog: false,
    editingReport: null,
    selectedChartConfig: null,
    editorTheme: 'light',
    editorModules: null,
    extensions: [],
  }),
}));

vi.mock('./components', () => ({
  SQLEditor: ({ value }: { value: string }) => <pre data-testid="sql-editor">{value}</pre>,
  SchemaSidebar: () => null,
  ResultsTable: () => null,
  ChartsPanel: () => null,
  ReportsPanel: ({
    savedReports,
    onLoadReport,
  }: {
    savedReports: UnifiedReport[];
    onLoadReport: (report: UnifiedReport) => void;
  }) => (
    <div>
      {savedReports.map((report) => (
        <button key={report.id} type="button" onClick={() => onLoadReport(report)}>
          {`load ${report.name}`}
        </button>
      ))}
    </div>
  ),
  ReportBuilderPanel: ({ spec, report }: { spec: unknown; report: UnifiedReport | null }) => (
    <div data-testid="builder-panel">
      <span data-testid="builder-spec">{JSON.stringify(spec)}</span>
      <span data-testid="builder-report">{report?.id ?? 'none'}</span>
    </div>
  ),
}));

vi.mock('@features/custom-dashboards/api/useCustomDashboards', () => ({
  useCustomDashboards: () => ({ data: [], refetch: vi.fn() }),
  useAddDashboardWidget: () => ({ mutateAsync: vi.fn() }),
  useCreateCustomDashboard: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@pages/custom-dashboards/components/PinChartDialog', () => ({
  PinChartDialog: () => null,
}));
vi.mock('@entities/report/api/useReports', () => ({
  useCreateReport: () => ({ mutateAsync: vi.fn() }),
  useUpdateReport: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: { selectedBudget: { ID: number } }) => unknown) =>
    selector({ selectedBudget: { ID: 1 } }),
}));

const { default: ExplorerPage } = await import('./ExplorerPage');

function renderAt(state?: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/reports/explorer', state }]}>
      <ExplorerPage />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ExplorerPage builder mode', () => {
  it('opens in the builder by default', () => {
    renderAt();
    expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'SQL (advanced)' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByTestId('builder-report')).toHaveTextContent('none');
  });

  it('reopens a saved builder report (dashboard "Open in Explorer") in the builder', async () => {
    renderAt({ editReportId: 'r-builder' });

    await waitFor(() =>
      expect(screen.getByTestId('builder-report')).toHaveTextContent('r-builder')
    );
    expect(JSON.parse(screen.getByTestId('builder-spec').textContent ?? '')).toEqual(builderSpec);
    expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('aria-selected', 'true');
    // The SQL tab gets the body without the header, so saving there makes it a SQL report.
    expect(explorer.setSqlQuery).toHaveBeenCalledWith(builderSql);
    expect(explorer.setEditingReport).toHaveBeenCalledWith(builderReport);
    expect(explorer.executeQuery).not.toHaveBeenCalled();
  });

  it('opens a plain SQL report in the SQL tab', async () => {
    renderAt({ editReportId: 'r-sql' });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'SQL (advanced)' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(explorer.setSqlQuery).toHaveBeenCalledWith('SELECT 1 AS x');
    expect(explorer.executeQuery).toHaveBeenCalledWith('SELECT 1 AS x');
  });

  it('loads builder reports from the saved reports list into the builder', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole('tab', { name: 'SQL (advanced)' }));
    await user.click(screen.getByRole('button', { name: 'load Net by month' }));
    expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('builder-report')).toHaveTextContent('r-builder');
    expect(explorer.handleLoadReport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'load Plain SQL' }));
    expect(screen.getByRole('tab', { name: 'SQL (advanced)' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(explorer.handleLoadReport).toHaveBeenCalledWith(sqlReport);
  });
});
