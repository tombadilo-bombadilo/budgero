import { memo } from 'react';
import { format, parseISO } from 'date-fns';
import { XAxis, YAxis, AreaChart, Area } from 'recharts';
import { Card, CardContent } from '@shared/ui/card';
import { ChartContainer, ChartTooltip } from '@shared/ui/chart';
import { CHART_CONFIG } from './constants';
import type { SpendingChartProps } from './types';

export const SpendingChart = memo(function SpendingChart({
  cumulativeData,
  maxValue,
  shouldShowBudgetPace,
  globalLocalizer,
}: SpendingChartProps) {
  return (
    <Card>
      <CardContent className="p-3">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Spending Pattern</h3>
        <ChartContainer config={CHART_CONFIG} className="h-32 w-full">
          {cumulativeData.length > 0 ? (
            <AreaChart data={cumulativeData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d) => format(parseISO(d), 'd')}
                stroke="var(--color-muted-foreground)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                stroke="var(--color-muted-foreground)"
                fontSize={10}
                width={35}
                tickFormatter={(value) => {
                  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                  return value.toFixed(0);
                }}
                domain={[0, maxValue]}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
              />

              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="var(--color-chart-1)"
                fill="url(#colorCumulative)"
                strokeWidth={2}
                isAnimationActive={false}
              />

              {shouldShowBudgetPace && (
                <Area
                  type="monotone"
                  dataKey="budgetPace"
                  stroke="var(--color-chart-3)"
                  fill="none"
                  strokeWidth={2}
                  strokeOpacity={0.7}
                  strokeDasharray="5 5"
                  isAnimationActive={false}
                />
              )}

              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs max-w-[200px]">
                      <div className="font-medium mb-2 truncate">
                        {format(parseISO(data.date), 'MMM d')}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-muted-foreground flex-shrink-0">Cumulative:</span>
                          <span className="font-mono font-medium truncate">
                            {globalLocalizer.format(data.cumulative)}
                          </span>
                        </div>
                        {shouldShowBudgetPace && (
                          <>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-muted-foreground flex-shrink-0">
                                Budget Pace:
                              </span>
                              <span className="font-mono font-medium truncate">
                                {globalLocalizer.format(data.budgetPace)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span
                                className={`flex-shrink-0 ${
                                  data.isOverPace ? 'text-red-600' : 'text-green-600'
                                }`}
                              >
                                {data.isOverPace ? 'Over pace:' : 'Under pace:'}
                              </span>
                              <span
                                className={`font-mono font-medium truncate ${
                                  data.isOverPace ? 'text-red-600' : 'text-green-600'
                                }`}
                              >
                                {globalLocalizer.format(
                                  Math.abs(data.budgetPace - data.cumulative)
                                )}
                              </span>
                            </div>
                          </>
                        )}
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-muted-foreground flex-shrink-0">Daily:</span>
                          <span className="font-mono font-medium truncate">
                            {globalLocalizer.format(data.value)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
            </AreaChart>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No spending data
            </div>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  );
});
