import React from 'react';
import type { DateRange } from 'react-day-picker';
import { Dialog, DialogContent } from '@shared/ui/dialog';
import { AddTransactionForm } from '@features/transactions/ui/add-transaction';
import { TransactionsBatchToolbar } from '@features/transactions/ui/TransactionsBatchToolbar';
import { TransactionsToolbar } from '@features/transactions/ui/TransactionsToolbar';
import type { GetTransactionsByAccountRow, Category } from '@budgero/core/browser';
import { useTransactionTable } from '@features/transactions/api/useTransactionTable';
import {
  useTransactionSearch,
  filterTransactions,
  isUncategorized,
} from '@features/transactions/api/useTransactionSearch';
import { makeAmountAccessors } from '@features/transactions/lib/amount-accessors';
import { MobileTransactionList } from '@features/transactions/ui/MobileTransactionList';
import { DesktopTransactionTable } from '@features/transactions/ui/desktop-table';
import { useUiStore } from '@shared/store/useUiStore';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useLabels } from '@entities/label/api/useLabels';

const EMPTY_CATEGORIES: Category[] = [];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 10;
const PAGE_SIZE_STORAGE_KEY = 'transaction-table-page-size';

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export interface FilteredStats {
  totalInflow: number;
  totalOutflow: number;
  transactionCount: number;
}

interface TransactionsTableProps {
  initialData: GetTransactionsByAccountRow[];
  hideAccountColumn?: boolean;
  onMobilePageChange?: (
    stats: {
      totalInflow: number;
      totalOutflow: number;
      transactionCount: number;
      pageNumber: number;
      totalPages: number;
    } | null
  ) => void;
  onCreateRecurringFromSelection?: (transaction: GetTransactionsByAccountRow) => void;
  preselectedAccountId?: number;
  /** Force display in budget currency (ignores user preference). Used for All Transactions page. */
  forceBudgetCurrency?: boolean;
  /** Hide secondary/original amount display. Used with forceBudgetCurrency. */
  hideSecondaryAmounts?: boolean;
  /** Categories for semantic search matching */
  categories?: Category[];
  /** Callback when semantic search detects a date range */
  onDateRangeChange?: (range: DateRange | undefined) => void;
  /** Callback when filtered data changes (includes semantic search filters) */
  onFilteredStatsChange?: (stats: FilteredStats) => void;
  /** Extra action buttons rendered in the toolbar row (replaces "Transactions" heading) */
  headerActions?: React.ReactNode;
}

export function TransactionsTable({
  initialData,
  hideAccountColumn = false,
  onMobilePageChange,
  onCreateRecurringFromSelection,
  preselectedAccountId,
  forceBudgetCurrency = false,
  hideSecondaryAmounts = false,
  categories = EMPTY_CATEGORIES,
  onDateRangeChange,
  onFilteredStatsChange,
  headerActions,
}: TransactionsTableProps) {
  const isMobile = useIsMobile();
  // Pagination state (search state lives in useTransactionSearch, below)
  const [showOnlyUncategorized, setShowOnlyUncategorized] = React.useState(false);
  const [page, setPage] = React.useState(0);

  // Page size with localStorage persistence so the user's preference sticks
  // across reloads. Falls back to the default if storage is empty or holds
  // an unsupported value (e.g. legacy values from before the option list).
  const [pageSize, setPageSizeState] = React.useState<PageSize>(() => {
    try {
      const saved = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
      if (!saved) return DEFAULT_PAGE_SIZE;
      const parsed = parseInt(saved, 10);
      return isPageSize(parsed) ? parsed : DEFAULT_PAGE_SIZE;
    } catch {
      return DEFAULT_PAGE_SIZE;
    }
  });

  const handlePageSizeChange = React.useCallback((value: string) => {
    const next = parseInt(value, 10);
    if (!isPageSize(next)) return;
    setPageSizeState(next);
    setPage(0); // jump back to the first page so the current scroll position stays sane
    try {
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage errors (private mode, quota exceeded, etc.)
    }
  }, []);

  // Balance column toggle with localStorage persistence
  const [showBalanceColumn, setShowBalanceColumn] = React.useState(() => {
    try {
      const saved = localStorage.getItem('transaction-table-show-balance');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleBalanceColumn = React.useCallback(() => {
    setShowBalanceColumn((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem('transaction-table-show-balance', String(newValue));
      } catch {
        // Ignore storage errors
      }
      return newValue;
    });
  }, []);

  // Label column toggle with localStorage persistence (shown by default)
  const [showLabelColumn, setShowLabelColumn] = React.useState(() => {
    try {
      return localStorage.getItem('transaction-table-show-label') !== 'false';
    } catch {
      return true;
    }
  });

  const handleToggleLabelColumn = React.useCallback(() => {
    setShowLabelColumn((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem('transaction-table-show-label', String(newValue));
      } catch {
        // Ignore storage errors
      }
      return newValue;
    });
  }, []);

  const storeCurrencyDisplay = useUiStore((state) => state.transactionCurrencyDisplay);
  const setTransactionCurrencyDisplay = useUiStore((state) => state.setTransactionCurrencyDisplay);
  // Override with budget currency if forced (e.g., All Transactions page)
  const transactionCurrencyDisplay = forceBudgetCurrency ? 'budget' : storeCurrencyDisplay;
  const selectedBudget = useUiStore((state) => state.selectedBudget);

  const {
    data: rawData,
    openDialog,
    rowSelection,
    selectedAccount,
    accountLocalizer,
    globalLocalizer,
    addTransactionMutation,
    updateTransactionColumnMutation,
    setOpenDialog,
    setRowSelection,
    toggleRowSelection,
    handleCellCommit,
    handleAddTransaction,
    selectedRowIds,
  } = useTransactionTable(initialData);

  const selectedAccountIdForForm = preselectedAccountId ?? selectedAccount?.ID;
  const budgetId = selectedAccount?.BudgetID || selectedBudget?.ID || 0;
  const { labels = [] } = useLabels(budgetId);

  // Currency display helper - use the correct formatter AND values
  const currentFormatter =
    transactionCurrencyDisplay === 'budget' ? globalLocalizer : accountLocalizer;
  const currencyLabel =
    transactionCurrencyDisplay === 'budget'
      ? selectedBudget?.DisplayCurrency || 'Budget Currency'
      : selectedAccount?.Currency || 'Account Currency';

  const { getPrimaryInflow, getPrimaryOutflow, getSecondaryInflow, getSecondaryOutflow } =
    React.useMemo(
      () => makeAmountAccessors(transactionCurrencyDisplay),
      [transactionCurrencyDisplay]
    );

  const uncategorizedCount = React.useMemo(() => {
    return rawData.reduce((count, tx) => count + (isUncategorized(tx) ? 1 : 0), 0);
  }, [rawData]);

  const categoryNames = React.useMemo(() => {
    return categories.map((cat) => cat.Name);
  }, [categories]);

  const labelNames = React.useMemo(() => {
    return labels.map((label) => label.Name);
  }, [labels]);

  const {
    searchQuery,
    setSearchQuery,
    parsedQuery,
    setIsSearchFocused,
    highlightedIndex,
    setHighlightedIndex,
    categorySuggestions,
    handleRemoveToken,
    handleClearAll,
    handleSelectCategory,
  } = useTransactionSearch(categoryNames, labelNames, onDateRangeChange);

  const { filteredData, paginatedData } = React.useMemo(() => {
    const filtered = filterTransactions(
      rawData,
      parsedQuery,
      showOnlyUncategorized,
      getPrimaryInflow,
      getPrimaryOutflow
    );

    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginated = filtered.slice(startIndex, endIndex);

    return { filteredData: filtered, paginatedData: paginated };
  }, [
    rawData,
    parsedQuery,
    page,
    pageSize,
    showOnlyUncategorized,
    getPrimaryInflow,
    getPrimaryOutflow,
  ]);

  // Report filtered stats to parent when filtered data changes
  const lastFilteredStatsRef = React.useRef<FilteredStats | null>(null);
  React.useEffect(() => {
    if (!onFilteredStatsChange) return;

    const totalInflow = filteredData.reduce((sum, tx) => sum + (getPrimaryInflow(tx) || 0), 0);
    const totalOutflow = filteredData.reduce((sum, tx) => sum + (getPrimaryOutflow(tx) || 0), 0);
    const nextStats: FilteredStats = {
      totalInflow,
      totalOutflow,
      transactionCount: filteredData.length,
    };

    const previous = lastFilteredStatsRef.current;
    const unchanged =
      previous &&
      previous.totalInflow === nextStats.totalInflow &&
      previous.totalOutflow === nextStats.totalOutflow &&
      previous.transactionCount === nextStats.transactionCount;

    if (unchanged) return;

    lastFilteredStatsRef.current = nextStats;
    onFilteredStatsChange(nextStats);
  }, [filteredData, onFilteredStatsChange, getPrimaryInflow, getPrimaryOutflow]);

  // If a selectedTransactionId exists, automatically jump to the page that contains it
  React.useEffect(() => {
    const raw = localStorage.getItem('selectedTransactionId');
    if (!raw) return;
    const id = parseInt(raw);
    if (!id || Number.isNaN(id)) return;
    const idx = filteredData.findIndex((tx) => tx.ID === id);
    if (idx >= 0) {
      const targetPage = Math.floor(idx / pageSize);
      if (targetPage !== page) setPage(targetPage);
      // Once page aligns, let AccountPage handle the scroll/highlight removal
    }
  }, [filteredData, page, pageSize]);

  // Calculate stats for current mobile page and notify parent
  const lastMobileStatsRef = React.useRef<{
    totalInflow: number;
    totalOutflow: number;
    transactionCount: number;
    pageNumber: number;
    totalPages: number;
  } | null>(null);
  React.useEffect(() => {
    if (!onMobilePageChange) return;

    // Only calculate for mobile (when callback is provided)
    const totalInflow = paginatedData.reduce((sum, tx) => sum + (getPrimaryInflow(tx) || 0), 0);
    const totalOutflow = paginatedData.reduce((sum, tx) => sum + (getPrimaryOutflow(tx) || 0), 0);
    const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
    const nextStats = {
      totalInflow,
      totalOutflow,
      transactionCount: paginatedData.length,
      pageNumber: page,
      totalPages,
    };

    const previous = lastMobileStatsRef.current;
    const unchanged =
      previous &&
      previous.totalInflow === nextStats.totalInflow &&
      previous.totalOutflow === nextStats.totalOutflow &&
      previous.transactionCount === nextStats.transactionCount &&
      previous.pageNumber === nextStats.pageNumber &&
      previous.totalPages === nextStats.totalPages;
    if (unchanged) return;

    lastMobileStatsRef.current = nextStats;
    onMobilePageChange(nextStats);
  }, [
    paginatedData,
    page,
    filteredData.length,
    pageSize,
    onMobilePageChange,
    getPrimaryInflow,
    getPrimaryOutflow,
  ]);

  React.useEffect(() => {
    setPage(0);
  }, [searchQuery]);

  React.useEffect(() => {
    setPage(0);
  }, [showOnlyUncategorized]);

  React.useEffect(() => {
    return () => {
      if (onMobilePageChange) {
        onMobilePageChange(null);
      }
    };
  }, [onMobilePageChange]);

  const totalPages = Math.ceil(filteredData.length / pageSize);
  const hasNextPage = page < totalPages - 1;
  const hasPreviousPage = page > 0;

  const numSelected = selectedRowIds.length;

  return (
    <div className="space-y-2 sm:space-y-4 px-3 sm:px-0">
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <TransactionsToolbar
          headerActions={headerActions}
          addTransactionPending={addTransactionMutation.isPending}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          setIsSearchFocused={setIsSearchFocused}
          categorySuggestions={categorySuggestions}
          highlightedIndex={highlightedIndex}
          setHighlightedIndex={setHighlightedIndex}
          handleSelectCategory={handleSelectCategory}
          parsedQuery={parsedQuery}
          handleRemoveToken={handleRemoveToken}
          handleClearAll={handleClearAll}
          globalLocalizer={globalLocalizer}
          forceBudgetCurrency={forceBudgetCurrency}
          selectedBudget={selectedBudget}
          selectedAccount={selectedAccount}
          transactionCurrencyDisplay={transactionCurrencyDisplay}
          storeCurrencyDisplay={storeCurrencyDisplay}
          setTransactionCurrencyDisplay={setTransactionCurrencyDisplay}
          currencyLabel={currencyLabel}
          isMobile={isMobile}
          showBalanceColumn={showBalanceColumn}
          handleToggleBalanceColumn={handleToggleBalanceColumn}
          showLabelColumn={showLabelColumn}
          handleToggleLabelColumn={handleToggleLabelColumn}
          pageSize={pageSize}
          handlePageSizeChange={handlePageSizeChange}
          hideAccountColumn={hideAccountColumn}
          uncategorizedCount={uncategorizedCount}
          showOnlyUncategorized={showOnlyUncategorized}
          setShowOnlyUncategorized={setShowOnlyUncategorized}
        />

        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <AddTransactionForm
            onAddTransaction={handleAddTransaction}
            onCancel={() => setOpenDialog(false)}
            budgetId={budgetId}
            selectedAccountId={selectedAccountIdForForm}
          />
        </DialogContent>
      </Dialog>

      <div>
        {isMobile ? (
          <MobileTransactionList
            transactions={filteredData}
            rowSelection={rowSelection}
            page={page}
            pageSize={pageSize}
            isPending={updateTransactionColumnMutation.isPending}
            pendingId={updateTransactionColumnMutation.variables?.transactionId}
            accountLocalizer={accountLocalizer}
            globalLocalizer={globalLocalizer}
            currentFormatter={currentFormatter}
            transactionCurrencyDisplay={transactionCurrencyDisplay}
            getPrimaryInflow={getPrimaryInflow}
            getPrimaryOutflow={getPrimaryOutflow}
            getSecondaryInflow={getSecondaryInflow}
            getSecondaryOutflow={getSecondaryOutflow}
            onCellCommit={handleCellCommit}
            stickyFooter={false}
            onSelectionChange={(rowId: string, checked: boolean) =>
              toggleRowSelection([rowId], checked)
            }
            hideAccountColumn={hideAccountColumn}
            hideSecondaryAmounts={hideSecondaryAmounts}
            budgetId={budgetId}
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            onNextPage={() => {
              if (hasNextPage) {
                setPage((p) => p + 1);
              }
            }}
            onPreviousPage={() => {
              if (hasPreviousPage) {
                setPage((p) => Math.max(0, p - 1));
              }
            }}
            currentPage={page}
            totalPages={totalPages}
          />
        ) : (
          <DesktopTransactionTable
            transactions={filteredData}
            rowSelection={rowSelection}
            page={page}
            pageSize={pageSize}
            isPending={updateTransactionColumnMutation.isPending}
            pendingId={updateTransactionColumnMutation.variables?.transactionId}
            accountLocalizer={accountLocalizer}
            globalLocalizer={globalLocalizer}
            currentFormatter={currentFormatter}
            transactionCurrencyDisplay={transactionCurrencyDisplay}
            getPrimaryInflow={getPrimaryInflow}
            getPrimaryOutflow={getPrimaryOutflow}
            getSecondaryInflow={getSecondaryInflow}
            getSecondaryOutflow={getSecondaryOutflow}
            onCellCommit={handleCellCommit}
            onSelectionChange={(rowId, checked, rangeIds, replaceSelection = false) =>
              toggleRowSelection(rangeIds && rangeIds.length > 0 ? rangeIds : [rowId], checked, {
                replace: replaceSelection,
              })
            }
            hideAccountColumn={hideAccountColumn}
            hideSecondaryAmounts={hideSecondaryAmounts}
            showBalanceColumn={showBalanceColumn}
            showLabelColumn={showLabelColumn}
            showExchangeRateColumn={
              hideAccountColumn &&
              !!selectedAccount?.Currency &&
              !!selectedBudget?.DisplayCurrency &&
              selectedAccount.Currency !== selectedBudget.DisplayCurrency
            }
            budgetId={budgetId}
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            onNextPage={() => {
              if (hasNextPage) {
                setPage((p) => p + 1);
              }
            }}
            onPreviousPage={() => {
              if (hasPreviousPage) {
                setPage((p) => Math.max(0, p - 1));
              }
            }}
            currentPage={page}
            totalPages={totalPages}
          />
        )}
      </div>

      {/* Batch Toolbar - Centered with max width like dashboard */}
      {numSelected > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-[min(720px,90vw)]">
          <div className="px-4 py-3 bg-background/95 backdrop-blur border border-border/50 shadow-lg rounded-xl">
            <TransactionsBatchToolbar
              selectedRowIds={selectedRowIds}
              clearSelection={() => setRowSelection({})}
              onCreateRecurring={onCreateRecurringFromSelection}
            />
          </div>
        </div>
      )}
    </div>
  );
}
