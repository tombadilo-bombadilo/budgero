import { useMemo } from 'react';
import { useUiStore } from '@shared/store/useUiStore';

import { startOfDay, endOfDay } from 'date-fns';
import { List, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { TooltipProvider } from '@shared/ui/tooltip';
import { useLoading } from '@shared/contexts/LoadingContext';
import { TransactionsTable } from '@features/transactions';
import { useAllTransactionsDetailed } from '@entities/transaction/api/useTransactions';
import { useCategories } from '@entities/category/api/useCategories';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';
import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { AccountDateRangeControls } from './components/AccountDateRangeControls';
import { FlowStat } from './components/FlowStat';
import { useAccountDateRange } from './hooks/useAccountDateRange';
import { useJumpToTransaction } from './hooks/useJumpToTransaction';
import { useTransactionStatsCallbacks } from './hooks/useTransactionStatsCallbacks';

export default function AllTransactionsPage() {
  const { isProcessingTransfer } = useLoading();

  const { mobilePageStats, filteredStats, handleMobilePageChange, handleFilteredStatsChange } =
    useTransactionStatsCallbacks();

  const {
    dateRange,
    handleDateRangeChange,
    periodLabel,
    isMobileDatePickerOpen,
    setIsMobileDatePickerOpen,
    isDesktopDatePickerOpen,
    setIsDesktopDatePickerOpen,
  } = useAccountDateRange();

  const { selectedBudget } = useUiStore();
  const formatDecimalAmount = useFormatMaskedAmount();
  // Stats below are integer milliunit sums; convert at this display boundary.
  const formatAmount = (m: number) => formatDecimalAmount(toDecimal(asMilli(m)));

  const { data, isLoading: isTransactionsLoading } = useAllTransactionsDetailed(
    selectedBudget?.ID || 0
  );
  const allTransactionsData = useMemo(() => data ?? [], [data]);

  // Fetch categories for semantic search
  const { data: categories = [] } = useCategories(selectedBudget?.ID || 0);

  const transactionsData = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return allTransactionsData;

    const fromDate = startOfDay(dateRange.from);
    const toDate = endOfDay(dateRange.to);

    return allTransactionsData.filter((t) => {
      const txDate = new Date(t.Date);
      return txDate >= fromDate && txDate <= toDate;
    });
  }, [allTransactionsData, dateRange]);

  const transactionStats = useMemo(() => {
    // If we have filtered stats from TransactionsTable (which includes semantic search filters), use those
    if (filteredStats) {
      return {
        recentCount: filteredStats.transactionCount,
        totalInflow: filteredStats.totalInflow,
        totalOutflow: filteredStats.totalOutflow,
      };
    }

    // Fallback to calculating from transactionsData (date-filtered only)
    let totalInflow = 0;
    let totalOutflow = 0;

    transactionsData.forEach((t) => {
      // Always use budget currency (Inflow/Outflow) for All Transactions view
      totalInflow += t.Inflow || 0;
      totalOutflow += t.Outflow || 0;
    });

    return {
      recentCount: transactionsData.length,
      totalInflow,
      totalOutflow,
    };
  }, [transactionsData, filteredStats]);

  useJumpToTransaction(transactionsData.length);

  if (isTransactionsLoading) {
    return <CenteredLoader className="flex-1 p-4" label="Loading transactions..." />;
  }

  return (
    <TooltipProvider>
      <div className="flex-1 bg-muted/30 sm:bg-background">
        {/* Mobile Header */}
        <div className="sm:hidden px-3 pt-3 pb-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <List className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-foreground">All Transactions</h1>
              <p className="text-[10px] text-muted-foreground">
                {mobilePageStats
                  ? `Page ${mobilePageStats.pageNumber + 1}/${mobilePageStats.totalPages}`
                  : `${transactionStats.recentCount} transactions`}
              </p>
            </div>
          </div>

          <div className="mb-2">
            <AccountDateRangeControls
              dateRange={dateRange}
              periodLabel={periodLabel}
              open={isMobileDatePickerOpen}
              onOpenChange={setIsMobileDatePickerOpen}
              onDateRangeChange={handleDateRangeChange}
              variant="mobile"
            />
          </div>

          <div className="flex items-center gap-4 mb-2">
            <FlowStat
              icon={ArrowUpRight}
              label="Inflow"
              value={formatAmount(transactionStats.totalInflow)}
              color="success"
              size="sm"
            />
            <FlowStat
              icon={ArrowDownRight}
              label="Outflow"
              value={formatAmount(transactionStats.totalOutflow)}
              color="destructive"
              size="sm"
            />
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden sm:block px-6 pt-4 pb-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <List className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-foreground">All Transactions</h1>
                <p className="text-xs text-muted-foreground">
                  {transactionStats.recentCount} transactions across all accounts
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AccountDateRangeControls
                dateRange={dateRange}
                periodLabel={periodLabel}
                open={isDesktopDatePickerOpen}
                onOpenChange={setIsDesktopDatePickerOpen}
                onDateRangeChange={handleDateRangeChange}
                variant="desktop"
              />
            </div>
          </div>

          <div className="flex items-center gap-6 mb-4">
            <FlowStat
              icon={ArrowUpRight}
              label="Inflow"
              value={formatAmount(transactionStats.totalInflow)}
              color="success"
              tooltip={`Total inflow from ${transactionStats.recentCount} transactions`}
            />

            <FlowStat
              icon={ArrowDownRight}
              label="Outflow"
              value={formatAmount(transactionStats.totalOutflow)}
              color="destructive"
              tooltip={`Total outflow from ${transactionStats.recentCount} transactions`}
            />
          </div>
        </div>

        {/* Transactions Section */}
        <div className="flex-1 sm:px-6 space-y-6">
          {isProcessingTransfer ? (
            <CenteredLoader className="py-12" label="Processing transfer..." />
          ) : (
            <TransactionsTable
              initialData={transactionsData}
              hideAccountColumn={false}
              onMobilePageChange={handleMobilePageChange}
              forceBudgetCurrency
              hideSecondaryAmounts
              categories={categories}
              onDateRangeChange={handleDateRangeChange}
              onFilteredStatsChange={handleFilteredStatsChange}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
