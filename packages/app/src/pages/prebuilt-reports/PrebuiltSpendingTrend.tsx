import { useMemo, useState } from 'react';
import { toDecimal, ZERO_MILLI } from '@budgero/core/browser';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartConfig, ChartContainer, ChartTooltip } from '@shared/ui/chart';
import { useSpendingTotalsByPeriod } from '@features/analytics/api/useAnalyticsQueries';
import { Skeleton } from '@shared/ui/skeleton';
import {
  formatMaskedAmount,
  formatMaskedMilli,
  maskFormattedIfEnabled,
} from '@shared/lib/privacy/mask-numbers';
import { useCompactNumberFormat } from '@shared/lib/useCompactNumberFormat';
import { AccountFilterControl } from './components/AccountFilterControl';
import { CategoryFilterControl } from './components/CategoryFilterControl';
import { useSpendingFilters } from './components/useSpendingFilters';

type Grouping = 'day' | 'week' | 'month' | 'quarter';

const groupingOptions: { value: Grouping; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
];

function getQuarterLabel(start: Date): string {
  const quarterIndex = Math.floor((start.getMonth() + 3) / 3);
  return `Q${quarterIndex} ${format(start, 'yyyy')}`;
}

function formatLabel(grouping: Grouping, start: Date, end: Date) {
  switch (grouping) {
    case 'day':
      return format(start, 'MMM d');
    case 'week':
      return `${format(start, 'MMM d')}–${format(end, 'MMM d')}`;
    case 'month':
      return format(start, 'MMM yyyy');
    case 'quarter':
      return getQuarterLabel(start);
    default:
      return format(start, 'MMM d');
  }
}

function formatRange(grouping: Grouping, start: Date, end: Date) {
  switch (grouping) {
    case 'day':
      return format(start, 'MMM d, yyyy');
    case 'week':
      return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`;
    case 'month':
      return format(start, 'MMMM yyyy');
    case 'quarter':
      return getQuarterLabel(start);
    default:
      return format(start, 'MMM d, yyyy');
  }
}

export function PrebuiltSpendingTrend() {
  const [grouping, setGrouping] = useState<Grouping>('week');
  const {
    selectedCategoryIds,
    setSelectedCategoryIds,
    selectedAccountIds,
    setSelectedAccountIds,
    categoryFilterIds,
    accountFilterIds,
    startDate,
    endDate,
    budgetId,
    globalLocalizer,
    privacyMaskNumbers,
  } = useSpendingFilters();

  const { data: totals, isLoading } = useSpendingTotalsByPeriod(
    startDate,
    endDate,
    budgetId,
    grouping,
    categoryFilterIds,
    accountFilterIds
  );

  const totalSpending = useMemo(() => {
    if (!totals) return 0;
    return totals.reduce((sum, row) => sum + (row.TotalSpending ?? 0), 0);
  }, [totals]);

  const compactFormatter = useCompactNumberFormat();

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      spending: {
        label: 'Spending',
        color: 'var(--color-destructive)',
      },
    }),
    []
  );

  const chartData = useMemo(() => {
    if (!totals) return [];
    return totals
      .map((row) => {
        if (!row.PeriodStart || !row.PeriodEnd) {
          return null;
        }
        const start = parseISO(row.PeriodStart);
        const end = parseISO(row.PeriodEnd);
        return {
          periodKey: row.Period || row.PeriodStart,
          label: formatLabel(grouping, start, end),
          rangeLabel: formatRange(grouping, start, end),
          // Chart values are decimal currency units, converted at this mapping.
          spending: toDecimal(row.TotalSpending ?? ZERO_MILLI),
        };
      })
      .filter(
        (
          item
        ): item is { periodKey: string; label: string; rangeLabel: string; spending: number } =>
          Boolean(item)
      );
  }, [totals, grouping]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold">Spending over time</CardTitle>
          <CardDescription>
            Track total outflows across flexible time buckets with account and category filters.
          </CardDescription>
          <div className="text-sm font-medium text-foreground">
            {formatMaskedMilli(globalLocalizer, totalSpending, privacyMaskNumbers)} total spending
          </div>
        </div>
        <div className="flex w-full flex-wrap items-stretch gap-2 sm:justify-end">
          <div className="flex min-w-[200px] flex-1 sm:flex-initial">
            <AccountFilterControl
              selectedAccountIds={selectedAccountIds}
              onChange={setSelectedAccountIds}
            />
          </div>
          <div className="flex min-w-[200px] flex-1 sm:flex-initial">
            <CategoryFilterControl
              selectedCategoryIds={selectedCategoryIds}
              onChange={setSelectedCategoryIds}
            />
          </div>
          <div className="flex w-full justify-start sm:w-auto sm:justify-end">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              value={grouping}
              onValueChange={(value) => value && setGrouping(value as Grouping)}
            >
              {groupingOptions.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="px-2 py-1 text-xs"
                >
                  <span className="text-[11px] sm:text-xs">{option.label}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-2 pt-2 sm:space-y-4 sm:px-6">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[300px] w-full" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>No spending recorded for the selected filters.</p>
            <p>Adjust the date range, grouping, or filters to explore other periods.</p>
          </div>
        ) : (
          <div className="h-[320px]">
            <ChartContainer config={chartConfig} className="h-full w-full -mx-1 sm:mx-0">
              <BarChart data={chartData} margin={{ top: 32, bottom: 24, left: 0, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  fontSize={11}
                />
                <YAxis
                  width={56}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  tickFormatter={(value: number) =>
                    maskFormattedIfEnabled(compactFormatter.format(value), privacyMaskNumbers)
                  }
                />
                <ChartTooltip
                  cursor={{ fill: 'var(--color-muted)', opacity: 0.1 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const datum = payload[0].payload as (typeof chartData)[number];
                    return (
                      <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                        <div className="font-medium text-foreground">{datum.rangeLabel}</div>
                        <div className="mt-2 flex items-center justify-between gap-4">
                          <span className="text-muted-foreground">Spending</span>
                          <span className="font-mono">
                            {formatMaskedAmount(
                              globalLocalizer,
                              datum.spending,
                              privacyMaskNumbers
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="spending"
                  fill="var(--color-destructive)"
                  radius={[6, 6, 0, 0]}
                  barSize={32}
                  name="Spending"
                />
              </BarChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
