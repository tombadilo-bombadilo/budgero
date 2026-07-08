import { useId } from 'react';
import { Area, AreaChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@shared/ui/chart';

const chartConfig = {
  balance: { label: 'Balance', color: 'var(--color-chart-1)' },
};

interface BalanceAreaChartProps {
  data: { date: string; balance: number }[];
  formatAmount: (value: number) => string;
  className: string;
  /** Override the default axis tick font size (e.g. 10 on mobile). */
  tickFontSize?: number;
}

/** The dashboard's cash-balance area chart, shared by the desktop and mobile pages. */
export function BalanceAreaChart({
  data,
  formatAmount,
  className,
  tickFontSize,
}: BalanceAreaChartProps) {
  // useId can emit characters that are invalid in url(#…) references; strip them.
  const gradientId = `balance-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <ChartContainer config={chartConfig} className={className}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          stroke="var(--color-muted-foreground)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tick={tickFontSize === undefined ? undefined : { fontSize: tickFontSize }}
          interval="preserveStartEnd"
        />
        <YAxis hide />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => formatAmount(value as number)} />}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
        />
      </AreaChart>
    </ChartContainer>
  );
}
