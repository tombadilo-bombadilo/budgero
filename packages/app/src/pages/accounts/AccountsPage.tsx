import { useUiStore } from '@shared/store/useUiStore';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useNetWorthHistory } from '@entities/account/api/useNetWorthHistory';
import {
  useMonthlyAssetHistory,
  type MonthlyAssetPoint,
} from '@entities/account/api/useMonthlyAssetHistory';
import { Card, CardContent, CardHeader } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { AlertCircle, Archive as ArchiveIcon, Search } from 'lucide-react';
import { Input } from '@shared/ui/input';
import { AddAccountDialog } from '@features/account-management/ui/AddAccountDialog';
import { DevSeedAccountsButton } from '@features/account-management/ui/DevSeedAccountsButton';
import { Button } from '@shared/ui/button';
import { useCallback, useMemo, useState } from 'react';
import { cn } from '@shared/lib/utils';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { PeriodTabs } from '@shared/ui/PeriodTabs';
import { DateRange } from 'react-day-picker';
import { differenceInMonths, differenceInDays } from 'date-fns';
import { useUncategorizedTransactions } from '@entities/transaction/api/useUncategorizedTransactions';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { isLiabilityType } from '@entities/account/model/accountTypes';
import {
  AccountGroupSection,
  AssetLiabilityHistoryChart,
  BreakdownSection,
  NetWorthCard,
} from './components';
import { useFutureBalanceAdjustments } from './hooks/useFutureBalanceAdjustments';

const CHART_COLORS = {
  cash: 'var(--color-chart-1)',
  credit: 'var(--color-chart-2)',
  investments: 'var(--color-account-investment)',
  retirement: 'var(--color-account-retirement)',
  loans: 'var(--color-chart-4)',
  realEstate: 'var(--color-account-real-estate)',
  otherAssets: 'var(--color-account-other-asset)',
} as const;

export default function AccountsPage() {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const globalLocalizer = useUiStore((s) => s.globalLocalizer);
  const privacyMaskNumbers = useUiStore((s) => s.privacyMaskNumbers);
  const budgetId = selectedBudget?.ID || 0;

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [activeTab, setActiveTab] = useState('summary');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    cash: true,
    credit: true,
    investments: true,
    retirement: true,
    loans: true,
    realEstate: true,
    otherAssets: true,
  });

  const periodMonths = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return 1;
    const months = differenceInMonths(dateRange.to, dateRange.from);
    const days = differenceInDays(dateRange.to, dateRange.from);
    if (months === 0) {
      return Math.max(0.25, days / 30);
    }
    return Math.max(1, months);
  }, [dateRange]);

  const periodLabel = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return '1 month';
    const months = differenceInMonths(dateRange.to, dateRange.from);
    const days = differenceInDays(dateRange.to, dateRange.from);
    if (days <= 7) return '1 week';
    if (months < 1) return `${days} days`;
    if (months === 1) return '1 month';
    if (months === 3) return '3 months';
    if (months >= 12) return 'YTD';
    return `${months} months`;
  }, [dateRange]);

  const { data: allAccountsData = [], isLoading } = useAccounts(budgetId);
  const [showArchived, setShowArchived] = useState(false);
  const [accountQuery, setAccountQuery] = useState('');
  // Exclude archived accounts from the main groups/net worth calculations; the user
  // opted them out of the active picture. They are still reachable via the toggle below.
  const accountsData = useMemo(() => allAccountsData.filter((a) => !a.Archived), [allAccountsData]);
  const archivedAccountsData = useMemo(
    () => allAccountsData.filter((a) => a.Archived),
    [allAccountsData]
  );
  const { data: netWorthChartData = [] } = useNetWorthHistory(budgetId, periodMonths);
  const { data: monthlyAssetHistory = [] } = useMonthlyAssetHistory(budgetId, 24);
  const { data: uncategorizedData } = useUncategorizedTransactions(budgetId);
  const futureAdjustments = useFutureBalanceAdjustments(accountsData);

  const accounts = useMemo(() => {
    if (accountsData.length === 0) return [];

    return accountsData.map((account) => {
      const adjustment = futureAdjustments[account.ID] || { original: 0, converted: 0 };
      const adjustedBalance = (account.Balance ?? 0) - adjustment.original;
      const hasConverted =
        account.BalanceConverted !== undefined && account.BalanceConverted !== null;
      const baseConverted = hasConverted
        ? (account.BalanceConverted ?? 0) - adjustment.converted
        : adjustedBalance;

      return {
        ...account,
        Balance: adjustedBalance,
        BalanceConverted: hasConverted ? baseConverted : account.BalanceConverted,
      };
    });
  }, [accountsData, futureAdjustments]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const { netWorth, totalAssets, totalLiabilities, accountGroups, netWorthChange, groupTrends } =
    useMemo(() => {
      const assets = accounts.filter((a) => !isLiabilityType(a.Type));
      const liabilities = accounts.filter((a) => isLiabilityType(a.Type));

      const assetsTotal = assets.reduce(
        (sum, a) => sum + (a.BalanceConverted ?? a.Balance ?? 0),
        0
      );
      const liabilitiesTotal = Math.abs(
        liabilities.reduce((sum, a) => sum + (a.BalanceConverted ?? a.Balance ?? 0), 0)
      );
      const netWorth = assetsTotal - liabilitiesTotal;

      let realChange = 0;
      if (netWorthChartData.length >= 2) {
        const firstValue = netWorthChartData[0].netWorth;
        const lastValue = netWorthChartData[netWorthChartData.length - 1].netWorth;
        realChange = lastValue - firstValue;
      }

      const groups = {
        cash: accounts.filter((a) => ['Checking', 'Savings', 'Cash'].includes(a.Type || '')),
        credit: accounts.filter((a) => a.Type === 'Credit'),
        loans: accounts.filter((a) => ['Loan', 'Mortgage'].includes(a.Type || '')),
        realEstate: accounts.filter((a) => a.Type === 'Real Estate'),
        otherAssets: accounts.filter((a) => a.Type === 'Other Asset'),
        investments: accounts.filter((a) => a.Type === 'Investment'),
        retirement: accounts.filter((a) => a.Type === 'Retirement'),
      };

      const calculateGroupTrend = (groupAccounts: typeof accounts, isLiabilityGroup = false) => {
        const currentTotal = groupAccounts.reduce(
          (sum, acc) => sum + Math.abs(acc.BalanceConverted ?? acc.Balance ?? 0),
          0
        );
        if (currentTotal === 0 || netWorthChartData.length < 2) return { change: 0, percentage: 0 };

        const firstDataPoint = netWorthChartData[0];
        const lastDataPoint = netWorthChartData[netWorthChartData.length - 1];
        if (!firstDataPoint || !lastDataPoint) return { change: 0, percentage: 0 };

        let startValue: number;
        let endValue: number;

        if (isLiabilityGroup) {
          const groupProportion = currentTotal / (liabilitiesTotal || 1);
          startValue = firstDataPoint.totalLiabilities * groupProportion;
          endValue = lastDataPoint.totalLiabilities * groupProportion;
        } else {
          const groupProportion = currentTotal / (assetsTotal || 1);
          startValue = firstDataPoint.totalAssets * groupProportion;
          endValue = lastDataPoint.totalAssets * groupProportion;
        }

        const change = endValue - startValue;
        const percentage = startValue !== 0 ? (change / Math.abs(startValue)) * 100 : 0;

        return {
          // milli × proportion is float milli; round back to integer milliunits
          change: roundMilli(change),
          percentage: Math.round(percentage * 10) / 10,
        };
      };

      const trends = {
        cash: calculateGroupTrend(groups.cash, false),
        credit: calculateGroupTrend(groups.credit, true),
        loans: calculateGroupTrend(groups.loans, true),
        realEstate: calculateGroupTrend(groups.realEstate, false),
        otherAssets: calculateGroupTrend(groups.otherAssets, false),
        investments: calculateGroupTrend(groups.investments, false),
        retirement: calculateGroupTrend(groups.retirement, false),
      };

      return {
        netWorth,
        totalAssets: assetsTotal,
        totalLiabilities: liabilitiesTotal,
        accountGroups: groups,
        netWorthChange: realChange,
        groupTrends: trends,
      };
    }, [accounts, netWorthChartData]);

  // Account name search. Net-worth totals stay based on the full set; only the
  // rendered group lists are filtered so typing doesn't make balances jump around.
  const trimmedQuery = accountQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const matchesQuery = useCallback(
    (a: { Name?: string }) => (a.Name || '').toLowerCase().includes(trimmedQuery),
    [trimmedQuery]
  );
  const filteredGroups = useMemo(() => {
    if (!isSearching) return accountGroups;
    return {
      cash: accountGroups.cash.filter(matchesQuery),
      credit: accountGroups.credit.filter(matchesQuery),
      loans: accountGroups.loans.filter(matchesQuery),
      realEstate: accountGroups.realEstate.filter(matchesQuery),
      otherAssets: accountGroups.otherAssets.filter(matchesQuery),
      investments: accountGroups.investments.filter(matchesQuery),
      retirement: accountGroups.retirement.filter(matchesQuery),
    };
  }, [accountGroups, isSearching, matchesQuery]);
  const visibleArchived = isSearching
    ? archivedAccountsData.filter(matchesQuery)
    : archivedAccountsData;
  const noMatches =
    isSearching &&
    Object.values(filteredGroups).every((list) => list.length === 0) &&
    visibleArchived.length === 0;

  // Milli-in: every balance/total on this page is an integer milliunit amount.
  const formatCurrency = (value: number) =>
    formatMaskedMilli(globalLocalizer, value, privacyMaskNumbers);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-8 w-48" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-96" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 pb-20 lg:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <h1 className="text-xl sm:text-2xl font-bold">Accounts</h1>
          <PeriodTabs value={dateRange} onChange={setDateRange} defaultPeriod="1M" />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {uncategorizedData && uncategorizedData.total > 0 && (
            <div className="flex shrink-0 items-center gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap text-sm font-medium">
                {uncategorizedData.total} uncategorized
              </span>
            </div>
          )}
          {archivedAccountsData.length > 0 && (
            <Button
              variant={showArchived ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowArchived((v) => !v)}
              className="gap-1.5"
            >
              <ArchiveIcon className="h-4 w-4" />
              {showArchived ? 'Hide Archived' : 'Show Archived'}
              <span className="text-xs text-muted-foreground">({archivedAccountsData.length})</span>
            </Button>
          )}
          {import.meta.env.DEV && <DevSeedAccountsButton />}
          <AddAccountDialog />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="xl:col-span-2 space-y-6">
          {/* Net Worth Summary */}
          <NetWorthCard
            netWorth={netWorth}
            netWorthChange={netWorthChange}
            periodLabel={periodLabel}
            chartData={netWorthChartData}
            formatCurrency={formatCurrency}
          />

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
              placeholder="Search accounts…"
              className="pl-9"
              aria-label="Search accounts"
            />
          </div>

          {/* Account Groups */}
          <div className="space-y-4">
            <AccountGroupSection
              title="Cash"
              accounts={filteredGroups.cash}
              isOpen={isSearching || openSections.cash}
              onToggle={() => toggleSection('cash')}
              trend={groupTrends.cash}
              periodLabel={periodLabel}
              periodMonths={periodMonths}
              chartColor={CHART_COLORS.cash}
              formatCurrency={formatCurrency}
            />

            <AccountGroupSection
              title="Credit Cards"
              accounts={filteredGroups.credit}
              isOpen={isSearching || openSections.credit}
              onToggle={() => toggleSection('credit')}
              trend={groupTrends.credit}
              periodLabel={periodLabel}
              periodMonths={periodMonths}
              chartColor={CHART_COLORS.credit}
              isLiability
              formatCurrency={formatCurrency}
            />

            <AccountGroupSection
              title="Investments"
              accounts={filteredGroups.investments}
              isOpen={isSearching || openSections.investments}
              onToggle={() => toggleSection('investments')}
              trend={groupTrends.investments}
              periodLabel={periodLabel}
              periodMonths={periodMonths}
              chartColor={CHART_COLORS.investments}
              formatCurrency={formatCurrency}
            />

            <AccountGroupSection
              title="Retirement"
              accounts={filteredGroups.retirement}
              isOpen={isSearching || openSections.retirement}
              onToggle={() => toggleSection('retirement')}
              trend={groupTrends.retirement}
              periodLabel={periodLabel}
              periodMonths={periodMonths}
              chartColor={CHART_COLORS.retirement}
              formatCurrency={formatCurrency}
            />

            <AccountGroupSection
              title="Loans & Mortgages"
              accounts={filteredGroups.loans}
              isOpen={isSearching || openSections.loans}
              onToggle={() => toggleSection('loans')}
              trend={groupTrends.loans}
              periodLabel={periodLabel}
              periodMonths={periodMonths}
              chartColor={CHART_COLORS.loans}
              isLiability
              formatCurrency={formatCurrency}
            />

            <AccountGroupSection
              title="Real Estate"
              accounts={filteredGroups.realEstate}
              isOpen={isSearching || openSections.realEstate}
              onToggle={() => toggleSection('realEstate')}
              trend={groupTrends.realEstate}
              periodLabel={periodLabel}
              periodMonths={periodMonths}
              chartColor={CHART_COLORS.realEstate}
              formatCurrency={formatCurrency}
            />

            <AccountGroupSection
              title="Other Assets"
              accounts={filteredGroups.otherAssets}
              isOpen={isSearching || openSections.otherAssets}
              onToggle={() => toggleSection('otherAssets')}
              trend={groupTrends.otherAssets}
              periodLabel={periodLabel}
              periodMonths={periodMonths}
              chartColor={CHART_COLORS.otherAssets}
              formatCurrency={formatCurrency}
            />

            {showArchived && visibleArchived.length > 0 && (
              <AccountGroupSection
                title="Archived"
                accounts={visibleArchived}
                isOpen={isSearching || (openSections.archived ?? true)}
                onToggle={() => toggleSection('archived')}
                trend={{ change: 0, percentage: 0 }}
                periodLabel={periodLabel}
                periodMonths={periodMonths}
                chartColor={CHART_COLORS.otherAssets}
                formatCurrency={formatCurrency}
              />
            )}

            {noMatches && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No accounts match “{accountQuery.trim()}”.
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              {/* Custom Styled Tabs */}
              <div className="flex items-center p-1 bg-muted rounded-lg">
                {['summary', 'totals', 'percent', 'history'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'flex-1 py-1.5 px-2 sm:py-2 sm:px-3 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 capitalize',
                      activeTab === tab
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <SidebarContent
                activeTab={activeTab}
                totalAssets={totalAssets}
                totalLiabilities={totalLiabilities}
                netWorth={netWorth}
                accountGroups={accountGroups}
                formatCurrency={formatCurrency}
                monthlyAssetHistory={monthlyAssetHistory}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

interface SidebarContentProps {
  activeTab: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  accountGroups: {
    cash: { BalanceConverted?: number; Balance?: number }[];
    credit: { BalanceConverted?: number; Balance?: number }[];
    loans: { BalanceConverted?: number; Balance?: number }[];
    realEstate: { BalanceConverted?: number; Balance?: number }[];
    otherAssets: { BalanceConverted?: number; Balance?: number }[];
    investments: { BalanceConverted?: number; Balance?: number }[];
    retirement: { BalanceConverted?: number; Balance?: number }[];
  };
  formatCurrency: (value: number) => string;
  monthlyAssetHistory: MonthlyAssetPoint[];
}

function SidebarContent({
  activeTab,
  totalAssets,
  totalLiabilities,
  netWorth,
  accountGroups,
  formatCurrency,
  monthlyAssetHistory,
}: SidebarContentProps) {
  const getGroupTotal = (
    group: { BalanceConverted?: number; Balance?: number }[],
    absolute = false
  ) => {
    const total = group.reduce((sum, acc) => sum + (acc.BalanceConverted ?? acc.Balance ?? 0), 0);
    return absolute ? Math.abs(total) : total;
  };

  const cashTotal = getGroupTotal(accountGroups.cash);
  const investmentsTotal = getGroupTotal(accountGroups.investments);
  const retirementTotal = getGroupTotal(accountGroups.retirement);
  const realEstateTotal = getGroupTotal(accountGroups.realEstate);
  const otherAssetsTotal = getGroupTotal(accountGroups.otherAssets);
  const loansTotal = getGroupTotal(accountGroups.loans, true);
  const creditTotal = getGroupTotal(accountGroups.credit, true);

  const showPercent = activeTab === 'percent';
  const showNetWorth = activeTab === 'totals';

  const formatValue = (value: number, total: number) => {
    if (showPercent) {
      return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%';
    }
    return formatCurrency(value);
  };

  const assetCategories = [
    {
      label: 'Investments',
      color: '#22d3ee',
      value: investmentsTotal,
      show: accountGroups.investments.length > 0,
    },
    {
      label: 'Retirement',
      color: '#f59e0b',
      value: retirementTotal,
      show: accountGroups.retirement.length > 0,
    },
    {
      label: 'Real Estate',
      color: '#a855f7',
      value: realEstateTotal,
      show: accountGroups.realEstate.length > 0,
    },
    {
      label: 'Other Assets',
      color: '#64748b',
      value: otherAssetsTotal,
      show: accountGroups.otherAssets.length > 0,
    },
    { label: 'Cash', color: '#06b6d4', value: cashTotal, show: true },
  ].filter((c) => c.show);

  const liabilityCategories = [
    { label: 'Loans', color: '#eab308', value: loansTotal, show: accountGroups.loans.length > 0 },
    {
      label: 'Credit Cards',
      color: '#ef4444',
      value: creditTotal,
      show: accountGroups.credit.length > 0,
    },
  ].filter((c) => c.show);

  if (activeTab === 'history') {
    return (
      <AssetLiabilityHistoryChart
        monthlyAssetHistory={monthlyAssetHistory}
        netWorth={netWorth}
        formatCurrency={formatCurrency}
      />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {showNetWorth && (
        <div>
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-xs sm:text-sm font-medium">Net Worth</span>
            <span className="text-sm sm:text-xl font-bold tabular-nums">
              {formatCurrency(netWorth)}
            </span>
          </div>
        </div>
      )}

      {/* Assets Section */}
      <BreakdownSection
        title={showNetWorth ? 'Total Assets' : 'Assets'}
        total={totalAssets}
        categories={assetCategories}
        showPercent={showPercent}
        formatCurrency={formatCurrency}
        formatValue={formatValue}
      />

      {/* Liabilities Section */}
      {totalLiabilities > 0 && (
        <BreakdownSection
          title={showNetWorth ? 'Total Liabilities' : 'Liabilities'}
          total={totalLiabilities}
          categories={liabilityCategories}
          showPercent={showPercent}
          formatCurrency={formatCurrency}
          formatValue={formatValue}
        />
      )}
    </div>
  );
}
