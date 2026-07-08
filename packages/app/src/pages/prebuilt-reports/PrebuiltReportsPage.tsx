import {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
  type ComponentType,
  type SVGProps,
} from 'react';
import { format, startOfYear, endOfDay } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { Button } from '@shared/ui/button';
import { IncomeExpenseByGroupChart } from '@features/analytics/ui/IncomeExpenseByGroupChart';
import { SpendingBreakdownContent } from '@features/analytics/ui/SpendingBreakdownContent';
import {
  useAnalyticsPeriodSummary,
  useOnBudgetBalance,
} from '@features/analytics/api/useAnalyticsQueries';
import { useUiStore, type RangeOption } from '@shared/store/useUiStore';
import { cn } from '@shared/lib/utils';
import {
  Activity,
  CalendarClock,
  CalendarDays,
  CreditCard,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import DateRangePicker, { type DateRangePresetKey } from '@shared/ui/date-range-picker';
import type { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import PrebuiltPayeeDonut from './PrebuiltPayeeDonut';
import PrebuiltLabelDonut from './PrebuiltLabelDonut';
import { PrebuiltCategoryPivot } from './PrebuiltCategoryPivot';
import { PrebuiltSpendingTrend } from './PrebuiltSpendingTrend';
import { useReportPeriod } from './components/useReportPeriod';

interface MetricCardProps {
  title: string;
  value: string;
  helper?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  accentClassName?: string;
  loading?: boolean;
}

type Metric = MetricCardProps & { key: string };

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    // Sync with current value when query changes (defer to avoid synchronous cascade)
    const id = requestAnimationFrame(() => setMatches(mediaQuery.matches));
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      cancelAnimationFrame(id);
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
  accentClassName,
  loading,
}: MetricCardProps) {
  return (
    <Card className="shadow-sm">
      {/* tighter below on mobile, normal on sm+ */}
      <CardHeader className="pb-0 sm:pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">
            {title}
          </CardTitle>
          <div className="rounded-md bg-muted p-1 sm:p-2">
            <Icon className="h-3 w-3 text-muted-foreground sm:h-4 sm:w-4" />
          </div>
        </div>
      </CardHeader>

      {/* no top padding on mobile; add a touch on sm+ */}
      <CardContent className="pt-0 sm:pt-1">
        {loading ? (
          <Skeleton className="h-6 w-20 sm:h-8 sm:w-24" />
        ) : (
          <div
            className={cn(
              'text-base font-semibold leading-tight tracking-tight sm:text-2xl',
              accentClassName
            )}
          >
            {value}
          </div>
        )}

        {helper ? (
          <div className="mt-0 text-[10px] text-muted-foreground sm:mt-1 sm:text-xs">{helper}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function PrebuiltReportsPage() {
  const { dateRange, budgetId, startDate, endDate } = useReportPeriod();
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const setDateRange = useUiStore((state) => state.setDateRange);
  const setRangeOption = useUiStore((state) => state.setRangeOption);
  const rangeOption = useUiStore((state) => state.rangeOption);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const hasAppliedDefaultRange = useRef(false);

  useEffect(() => {
    if (hasAppliedDefaultRange.current) {
      return;
    }
    hasAppliedDefaultRange.current = true;
    if (rangeOption === 'last-30') {
      // Defer state updates to avoid synchronous cascade
      const id = requestAnimationFrame(() => {
        const now = new Date();
        const start = startOfYear(now);
        const end = endOfDay(now);
        setDateRange({ from: start, to: end });
        setRangeOption('ytd');
      });
      return () => cancelAnimationFrame(id);
    }
  }, [rangeOption, setDateRange, setRangeOption]);

  const includesProjections = Boolean(endDate) && endDate > format(new Date(), 'yyyy-MM-dd');

  const { data: periodSummary, isLoading: isLoadingSummary } = useAnalyticsPeriodSummary(
    startDate,
    endDate,
    budgetId
  );
  const { data: onBudgetBalance, isLoading: isLoadingBalance } = useOnBudgetBalance(budgetId);
  const showPivot = useMediaQuery('(min-width: 1280px)');

  const periodLabel = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) {
      return 'No date range selected';
    }
    return `${format(dateRange.from, 'MMM d, yyyy')} – ${format(dateRange.to, 'MMM d, yyyy')}`;
  }, [dateRange]);

  const hasSummary = Boolean(periodSummary);
  const hasBalance = typeof onBudgetBalance === 'number';

  const presetToRangeOption = useMemo<Partial<Record<DateRangePresetKey, RangeOption>>>(
    () => ({
      last30Days: 'last-30',
      lastMonth: 'last-month',
      yearToDate: 'ytd',
    }),
    []
  );

  const handleDateRangeChange = useCallback(
    (range: DateRange | undefined, preset?: DateRangePresetKey) => {
      setDateRange(range);
      const mapped = preset ? presetToRangeOption[preset] : undefined;
      setRangeOption(mapped ?? 'custom');
      if (range?.from && range?.to) setIsDatePickerOpen(false);
    },
    [presetToRangeOption, setDateRange, setRangeOption]
  );

  const metrics = useMemo<Metric[]>(() => {
    if (!hasSummary) {
      return [
        {
          key: 'spending',
          title: 'Total spending',
          value: '—',
          helper: 'Track outgoing cash',
          icon: CreditCard,
          loading: isLoadingSummary || isLoadingBalance,
        },
        {
          key: 'income',
          title: 'Total income',
          value: '—',
          helper: 'Monitor money coming in',
          icon: PiggyBank,
          loading: isLoadingSummary,
        },
        {
          key: 'net',
          title: 'Net cashflow',
          value: '—',
          helper: 'Income minus spending',
          icon: TrendingUp,
          loading: isLoadingSummary,
        },
        {
          key: 'average',
          title: 'Avg daily spend',
          value: '—',
          helper: 'Based on your current range',
          icon: Activity,
          loading: isLoadingSummary,
        },
        {
          key: 'balance',
          title: 'On-budget balance',
          value: '—',
          helper: 'All on-budget accounts',
          icon: Wallet,
          loading: isLoadingBalance,
        },
      ];
    }

    const netPositive = (periodSummary?.NetCashflow ?? 0) >= 0;

    return [
      {
        key: 'spending',
        title: 'Total spending',
        value: formatMaskedMilli(
          globalLocalizer,
          periodSummary?.TotalSpending ?? 0,
          privacyMaskNumbers
        ),
        helper: `${periodSummary?.TransactionCount ?? 0} transactions`,
        icon: CreditCard,
        loading: isLoadingSummary,
      },
      {
        key: 'income',
        title: 'Total income',
        value: formatMaskedMilli(
          globalLocalizer,
          periodSummary?.TotalIncome ?? 0,
          privacyMaskNumbers
        ),
        helper: `${periodSummary?.ActiveDays ?? 0} active days`,
        icon: PiggyBank,
        loading: isLoadingSummary,
      },
      {
        key: 'net',
        title: 'Net cashflow',
        value: formatMaskedMilli(
          globalLocalizer,
          periodSummary?.NetCashflow ?? 0,
          privacyMaskNumbers
        ),
        helper: netPositive ? 'On track to grow savings' : 'Keep an eye on overspending',
        icon: netPositive ? TrendingUp : TrendingDown,
        accentClassName: netPositive
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400',
        loading: isLoadingSummary,
      },
      {
        key: 'average',
        title: 'Avg daily spend',
        value: formatMaskedMilli(
          globalLocalizer,
          periodSummary?.AverageDailySpending ?? 0,
          privacyMaskNumbers
        ),
        helper: `${periodSummary?.PeriodDays ?? 0} day window`,
        icon: Activity,
        loading: isLoadingSummary,
      },
      {
        key: 'balance',
        title: 'On-budget balance',
        value: hasBalance
          ? formatMaskedMilli(globalLocalizer, onBudgetBalance ?? 0, privacyMaskNumbers)
          : '—',
        helper: 'All on-budget accounts',
        icon: Wallet,
        loading: isLoadingBalance,
      },
    ];
  }, [
    hasSummary,
    hasBalance,
    periodSummary,
    onBudgetBalance,
    globalLocalizer,
    privacyMaskNumbers,
    isLoadingSummary,
    isLoadingBalance,
  ]);

  return (
    <div className="flex-1 overflow-x-hidden px-3 pt-6 pb-28 sm:px-4 sm:pb-12 lg:px-8 lg:pt-8 lg:pb-14">
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Prebuilt analytics</h1>
            <p className="text-sm text-muted-foreground">
              Ready-to-use insights for your budgeting period
            </p>
            <div className="text-xs text-muted-foreground">{periodLabel}</div>
            {includesProjections && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <CalendarClock className="h-3 w-3" />
                Includes projected recurring transactions
              </div>
            )}
          </div>
          <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full max-w-md justify-between gap-2 text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  <span className="truncate">{periodLabel}</span>
                </span>
                <span className="text-muted-foreground text-xs">Adjust</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-4" align="start">
              <DateRangePicker
                value={dateRange}
                onChange={handleDateRangeChange}
                className="w-full"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map((metric) => (
            <div key={metric.key} className="min-w-0">
              <MetricCard
                title={metric.title}
                value={metric.value}
                helper={metric.helper}
                icon={metric.icon}
                accentClassName={metric.accentClassName}
                loading={metric.loading}
              />
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="min-w-0">
            <PrebuiltSpendingTrend />
          </div>
          <div className="min-w-0">
            <Card className="shadow-sm">
              {/* tighten header/content gap on this card too */}
              <CardHeader className="pb-1 sm:pb-2">
                <CardTitle className="text-lg font-semibold">Spending breakdown</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Drill into category groups to see where cash goes
                </p>
              </CardHeader>
              <CardContent className="pt-0 sm:pt-2">
                <SpendingBreakdownContent />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="min-w-0">
          <IncomeExpenseByGroupChart />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="min-w-0">
            <PrebuiltPayeeDonut />
          </div>
          <div className="min-w-0">
            <PrebuiltLabelDonut />
          </div>
        </div>
        {showPivot ? (
          <div className="min-w-0">
            <PrebuiltCategoryPivot />
          </div>
        ) : null}
      </div>
    </div>
  );
}
