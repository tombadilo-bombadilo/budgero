import { AccountTypeLabel } from '@entities/account/ui/AccountTypeLabel';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useParams } from 'react-router-dom';
import { EditAccountDialog } from '@features/account-management/ui/EditAccountDialog';
import { ReconcileAccountDialog } from '@features/account-management/ui/ReconcileAccountDialog';
import { useCategories } from '@entities/category/api/useCategories';
import { useRevaluationSummary } from '@entities/currency/api/useRevaluationSummary';
import { useAccounts } from '@entities/account/api/useAccounts';
import {
  useAccountTransactionPages,
  useAccountTransactionsForSearch,
  useAccountTransactionSummary,
} from '@entities/transaction/api/queries';
import {
  useProjectedTransactions,
  useRecurringOccurrences,
} from '@entities/recurring/api/useRecurringTransactions';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { Badge } from '@shared/ui/badge';
import { Wallet, ArrowUpRight, ArrowDownRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { TooltipProvider } from '@shared/ui/tooltip';
import { PayoffSimulator } from '@features/debt/ui/PayoffSimulator';
import { RecurringTransactionEditor } from '@features/recurring/ui/RecurringTransactionEditor';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { formatDateISO } from '@shared/lib/date-utils';
import { formatSafeMilli } from '@shared/lib/currency/milli';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { isSafeStorageAmount } from '@budgero/core/browser';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { hasUnsafeTransactionMoney } from '@entities/transaction/lib/money-integrity';

import { formatExchangeRate } from '@entities/currency/lib/exchange-rate-format';
import { AccountGlyph } from '@entities/account/ui/AccountGlyph';
import { BankSyncButton } from '@features/bank-sync';
import { useAccountDateRange } from './hooks/useAccountDateRange';
import { useAccountMetrics } from './hooks/useAccountMetrics';
import { useJumpToTransaction } from './hooks/useJumpToTransaction';
import { useRecurringEditorFromTransaction } from './hooks/useRecurringEditorFromTransaction';
import { useTransactionStatsCallbacks } from './hooks/useTransactionStatsCallbacks';
import { mergeProjectedTransactions } from './hooks/projected-register';
import {
  computeLiabilityInfo,
  convertLiabilityInfoToBudgetCurrency,
  calculateTransactionStats,
  shouldSyncSelectedAccount,
  showsDebtDetails,
} from './account-page.utils';
import { AccountHeader } from './components/AccountHeader';
import { FlowStat } from './components/FlowStat';
import { ValueChangeStat } from './components/ValueChangeStat';
import { AccountSummaryCards } from './components/AccountSummaryCards';
import { AccountDateRangeControls } from './components/AccountDateRangeControls';
import { AccountTransactionsSection } from './components/AccountTransactionsSection';

export default function AccountPage() {
  const { t } = useLingui();

  const { accountId } = useParams<{ accountId: string }>();
  const numericId = Number(accountId);
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

  const {
    accountLocalizer,
    globalLocalizer,
    selectedBudget,
    selectedAccount: currentStoreAccount,
    setSelectedAccount,
    transactionCurrencyDisplay,
  } = useUiStore();

  const { data: accounts = [], isLoading: isAccountsLoading } = useAccounts(
    selectedBudget?.ID || 0
  );

  const selectedAccount = useMemo(
    () => accounts.find((acc) => acc.ID === numericId) || null,
    [accounts, numericId]
  );

  const accountTypeDef = selectedAccount
    ? getAccountTypeDefinition(selectedAccount.Type || '')
    : null;
  const AccountIcon = accountTypeDef?.icon || Wallet;

  const [isRegisterFilterActive, setIsRegisterFilterActive] = useState(false);
  const registerRange = useMemo(() => {
    const from = dateRange?.from ? formatDateISO(dateRange.from) : undefined;
    const toSource = dateRange?.to ?? dateRange?.from;
    return { from, to: toSource ? formatDateISO(toSource) : undefined };
  }, [dateRange]);
  const transactionPages = useAccountTransactionPages(
    numericId,
    registerRange.from,
    registerRange.to
  );
  const searchTransactions = useAccountTransactionsForSearch(
    numericId,
    registerRange.from,
    registerRange.to,
    isRegisterFilterActive
  );
  const { data: transactionSummary, isLoading: isTransactionSummaryLoading } =
    useAccountTransactionSummary(numericId, registerRange.from, registerRange.to);
  const pagedTransactions = useMemo(
    () => transactionPages.data?.pages.flatMap((page) => page.rows) ?? [],
    [transactionPages.data]
  );
  const allTransactionsData = useMemo(
    () =>
      isRegisterFilterActive ? (searchTransactions.data ?? pagedTransactions) : pagedTransactions,
    [isRegisterFilterActive, pagedTransactions, searchTransactions.data]
  );
  const isTransactionsLoading = transactionPages.isLoading || isTransactionSummaryLoading;
  const { fetchNextPage } = transactionPages;
  const handleLoadMoreTransactions = useCallback(async () => {
    await fetchNextPage();
  }, [fetchNextPage]);

  const {
    balanceAccountToday,
    balanceConvertedToday,
    displayBalanceToday,
    displayClearedBalance,
    transactionsData,
  } = useAccountMetrics({
    selectedAccount,
    allTransactionsData,
    dateRange,
    transactionCurrencyDisplay,
  });

  // Fetch categories (needed for transaction display/editing)
  const { data: categories = [] } = useCategories(selectedBudget?.ID || 0);
  const isForeignCurrency =
    !!selectedAccount &&
    !!selectedBudget &&
    selectedAccount.Currency !== selectedBudget.DisplayCurrency;
  const { data: revaluationSummary } = useRevaluationSummary(
    isForeignCurrency ? (selectedAccount?.ID ?? 0) : 0
  );

  // Posted occurrences link a real transaction back to its recurring series.
  const { data: postedOccurrences = [] } = useRecurringOccurrences(
    selectedAccount?.BudgetID || selectedBudget?.ID || 0,
    { status: ['ready'], accountId: numericId || undefined }
  );

  // Scheduled occurrences projected into the register, with inline mark
  // ready / skip actions. They strictly follow the register range, so future
  // occurrences only show when the range extends past today.
  const projectedOptions = useMemo(
    () => ({
      accountId: numericId || undefined,
      fromDate: registerRange.from,
      toDate: registerRange.to,
    }),
    [numericId, registerRange]
  );
  const { data: projectedTransactions = [] } = useProjectedTransactions(
    selectedAccount?.BudgetID || selectedBudget?.ID || 0,
    projectedOptions
  );

  const recurringIdByTransactionId = useMemo(() => {
    const map = new Map<number, number>();
    for (const occurrence of postedOccurrences) {
      if (occurrence.transactionId != null) {
        map.set(occurrence.transactionId, occurrence.recurringTransactionId);
      }
    }
    return map;
  }, [postedOccurrences]);

  const registerRows = useMemo(() => {
    const merged = mergeProjectedTransactions(
      transactionsData,
      allTransactionsData,
      projectedTransactions
    );
    if (!recurringIdByTransactionId.size) return merged;
    return merged.map((row) => {
      const recurringId = row.IsProjected ? undefined : recurringIdByTransactionId.get(row.ID);
      return recurringId === undefined ? row : { ...row, RecurringTransactionID: recurringId };
    });
  }, [transactionsData, allTransactionsData, projectedTransactions, recurringIdByTransactionId]);
  const unsafeTransactionCount = useMemo(
    () =>
      (transactionSummary?.UnsafeTransactionCount ?? 0) +
      projectedTransactions.filter(hasUnsafeTransactionMoney).length,
    [projectedTransactions, transactionSummary?.UnsafeTransactionCount]
  );
  const hasUnsafeAccountBalance = Boolean(
    selectedAccount &&
    [selectedAccount.BalanceNative, selectedAccount.BalanceConverted].some(
      (value) => value != null && !isSafeStorageAmount(value)
    )
  );
  const hasStoredMoneyIntegrityIssue = unsafeTransactionCount > 0 || hasUnsafeAccountBalance;
  const recurringEditor = useRecurringEditorFromTransaction({
    budgetId: selectedAccount?.BudgetID || selectedBudget?.ID || 0,
    accountId: numericId,
  });

  const currentFormatter =
    transactionCurrencyDisplay === 'budget' ? globalLocalizer : accountLocalizer;
  const formatAmount = useFormatMaskedAmount(currentFormatter);
  // Stored amounts are integer milliunits; convert at this display boundary.
  const formatMilliAmount = (m: number) => formatSafeMilli({ format: formatAmount }, m);
  // Revaluation deltas are budget-currency values by definition — formatting
  // them in the account currency would read as lost/gained holdings.
  const formatBudgetAmount = useFormatMaskedAmount(globalLocalizer);
  const formatBudgetMilliAmount = (m: number) => formatSafeMilli({ format: formatBudgetAmount }, m);
  const maskedFormatter = useMemo(
    () =>
      ({
        format: (value: number) => formatAmount(value),
      }) as Intl.NumberFormat,
    [formatAmount]
  );

  const liabilityInfo = useMemo(
    () => computeLiabilityInfo(selectedAccount, balanceAccountToday),
    [selectedAccount, balanceAccountToday]
  );

  const displayLiabilityInfo = useMemo(() => {
    if (hasStoredMoneyIntegrityIssue) return null;
    if (!liabilityInfo || !selectedAccount) return liabilityInfo;
    if (!showsDebtDetails(selectedAccount)) return null;
    if (transactionCurrencyDisplay === 'budget' && selectedAccount.BalanceConverted !== undefined) {
      const conversionRate =
        balanceAccountToday !== 0 ? Math.abs(balanceConvertedToday / balanceAccountToday) : 1;
      return convertLiabilityInfoToBudgetCurrency(liabilityInfo, conversionRate);
    }
    return liabilityInfo;
  }, [
    liabilityInfo,
    selectedAccount,
    transactionCurrencyDisplay,
    balanceAccountToday,
    balanceConvertedToday,
    hasStoredMoneyIntegrityIssue,
  ]);

  const transactionStats = useMemo(() => {
    // Search materializes the complete selected range, so its client-filtered
    // totals remain exact. The normal register uses database aggregates.
    if (isRegisterFilterActive && !searchTransactions.isFetching && filteredStats) {
      return {
        recentCount: filteredStats.transactionCount,
        totalInflow: filteredStats.totalInflow,
        totalOutflow: filteredStats.totalOutflow,
      };
    }
    if (mobilePageStats) {
      return calculateTransactionStats(registerRows, mobilePageStats, transactionCurrencyDisplay);
    }
    const projectedTotals = projectedTransactions.reduce(
      (totals, transaction) => {
        totals.inflow +=
          transactionCurrencyDisplay === 'budget'
            ? transaction.InflowConverted
            : (transaction.InflowNative ?? transaction.InflowConverted);
        totals.outflow +=
          transactionCurrencyDisplay === 'budget'
            ? transaction.OutflowConverted
            : (transaction.OutflowNative ?? transaction.OutflowConverted);
        return totals;
      },
      { inflow: 0, outflow: 0 }
    );
    return {
      recentCount: (transactionSummary?.TransactionCount ?? 0) + projectedTransactions.length,
      totalInflow:
        ((transactionCurrencyDisplay === 'budget'
          ? transactionSummary?.TotalInflowConverted
          : transactionSummary?.TotalInflowNative) ?? 0) + projectedTotals.inflow,
      totalOutflow:
        ((transactionCurrencyDisplay === 'budget'
          ? transactionSummary?.TotalOutflowConverted
          : transactionSummary?.TotalOutflowNative) ?? 0) + projectedTotals.outflow,
    };
  }, [
    filteredStats,
    isRegisterFilterActive,
    mobilePageStats,
    projectedTransactions,
    registerRows,
    searchTransactions.isFetching,
    transactionCurrencyDisplay,
    transactionSummary,
  ]);
  const hasMoneyIntegrityIssue =
    hasStoredMoneyIntegrityIssue ||
    !isSafeStorageAmount(displayBalanceToday) ||
    !isSafeStorageAmount(transactionStats.totalInflow) ||
    !isSafeStorageAmount(transactionStats.totalOutflow);

  useEffect(() => {
    if (!isNaN(numericId) && shouldSyncSelectedAccount(selectedAccount, currentStoreAccount)) {
      setSelectedAccount(selectedAccount);
    }
  }, [numericId, selectedAccount, currentStoreAccount, setSelectedAccount]);

  useJumpToTransaction(transactionsData.length);

  if (isAccountsLoading) {
    return <CenteredLoader className="flex-1 p-4" label={t`Loading account information...`} />;
  }

  if (!selectedAccount && !isAccountsLoading) {
    return (
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4 mx-auto">
            <Wallet className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-medium text-muted-foreground mb-2">
            <Trans>Account not found</Trans>
          </p>
          <p className="text-sm text-muted-foreground/70">
            <Trans>The account you're looking for doesn't exist or has been deleted.</Trans>
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex-1 bg-muted/30 sm:bg-background">
        {/* Mobile Header */}
        <div className="sm:hidden px-3 pt-3 pb-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <AccountGlyph
                type={selectedAccount?.Type}
                currency={selectedAccount?.Currency}
                className="w-4 h-4"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h1 className="text-base font-bold text-foreground truncate">
                  {selectedAccount?.Name}
                </h1>
                {selectedAccount && (
                  <EditAccountDialog
                    budgetId={selectedBudget?.ID || 0}
                    selectedAccount={selectedAccount}
                  />
                )}
                {selectedAccount && (
                  <BankSyncButton
                    budgetId={selectedAccount.BudgetID}
                    accountId={selectedAccount.ID}
                    currency={selectedAccount.Currency}
                  />
                )}
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                  <AccountTypeLabel type={selectedAccount?.Type} />
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                {selectedAccount?.Currency}
                {' · '}
                {mobilePageStats
                  ? t`Page ${mobilePageStats.pageNumber + 1}/${mobilePageStats.totalPages}`
                  : `${transactionStats.recentCount} txns`}
                {selectedAccount?.ReconciledAt && (
                  <span>
                    <Trans>
                      {' '}
                      · Reconciled {new Date(selectedAccount.ReconciledAt).toLocaleDateString()}
                    </Trans>
                  </span>
                )}
              </p>
            </div>
          </div>

          <div>
            <AccountDateRangeControls
              dateRange={dateRange}
              periodLabel={periodLabel}
              open={isMobileDatePickerOpen}
              onOpenChange={setIsMobileDatePickerOpen}
              onDateRangeChange={handleDateRangeChange}
              variant="mobile"
            />
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-[10px] text-muted-foreground">
                <Trans>Balance</Trans>
              </span>
              <p className="text-sm font-bold tabular-nums text-foreground">
                {formatMilliAmount(displayBalanceToday)}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">
                <Trans>Cleared</Trans>
              </span>
              <p className="text-sm font-medium tabular-nums text-muted-foreground">
                {formatMilliAmount(displayClearedBalance)}
              </p>
            </div>
            <div className="w-px h-6 bg-border" />
            <FlowStat
              icon={ArrowUpRight}
              label={t`Inflow`}
              value={formatMilliAmount(transactionStats.totalInflow)}
              color="success"
              size="sm"
            />
            <FlowStat
              icon={ArrowDownRight}
              label={t`Outflow`}
              value={formatMilliAmount(transactionStats.totalOutflow)}
              color="destructive"
              size="sm"
            />
            {revaluationSummary &&
              revaluationSummary.total !== 0 &&
              selectedAccount &&
              selectedBudget && (
                <>
                  <div className="w-px h-6 bg-border" />
                  <ValueChangeStat
                    accountId={selectedAccount.ID}
                    summary={revaluationSummary}
                    onBudget={Boolean(selectedAccount.OnBudget)}
                    formatBudgetMilliAmount={formatBudgetMilliAmount}
                    formatRate={formatExchangeRate}
                    accountCurrency={selectedAccount.Currency}
                    budgetCurrency={selectedBudget.DisplayCurrency}
                    size="sm"
                  />
                </>
              )}
          </div>

          {displayLiabilityInfo && (
            <div>
              {balanceAccountToday > 0 ? (
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-success">
                      <Trans>Paid off!</Trans>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      <Trans>This liability has a positive balance.</Trans>
                    </div>
                  </div>
                </div>
              ) : (
                <PayoffSimulator
                  outstanding={displayLiabilityInfo.outstanding}
                  apr={displayLiabilityInfo.apr}
                  minPayment={displayLiabilityInfo.minPayment}
                  formatter={maskedFormatter}
                  initial={displayLiabilityInfo.minPayment}
                />
              )}
            </div>
          )}
        </div>

        {/* Desktop Header */}
        <div className="hidden sm:block px-6 pt-4 pb-2">
          <div className="flex items-center justify-between mb-3">
            <AccountHeader
              accountName={selectedAccount?.Name || ''}
              accountType={selectedAccount?.Type || ''}
              accountCurrency={selectedAccount?.Currency || ''}
              reconciledAt={selectedAccount?.ReconciledAt}
              AccountIcon={AccountIcon}
            />
            <div className="flex items-center gap-2">
              <AccountDateRangeControls
                dateRange={dateRange}
                periodLabel={periodLabel}
                open={isDesktopDatePickerOpen}
                onOpenChange={setIsDesktopDatePickerOpen}
                onDateRangeChange={handleDateRangeChange}
                variant="desktop"
              />
              {selectedAccount && (
                <BankSyncButton
                  budgetId={selectedAccount.BudgetID}
                  accountId={selectedAccount.ID}
                  currency={selectedAccount.Currency}
                />
              )}
              {selectedAccount && (
                <EditAccountDialog
                  budgetId={selectedBudget?.ID || 0}
                  selectedAccount={selectedAccount}
                />
              )}
            </div>
          </div>
          <AccountSummaryCards
            displayBalanceToday={displayBalanceToday}
            displayClearedBalance={displayClearedBalance}
            transactionStats={transactionStats}
            displayLiabilityInfo={displayLiabilityInfo}
            balanceAccountToday={balanceAccountToday}
            formatter={maskedFormatter}
            valueChangeSlot={
              revaluationSummary &&
              revaluationSummary.total !== 0 &&
              selectedAccount &&
              selectedBudget ? (
                <ValueChangeStat
                  accountId={selectedAccount.ID}
                  summary={revaluationSummary}
                  onBudget={Boolean(selectedAccount.OnBudget)}
                  formatBudgetMilliAmount={formatBudgetMilliAmount}
                  formatRate={formatExchangeRate}
                  accountCurrency={selectedAccount.Currency}
                  budgetCurrency={selectedBudget.DisplayCurrency}
                  size="md"
                />
              ) : null
            }
          />
        </div>

        {hasMoneyIntegrityIssue && (
          <div className="px-3 pb-3 sm:px-6">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                <Trans>Exchange-rate data needs attention</Trans>
              </AlertTitle>
              <AlertDescription>
                {unsafeTransactionCount > 0
                  ? plural(unsafeTransactionCount, {
                      one: `# transaction contains an amount outside Budgero's exact money range. Correct the exchange rate in the highlighted row; the converted amount and account balance will then be recalculated.`,
                      other: `# transactions contain an amount outside Budgero's exact money range. Correct the exchange rate in the highlighted row; the converted amount and account balance will then be recalculated.`,
                    })
                  : t`This account balance is outside Budgero’s exact money range. Correct the offending transaction exchange rate to recalculate it.`}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Transactions Section */}
        <div className="flex-1 sm:px-6 space-y-6">
          <AccountTransactionsSection
            isTransactionsLoading={isTransactionsLoading}
            transactionsData={registerRows}
            accountId={numericId}
            onMobilePageChange={handleMobilePageChange}
            onCreateRecurringFromSelection={recurringEditor.openFromTransaction}
            categories={categories}
            onDateRangeChange={handleDateRangeChange}
            onFilteredStatsChange={handleFilteredStatsChange}
            onFilterModeChange={setIsRegisterFilterActive}
            totalTransactionCount={
              (transactionSummary?.TransactionCount ?? 0) + projectedTransactions.length
            }
            uncategorizedCount={transactionSummary?.UncategorizedCount ?? 0}
            unclearedCount={transactionSummary?.UnclearedCount ?? 0}
            hasMoreTransactions={Boolean(transactionPages.hasNextPage)}
            isLoadingMoreTransactions={transactionPages.isFetchingNextPage}
            onLoadMoreTransactions={handleLoadMoreTransactions}
            headerActions={
              selectedAccount && (
                <ReconcileAccountDialog
                  account={selectedAccount}
                  budgetId={selectedBudget?.ID || 0}
                />
              )
            }
          />
        </div>
      </div>
      <RecurringTransactionEditor
        open={recurringEditor.open}
        mode="create"
        onOpenChange={recurringEditor.setOpen}
        budgetId={selectedAccount?.BudgetID || selectedBudget?.ID || 0}
        accounts={accounts.filter((a) => !a.Archived)}
        categories={categories}
        initialValues={recurringEditor.initialValues}
        onSubmit={recurringEditor.handleSubmit}
        isSubmitting={recurringEditor.isSubmitting}
      />
    </TooltipProvider>
  );
}
