import { Area, AreaChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartConfig, ChartContainer, ChartTooltip } from '@shared/ui/chart';
import { ChartEmptyState } from '@shared/ui/ChartEmptyState';
import { useSpendingByDates } from '@features/analytics/api/useAnalyticsQueries';
import { useUiStore } from '@shared/store/useUiStore';
import { useMemo } from 'react';
import { format, eachDayOfInterval, differenceInDays, subDays } from 'date-fns';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

export function SpendingOverviewContent() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const dateRange = useUiStore((state) => state.dateRange);

  const budgetId = selectedBudget?.ID || 0;

  const { data: spendingData, isLoading: isLoadingSpending } = useSpendingByDates(
    dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '',
    dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '',
    budgetId
  );

  const previousPeriodRange = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return null;

    const daysDiff = differenceInDays(dateRange.to, dateRange.from) + 1;
    const previousFrom = subDays(dateRange.from, daysDiff);
    const previousTo = subDays(dateRange.from, 1);

    return {
      from: previousFrom,
      to: previousTo,
    };
  }, [dateRange]);

  const { data: previousSpendingData } = useSpendingByDates(
    previousPeriodRange?.from ? format(previousPeriodRange.from, 'yyyy-MM-dd') : '',
    previousPeriodRange?.to ? format(previousPeriodRange.to, 'yyyy-MM-dd') : '',
    budgetId
  );

  const chartConfig = useMemo(() => {
    const config: ChartConfig = {
      amount: {
        label: 'Current Period',
        color: 'var(--color-chart-1)',
      },
      previousAmount: {
        label: 'Previous Period',
        color: 'var(--color-chart-3)',
      },
    };
    return config;
  }, []);

  const formattedData = useMemo(() => {
    if (!spendingData || spendingData.length === 0 || !dateRange?.from || !dateRange?.to) return [];

    const spendingMap = new Map();
    spendingData.forEach((item) => {
      spendingMap.set(item.Date, item.Spending);
    });

    // Create a map of previous period spending data by date index
    const previousSpendingMap = new Map();
    if (previousSpendingData && previousPeriodRange) {
      const previousDates = eachDayOfInterval({
        start: previousPeriodRange.from,
        end: previousPeriodRange.to,
      });

      let previousCumulative = 0;
      previousDates.forEach((date, index) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const previousItem = previousSpendingData.find((item) => item.Date === dateStr);
        previousCumulative += previousItem?.Spending || 0;
        previousSpendingMap.set(index, previousCumulative);
      });
    }

    const allDates = eachDayOfInterval({
      start: dateRange.from,
      end: dateRange.to,
    });

    // Sums run in exact integer milliunits; chart data is decimal currency
    // units, converted at this mapping (axes/tooltips see currency values).
    let cumulativeAmount = 0;

    return allDates.map((date, index) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dailySpending = spendingMap.get(dateStr) || 0;
      cumulativeAmount += dailySpending;

      // Get previous period cumulative amount for the same day index
      const previousAmount = previousSpendingMap.get(index) || 0;

      return {
        date: format(date, 'MMM d'),
        amount: toDecimal(asMilli(cumulativeAmount)),
        previousAmount: toDecimal(asMilli(previousAmount)),
        dailySpending: toDecimal(asMilli(dailySpending)),
      };
    });
  }, [spendingData, previousSpendingData, dateRange, previousPeriodRange]);

  if (isLoadingSpending) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (formattedData.length === 0) {
    return <ChartEmptyState hint="No transactions found for the selected period" />;
  }

  return (
    <div className="h-[300px]">
      <ChartContainer config={chartConfig} className="h-full w-full relative">
        <AreaChart
          accessibilityLayer
          data={formattedData}
          margin={{ left: 8, right: 8, top: 40, bottom: 8 }}
        >
          <defs>
            <linearGradient id="spendingGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.8} />
              <stop offset="50%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="previousGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.3} />
              <stop offset="50%" stopColor="var(--color-chart-3)" stopOpacity={0.15} />
              <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={10}
            interval="preserveStartEnd"
          />
          <YAxis hide />
          <ChartTooltip
            cursor={{
              stroke: 'var(--color-muted-foreground)',
              strokeWidth: 1,
              strokeDasharray: '3 3',
            }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;

              const data = payload[0].payload;
              return (
                <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                  <div className="font-medium mb-2">{label}</div>
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Current:</span>
                      <span className="font-mono font-medium">
                        {globalLocalizer.format(data.amount)}
                      </span>
                    </div>
                    {data.previousAmount > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Previous:</span>
                        <span className="font-mono font-medium text-muted-foreground">
                          {globalLocalizer.format(data.previousAmount)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Daily:</span>
                      <span className="font-mono font-medium">
                        {globalLocalizer.format(data.dailySpending)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }}
          />
          {/* Previous period line - rendered first so it appears behind */}
          <Area
            key="previousAmount"
            dataKey="previousAmount"
            type="monotone"
            fill="url(#previousGradient)"
            stroke="var(--color-chart-3)"
            strokeWidth={1.5}
            strokeOpacity={0.4}
            dot={false}
          />
          <Area
            key="amount"
            dataKey="amount"
            type="monotone"
            fill="url(#spendingGradient)"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, index } = props;
              // Only show dot on the last point
              if (index === formattedData.length - 1) {
                return (
                  <g>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill="var(--color-chart-1)"
                      stroke="white"
                      strokeWidth={2}
                    />
                  </g>
                );
              }
              return <g />;
            }}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
