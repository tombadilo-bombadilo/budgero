import React from 'react';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger,
} from '@shared/ui/drawer';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { Slider } from '@shared/ui/slider';
import { Label } from '@shared/ui/label';
import { Separator } from '@shared/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Info, X } from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import {
  tooltipBase,
  tooltipHtml,
  useChartPalette,
  BAR_MAX_WIDTH,
} from '@shared/lib/charts/echarts-chrome';
import { computePayoffDate } from '@shared/lib/date-utils';
import { roundMilli } from '@shared/lib/currency/round-amount';
import {
  formatMilli,
  fromDecimal,
  toDecimal,
  ZERO_MILLI,
  type MilliUnits,
} from '@shared/lib/currency/milli';
import { buildPayoffSchedule } from '@shared/lib/debt/payoff-schedule';
import { PayoffSummaryGrid } from '@features/debt/ui/PayoffSummaryGrid';

// Money props are in milliunit space (possibly non-integer floats after
// display-currency conversion); interest math stays float, results round back
// via roundMilli at display/branding boundaries.
type PayoffPlanSheetProps = {
  trigger: React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLElement> }>;
  outstanding: number; // milliunits
  apr?: number;
  formatter: Intl.NumberFormat; // decimal currency formatter
  initialPayment: number; // milliunits
  onPaymentChange?: (n: number) => void; // milliunits
  suggestedMin: number; // milliunits
  maxPayment: number; // milliunits
};

export function PayoffPlanSheet({
  trigger,
  outstanding,
  apr,
  formatter,
  initialPayment,
  onPaymentChange,
  suggestedMin,
  maxPayment,
}: PayoffPlanSheetProps) {
  const [open, setOpen] = React.useState(false);
  const originalTriggerOnClick = trigger.props.onClick;
  const handleTriggerClick: React.MouseEventHandler<HTMLElement> = (event) => {
    originalTriggerOnClick?.(event);
    if (!event.defaultPrevented) {
      setOpen(true);
    }
  };
  // payment stays a plain number in milliunit space (slider + prop can carry
  // float residue); the extras come from CalculatorCell as exact MilliUnits.
  const [payment, setPayment] = React.useState<number>(initialPayment);
  const [localApr, setLocalApr] = React.useState<number>(apr ?? 0); // percent, dimensionless
  const [extraMonthly, setExtraMonthly] = React.useState<MilliUnits>(ZERO_MILLI);
  const [oneTimeExtra, setOneTimeExtra] = React.useState<MilliUnits>(ZERO_MILLI);
  const numericLocalizer = React.useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );
  const formatNumeric = React.useCallback(
    (value: number) => numericLocalizer.format(value),
    [numericLocalizer]
  );
  const calculatorDisplayClassName =
    'h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-left text-sm font-mono tabular-nums shadow-xs hover:bg-muted/20';
  const calculatorInputClassName = 'h-9 text-left text-sm tabular-nums';

  React.useEffect(() => {
    if (open) {
      setPayment(initialPayment);
      setLocalApr(apr ?? 0);
    }
  }, [open, initialPayment, apr]);

  const rMonthly = localApr > 0 ? localApr / 100 / 12 : 0;
  const sim = React.useMemo(
    () => buildPayoffSchedule(outstanding, rMonthly, payment, extraMonthly, oneTimeExtra),
    [outstanding, rMonthly, payment, extraMonthly, oneTimeExtra]
  );

  const payoffDate = React.useMemo(() => computePayoffDate(sim.months), [sim.months]);

  const handlePaymentInput = (val: number) => {
    // Milliunits in, milliunits out
    const n = Math.max(0, val || 0);
    setPayment(n);
    onPaymentChange?.(n);
  };

  const sliderPayment = Math.min(Math.max(payment, 1_000), Math.max(maxPayment, outstanding));

  // Charts consume decimals: convert milli-space schedule values at the
  // chart-data mapping boundary.
  const chartData = sim.rows.map((r, idx) => ({
    idx,
    monthLabel: r.label,
    dateISO: r.dateISO,
    payment: toDecimal(roundMilli(r.payment)),
    principal: toDecimal(roundMilli(r.principal)),
    interest: toDecimal(roundMilli(r.interest)),
    remaining: toDecimal(roundMilli(r.remaining)),
  }));

  const palette = useChartPalette();
  const chartOption = React.useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const principalColor = palette.series[0];
    const interestColor = palette.series[3];
    const remainingColor = palette.series[6];
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: chartData.map((row) => row.monthLabel),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      // Two value axes like the original: bars on the left scale, the
      // remaining-balance line on a hidden right scale.
      yAxis: [
        {
          type: 'value' as const,
          axisLabel: {
            color: chrome.axisText,
            fontSize: 11,
            formatter: (value: number) => formatter.format(value),
          },
          splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
          axisLine: { show: false },
        },
        { type: 'value' as const, show: false },
      ],
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const row = chartData[items[0]?.dataIndex ?? 0];
          if (!row) return '';
          return tooltipHtml(`Month ${row.idx + 1} — ${row.monthLabel}`, [
            { color: principalColor, name: 'Principal', value: formatter.format(row.principal) },
            { color: interestColor, name: 'Interest', value: formatter.format(row.interest) },
            { color: remainingColor, name: 'Remaining', value: formatter.format(row.remaining) },
          ]);
        },
      },
      series: [
        {
          name: 'Principal',
          type: 'bar' as const,
          stack: 'payment',
          data: chartData.map((row) => row.principal),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: principalColor, borderColor: chrome.surface, borderWidth: 1 },
        },
        {
          name: 'Interest',
          type: 'bar' as const,
          stack: 'payment',
          data: chartData.map((row) => row.interest),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: interestColor, borderColor: chrome.surface, borderWidth: 1 },
        },
        {
          name: 'Remaining',
          type: 'line' as const,
          yAxisIndex: 1,
          data: chartData.map((row) => row.remaining),
          lineStyle: { color: remainingColor, width: 2 },
          itemStyle: { color: remainingColor, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: chartData.length <= 30,
        },
      ],
    };
  }, [chartData, palette, formatter]);

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="right">
      <DrawerTrigger asChild>
        {React.cloneElement(trigger, { onClick: handleTriggerClick })}
      </DrawerTrigger>
      <DrawerContent
        className="w-full data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-2xl flex flex-col"
        onOpenAutoFocus={(e) => {
          // Prevent Radix from auto-focusing the first focusable element (APR input)
          e.preventDefault();
        }}
      >
        <DrawerHeader className="relative pr-10">
          <DrawerTitle>Payment Plan</DrawerTitle>
          <DrawerDescription>
            Explore detailed payoff projections. Adjust APR, monthly payment, and extras to see how
            they affect timeline and interest.
          </DrawerDescription>
          <DrawerClose
            aria-label="Close payment plan"
            className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" />
          </DrawerClose>
        </DrawerHeader>

        <div className="px-4 space-y-4 flex-1 overflow-y-auto min-h-0 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">APR (%)</Label>
                {/* APR is a dimensionless percent; bridge CalculatorCell's MilliUnits contract */}
                <CalculatorCell
                  value={fromDecimal(isFinite(localApr) ? localApr : 0)}
                  onCommit={(value) => {
                    const decimal = toDecimal(value);
                    setLocalApr(Number.isFinite(decimal) ? decimal : 0);
                  }}
                  formatter={formatNumeric}
                  localizer={numericLocalizer}
                  inputAlign="left"
                  className="w-full"
                  displayClassName={calculatorDisplayClassName}
                  inputClassName={calculatorInputClassName}
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Monthly payment</Label>
                  <span className="text-xs font-mono">
                    {formatMilli(formatter, roundMilli(payment || 0))}
                  </span>
                </div>
                <CalculatorCell
                  value={roundMilli(isFinite(payment) ? payment : 0)}
                  onCommit={(value) => handlePaymentInput(value)}
                  formatter={formatNumeric}
                  localizer={numericLocalizer}
                  inputAlign="left"
                  className="w-full"
                  displayClassName={calculatorDisplayClassName}
                  inputClassName={calculatorInputClassName}
                />
                <div className="mt-2">
                  <Slider
                    min={1_000} // one currency unit in milliunits
                    max={Math.max(maxPayment, outstanding)}
                    step={1_000}
                    value={[sliderPayment]}
                    onValueChange={(vals) => handlePaymentInput(vals[0])}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Suggested minimum:{' '}
                  <span className="font-mono">
                    {formatMilli(formatter, roundMilli(suggestedMin))}
                  </span>
                </div>
              </div>
              <Separator />
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                <div className="min-w-0 w-full sm:w-1/2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      className="flex-1 min-w-0 block text-xs text-muted-foreground leading-tight whitespace-normal break-words sm:truncate sm:whitespace-nowrap sm:overflow-hidden sm:h-5"
                      title="Extra monthly"
                    >
                      Extra monthly
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          aria-label="About extra monthly"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 text-xs">
                        Added to every monthly payment throughout the plan.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <CalculatorCell
                    value={extraMonthly}
                    onCommit={(value) => setExtraMonthly(value > 0 ? value : ZERO_MILLI)}
                    formatter={formatNumeric}
                    localizer={numericLocalizer}
                    inputAlign="left"
                    className="mt-1 w-full"
                    displayClassName={calculatorDisplayClassName}
                    inputClassName={calculatorInputClassName}
                  />
                </div>
                <div className="min-w-0 w-full sm:w-1/2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      className="flex-1 min-w-0 block text-xs text-muted-foreground leading-tight whitespace-normal break-words sm:truncate sm:whitespace-nowrap sm:overflow-hidden sm:h-5"
                      title="One-time extra (this month)"
                    >
                      One-time extra (this month)
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          aria-label="About one-time extra"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 text-xs">
                        Applied only in the first month of the schedule.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <CalculatorCell
                    value={oneTimeExtra}
                    onCommit={(value) => setOneTimeExtra(value > 0 ? value : ZERO_MILLI)}
                    formatter={formatNumeric}
                    localizer={numericLocalizer}
                    inputAlign="left"
                    className="mt-1 w-full"
                    displayClassName={calculatorDisplayClassName}
                    inputClassName={calculatorInputClassName}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <PayoffSummaryGrid
                months={sim.months}
                payoffDate={payoffDate}
                totalPaid={sim.totalPaid}
                interestPaid={sim.interestPaid}
                formatter={formatter}
                leading={
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Outstanding</div>
                      <div className="font-mono">
                        {formatMilli(formatter, roundMilli(outstanding))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">APR</div>
                      <div className="font-mono">{(localApr || 0).toFixed(2)}%</div>
                    </div>
                  </>
                }
              />
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-2">
            {sim.months === null && (
              <div className="text-xs text-destructive mb-2">
                Payment too low to cover monthly interest. Increase payment above{' '}
                <span className="font-mono">
                  {formatMilli(formatter, roundMilli(outstanding * rMonthly))}
                </span>
                .
              </div>
            )}
            <div>
              <EChart
                option={chartOption}
                ariaLabel="Debt payoff schedule chart"
                className="h-64 w-full"
              />
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                {[
                  { color: palette.series[0], label: 'Principal' },
                  { color: palette.series[3], label: 'Interest' },
                  { color: palette.series[6], label: 'Remaining' },
                ].map((item) => (
                  <span
                    key={item.label}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                      aria-hidden
                    />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">Amortization Table</div>
            <div className="border rounded-lg max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background/90 backdrop-blur">
                  <tr className="border-b">
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Date</th>
                    <th className="text-right p-2">Payment</th>
                    <th className="text-right p-2">Interest</th>
                    <th className="text-right p-2">Principal</th>
                    <th className="text-right p-2">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.rows.map((r) => (
                    <tr key={r.i} className="border-b">
                      <td className="p-2">{r.i}</td>
                      <td className="p-2">{r.label}</td>
                      <td className="p-2 text-right font-mono">
                        {formatMilli(formatter, roundMilli(r.payment))}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {formatMilli(formatter, roundMilli(r.interest))}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {formatMilli(formatter, roundMilli(r.principal))}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {formatMilli(formatter, roundMilli(r.remaining))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
