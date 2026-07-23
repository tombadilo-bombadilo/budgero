import { useMemo, useState } from 'react';
import {
  Landmark,
  Tag,
  ArrowLeftRight,
  Waypoints,
  ClipboardCheck,
  FlaskConical,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { useAnalyticsPageState, type ReportKey } from './analytics-state';
import { useAnalyticsData } from './useAnalyticsData';
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar';
import { WealthReport } from './reports/WealthReport';
import { SpendingReport } from './reports/SpendingReport';
import { InOutReport } from './reports/InOutReport';
import { FlowReport } from './reports/FlowReport';
import { PlanRealityReport } from './reports/PlanRealityReport';
import { ScenarioReport } from './reports/ScenarioReport';
import { VsExpenseReport } from './reports/VsExpenseReport';

/**
 * Question-based reports: each answers something a household asks, rather
 * than naming a chart type.
 */
const REPORTS: { key: ReportKey; label: string; question: string; icon: LucideIcon }[] = [
  { key: 'wealth', label: 'Wealth', question: 'Am I growing?', icon: Landmark },
  { key: 'spending', label: 'Spending', question: 'Where does it go?', icon: Tag },
  { key: 'in-out', label: 'In vs Out', question: 'Within our means?', icon: ArrowLeftRight },
  { key: 'plan', label: 'Plan vs Reality', question: 'Did the budget hold?', icon: ClipboardCheck },
  { key: 'money-map', label: 'Money Map', question: 'How does it move?', icon: Waypoints },
  { key: 'scenario', label: 'Scenario', question: 'What if?', icon: FlaskConical },
  { key: 'ledger', label: 'Ledger', question: 'Every category, every month', icon: Table2 },
];

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
      <h1 className="text-2xl font-bold tracking-tight">Prebuilt</h1>

      <div className="grid grid-cols-2 gap-1 rounded-xl border border-dashed border-border/70 bg-card p-1 sm:grid-cols-3 lg:grid-cols-7">
        {REPORTS.map(({ key, label, question, icon: Icon }) => (
          <Button
            key={key}
            variant={report === key ? 'default' : 'ghost'}
            className={cn(
              'h-auto flex-col items-start gap-0.5 px-3 py-2',
              report !== key && 'text-muted-foreground'
            )}
            onClick={() => setReport(key)}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon className="h-4 w-4" />
              {label}
            </span>
            <span
              className={cn(
                'text-[11px] font-normal',
                report === key ? 'text-primary-foreground/75' : 'text-muted-foreground'
              )}
            >
              {question}
            </span>
          </Button>
        ))}
      </div>

      <AnalyticsFilterBar
        state={state}
        data={data}
        showCategoryFilters={CATEGORY_FILTER_REPORTS.has(report)}
      />

      {report === 'wealth' && (
        <WealthReport data={data} months={months} accountIds={state.selections.accountIds} />
      )}
      {report === 'spending' && <SpendingReport data={data} months={months} />}
      {report === 'in-out' && <InOutReport data={data} months={months} />}
      {report === 'plan' && <PlanRealityReport data={data} months={months} />}
      {report === 'money-map' && <FlowReport data={data} />}
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
  );
}
