import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { SquarePen } from 'lucide-react';
import type { QuestionRouteState } from '@pages/reports/question/useOpenSavedQuestion';
import { Button } from '@shared/ui/button';
import { BackToReports } from '@pages/reports/BackToReports';
import { useAnalyticsPageState, type ReportKey } from './analytics-state';
import { useAnalyticsData } from './useAnalyticsData';
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar';
import { REPORT_ORDER, reportMeta } from './report-questions';
import { prebuiltQuestion } from './prebuilt-question';
import { WealthReport } from './reports/WealthReport';
import { SpendingReport } from './reports/SpendingReport';
import { InOutReport } from './reports/InOutReport';
import { FlowReport } from './reports/FlowReport';
import { PlanRealityReport } from './reports/PlanRealityReport';
import { ScenarioReport } from './reports/ScenarioReport';
import { VsExpenseReport } from './reports/VsExpenseReport';

/** Wealth is account-scoped; everything else takes the full filter set. */
const CATEGORY_FILTER_REPORTS = new Set<ReportKey>([
  'spending',
  'in-out',
  'money-map',
  'scenario',
  'ledger',
]);

function isReportKey(value: string | undefined): value is ReportKey {
  return REPORT_ORDER.includes(value as ReportKey);
}

/** /reports/prebuilt/:reportKey — one prebuilt report, full page, with its filters. */
export default function PrebuiltReportPage() {
  const { reportKey } = useParams<{ reportKey: string }>();
  if (!isReportKey(reportKey)) return <Navigate to="/reports" replace />;
  return <PrebuiltReport key={reportKey} report={reportKey} />;
}

function PrebuiltReport({ report }: { report: ReportKey }) {
  const { t } = useLingui();
  const state = useAnalyticsPageState();
  const data = useAnalyticsData(state.filters);

  const earliestMonth = useMemo(() => {
    let earliest: string | null = null;
    for (const txn of data.allTxns) {
      if (earliest === null || txn.monthKey < earliest) earliest = txn.monthKey;
    }
    return earliest;
  }, [data.allTxns]);

  const months = useMemo(() => state.monthsFor(earliestMonth), [state, earliestMonth]);
  const navigate = useNavigate();
  const asQuestion = prebuiltQuestion(report, state.selections);

  return (
    <div className="w-full space-y-4 p-4 pb-24 sm:p-6 md:pb-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <BackToReports />
          <h1 className="text-sm font-medium text-muted-foreground">{reportMeta(report).label}</h1>
        </div>
        {asQuestion && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const routeState: QuestionRouteState = {
                startSpec: asQuestion.spec,
                startName: asQuestion.name,
              };
              void navigate('/reports/question/new', { state: routeState });
            }}
            title={t`Open this report in the question editor, with its filters, to change it`}
          >
            <SquarePen className="h-4 w-4" aria-hidden />
            <Trans>Open as question</Trans>
          </Button>
        )}
      </div>

      <AnalyticsFilterBar
        state={state}
        data={data}
        showCategoryFilters={CATEGORY_FILTER_REPORTS.has(report)}
      />

      <div>
        {report === 'wealth' && (
          <WealthReport data={data} months={months} accountIds={state.selections.accountIds} />
        )}
        {report === 'spending' && <SpendingReport data={data} months={months} />}
        {report === 'in-out' && <InOutReport data={data} months={months} />}
        {report === 'plan' && <PlanRealityReport data={data} months={months} />}
        {report === 'money-map' && <FlowReport data={data} months={months} />}
        {report === 'scenario' && (
          <ScenarioReport data={data} months={months} accountIds={state.selections.accountIds} />
        )}
        {report === 'ledger' && (
          <VsExpenseReport
            data={data}
            months={months}
            accountIds={state.selections.accountIds}
            categoryIds={state.selections.categoryIds}
          />
        )}
      </div>
    </div>
  );
}
