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
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
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

interface TooltipPayloadItem {
  value: number;
  name: string;
  color?: string;
  payload?: { monthLabel?: string; idx?: number };
}

function CurrencyTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  formatter: Intl.NumberFormat;
}) {
  if (!active || !payload || payload.length === 0) return null;

  // Prefer monthLabel stored on each datum; fallback to recharts label string.
  let displayLabel = '';
  try {
    const first = payload[0];
    const datum = first?.payload;
    const monthLabel = datum?.monthLabel || '';
    const idx = typeof datum?.idx === 'number' ? datum.idx : Number(datum?.idx);
    if (!Number.isNaN(idx) && monthLabel) {
      displayLabel = `Month ${idx + 1} — ${monthLabel}`;
    } else if (monthLabel) {
      displayLabel = monthLabel;
    } else {
      displayLabel = String(label ?? '');
    }
  } catch {
    displayLabel = String(label ?? '');
  }

  return (
    <div className="text-popover-foreground border border-border rounded-lg shadow-xl p-2 text-xs backdrop-blur-md bg-popover/80">
      <div className="font-medium mb-1">{displayLabel}</div>
      <div className="grid gap-1">
        {payload.map((p, idx) => (
          <div className="flex items-center justify-between gap-4" key={idx}>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ backgroundColor: p.color || '#999' }}
              />
              <span className="text-muted-foreground">{p.name}</span>
            </div>
            <span className="font-mono">{formatter.format(Number(p.value || 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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

  // Adaptive X-axis label density to avoid overlap (especially on mobile)
  const chartWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const [xAxisTicks, setXAxisTicks] = React.useState<number[]>([]);
  const measureAttempts = React.useRef(0);
  const recomputeTicks = React.useCallback(() => {
    const el = chartWrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = rect.width || (el as HTMLElement).offsetWidth || (el as HTMLElement).clientWidth || 0;
    const points = chartData.length || 1;
    if (w <= 0 && measureAttempts.current < 10) {
      measureAttempts.current += 1;
      requestAnimationFrame(recomputeTicks);
      return;
    }
    measureAttempts.current = 0;
    const isSmall = w < 640; // approx tailwind sm breakpoint
    const targetLabelWidth = isSmall ? 64 : 110; // px per label; slightly wider on desktop
    const maxTicks = Math.max(2, Math.floor(w / targetLabelWidth));
    const step = Math.max(1, Math.ceil(points / maxTicks));
    const ticks: number[] = [];
    for (let i = 0; i < points; i += step) ticks.push(i);
    if (ticks[ticks.length - 1] !== points - 1) ticks.push(points - 1);
    setXAxisTicks(ticks);
  }, [chartData.length]);

  React.useLayoutEffect(() => {
    const el = chartWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recomputeTicks());
    ro.observe(el);
    recomputeTicks();
    return () => ro.disconnect();
  }, [recomputeTicks]);

  React.useEffect(() => {
    // Recompute on open to capture size after sheet animation as well
    if (open) {
      recomputeTicks();
      const t = setTimeout(recomputeTicks, 250);
      return () => clearTimeout(t);
    }
  }, [open, recomputeTicks]);

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
            <div className="h-64" ref={chartWrapperRef}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="idx"
                    hide={false}
                    tick={{ fontSize: 11 }}
                    ticks={xAxisTicks}
                    interval={0}
                    minTickGap={10}
                    tickFormatter={(v) => chartData[Number(v)]?.monthLabel || ''}
                  />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tickFormatter={(v) => formatter.format(Number(v))}
                    width={70}
                  />
                  <YAxis yAxisId="right" orientation="right" hide />
                  <ReTooltip content={<CurrencyTooltip formatter={formatter} />} />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="principal"
                    name="Principal"
                    stackId="a"
                    fill="var(--color-chart-2)"
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="interest"
                    name="Interest"
                    stackId="a"
                    fill="var(--color-chart-3)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="remaining"
                    name="Remaining"
                    stroke="var(--color-chart-5)"
                    strokeWidth={2.25}
                    dot={{ r: 2.2 }}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
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
