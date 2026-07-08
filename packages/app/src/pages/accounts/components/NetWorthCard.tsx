/**
 * Net Worth Card Component
 *
 * Displays net worth summary with area chart.
 */

import { Card, CardContent } from '@shared/ui/card';
import { ChartConfig, ChartContainer } from '@shared/ui/chart';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Area, AreaChart, XAxis, YAxis, Tooltip } from 'recharts';
import { cn } from '@shared/lib/utils';
import { trendTextClass } from '@shared/lib/amount-color';
import { asMilli, fromDecimal, toDecimal } from '@shared/lib/currency/milli';

interface NetWorthDataPoint {
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

interface NetWorthCardProps {
  /** Integer milliunits. */
  netWorth: number;
  /** Integer milliunits. */
  netWorthChange: number;
  periodLabel: string;
  /** Amounts in integer milliunits (converted to decimal at the chart mapping below). */
  chartData: NetWorthDataPoint[];
  /** Milli-in currency formatter. */
  formatCurrency: (milli: number) => string;
}

const chartConfig: ChartConfig = {
  netWorth: {
    label: 'Net Worth',
    color: 'var(--color-chart-1)',
  },
};

function CustomTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { value: number; payload: unknown }[];
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (active && payload && payload.length) {
    const { value } = payload[0];
    const formattedValue = formatter ? formatter(value) : String(value);

    return (
      <div
        className="text-popover-foreground border border-border rounded-lg shadow-xl p-3 text-sm backdrop-blur-md bg-popover/80"
        style={{ zIndex: 9999 }}
      >
        <div className="text-muted-foreground mb-1">{label}</div>
        <div className="font-semibold">{formattedValue}</div>
      </div>
    );
  }
  return null;
}

export function NetWorthCard({
  netWorth,
  netWorthChange,
  periodLabel,
  chartData,
  formatCurrency,
}: NetWorthCardProps) {
  const changePercent =
    netWorth - netWorthChange !== 0 ? (netWorthChange / (netWorth - netWorthChange)) * 100 : 0;

  // Chart values are decimal currency units; stored points are milliunits.
  const chartDataDecimal = chartData.map((point) => ({
    ...point,
    netWorth: toDecimal(asMilli(point.netWorth)),
  }));

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4 sm:gap-0">
          <div>
            <div className="text-sm text-muted-foreground mb-1">NET WORTH</div>
            <div className="text-2xl sm:text-3xl font-bold">{formatCurrency(netWorth)}</div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-2">
              <div
                className={cn(
                  'flex items-center gap-1 text-sm font-medium',
                  trendTextClass(netWorthChange)
                )}
              >
                {netWorthChange >= 0 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                {formatCurrency(Math.abs(netWorthChange))} ({changePercent.toFixed(1)}%)
              </div>
              <span className="text-sm text-muted-foreground">{periodLabel} change</span>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-sm text-muted-foreground">Net worth performance</div>
            <div className="text-xs text-muted-foreground mt-1">{periodLabel}</div>
          </div>
        </div>

        {/* Net Worth Chart */}
        <div className="h-32 sm:h-48 w-full">
          <ChartContainer config={chartConfig} className="h-full w-full">
            <AreaChart
              accessibilityLayer
              data={chartDataDecimal}
              margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
            >
              <defs>
                <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-netWorth)" stopOpacity={0.8} />
                  <stop offset="50%" stopColor="var(--color-netWorth)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--color-netWorth)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10 }}
                tickMargin={8}
                interval="preserveStartEnd"
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <YAxis hide />
              <Tooltip
                content={
                  // Plotted values are decimal; formatCurrency is milli-in.
                  <CustomTooltip formatter={(value) => formatCurrency(fromDecimal(value))} />
                }
                cursor={{
                  strokeDasharray: '3 3',
                  stroke: 'var(--color-netWorth)',
                  strokeOpacity: 0.3,
                }}
                labelFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  });
                }}
              />
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke="var(--color-netWorth)"
                fillOpacity={1}
                fill="url(#netWorthGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
