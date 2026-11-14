import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PrebuiltReportPage from './PrebuiltReportPage';

const track = vi.hoisted(() => vi.fn());
vi.mock('@shared/lib/analytics/track', () => ({ track }));
vi.mock('./analytics-state', () => ({
  useAnalyticsPageState: () => ({ filters: {}, selections: {}, monthsFor: () => [] }),
}));
vi.mock('./useAnalyticsData', () => ({ useAnalyticsData: () => ({ allTxns: [] }) }));
vi.mock('./components/AnalyticsFilterBar', () => ({ AnalyticsFilterBar: () => null }));
vi.mock('./prebuilt-question', () => ({ prebuiltQuestion: () => null }));
vi.mock('@pages/reports/BackToReports', () => ({ BackToReports: () => null }));
vi.mock('./reports/WealthReport', () => ({ WealthReport: () => null }));
vi.mock('./reports/SpendingReport', () => ({ SpendingReport: () => null }));
vi.mock('./reports/InOutReport', () => ({ InOutReport: () => null }));
vi.mock('./reports/FlowReport', () => ({ FlowReport: () => null }));
vi.mock('./reports/PlanRealityReport', () => ({ PlanRealityReport: () => null }));
vi.mock('./reports/ScenarioReport', () => ({ ScenarioReport: () => null }));
vi.mock('./reports/VsExpenseReport', () => ({ VsExpenseReport: () => null }));

afterEach(() => {
  cleanup();
  track.mockReset();
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/prebuilt/:reportKey" element={<PrebuiltReportPage />} />
        <Route path="/reports" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PrebuiltReportPage analytics', () => {
  it('counts opening a prebuilt report, with its key', () => {
    renderAt('/reports/prebuilt/money-map');
    expect(track.mock.calls).toEqual([
      ['report_opened', { kind: 'prebuilt', report: 'money-map' }],
    ]);
  });

  it('sends nothing for an unknown report', () => {
    renderAt('/reports/prebuilt/nope');
    expect(track).not.toHaveBeenCalled();
  });
});
