import { Trans } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { subDays } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { useUiStore } from '@shared/store/useUiStore';
import { useDashboardMetrics } from '@features/analytics/api/useDashboardMetrics';
import { SpendingBreakdownContent } from '@features/analytics/ui/SpendingBreakdownContent';
import { SpendingOverviewContent } from '@features/analytics/ui/SpendingOverviewContent';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';
import { AtAGlance } from '@widgets/dashboard/AtAGlance';
import { UpcomingTransactionsCard } from '@widgets/dashboard/UpcomingTransactionsCard';
import { UncategorizedTransactionsCard } from '@widgets/dashboard/UncategorizedTransactionsCard';
import { OverspentCategoriesCard } from '@widgets/dashboard/OverspentCategoriesCard';
import { CashflowTrendCard } from '@widgets/dashboard/CashflowTrendCard';
import { TrendIndicator } from '@widgets/dashboard/TrendIndicator';
import { BalanceAreaChart } from '@widgets/dashboard/BalanceAreaChart';
import type { BuiltinCardKey } from './builtin-cards';
import { useDashboardPeriod } from './useDashboardPeriod';

/**
 * The metrics of the active period, resolved the way each old home page did:
 * desktop passes the raw range, the phone falls back to the last 30 days.
 */
function usePeriodMetrics() {
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const { dateRange, platform } = useDashboardPeriod();

  const { from, to } = useMemo(() => {
    if (platform === 'desktop') return { from: dateRange?.from ?? null, to: dateRange?.to ?? null };
    if (!dateRange?.from || !dateRange?.to) {
      const now = new Date();
      return { from: subDays(now, 30), to: now };
    }
    return { from: dateRange.from, to: dateRange.to };
  }, [dateRange, platform]);

  const metrics = useDashboardMetrics(budgetId, from, to);
  // Decimal-in formatter for chart values (chart data is converted below).
  const formatAmount = useFormatMaskedAmount(globalLocalizer);
  // Milli-in formatter for stored amounts coming out of the metrics hook.
  const formatMilliAmount = useMemo(
    () => (m: number) => formatMaskedMilli(globalLocalizer, m, privacyMaskNumbers),
    [globalLocalizer, privacyMaskNumbers]
  );
  return { budgetId, globalLocalizer, metrics, formatAmount, formatMilliAmount, platform };
}

function CashBalanceCard() {
  const { metrics, formatAmount, formatMilliAmount, platform } = usePeriodMetrics();
  const { totalBalance, balanceChartData, balanceTrend } = metrics;
  // Charts render decimal currency units; convert milliunits at the mapping.
  const balanceChartDecimal = useMemo(
    () => balanceChartData.map((p) => ({ ...p, balance: toDecimal(asMilli(p.balance)) })),
    [balanceChartData]
  );

  if (platform === 'mobile') {
    return (
      <Card>
        <CardHeader className="pb-0 text-center">
          <CardTitle className="text-base font-medium">
            <Trans>Cash Balance</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center mb-4 text-muted-foreground">
            <div className="text-2xl font-medium">{formatMilliAmount(totalBalance)}</div>
            <div className="text-sm opacity-70">
              <Trans>checking, savings & cash</Trans>
            </div>
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
    );
  }

  return (
    <Card className="bg-primary/[0.03] dark:bg-primary/[0.06] border-primary/20">
      <CardContent className="pt-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          <Trans>Cash Balance</Trans>
        </div>
        <div className="flex items-center gap-8">
          <div className="shrink-0">
            <div className="text-4xl font-semibold text-foreground tabular-nums">
              {formatMilliAmount(totalBalance)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              <Trans>checking, savings & cash</Trans>
            </div>
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
            className="h-[140px] min-w-0 flex-1 overflow-hidden"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SpendingBreakdownCard() {
  const { metrics, formatMilliAmount } = usePeriodMetrics();
  const { totalSpending, spendingTrend } = metrics;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          <Trans>Spending Breakdown</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="text-2xl font-semibold text-foreground tabular-nums">
            {formatMilliAmount(totalSpending)}
          </div>
          <div className="text-sm text-muted-foreground">
            <Trans>total spent</Trans>
          </div>
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
  );
}

function SpendingOverviewCard() {
  const { metrics, formatMilliAmount } = usePeriodMetrics();
  const { budgetRemaining, totalAssignedAmount } = metrics;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          <Trans>Spending Overview</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="text-foreground tabular-nums">
            <span className="text-2xl font-semibold">{formatMilliAmount(budgetRemaining)}</span>{' '}
            <span className="text-lg font-normal text-muted-foreground">
              <Trans>left</Trans>
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            <Trans>out of {formatMilliAmount(totalAssignedAmount || 0)} budgeted</Trans>
          </div>
        </div>
        <SpendingOverviewContent />
      </CardContent>
    </Card>
  );
}

/** The phone home's spending card: breakdown and time series behind tabs. */
function SpendingTabsCard() {
  const { metrics, formatMilliAmount } = usePeriodMetrics();
  const { totalSpending, spendingTrend, budgetRemaining, totalAssignedAmount } = metrics;
  const [activeTab, setActiveTab] = useState<'breakdown' | 'timeseries'>('breakdown');
  return (
    <Card>
      <CardHeader className="pb-0 text-center">
        <CardTitle className="text-base font-medium">
          <Trans>Spending Analysis</Trans>
        </CardTitle>
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
                <Trans>Breakdown</Trans>
              </TabsTrigger>
              <TabsTrigger
                value="timeseries"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full data-[state=active]:shadow-none"
              >
                <Trans>Time Series</Trans>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="text-center mb-4 text-muted-foreground">
            {activeTab === 'breakdown' ? (
              <div>
                <div className="text-2xl font-medium">{formatMilliAmount(totalSpending)}</div>
                <div className="text-sm opacity-70">
                  <Trans>total spent</Trans>
                </div>
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
                  <Trans>{formatMilliAmount(budgetRemaining)} left</Trans>
                </div>
                <div className="text-sm opacity-70">
                  <Trans>out of {formatMilliAmount(totalAssignedAmount || 0)} budgeted</Trans>
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
  );
}

function CashflowCard() {
  const { budgetId, globalLocalizer, metrics } = usePeriodMetrics();
  return (
    <CashflowTrendCard
      budgetId={budgetId}
      globalLocalizer={globalLocalizer}
      startDate={metrics.startDateISO}
      endDate={metrics.endDateISO}
    />
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 border-t border-border/40" />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
      <div className="flex-1 border-t border-border/40" />
    </div>
  );
}

function UnknownBuiltinCard({ title }: { title?: string }) {
  return (
    <Card className="h-full border-dashed">
      <CardHeader>
        <CardTitle className="text-base">{title || <Trans>Card</Trans>}</CardTitle>
        <CardDescription>
          <Trans>This card comes from a newer version of Budgero. Update the app to see it.</Trans>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function BudgetCard({ kind }: { kind: 'upcoming' | 'uncategorized' }) {
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  return kind === 'upcoming' ? (
    <UpcomingTransactionsCard budgetId={budgetId} globalLocalizer={globalLocalizer} />
  ) : (
    <UncategorizedTransactionsCard budgetId={budgetId} globalLocalizer={globalLocalizer} />
  );
}

/** One built-in card, drawn exactly as on the old home page. */
export function BuiltinCard({
  cardKey,
  fallbackTitle,
}: {
  cardKey: BuiltinCardKey | 'unknown';
  fallbackTitle?: string;
}) {
  switch (cardKey) {
    case 'cash_balance':
      return <CashBalanceCard />;
    case 'at_a_glance':
      return <AtAGlance />;
    case 'cashflow_trend':
      return <CashflowCard />;
    case 'overspent':
      return <OverspentCategoriesCard />;
    case 'section_spending':
      return (
        <SectionHeading>
          <Trans>Spending Analysis</Trans>
        </SectionHeading>
      );
    case 'spending_breakdown':
      return <SpendingBreakdownCard />;
    case 'spending_overview':
      return <SpendingOverviewCard />;
    case 'spending_tabs':
      return <SpendingTabsCard />;
    case 'section_actions':
      return (
        <SectionHeading>
          <Trans>Action Items</Trans>
        </SectionHeading>
      );
    case 'upcoming':
      return <BudgetCard kind="upcoming" />;
    case 'uncategorized':
      return <BudgetCard kind="uncategorized" />;
    default:
      return <UnknownBuiltinCard title={fallbackTitle} />;
  }
}
