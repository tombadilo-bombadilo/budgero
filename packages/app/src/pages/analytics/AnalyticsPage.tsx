import { Trans } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { useAnalyticsPageState, type ReportKey } from './analytics-state';
import { useAnalyticsData } from './useAnalyticsData';
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar';
import { ReportPicker } from './components/ReportPicker';
import { REPORT_PANEL_ID, reportTabId } from './report-questions';
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

export default function AnalyticsPage() {
  const [report, setReport] = useState<ReportKey>('wealth');
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

  return (
    <div className="w-full space-y-4 p-4 pb-24 sm:p-6 md:pb-6">
      <h1 className="text-sm font-medium text-muted-foreground">
        <Trans>Prebuilt reports</Trans>
      </h1>

      <ReportPicker value={report} onChange={setReport} />

      <AnalyticsFilterBar
        state={state}
        data={data}
        showCategoryFilters={CATEGORY_FILTER_REPORTS.has(report)}
      />

      <div id={REPORT_PANEL_ID} role="tabpanel" aria-labelledby={reportTabId(report)}>
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
