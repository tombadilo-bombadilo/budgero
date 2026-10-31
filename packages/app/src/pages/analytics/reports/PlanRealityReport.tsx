import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { AnimatedNumber } from '@shared/ui/animated-number';
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
  BASE_GRID,
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  monthAxis,
  moneyAxis,
  shortMonthLabel,
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { ReportShell } from '../components/ReportShell';
import { InsightStrip, LegendChips, PanelSectionTitle, StatTile } from '../components/panels';

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
        monthLabel: shortMonthLabel,
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

  return (
    <div className="space-y-4">
      <ReportShell
        title={t`Plan vs Reality`}
        hero={
          <AnimatedNumber
            value={slack}
            formatter={(value) =>
              `${value >= 0 ? '+' : ''}${money.amount(value)} ${value >= 0 ? 'under' : 'over'} plan`
            }
            rounding="integer"
          />
        }
        heroClassName={trendTextClass(slack)}
        subtitle={t`What you assigned vs what actually happened — only possible because you budget`}
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
        panel={
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label={t`Assigned`} value={money.tile(plan.totalAssigned)} />
              <StatTile
                label={t`Spent`}
                value={money.tile(plan.totalSpent)}
                detail={
                  plan.totalAssigned > 0
                    ? `${Math.round((plan.totalSpent / plan.totalAssigned) * 100)}% of plan`
                    : undefined
                }
              />
              <StatTile
                label={t`Months on plan`}
                value={`${Math.round(plan.monthsOnPlan * 100)}%`}
                valueClassName={
                  plan.monthsOnPlan >= 0.5 ? 'text-green-600' : 'text-red-600 dark:text-red-300'
                }
              />
              <StatTile
                label={slack >= 0 ? t`Left in plan` : t`Over plan`}
                value={money.tile(Math.abs(slack))}
                valueClassName={trendTextClass(slack)}
              />
            </div>

            {overspenders.length > 0 ? (
              <>
                <PanelSectionTitle>
                  <Trans>Where the plan leaks</Trans>
                </PanelSectionTitle>
                <div className="divide-y divide-border/50">
                  {overspenders.map((row) => (
                    <div
                      key={row.categoryId}
                      className="flex items-baseline justify-between gap-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{row.name}</span>
                          {row.chronic ? (
                            <span className="shrink-0 rounded-full border border-red-300 px-1.5 text-[10px] font-medium uppercase tracking-wide text-red-600 dark:border-red-800 dark:text-red-300">
                              <Trans>chronic</Trans>
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <Trans>
                            {money.amount(row.spent)} of {money.amount(row.assigned)} assigned
                            {row.monthsWithPlan > 0
                              ? t` · over in ${row.monthsOver}/${row.monthsWithPlan} mo`
                              : ''}
                          </Trans>
                        </div>
                      </div>
                      <span className="whitespace-nowrap text-sm font-semibold text-red-600 tabular-nums dark:text-red-300">
                        {Math.round((row.usage ?? 0) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {targetReport.groups.some((group) => group.target) ? (
              <>
                <PanelSectionTitle>
                  <Trans>Goal funding (this period)</Trans>
                </PanelSectionTitle>
                <GoalFundingList
                  groups={targetReport.groups}
                  money={money.amount}
                  positiveColor={palette.flow.positive}
                  progressColor={palette.series[0]}
                />
              </>
            ) : null}
          </>
        }
      />
      <TargetTable
        report={targetReport}
        money={money.amount}
        monthCount={months.length}
        isLoading={data.isLoading || targetLoading}
      />
    </div>
  );
}
