import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseISO, format } from 'date-fns';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { ChartContainer, ChartConfig, ChartTooltip } from '@shared/ui/chart';
import { useUiStore } from '@shared/store/useUiStore';
import { useIncomeExpenseByPeriod } from '@features/analytics/api/useAnalyticsQueries';
import { useAccounts } from '@entities/account/api/useAccounts';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { Skeleton } from '@shared/ui/skeleton';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { useCompactNumberFormat } from '@shared/lib/useCompactNumberFormat';
import { formatMaskedAmount, maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { asMilli, toDecimal, ZERO_MILLI } from '@shared/lib/currency/milli';

const groupingOptions: { value: Grouping; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
];

type Grouping = 'day' | 'week' | 'month' | 'quarter';

const incomeColor = 'var(--color-chart-1)';
const expenseColor = 'var(--color-destructive)';
const netWorthColor = 'var(--color-chart-4)';

interface ChartDatum {
  periodKey: string;
  label: string;
  rangeLabel: string;
  periodStart: string;
  periodEnd: string;
  income: number;
  expense: number;
  net: number;
  netWorth: number | null;
}

function getRangeLabel(grouping: Grouping, start: Date, end: Date) {
  switch (grouping) {
    case 'day':
      return format(start, 'MMM d, yyyy');
    case 'week':
      return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
    case 'month':
      return format(start, 'MMMM yyyy');
    case 'quarter': {
      const quarterIndex = Math.floor((start.getMonth() + 3) / 3);
      return `Q${quarterIndex} ${format(start, 'yyyy')}`;
    }
    default:
      return format(start, 'MMM d, yyyy');
  }
}

function getLabel(grouping: Grouping, start: Date, end: Date) {
  switch (grouping) {
    case 'day':
      return format(start, 'MMM d');
    case 'week':
      return `${format(start, 'MMM d')}–${format(end, 'MMM d')}`;
    case 'month':
      return format(start, 'MMM yyyy');
    case 'quarter': {
      const quarterIndex = Math.floor((start.getMonth() + 3) / 3);
      return `Q${quarterIndex} ${format(start, 'yy')}`;
    }
    default:
      return format(start, 'MMM d');
  }
}

export function IncomeExpenseByGroupChart() {
  const [grouping, setGrouping] = useState<Grouping>('month');
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const dateRange = useUiStore((state) => state.dateRange);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const startDate = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
  const endDate = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';

  const { data: accounts, isLoading: isLoadingAccounts } = useAccounts(budgetId);

  const onBudgetAccounts = useMemo(
    () => (accounts ?? []).filter((account) => account.OnBudget && !account.Deleted),
    [accounts]
  );

  // Filter out account IDs that are no longer valid - defer to avoid synchronous cascade
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setSelectedAccountIds((prev) => {
        if (prev.length === 0) {
          return prev;
        }
        const validIds = prev.filter((id) => onBudgetAccounts.some((account) => account.ID === id));
        return validIds.length === prev.length ? prev : validIds;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [onBudgetAccounts]);

  const toggleAccount = useCallback((accountId: number) => {
    setSelectedAccountIds((prev) => {
      if (prev.includes(accountId)) {
        const next = prev.filter((id) => id !== accountId);
        return next;
      }
      return [...prev, accountId];
    });
  }, []);

  const accountFilterIds = selectedAccountIds.length ? selectedAccountIds : undefined;

  const { data, isLoading } = useIncomeExpenseByPeriod(
    startDate,
    endDate,
    budgetId,
    grouping,
    accountFilterIds
  );

  const currentNetWorth = useMemo(() => {
    const relevantAccounts =
      selectedAccountIds.length > 0
        ? onBudgetAccounts.filter((account) => selectedAccountIds.includes(account.ID))
        : onBudgetAccounts;

    return relevantAccounts.reduce((sum, account) => {
      const balance =
        typeof account.BalanceConverted === 'number'
          ? account.BalanceConverted
          : (account.Balance ?? 0);
      return sum + (Number.isFinite(balance) ? balance : 0);
    }, 0);
  }, [onBudgetAccounts, selectedAccountIds]);

  const accountButtonLabel = useMemo(() => {
    if (isLoadingAccounts) {
      return 'Loading accounts...';
    }
    if (onBudgetAccounts.length === 0) {
      return 'No on-budget accounts';
    }
    if (selectedAccountIds.length === 0) {
      return 'All on-budget accounts';
    }
    if (selectedAccountIds.length === 1) {
      const account = onBudgetAccounts.find((item) => item.ID === selectedAccountIds[0]);
      return account?.Name ?? '1 account';
    }
    return `${selectedAccountIds.length} accounts`;
  }, [isLoadingAccounts, onBudgetAccounts, selectedAccountIds]);

  const chartData = useMemo<ChartDatum[]>(() => {
    if (!data || data.length === 0) {
      return [];
    }

    // Chart data is decimal currency units, converted from milliunits at this
    // mapping so the compact axis formatter and tooltips see currency values.
    const rows = data
      .map((row) => {
        const start = parseISO(row.PeriodStart);
        const end = parseISO(row.PeriodEnd);
        const income = toDecimal(row.TotalIncome ?? ZERO_MILLI);
        const expense = toDecimal(row.TotalExpense ?? ZERO_MILLI);
        return {
          periodKey: row.Period || row.PeriodStart,
          label: getLabel(grouping, start, end),
          rangeLabel: getRangeLabel(grouping, start, end),
          periodStart: row.PeriodStart,
          periodEnd: row.PeriodEnd,
          income,
          expense: -expense,
          net: income - expense,
        };
      })
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

    const totalNet = rows.reduce((sum, row) => sum + row.net, 0);
    // currentNetWorth is an integer milliunit sum of account balances.
    const baseNetWorth =
      typeof currentNetWorth === 'number' && Number.isFinite(currentNetWorth)
        ? toDecimal(asMilli(currentNetWorth)) - totalNet
        : 0;

    let runningNetWorth = baseNetWorth;

    return rows.map((row) => {
      runningNetWorth += row.net;
      return {
        ...row,
        netWorth: runningNetWorth,
      };
    });
  }, [data, grouping, currentNetWorth]);

  const compactFormatter = useCompactNumberFormat();

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      income: {
        label: 'Income',
        color: incomeColor,
      },
      expense: {
        label: 'Expense',
        color: expenseColor,
      },
      netWorth: {
        label: 'Net Worth',
        color: netWorthColor,
      },
    }),
    []
  );

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="text-lg font-semibold">Income vs expense trend</CardTitle>
          <CardDescription>
            Spot how cash flows in and out across the selected period grouping.
          </CardDescription>
        </div>
        <div className="flex w-full flex-wrap items-stretch gap-2 sm:justify-end">
          <div className="flex min-w-[200px] flex-1 sm:flex-initial">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between gap-2"
                  disabled={isLoadingAccounts || onBudgetAccounts.length === 0}
                >
                  <span className="truncate text-left">{accountButtonLabel}</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search accounts..." />
                  <CommandList className="max-h-64 overflow-y-auto">
                    <CommandEmpty>No accounts found.</CommandEmpty>
                    <CommandItem
                      value="__all__"
                      onSelect={() => setSelectedAccountIds([])}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          selectedAccountIds.length === 0 ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      All on-budget accounts
                    </CommandItem>
                    {onBudgetAccounts.length > 0 && (
                      <CommandGroup heading="Accounts">
                        {onBudgetAccounts.map((account) => {
                          const isSelected = selectedAccountIds.includes(account.ID);
                          return (
                            <CommandItem
                              key={account.ID}
                              value={account.Name}
                              onSelect={() => toggleAccount(account.ID)}
                              className="cursor-pointer"
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  isSelected ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              {account.Name}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex w-full justify-start sm:w-auto sm:justify-end">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              value={grouping}
              onValueChange={(value) => value && setGrouping(value as Grouping)}
            >
              {groupingOptions.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="px-2 py-1 text-xs"
                >
                  <span className="text-[11px] sm:text-xs">{option.label}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-2 pt-2 sm:space-y-4 sm:px-6">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[260px] w-full" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>No income or expense activity for the selected range.</p>
            <p>Adjust the filters or date range to explore other periods.</p>
          </div>
        ) : (
          <div className="h-[320px]">
            <ChartContainer config={chartConfig} className="h-full w-full -mx-1 sm:mx-0">
              <ResponsiveContainer>
                <ComposedChart
                  data={chartData}
                  margin={{ top: 32, bottom: 24, left: 0, right: 12 }}
                  stackOffset="sign"
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    fontSize={11}
                  />
                  <YAxis
                    yAxisId="flows"
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    fontSize={11}
                    tickFormatter={(value: number) =>
                      maskFormattedIfEnabled(compactFormatter.format(value), privacyMaskNumbers)
                    }
                  />
                  <YAxis
                    yAxisId="netWorth"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    fontSize={11}
                    tickFormatter={(value: number) =>
                      maskFormattedIfEnabled(compactFormatter.format(value), privacyMaskNumbers)
                    }
                  />
                  <ChartTooltip
                    cursor={{ fill: 'var(--color-muted)', opacity: 0.1 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const datum = payload[0].payload as ChartDatum;

                      return (
                        <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                          <div className="font-medium text-foreground">{datum.rangeLabel}</div>
                          <div className="mt-2 grid gap-1.5">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">Income</span>
                              <span className="font-mono">
                                {formatMaskedAmount(
                                  globalLocalizer,
                                  datum.income,
                                  privacyMaskNumbers
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">Expense</span>
                              <span className="font-mono">
                                {formatMaskedAmount(
                                  globalLocalizer,
                                  Math.abs(datum.expense),
                                  privacyMaskNumbers
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-1">
                              <span className="text-muted-foreground">Net</span>
                              <span className="font-mono">
                                {formatMaskedAmount(globalLocalizer, datum.net, privacyMaskNumbers)}
                              </span>
                            </div>
                            {typeof datum.netWorth === 'number' && (
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Net worth</span>
                                <span className="font-mono">
                                  {formatMaskedAmount(
                                    globalLocalizer,
                                    datum.netWorth,
                                    privacyMaskNumbers
                                  )}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    yAxisId="flows"
                    dataKey="income"
                    stackId="net"
                    fill={incomeColor}
                    radius={[4, 4, 0, 0]}
                    fillOpacity={0.95}
                    name="Income"
                  />
                  <Bar
                    yAxisId="flows"
                    dataKey="expense"
                    stackId="net"
                    fill={expenseColor}
                    radius={[0, 0, 4, 4]}
                    fillOpacity={0.95}
                    name="Expense"
                  />
                  <Line
                    yAxisId="netWorth"
                    type="monotone"
                    dataKey="netWorth"
                    stroke={netWorthColor}
                    strokeWidth={2.5}
                    dot={{
                      r: 3,
                      stroke: netWorthColor,
                      strokeWidth: 2,
                      fill: 'var(--color-background)',
                    }}
                    activeDot={{
                      r: 5,
                      stroke: netWorthColor,
                      strokeWidth: 2,
                      fill: 'var(--color-background)',
                    }}
                    name="Net worth"
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
