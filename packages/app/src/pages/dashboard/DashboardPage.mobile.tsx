import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { useUiStore } from '@shared/store/useUiStore';
import { useDashboardMetrics } from '@features/analytics/api/useDashboardMetrics';
import { subDays } from 'date-fns';
import { PeriodTabs } from '@shared/ui/PeriodTabs';
import { DateRange } from 'react-day-picker';
import { SpendingBreakdownContent } from '@features/analytics/ui/SpendingBreakdownContent';
import { SpendingOverviewContent } from '@features/analytics/ui/SpendingOverviewContent';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { AtAGlance } from '@widgets/dashboard/AtAGlance';
import { UpcomingTransactionsCard } from '@widgets/dashboard/UpcomingTransactionsCard';
import { UncategorizedTransactionsCard } from '@widgets/dashboard/UncategorizedTransactionsCard';
import { TrialRewardsProgressCard } from '@widgets/dashboard/TrialRewardsProgressCard';
import { OverspentCategoriesCard } from '@widgets/dashboard/OverspentCategoriesCard';
import { CashflowTrendCard } from '@widgets/dashboard/CashflowTrendCard';
import { TrendIndicator } from '@widgets/dashboard/TrendIndicator';
import { BalanceAreaChart } from '@widgets/dashboard/BalanceAreaChart';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

export function DashboardPageMobile() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });
  const [activeTab, setActiveTab] = useState<'breakdown' | 'timeseries'>('breakdown');

  // Sync local date range with global store
  const setGlobalDateRange = useUiStore((state) => state.setDateRange);
  useEffect(() => {
    setGlobalDateRange(dateRange);
  }, [dateRange, setGlobalDateRange]);

  const budgetId = selectedBudget?.ID || 0;

  // Resolve the active range to Date forms, falling back to the last 30 days
  // when no range is selected (mobile-specific default).
  const { startDate, endDate } = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) {
      const now = new Date();
      return {
        startDate: subDays(now, 30),
        endDate: now,
      };
    }
    return {
      startDate: dateRange.from,
      endDate: dateRange.to,
    };
  }, [dateRange]);

  const {
    startDateISO,
    endDateISO,
    totalBalance,
    totalAssignedAmount,
    balanceChartData,
    totalSpending,
    spendingTrend,
    balanceTrend,
    budgetRemaining,
  } = useDashboardMetrics(budgetId, startDate, endDate);

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
    <div className="p-4 pb-20">
      {/* At a Glance */}
      <div className="mb-4">
        <AtAGlance />
      </div>

      <div className="mb-4">
        <OverspentCategoriesCard />
      </div>

      {/* Period Selector */}
      <div className="flex justify-center mb-4">
        <PeriodTabs value={dateRange} onChange={setDateRange} />
      </div>

      {/* Balance Card */}
      <Card className="mb-4">
        <CardHeader className="pb-0 text-center">
          <CardTitle className="text-base font-medium">Cash Balance</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Summary Text */}
          <div className="text-center mb-4 text-muted-foreground">
            <div className="text-2xl font-medium">{formatMilliAmount(totalBalance)}</div>
            <div className="text-sm opacity-70">checking, savings & cash</div>
            {/* Trend Indicator */}
            {balanceTrend.change !== 0 && (
              <TrendIndicator
                change={balanceTrend.change}
                percentage={balanceTrend.percentage}
                formatAmount={formatMilliAmount}
                center
              />
            )}
          </div>

          <BalanceAreaChart
            data={balanceChartDecimal}
            formatAmount={formatAmount}
            className="h-[200px] w-full"
            tickFontSize={10}
          />
        </CardContent>
      </Card>

      {/* Spending Card with Tabs */}
      <Card className="mb-4">
        <CardHeader className="pb-0 text-center">
          <CardTitle className="text-base font-medium">Spending Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'breakdown' | 'timeseries')}
            className="w-full"
          >
            <div className="flex justify-center mb-4">
              <TabsList className="gap-1 bg-transparent">
                <TabsTrigger
                  value="breakdown"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full data-[state=active]:shadow-none"
                >
                  Breakdown
                </TabsTrigger>
                <TabsTrigger
                  value="timeseries"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full data-[state=active]:shadow-none"
                >
                  Time Series
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Summary Text */}
            <div className="text-center mb-4 text-muted-foreground">
              {activeTab === 'breakdown' ? (
                <div>
                  <div className="text-2xl font-medium">{formatMilliAmount(totalSpending)}</div>
                  <div className="text-sm opacity-70">total spent</div>
                  {/* Spending Trend Indicator */}
                  {spendingTrend.change !== 0 && (
                    <TrendIndicator
                      change={spendingTrend.change}
                      percentage={spendingTrend.percentage}
                      formatAmount={formatMilliAmount}
                      invert
                      center
                    />
                  )}
                </div>
              ) : (
                <div>
                  <div className="text-2xl font-medium">
                    {formatMilliAmount(budgetRemaining)} left
                  </div>
                  <div className="text-sm opacity-70">
                    out of {formatMilliAmount(totalAssignedAmount || 0)} budgeted
                  </div>
                </div>
              )}
            </div>

            <TabsContent value="breakdown" className="mt-0">
              <SpendingBreakdownContent />
            </TabsContent>
            <TabsContent value="timeseries" className="mt-0">
              <SpendingOverviewContent />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="mt-4">
        <CashflowTrendCard
          budgetId={budgetId}
          globalLocalizer={globalLocalizer}
          startDate={startDateISO}
          endDate={endDateISO}
        />
      </div>

      {/* Upcoming Transactions and Needs Categorising */}
      <div className="mt-4 space-y-4">
        <UpcomingTransactionsCard budgetId={budgetId} globalLocalizer={globalLocalizer} />
        <UncategorizedTransactionsCard budgetId={budgetId} globalLocalizer={globalLocalizer} />
      </div>

      {/* Trial Rewards (hides itself for paid users + post-trial-window) */}
      <div className="mt-4">
        <TrialRewardsProgressCard />
      </div>
    </div>
  );
}
