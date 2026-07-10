/**
 * Account Sparkline Component
 *
 * Displays a mini line chart showing account balance history.
 */

import { useAccountBalanceHistory } from '@entities/account/api/useAccountBalanceHistory';
import { useUiStore } from '@shared/store/useUiStore';
import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';
import { cn } from '@shared/lib/utils';
import { parseISO } from 'date-fns';
import { trendTextClass } from '@shared/lib/amount-color';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

interface AccountSparklineProps {
  accountId: number;
  strokeColor: string;
  accountName: string;
  periodMonths?: number;
}

export function AccountSparkline({
  accountId,
  strokeColor,
  accountName,
  periodMonths = 1,
}: AccountSparklineProps) {
  const { data: sparklineData } = useAccountBalanceHistory(accountId, periodMonths);
  const globalLocalizer = useUiStore((s) => s.globalLocalizer);

  if (!sparklineData || sparklineData.length === 0) {
    return (
      <div className="hidden sm:block w-12 sm:w-16 h-6 sm:h-8">
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-xs text-muted-foreground">—</div>
        </div>
      </div>
    );
  }

  // Transform data for recharts; chart values are decimal currency units.
  const chartData = sparklineData.map((point) => ({
    value: toDecimal(asMilli(point.balance)),
    date: parseISO(point.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  }));

  // Calculate trend (exact in integer milliunits, converted for display below)
  const firstValue = sparklineData[0]?.balance || 0;
  const lastValue = sparklineData[sparklineData.length - 1]?.balance || 0;
  const change = lastValue - firstValue;
  const changePercent = firstValue !== 0 ? (change / Math.abs(firstValue)) * 100 : 0;

  return (
    <div className="hidden sm:block w-12 sm:w-16 h-6 sm:h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Tooltip
            wrapperStyle={{ zIndex: 2147483647, pointerEvents: 'none' }}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const value = Number((payload[0] as { value?: number }).value ?? 0);
                const displayDate =
                  typeof label === 'string'
                    ? label
                    : (payload[0].payload as { date?: string })?.date || 'Unknown date';

                return (
                  <div
                    className="text-popover-foreground border border-border rounded-lg shadow-xl p-3 text-sm min-w-[180px] backdrop-blur-md bg-popover/80"
                    style={{ zIndex: 9999 }}
                  >
                    <div className="font-medium mb-1">{accountName}</div>
                    <div className="text-muted-foreground text-xs mb-2">{displayDate}</div>
                    <div className="font-semibold">{globalLocalizer.format(value)}</div>
                    <div className="text-xs mt-1 text-muted-foreground">
                      Period trend: {change >= 0 ? '+' : ''}
                      {globalLocalizer.format(toDecimal(asMilli(change)))}
                      <span className={cn('ml-1', trendTextClass(change))}>
                        ({changePercent >= 0 ? '+' : ''}
                        {changePercent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                );
              }
              return null;
            }}
            cursor={{ strokeDasharray: '3 3', stroke: strokeColor, strokeOpacity: 0.3 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
