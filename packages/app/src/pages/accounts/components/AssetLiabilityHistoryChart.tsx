import { Bar, BarChart, XAxis, YAxis, Legend, ReferenceLine } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@shared/ui/chart';
import type { MonthlyAssetPoint } from '@entities/account/api/useMonthlyAssetHistory';
import { asMilli, fromDecimal, toDecimal } from '@shared/lib/currency/milli';

interface AssetLiabilityHistoryChartProps {
  /** Amounts in integer milliunits (converted to decimal at the chart mapping below). */
  monthlyAssetHistory: MonthlyAssetPoint[];
  /** Integer milliunits. */
  netWorth: number;
  /** Milli-in currency formatter. */
  formatCurrency: (milli: number) => string;
}

/** Stacked assets-vs-liabilities bar chart for the Accounts page sidebar "history" tab. */
export function AssetLiabilityHistoryChart({
  monthlyAssetHistory,
  netWorth,
  formatCurrency,
}: AssetLiabilityHistoryChartProps) {
  const historyColors = {
    cash: 'var(--color-chart-1)',
    investments: 'var(--color-chart-2)',
    retirement: 'var(--color-chart-3)',
    realEstate: 'var(--color-chart-4)',
    otherAssets: 'var(--color-chart-5)',
    credit: 'var(--color-destructive)',
    loans: 'var(--color-warning)',
  };

  const historyChartConfig = {
    cash: { label: 'Cash', color: historyColors.cash },
    investments: { label: 'Investments', color: historyColors.investments },
    retirement: { label: 'Retirement', color: historyColors.retirement },
    realEstate: { label: 'Real Estate', color: historyColors.realEstate },
    otherAssets: { label: 'Other Assets', color: historyColors.otherAssets },
    credit: { label: 'Credit', color: historyColors.credit },
    loans: { label: 'Loans', color: historyColors.loans },
  } satisfies ChartConfig;

  // Transform data: decimal currency units for axes/tooltips, and liabilities
  // become negative for display below the X axis.
  const chartData = monthlyAssetHistory.map((point) => ({
    ...point,
    cash: toDecimal(asMilli(point.cash)),
    investments: toDecimal(asMilli(point.investments)),
    retirement: toDecimal(asMilli(point.retirement)),
    realEstate: toDecimal(asMilli(point.realEstate)),
    otherAssets: toDecimal(asMilli(point.otherAssets)),
    credit: -toDecimal(asMilli(point.credit)), // Negative for below-axis display
    loans: -toDecimal(asMilli(point.loans)), // Negative for below-axis display
  }));

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-muted-foreground">
        Asset & Liability History (24 months)
      </div>

      {monthlyAssetHistory.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          No historical data available
        </div>
      ) : (
        <ChartContainer config={historyChartConfig} className="h-[320px] w-full">
          <BarChart
            data={chartData}
            stackOffset="sign"
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => {
                const absValue = Math.abs(value);
                if (absValue >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                if (absValue >= 1000) return `${(value / 1000).toFixed(0)}K`;
                return value.toString();
              }}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine y={0} stroke="var(--color-border)" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    // Plotted values are decimal; formatCurrency is milli-in.
                    const absMilli = fromDecimal(Math.abs(value as number));
                    return (
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-muted-foreground">
                          {historyChartConfig[name as keyof typeof historyChartConfig]?.label ||
                            name}
                        </span>
                        <span className="font-mono font-medium">{formatCurrency(absMilli)}</span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Legend
              wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }}
              formatter={(value) =>
                historyChartConfig[value as keyof typeof historyChartConfig]?.label || value
              }
            />
            {/* Assets - stacked above zero */}
            <Bar dataKey="cash" stackId="a" fill={historyColors.cash} radius={[0, 0, 0, 0]} />
            <Bar
              dataKey="investments"
              stackId="a"
              fill={historyColors.investments}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="retirement"
              stackId="a"
              fill={historyColors.retirement}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="realEstate"
              stackId="a"
              fill={historyColors.realEstate}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="otherAssets"
              stackId="a"
              fill={historyColors.otherAssets}
              radius={[4, 4, 0, 0]}
            />
            {/* Liabilities - stacked below zero (negative values) */}
            <Bar dataKey="loans" stackId="a" fill={historyColors.loans} radius={[0, 0, 0, 0]} />
            <Bar dataKey="credit" stackId="a" fill={historyColors.credit} radius={[0, 0, 4, 4]} />
          </BarChart>
        </ChartContainer>
      )}

      {/* Net Worth trend line */}
      {monthlyAssetHistory.length > 0 && (
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current Net Worth</span>
            <span className="font-bold">{formatCurrency(netWorth)}</span>
          </div>
          {monthlyAssetHistory.length >= 2 && (
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted-foreground">vs {monthlyAssetHistory[0].label}</span>
              <span
                className={
                  netWorth - monthlyAssetHistory[0].netWorth >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }
              >
                {netWorth - monthlyAssetHistory[0].netWorth >= 0 ? '+' : ''}
                {formatCurrency(netWorth - monthlyAssetHistory[0].netWorth)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
