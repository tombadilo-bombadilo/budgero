import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { DateRange } from 'react-day-picker';
import { subDays } from 'date-fns';
import { useUiStore } from '@shared/store/useUiStore';
import { useDashboardMetrics } from '@features/analytics/api/useDashboardMetrics';
import { PeriodTabs } from '@shared/ui/PeriodTabs';
import { SpendingBreakdownContent } from '@features/analytics/ui/SpendingBreakdownContent';
import { SpendingOverviewContent } from '@features/analytics/ui/SpendingOverviewContent';

import { AtAGlance } from '@widgets/dashboard/AtAGlance';
import { UpcomingTransactionsCard } from '@widgets/dashboard/UpcomingTransactionsCard';
import { UncategorizedTransactionsCard } from '@widgets/dashboard/UncategorizedTransactionsCard';
import { OverspentCategoriesCard } from '@widgets/dashboard/OverspentCategoriesCard';
import { TrialRewardsProgressCard } from '@widgets/dashboard/TrialRewardsProgressCard';
import { CashflowTrendCard } from '@widgets/dashboard/CashflowTrendCard';
import { TrendIndicator } from '@widgets/dashboard/TrendIndicator';
import { BalanceAreaChart } from '@widgets/dashboard/BalanceAreaChart';

import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

export function DashboardPageDesktop() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  // Own the dashboard's period range locally so other pages (e.g. Prebuilt Reports'
  // "All Time") can't overwrite the 1W/1M/3M/YTD selection via the shared store.
  // We still push it into the store one-way so shared analytics widgets stay in sync.
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const setGlobalDateRange = useUiStore((state) => state.setDateRange);
  useEffect(() => {
    setGlobalDateRange(dateRange);
  }, [dateRange, setGlobalDateRange]);

  const budgetId = selectedBudget?.ID || 0;

  const {
    startDateISO: startDate,
    endDateISO: endDate,
    totalBalance,
    totalAssignedAmount,
    balanceChartData,
    totalSpending,
    spendingTrend,
    balanceTrend,
    budgetRemaining,
  } = useDashboardMetrics(budgetId, dateRange?.from ?? null, dateRange?.to ?? null);

  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  // Decimal-in formatter for chart values (chart data is converted below).
  const formatAmount = useFormatMaskedAmount(globalLocalizer);
  // Milli-in formatter for stored amounts coming out of the metrics hook.
  const formatMilliAmount = useMemo(
    () => (m: number) => formatMaskedMilli(globalLocalizer, m, privacyMaskNumbers),
    [globalLocalizer, privacyMaskNumbers]
  );
  // Charts render decimal currency units; convert milliunits at the mapping.
  const balanceChartDecimal = useMemo(
    () => balanceChartData.map((p) => ({ ...p, balance: toDecimal(asMilli(p.balance)) })),
    [balanceChartData]
  );

  return (
    <div className="px-8 py-6 space-y-6">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <PeriodTabs value={dateRange} onChange={setDateRange} />
      </div>

      {/* Cash Balance Hero (full width, tinted) */}
      <Card className="bg-primary/[0.03] dark:bg-primary/[0.06] border-primary/20">
        <CardContent className="pt-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Cash Balance
          </div>
          <div className="flex items-center gap-8">
            <div className="shrink-0">
              <div className="text-4xl font-semibold text-foreground tabular-nums">
                {formatMilliAmount(totalBalance)}
              </div>
              <div className="text-sm text-muted-foreground mt-1">checking, savings & cash</div>
              {balanceTrend.change !== 0 && (
                <TrendIndicator
                  change={balanceTrend.change}
                  percentage={balanceTrend.percentage}
                  formatAmount={formatMilliAmount}
                />
              )}
            </div>
            <BalanceAreaChart
              data={balanceChartDecimal}
              formatAmount={formatAmount}
              className="h-[140px] flex-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* At a Glance (full width) */}
      <AtAGlance />

      {/* Cashflow + Overspent (2/3 + 1/3) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CashflowTrendCard
            budgetId={budgetId}
            globalLocalizer={globalLocalizer}
            startDate={startDate}
            endDate={endDate}
          />
        </div>
        <OverspentCategoriesCard />
      </div>

      {/* Spending Analysis Section Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 border-t border-border/40" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Spending Analysis
        </span>
        <div className="flex-1 border-t border-border/40" />
      </div>

      {/* Spending Analysis - Desktop split into two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Spending Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="text-2xl font-semibold text-foreground tabular-nums">
                {formatMilliAmount(totalSpending)}
              </div>
              <div className="text-sm text-muted-foreground">total spent</div>
              {spendingTrend.change !== 0 && (
                <TrendIndicator
                  change={spendingTrend.change}
                  percentage={spendingTrend.percentage}
                  formatAmount={formatMilliAmount}
                  invert
                />
              )}
            </div>
            <SpendingBreakdownContent />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Spending Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="text-foreground tabular-nums">
                <span className="text-2xl font-semibold">{formatMilliAmount(budgetRemaining)}</span>{' '}
                <span className="text-lg font-normal text-muted-foreground">left</span>
              </div>
              <div className="text-sm text-muted-foreground">
                out of {formatMilliAmount(totalAssignedAmount || 0)} budgeted
              </div>
            </div>
            <SpendingOverviewContent />
          </CardContent>
        </Card>
      </div>

      {/* Action Items Section Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 border-t border-border/40" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Action Items
        </span>
        <div className="flex-1 border-t border-border/40" />
      </div>

      {/* Upcoming Transactions and Needs Categorising */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <UpcomingTransactionsCard budgetId={budgetId} globalLocalizer={globalLocalizer} />
        <UncategorizedTransactionsCard budgetId={budgetId} globalLocalizer={globalLocalizer} />
      </div>

      {/* Trial Rewards (hides itself for paid users + post-trial-window) */}
      <TrialRewardsProgressCard />
    </div>
  );
}
