import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { trendTextClass } from '@shared/lib/amount-color';
import { buildPlanVsReality } from '../analytics-model';
import { GoalFundingList } from '../components/GoalFundingList';
import { planInsights } from '../insights';
import { usePlanData } from '../usePlanData';
import { useTargetData } from '../useTargetData';
import { buildTargetReport } from '../target-report';
import { TargetTable } from '../components/TargetTable';
import type { AnalyticsData } from '../useAnalyticsData';
import {
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  BASE_GRID,
  longMonthLabel,
  moneyAxis,
  monthAxis,
  shortMonthLabel,
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { KeyFigures, ReportLayout } from '../components/ReportLayout';
import { LedgerTable } from '../components/LedgerTable';
import { InsightStrip, LegendChips } from '../components/panels';
import { reportMeta } from '../report-questions';
import { planAnswer } from '../report-answers';

interface PlanRealityReportProps {
  data: AnalyticsData;
  months: string[];
}

/**
 * Plan vs Reality — the report only a zero-based budgeting app can make:
 * what you ASSIGNED each month against what you actually spent, where the
 * plan leaks per category, and how well goal categories are being funded.
 */
export function PlanRealityReport({ data, months }: PlanRealityReportProps) {
  const { t } = useLingui();

  const palette = usePalette();
  const money = useMoneyFormatters();
  const { data: planInputs, isLoading: planLoading } = usePlanData(months, data.budgetId);

  const plan = useMemo(() => buildPlanVsReality(planInputs ?? []), [planInputs]);
  const { data: targetInputs, isLoading: targetLoading } = useTargetData(months, data.budgetId);
  const targetReport = useMemo(() => buildTargetReport(targetInputs ?? []), [targetInputs]);

  const planColor = palette.series[0];
  const spentColor = palette.flow.negative;
  const slack = plan.totalAssigned - plan.totalSpent;
  const isEmpty = plan.totalAssigned === 0 && plan.totalSpent === 0;

  const insights = useMemo(
    () =>
      planInsights(plan, {
        money: (milli) => money.amount(milli),
        monthLabel: longMonthLabel,
      }),
    [plan, money]
  );

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    return {
      grid: BASE_GRID,
      xAxis: monthAxis(
        plan.months.map((point) => point.monthKey),
        chrome
      ),
      yAxis: moneyAxis(chrome, money.compact),
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const point = plan.months[items[0]?.dataIndex ?? 0];
          if (!point) return '';
          return tooltipHtml(shortMonthLabel(point.monthKey), [
            { color: planColor, name: t`Assigned`, value: money.amount(point.assigned) },
            { color: spentColor, name: t`Spent`, value: money.amount(point.spent) },
            {
              color: point.slack >= 0 ? palette.flow.positive : palette.flow.negative,
              name: point.slack >= 0 ? t`Left in plan` : t`Over plan`,
              value: money.amount(Math.abs(point.slack)),
            },
          ]);
        },
      },
      series: [
        {
          name: t`Assigned`,
          type: 'bar',
          data: plan.months.map((point) => point.assigned / 1000),
          barMaxWidth: BAR_MAX_WIDTH,
          barGap: '20%',
          itemStyle: { color: planColor, borderRadius: BAR_RADIUS_TOP },
        },
        {
          name: t`Spent`,
          type: 'bar',
          data: plan.months.map((point) => ({
            value: point.spent / 1000,
            // Spending over the month's assignment flags itself.
            itemStyle: {
              color: point.spent > point.assigned && point.assigned > 0 ? spentColor : chrome.other,
              borderRadius: BAR_RADIUS_TOP,
            },
          })),
          barMaxWidth: BAR_MAX_WIDTH,
        },
      ],
    };
  }, [plan, palette, money, planColor, spentColor, t]);

  // Chronic offenders first (habit beats magnitude), then by total overage.
  const overspenders = useMemo(
    () =>
      plan.categories
        .filter((row) => row.usage !== null && row.usage > 1)
        .sort(
          (a, b) =>
            Number(b.chronic) - Number(a.chronic) || b.spent - b.assigned - (a.spent - a.assigned)
        )
        .slice(0, 8),
    [plan.categories]
  );

  const fmt = { money: (milli: number) => money.amount(milli), monthLabel: longMonthLabel };
  const hasGoals = targetReport.groups.some((group) => group.target);

  return (
    <div className="space-y-4">
      <ReportLayout
        question={reportMeta('plan').question}
        answer={planAnswer({ assigned: plan.totalAssigned, spent: plan.totalSpent }, fmt)}
        insights={<InsightStrip insights={insights} />}
        legend={
          <LegendChips
            items={[
              { color: planColor, label: t`Assigned` },
              { color: palette.chrome.other, label: t`Spent (within plan)` },
              { color: spentColor, label: t`Spent (over plan)` },
            ]}
          />
        }
        chart={<EChart option={option} ariaLabel="Assigned versus spent per month" />}
        isLoading={data.isLoading || planLoading}
        isEmpty={isEmpty}
        emptyText={t`No assignments in this period — assign money on the Planning page first.`}
        figures={
          <KeyFigures
            items={[
              { label: t`Assigned`, value: money.tile(plan.totalAssigned) },
              {
                label: t`Spent`,
                value: money.tile(plan.totalSpent),
                detail:
                  plan.totalAssigned > 0
                    ? t`${Math.round((plan.totalSpent / plan.totalAssigned) * 100)}% of plan`
                    : undefined,
              },
              {
                label: slack >= 0 ? t`Left in plan` : t`Over plan`,
                value: money.tile(Math.abs(slack)),
                valueClassName: trendTextClass(slack),
              },
              {
                label: t`Months on plan`,
                value: `${Math.round(plan.monthsOnPlan * 100)}%`,
                valueClassName:
                  plan.monthsOnPlan >= 0.5 ? 'text-green-600' : 'text-red-600 dark:text-red-300',
              },
            ]}
          />
        }
      >
        {overspenders.length > 0 || hasGoals ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {overspenders.length > 0 ? (
              <LedgerTable
                title={<Trans>Where the plan leaks</Trans>}
                rows={overspenders}
                rowKey={(row) => String(row.categoryId)}
                columns={[
                  {
                    key: 'name',
                    header: t`Category`,
                    render: (row) => (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{row.name}</span>
                        {row.chronic ? (
                          <span className="shrink-0 rounded-full border border-red-300 px-1.5 text-[10px] font-medium uppercase tracking-wide text-red-600 dark:border-red-800 dark:text-red-300">
                            <Trans>chronic</Trans>
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: 'spent',
                    header: t`Spent`,
                    align: 'right',
                    render: (row) => money.amount(row.spent),
                  },
                  {
                    key: 'assigned',
                    header: t`Assigned`,
                    align: 'right',
                    hideOnMobile: true,
                    render: (row) => money.amount(row.assigned),
                  },
                  {
                    key: 'months',
                    header: t`Months over`,
                    align: 'right',
                    hideOnMobile: true,
                    render: (row) =>
                      row.monthsWithPlan > 0 ? `${row.monthsOver}/${row.monthsWithPlan}` : '—',
                    cellClassName: () => 'text-muted-foreground',
                  },
                  {
                    key: 'usage',
                    header: t`Used`,
                    align: 'right',
                    render: (row) => `${Math.round((row.usage ?? 0) * 100)}%`,
                    cellClassName: () => 'font-semibold text-red-600 dark:text-red-300',
                  },
                ]}
              />
            ) : null}
            {hasGoals ? (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">
                  <Trans>Goal funding (this period)</Trans>
                </h3>
                <div className="px-4 py-2">
                  <GoalFundingList
                    groups={targetReport.groups}
                    money={money.amount}
                    positiveColor={palette.flow.positive}
                    progressColor={palette.series[0]}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </ReportLayout>
      <TargetTable
        report={targetReport}
        money={money.amount}
        monthCount={months.length}
        isLoading={data.isLoading || targetLoading}
      />
    </div>
  );
}
