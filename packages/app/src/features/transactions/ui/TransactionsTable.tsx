import { useLingui } from '@lingui/react/macro';
import React from 'react';
import type { DateRange } from 'react-day-picker';
import { Dialog, DialogContent } from '@shared/ui/dialog';
import { AddTransactionForm } from '@features/transactions/ui/add-transaction';
import { TransactionsBatchToolbar } from '@features/transactions/ui/TransactionsBatchToolbar';
import { TransactionsToolbar } from '@features/transactions/ui/TransactionsToolbar';
import type { GetTransactionsByAccountRow, Category } from '@budgero/core/browser';
import { useTransactionTable } from '@features/transactions/api/useTransactionTable';
import { useClearedShortcut } from '@features/transactions/api/useClearedShortcut';
import { orderWithinDays } from '@features/transactions/lib/same-day-order';
import { useRegisterDisplay } from '@shared/contexts/RegisterDisplayContext';
import { useDuplicateShortcut } from '@features/transactions/api/useDuplicateShortcut';
import { useDeleteSelected } from '@features/transactions/api/useDeleteSelected';
import { useRegisterActionShortcuts } from '@features/transactions/api/useRegisterActionShortcuts';
import { useQuickFilterShortcuts } from '@features/transactions/api/useQuickFilterShortcuts';
import { useEmptyStateViewed } from '@shared/lib/analytics/first-month';
import {
  useTransactionSearch,
  filterTransactions,
  isUncategorized,
  isUncleared,
} from '@features/transactions/api/useTransactionSearch';
import {
  displayCurrencyFormatter,
  makeAmountAccessors,
} from '@features/transactions/lib/amount-accessors';
import {
  nextTransactionSort,
  sortTransactions,
  type TransactionSortColumn,
  type TransactionSortState,
} from '@features/transactions/lib/transaction-sort';
import { useTransactionSort } from '@features/transactions/api/useTransactionSort';
import { useTransactionTableColumns } from '@features/transactions/api/useTransactionTableColumns';
import { visibleColumnSort } from '@features/transactions/lib/table-columns';
import { MobileTransactionSortControl } from '@features/transactions/ui/MobileTransactionSortControl';
import { MobileTransactionList } from '@features/transactions/ui/MobileTransactionList';
import { DesktopTransactionTable } from '@features/transactions/ui/desktop-table';
import { useUiStore } from '@shared/store/useUiStore';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useLabels } from '@entities/label/api/useLabels';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useCategoryGroups } from '@entities/category/api/useCategories';
import { usePayees } from '@entities/payee/api/usePayees';
import { useInlineTransactionEntryEnabled } from '@shared/contexts/InlineTransactionEntryContext';
import { setInlineAddTarget } from '@features/transactions/model/inline-add-target';
import { useTransferConversion } from '../api/useTransferConversion';
import { TransferConversionProvider } from '../api/transfer-conversion-context';
import type { TransactionEditorDirectories } from './desktop-table/transaction-editor-types';

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
  /** Notifies an account register when search requires its complete selected range. */
  onFilterModeChange?: (active: boolean) => void;
  /** Database count for a partially loaded account register. */
  totalTransactionCount?: number;
  /** Database count used before the uncategorized filter is activated. */
  uncategorizedCountOverride?: number;
  /** Database count used before the uncleared filter is activated. */
  unclearedCountOverride?: number;
  /** Incremental account-register loading controls. */
  hasMoreTransactions?: boolean;
  isLoadingMoreTransactions?: boolean;
  onLoadMoreTransactions?: () => Promise<unknown>;
  /** Extra action buttons rendered in the toolbar row (replaces "Transactions" heading) */
  headerActions?: React.ReactNode;
  /** initialData is still loading (an empty list isn't an empty register yet). */
  dataLoading?: boolean;
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
  onFilterModeChange,
  totalTransactionCount,
  uncategorizedCountOverride,
  unclearedCountOverride,
  hasMoreTransactions = false,
  isLoadingMoreTransactions = false,
  onLoadMoreTransactions,
  headerActions,
  dataLoading = false,
}: TransactionsTableProps) {
  const { t, i18n } = useLingui();

  const isMobile = useIsMobile();
  // Pagination state (search state lives in useTransactionSearch, below)
  const [showOnlyUncategorized, setShowOnlyUncategorized] = React.useState(false);
  const [showOnlyUncleared, setShowOnlyUncleared] = React.useState(false);
  const toggleUncleared = React.useCallback(() => setShowOnlyUncleared((v) => !v), []);
  const toggleUncategorized = React.useCallback(() => setShowOnlyUncategorized((v) => !v), []);
  useQuickFilterShortcuts(hideAccountColumn, toggleUncleared, toggleUncategorized);
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
    handleAddTransfer,
    selectedRowIds,
  } = useTransactionTable(initialData, transactionCurrencyDisplay);

  const selectedAccountIdForForm = preselectedAccountId ?? selectedAccount?.ID;
  const budgetId = selectedBudget?.ID || selectedAccount?.BudgetID || 0;
  const { labels = [] } = useLabels(budgetId);
  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: categoryGroups = [] } = useCategoryGroups(budgetId);
  const { data: payees = [] } = usePayees(budgetId);
  // The category pickers load Available and Ready to Assign themselves, only
  // while open, so the register doesn't compute the budget on every write.
  const editorDirectories = React.useMemo<TransactionEditorDirectories>(
    () => ({
      accounts,
      categories,
      categoryGroups,
      labels,
      payees,
    }),
    [accounts, categories, categoryGroups, labels, payees]
  );

  // "Transfer: Account" payee choices: convert a row to a transfer and back. The
  // payee cells reach these through context, so other surfaces are unaffected.
  const transferConversion = useTransferConversion({ rows: rawData, accounts });
  const transferConversionActions = React.useMemo(
    () => ({
      requestConversion: transferConversion.requestConversion,
      requestUnlink: transferConversion.requestUnlink,
    }),
    [transferConversion.requestConversion, transferConversion.requestUnlink]
  );

  // Currency display helper - use the correct formatter AND values
  const currentFormatter = displayCurrencyFormatter(
    transactionCurrencyDisplay,
    globalLocalizer,
    accountLocalizer
  );
  const currencyLabel =
    transactionCurrencyDisplay === 'budget'
      ? selectedBudget?.DisplayCurrency || t`Budget Currency`
      : selectedAccount?.Currency || t`Account Currency`;

  const { getPrimaryInflow, getPrimaryOutflow, getSecondaryInflow, getSecondaryOutflow } =
    React.useMemo(
      () => makeAmountAccessors(transactionCurrencyDisplay),
      [transactionCurrencyDisplay]
    );

  const loadedUncategorizedCount = React.useMemo(() => {
    return rawData.reduce((count, tx) => count + (isUncategorized(tx) ? 1 : 0), 0);
  }, [rawData]);

  const loadedUnclearedCount = React.useMemo(
    () => rawData.reduce((count, tx) => count + (isUncleared(tx) ? 1 : 0), 0),
    [rawData]
  );

  const categoryNames = React.useMemo(() => {
    return categories.map((cat) => cat.Name);
  }, [categories]);

  const labelNames = React.useMemo(() => {
    return labels.map((label) => label.Name);
  }, [labels]);

  // On one account's register, suggesting account names adds nothing.
  const accountNames = React.useMemo(
    () => (hideAccountColumn ? [] : accounts.map((account) => account.Name)),
    [accounts, hideAccountColumn]
  );

  const {
    searchQuery,
    setSearchQuery,
    setCaret,
    parsedQuery,
    setIsSearchFocused,
    highlightedIndex,
    setHighlightedIndex,
    suggestions,
    activeTerm,
    handleRemoveToken,
    handleClearAll,
    handleSelectSuggestion,
  } = useTransactionSearch(categoryNames, labelNames, onDateRangeChange, {
    payeeNames: payees,
    accountNames,
    // Typed amounts are in the currency the table shows.
    amountFormatter: currentFormatter,
  });

  const isFilterModeActive =
    searchQuery.trim().length > 0 || showOnlyUncategorized || showOnlyUncleared;

  // Column sort, remembered per register (an account, or All Transactions of a budget).
  const registerSortKey = preselectedAccountId
    ? `account:${preselectedAccountId}`
    : `all:${budgetId}`;
  const { sort: storedSort, setSort } = useTransactionSort(registerSortKey);
  // Desktop column options (synced per user). A sort on a column the desktop
  // table hides falls back to date order there; mobile cards show every field.
  const { columns: tableColumns, update: updateTableColumns } = useTransactionTableColumns();
  const sort = isMobile ? storedSort : visibleColumnSort(storedSort, tableColumns);
  const handleSortChange = React.useCallback(
    (next: TransactionSortState) => {
      setSort(next);
      setPage(0);
    },
    [setSort]
  );
  const handleHeaderSort = React.useCallback(
    (column: TransactionSortColumn) => handleSortChange(nextTransactionSort(sort, column)),
    [handleSortChange, sort]
  );

  // A sort orders the whole selected range, so a partially loaded account
  // register loads all of it, as for a search.
  const needsCompleteData = isFilterModeActive || sort !== null;
  React.useEffect(() => {
    onFilterModeChange?.(needsCompleteData);
  }, [needsCompleteData, onFilterModeChange]);

  const uncategorizedCount =
    !isFilterModeActive && uncategorizedCountOverride !== undefined
      ? uncategorizedCountOverride
      : loadedUncategorizedCount;
  const unclearedCount =
    !isFilterModeActive && unclearedCountOverride !== undefined
      ? unclearedCountOverride
      : loadedUnclearedCount;

  const { sameDayOrder, compactRows, showTime } = useRegisterDisplay();
  const orderedData = React.useMemo(
    () => orderWithinDays(rawData, sameDayOrder, showTime),
    [rawData, sameDayOrder, showTime]
  );

  const filteredData = React.useMemo(
    () =>
      filterTransactions(
        orderedData,
        parsedQuery,
        { uncategorized: showOnlyUncategorized, uncleared: showOnlyUncleared },
        getPrimaryInflow,
        getPrimaryOutflow
      ),
    [
      orderedData,
      parsedQuery,
      showOnlyUncategorized,
      showOnlyUncleared,
      getPrimaryInflow,
      getPrimaryOutflow,
    ]
  );

  const sortContext = React.useMemo(
    () => ({
      signedAmount: (tx: GetTransactionsByAccountRow) =>
        (getPrimaryInflow(tx) || 0) - (getPrimaryOutflow(tx) || 0),
      splitLabel: t`Split`,
      transfersLabel: t`Transfers`,
      locale: i18n.locale,
    }),
    [getPrimaryInflow, getPrimaryOutflow, t, i18n.locale]
  );
  // Sorted once per change of rows, sort or currency; pagination and the
  // virtualized rows only slice this.
  const sortedData = React.useMemo(
    () => sortTransactions(filteredData, sort, sortContext),
    [filteredData, sort, sortContext]
  );

  // An empty register, not one a search or quick filter emptied.
  useEmptyStateViewed(
    'transactions',
    !dataLoading && !isFilterModeActive && rawData.length === 0 && !totalTransactionCount
  );

  const effectiveTransactionCount =
    !needsCompleteData && totalTransactionCount !== undefined
      ? totalTransactionCount
      : filteredData.length;

  const paginatedData = React.useMemo(() => {
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, page, pageSize]);

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
    if (!isMobile) return;
    const raw = localStorage.getItem('selectedTransactionId');
    if (!raw) return;
    const id = parseInt(raw);
    if (!id || Number.isNaN(id)) return;
    const idx = sortedData.findIndex((tx) => tx.ID === id);
    if (idx >= 0) {
      const targetPage = Math.floor(idx / pageSize);
      if (targetPage !== page) setPage(targetPage);
      // Once page aligns, let AccountPage handle the scroll/highlight removal
    }
  }, [sortedData, isMobile, page, pageSize]);

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
    if (!isMobile) {
      onMobilePageChange(null);
      return;
    }

    // Only calculate for mobile (when callback is provided)
    const totalInflow = paginatedData.reduce((sum, tx) => sum + (getPrimaryInflow(tx) || 0), 0);
    const totalOutflow = paginatedData.reduce((sum, tx) => sum + (getPrimaryOutflow(tx) || 0), 0);
    const totalPages = Math.ceil(effectiveTransactionCount / pageSize) || 1;
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
    effectiveTransactionCount,
    pageSize,
    onMobilePageChange,
    getPrimaryInflow,
    getPrimaryOutflow,
    isMobile,
  ]);

  React.useEffect(() => {
    setPage(0);
  }, [searchQuery]);

  React.useEffect(() => {
    setPage(0);
  }, [showOnlyUncategorized, showOnlyUncleared]);

  React.useEffect(() => {
    return () => {
      if (onMobilePageChange) {
        onMobilePageChange(null);
      }
    };
  }, [onMobilePageChange]);

  const totalPages = Math.ceil(effectiveTransactionCount / pageSize) || 1;
  const hasNextPage = page < totalPages - 1;
  const hasPreviousPage = page > 0;

  useClearedShortcut(selectedRowIds, rawData);
  const { deleteRows } = useDeleteSelected();
  useDuplicateShortcut(selectedRowIds, rawData);

  const numSelected = selectedRowIds.length;

  // Inline entry (Appearance setting): the register's Add Transaction button,
  // Ctrl/⌘+Alt+T and the header button open a row at the top instead of the dialog.
  const inlineEntry = useInlineTransactionEntryEnabled() && !isMobile;
  const [inlineAddOpen, setInlineAddOpen] = React.useState(false);
  const openInlineAdd = React.useCallback(() => {
    setShowOnlyUncategorized(false);
    setShowOnlyUncleared(false);
    setInlineAddOpen(true);
  }, []);
  React.useEffect(() => {
    if (!inlineEntry) return;
    return setInlineAddTarget(openInlineAdd);
  }, [inlineEntry, openInlineAdd]);

  useRegisterActionShortcuts({
    onAdd: inlineEntry ? openInlineAdd : () => setOpenDialog(true),
    onDeleteSelected: () => void deleteRows(selectedRowIds, () => setRowSelection({})),
    hasSelection: selectedRowIds.length > 0,
  });

  return (
    <TransferConversionProvider value={transferConversionActions}>
      <div className="space-y-2 sm:space-y-4 px-3 sm:px-0">
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <TransactionsToolbar
            headerActions={headerActions}
            addTransactionPending={addTransactionMutation.isPending}
            onInlineAdd={inlineEntry ? openInlineAdd : undefined}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setCaret={setCaret}
            setIsSearchFocused={setIsSearchFocused}
            suggestions={suggestions}
            suggestionsNegated={activeTerm?.excludes ?? false}
            highlightedIndex={highlightedIndex}
            setHighlightedIndex={setHighlightedIndex}
            handleSelectSuggestion={handleSelectSuggestion}
            parsedQuery={parsedQuery}
            handleRemoveToken={handleRemoveToken}
            handleClearAll={handleClearAll}
            amountFormatter={currentFormatter}
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
            tableColumns={tableColumns}
            onTableColumnsChange={updateTableColumns}
            pageSize={pageSize}
            handlePageSizeChange={handlePageSizeChange}
            mobileSortControl={
              <MobileTransactionSortControl
                sort={sort}
                onSortChange={handleSortChange}
                showAccountOption={!hideAccountColumn}
              />
            }
            hideAccountColumn={hideAccountColumn}
            uncategorizedCount={uncategorizedCount}
            showOnlyUncategorized={showOnlyUncategorized}
            setShowOnlyUncategorized={setShowOnlyUncategorized}
            unclearedCount={unclearedCount}
            showOnlyUncleared={showOnlyUncleared}
            setShowOnlyUncleared={setShowOnlyUncleared}
          />

          <DialogContent onInteractOutside={(e) => e.preventDefault()}>
            <AddTransactionForm
              onAddTransaction={handleAddTransaction}
              onAddTransfer={handleAddTransfer}
              onCancel={() => setOpenDialog(false)}
              budgetId={budgetId}
              selectedAccountId={selectedAccountIdForForm}
            />
          </DialogContent>
        </Dialog>

        <div>
          {isMobile ? (
            <MobileTransactionList
              transactions={sortedData}
              sorted={sort !== null}
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
              onNextPage={async () => {
                if (!hasNextPage) return;
                const nextPage = page + 1;
                if (
                  !needsCompleteData &&
                  (nextPage + 1) * pageSize > sortedData.length &&
                  hasMoreTransactions
                ) {
                  await onLoadMoreTransactions?.();
                }
                setPage(nextPage);
              }}
              onPreviousPage={() => {
                if (hasPreviousPage) {
                  setPage((p) => Math.max(0, p - 1));
                }
              }}
              currentPage={page}
              totalPages={totalPages}
              isLoadingMore={isLoadingMoreTransactions}
            />
          ) : (
            <DesktopTransactionTable
              transactions={sortedData}
              sort={sort}
              onSortChange={handleHeaderSort}
              rowSelection={rowSelection}
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
              showMemoColumn={tableColumns.showMemo}
              showPayeeColumn={tableColumns.showPayee}
              wrapMemo={tableColumns.wrapMemo}
              showExchangeRateColumn={
                hideAccountColumn &&
                !!selectedAccount?.Currency &&
                !!selectedBudget?.DisplayCurrency &&
                selectedAccount.Currency !== selectedBudget.DisplayCurrency
              }
              editorDirectories={editorDirectories}
              budgetId={budgetId}
              inlineAdd={
                inlineEntry && inlineAddOpen
                  ? { accountId: selectedAccountIdForForm, onClose: () => setInlineAddOpen(false) }
                  : undefined
              }
              scrollResetKey={`${searchQuery}:${showOnlyUncategorized}:${showOnlyUncleared}:${sort?.column ?? ''}:${sort?.direction ?? ''}`}
              canLoadMore={!needsCompleteData && hasMoreTransactions}
              isLoadingMore={isLoadingMoreTransactions}
              onLoadMore={onLoadMoreTransactions}
              compact={compactRows}
              onClearSelection={() => setRowSelection({})}
            />
          )}
        </div>

        {transferConversion.dialog}

        {/* Batch Toolbar - Centered with max width like dashboard */}
        {numSelected > 0 && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-[min(720px,90vw)]">
            <div className="px-4 py-3 bg-background/95 backdrop-blur border border-border/50 shadow-lg rounded-xl">
              <TransactionsBatchToolbar
                selectedRowIds={selectedRowIds}
                clearSelection={() => setRowSelection({})}
                onCreateRecurring={onCreateRecurringFromSelection}
                rows={rawData}
              />
            </div>
          </div>
        )}
      </div>
    </TransferConversionProvider>
  );
}
