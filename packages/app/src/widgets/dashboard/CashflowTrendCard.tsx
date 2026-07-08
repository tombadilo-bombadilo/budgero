import { useMemo } from 'react';
import { format, parseISO, differenceInCalendarDays, subDays } from 'date-fns';
import { TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';
import { Area, Bar, Cell, ComposedChart, Legend, XAxis, YAxis, CartesianGrid } from 'recharts';

import { Card, CardHeader, CardTitle, CardContent } from '@shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@shared/ui/chart';
import { useIncomeExpenseByPeriod } from '@features/analytics/api/useAnalyticsQueries';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { useCompactNumberFormat } from '@shared/lib/useCompactNumberFormat';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

type CashflowTrendCardProps = {
  budgetId: number;
  globalLocalizer: Intl.NumberFormat;
  startDate?: string;
  endDate?: string;
};

const DEFAULT_WINDOW_DAYS = 84; // roughly 12 weeks
const MONTH_THRESHOLD_DAYS = 210;

export function CashflowTrendCard({
  budgetId,
  globalLocalizer,
  startDate,
  endDate,
}: CashflowTrendCardProps) {
  const compactFormatter = useCompactNumberFormat(globalLocalizer.resolvedOptions().locale);
  const today = new Date();
  const effectiveEndDate = endDate && endDate.length > 0 ? endDate : format(today, 'yyyy-MM-dd');
  const effectiveStartDate =
    startDate && startDate.length > 0
      ? startDate
      : format(subDays(parseISO(effectiveEndDate), DEFAULT_WINDOW_DAYS - 1), 'yyyy-MM-dd');

  const rangeDays = Math.max(
    1,
    differenceInCalendarDays(parseISO(effectiveEndDate), parseISO(effectiveStartDate))
  );
  const grouping: 'week' | 'month' = rangeDays > MONTH_THRESHOLD_DAYS ? 'month' : 'week';

  const { data: incomeExpense = [], isLoading } = useIncomeExpenseByPeriod(
    effectiveStartDate,
    effectiveEndDate,
    budgetId,
    grouping
  );

  const chartData = useMemo(() => {
    return incomeExpense.map((row) => {
      const parsedStart = parseISO(row.PeriodStart);
      const parsedEnd = parseISO(row.PeriodEnd);
      const label =
        grouping === 'week'
          ? `${format(parsedStart, 'MMM d')} - ${format(parsedEnd, 'MMM d')}`
          : format(parsedStart, 'MMM yyyy');
      // Chart data is decimal currency units; convert from stored milliunits here.
      const net = toDecimal(asMilli(row.TotalIncome - row.TotalExpense));
      return {
        label,
        income: toDecimal(row.TotalIncome),
        expense: toDecimal(row.TotalExpense),
        net,
      };
    });
  }, [incomeExpense, grouping]);

  const totals = useMemo(() => {
    return chartData.reduce(
      (acc, item) => {
        acc.income += item.income;
        acc.expense += item.expense;
        acc.net += item.net;
        return acc;
      },
      { income: 0, expense: 0, net: 0 }
    );
  }, [chartData]);

  const netPositive = totals.net >= 0;
  const DeltaIcon = netPositive ? TrendingUp : TrendingDown;
  const netClass = netPositive ? 'text-green-600' : 'text-red-600 dark:text-red-300';

  const chartConfig = {
    income: { label: 'Income', color: 'var(--color-chart-2)' },
    expense: { label: 'Spending', color: 'var(--color-chart-3)' },
  };

  const positiveNetColor = '#22c55e';
  const negativeNetColor = '#ef4444';
  const formatAmount = useFormatMaskedAmount(globalLocalizer);

  return (
    <Card className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
          Cashflow trends
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted/30 px-3 py-2.5 text-sm space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">Income</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatAmount(totals.income)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">Spending</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatAmount(totals.expense)}
            </span>
          </div>
          <div className="border-t border-border/40 pt-1.5 flex items-center justify-between gap-4">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              Net cashflow
              <DeltaIcon className={`h-3.5 w-3.5 ${netClass}`} />
            </span>
            <span className={`font-semibold tabular-nums ${netClass}`}>
              {netPositive ? '+' : '−'}
              {formatAmount(Math.abs(totals.net))}
            </span>
          </div>
        </div>

        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            <defs>
              <linearGradient id="cashflowIncome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="cashflowExpense" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-chart-3)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-chart-3)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              stroke="var(--color-muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(value) => compactFormatter.format(value as number)}
              stroke="var(--color-muted-foreground)"
              fontSize={10}
              width={45}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex items-center justify-between gap-2">
                      <span className="capitalize">{name}</span>
                      <span className="font-medium">{formatAmount(value as number)}</span>
                    </div>
                  )}
                />
              }
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="income"
              stroke="var(--color-chart-2)"
              strokeWidth={2}
              fill="url(#cashflowIncome)"
              fillOpacity={0.3}
            />
            <Area
              type="monotone"
              dataKey="expense"
              stroke="var(--color-chart-3)"
              strokeWidth={2}
              fill="url(#cashflowExpense)"
              fillOpacity={0.3}
            />
            <Bar dataKey="net" radius={[6, 6, 0, 0]} barSize={24} legendType="none">
              {chartData.map((item) => (
                <Cell key={item.label} fill={item.net >= 0 ? positiveNetColor : negativeNetColor} />
              ))}
            </Bar>
          </ComposedChart>
        </ChartContainer>

        {isLoading && (
          <div className="text-xs text-muted-foreground text-center">Loading cashflow data…</div>
        )}
      </CardContent>
    </Card>
  );
}
