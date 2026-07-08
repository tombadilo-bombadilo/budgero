import { useParams } from 'react-router-dom';
import { EditAccountDialog } from '@features/account-management/ui/EditAccountDialog';
import { ReconcileAccountDialog } from '@features/account-management/ui/ReconcileAccountDialog';
import { useCategories } from '@entities/category/api/useCategories';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useTransactions } from '@entities/transaction/api/useTransactions';
import {
  useCreateRecurringTransaction,
  useMarkRecurringOccurrenceReady,
  useProjectedTransactions,
  useRecurringOccurrences,
  useSkipRecurringOccurrence,
} from '@entities/recurring/api/useRecurringTransactions';
import { useEffect, useMemo, useState } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { Badge } from '@shared/ui/badge';
import { endOfDay, isAfter } from 'date-fns';
import { Wallet, ArrowUpRight, ArrowDownRight, CheckCircle2 } from 'lucide-react';
import { TooltipProvider } from '@shared/ui/tooltip';
import { PayoffSimulator } from '@features/debt/ui/PayoffSimulator';
import { useLoading } from '@shared/contexts/LoadingContext';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import {
  RecurringTransactionEditor,
  type RecurringTransactionEditorProps,
  type RecurringTransactionEditorSubmit,
} from '@features/recurring/ui/RecurringTransactionEditor';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { formatDateISO, getTodayISO } from '@shared/lib/date-utils';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { getErrorMessage } from '@shared/lib/errors';
import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { toast } from 'sonner';

import { useAccountDateRange } from './hooks/useAccountDateRange';
import { useAccountMetrics, normalizeToDate } from './hooks/useAccountMetrics';
import { useJumpToTransaction } from './hooks/useJumpToTransaction';
import { useTransactionStatsCallbacks } from './hooks/useTransactionStatsCallbacks';
import { mergeProjectedTransactions } from './hooks/projected-register';
import {
  buildCategoriesMap,
  computeLiabilityInfo,
  convertLiabilityInfoToBudgetCurrency,
  calculateTransactionStats,
} from './account-page.utils';
import { AccountHeader } from './components/AccountHeader';
import { FlowStat } from './components/FlowStat';
import { AccountSummaryCards } from './components/AccountSummaryCards';
import { AccountDateRangeControls } from './components/AccountDateRangeControls';
import { AccountTransactionsSection } from './components/AccountTransactionsSection';
import { RecurringTransactionsPanel } from './components/RecurringTransactionsPanel';

export default function AccountPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const numericId = Number(accountId);
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

  const { data, isLoading: isTransactionsLoading } = useTransactions(numericId);
  const allTransactionsData = useMemo(() => data ?? [], [data]);

  const { balanceAccountToday, balanceConvertedToday, displayBalanceToday, transactionsData } =
    useAccountMetrics({
      selectedAccount,
      allTransactionsData,
      dateRange,
      transactionCurrencyDisplay,
    });

  // Fetch categories (needed for transaction display/editing)
  const { data: categories = [] } = useCategories(selectedBudget?.ID || 0);

  const {
    data: recurringOccurrences = [],
    isLoading: recurringLoading,
    isFetching: recurringFetching,
  } = useRecurringOccurrences(selectedAccount?.BudgetID || selectedBudget?.ID || 0, {
    status: ['scheduled', 'ready'],
    accountId: numericId || undefined,
  });
  const markRecurringReady = useMarkRecurringOccurrenceReady();
  const skipRecurring = useSkipRecurringOccurrence();
  const createRecurring = useCreateRecurringTransaction();

  // Scheduled occurrences projected into the register as non-editable rows.
  // The date filter mirrors the register range, so future occurrences only
  // appear when the user extends the range past today, while overdue ones
  // surface inside the default range.
  const projectedOptions = useMemo(
    () => ({
      accountId: numericId || undefined,
      fromDate: dateRange?.from ? formatDateISO(dateRange.from) : undefined,
      toDate: dateRange?.to ? formatDateISO(dateRange.to) : undefined,
    }),
    [numericId, dateRange]
  );
  const { data: projectedTransactions = [] } = useProjectedTransactions(
    selectedAccount?.BudgetID || selectedBudget?.ID || 0,
    projectedOptions
  );

  const registerRows = useMemo(
    () => mergeProjectedTransactions(transactionsData, allTransactionsData, projectedTransactions),
    [transactionsData, allTransactionsData, projectedTransactions]
  );
  const [processingOccurrenceId, setProcessingOccurrenceId] = useState<number | null>(null);
  const [recurringEditorOpen, setRecurringEditorOpen] = useState(false);
  const [recurringEditorInitialValues, setRecurringEditorInitialValues] =
    useState<RecurringTransactionEditorProps['initialValues']>();

  const currentFormatter =
    transactionCurrencyDisplay === 'budget' ? globalLocalizer : accountLocalizer;
  const formatAmount = useFormatMaskedAmount(currentFormatter);
  // Stored amounts are integer milliunits; convert at this display boundary.
  const formatMilliAmount = (m: number) => formatAmount(toDecimal(asMilli(m)));
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
    if (!liabilityInfo || !selectedAccount) return liabilityInfo;
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
  ]);

  const categoriesById = useMemo(() => buildCategoriesMap(categories), [categories]);

  const upcomingRecurringOccurrences = useMemo(() => {
    const threshold = new Date();
    threshold.setMonth(threshold.getMonth() + 1);
    const thresholdKey = formatDateISO(threshold);

    const scheduled = recurringOccurrences
      .filter(
        (occurrence) =>
          occurrence.status === 'scheduled' && occurrence.template.accountId === numericId
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // The next un-ready occurrence per series, so a rule whose imminent
    // occurrences are all marked ready still surfaces its next due date even
    // when that falls beyond the one-month reminder window.
    const nextPerTemplate = new Map<number, number>();
    for (const occurrence of scheduled) {
      if (!nextPerTemplate.has(occurrence.recurringTransactionId)) {
        nextPerTemplate.set(occurrence.recurringTransactionId, occurrence.id);
      }
    }

    return scheduled.filter(
      (occurrence) =>
        occurrence.dueDate <= thresholdKey ||
        nextPerTemplate.get(occurrence.recurringTransactionId) === occurrence.id
    );
  }, [recurringOccurrences, numericId]);

  // Real transactions that were posted by marking a recurring occurrence ready.
  // These are already represented by their recurring series, so they must not
  // also appear as standalone "scheduled" entries in the upcoming panel.
  const recurringPostedTransactionIds = useMemo(
    () =>
      new Set(
        recurringOccurrences
          .map((occurrence) => occurrence.transactionId)
          .filter((id): id is number => id != null)
      ),
    [recurringOccurrences]
  );

  const upcomingScheduledTransactions = useMemo(() => {
    const todayEnd = endOfDay(new Date());
    return allTransactionsData
      .map((transaction) => {
        const rawDate =
          (transaction as { Date?: string; date?: string }).Date ??
          (transaction as { Date?: string; date?: string }).date;
        const parsedDate = normalizeToDate(rawDate);
        return { transaction, parsedDate };
      })
      .filter(
        ({ transaction, parsedDate }) =>
          parsedDate &&
          isAfter(parsedDate, todayEnd) &&
          !recurringPostedTransactionIds.has(transaction.ID)
      )
      .sort((a, b) => {
        if (!a.parsedDate || !b.parsedDate) return 0;
        return a.parsedDate.getTime() - b.parsedDate.getTime();
      });
  }, [allTransactionsData, recurringPostedTransactionIds]);

  const handleCreateRecurringFromTransaction = (transaction: GetTransactionsByAccountRow) => {
    const direction = transaction.Outflow > 0 ? 'outflow' : 'inflow';
    const rawAmount = direction === 'outflow' ? transaction.Outflow : transaction.Inflow;
    const startDate = transaction.Date || getTodayISO();

    setRecurringEditorInitialValues({
      name: transaction.Memo || 'Recurring transaction',
      memo: transaction.Memo || '',
      // Outflow/Inflow are stored milliunits; Math.abs drops the brand only.
      amount: asMilli(Math.abs(rawAmount)),
      direction,
      accountId: numericId,
      categoryId: transaction.CategoryID ?? null,
      schedule: {
        startDate,
        intervalUnit: 'month',
        intervalCount: 1,
      },
      notifyDaysBefore: 0,
      active: true,
    });
    setRecurringEditorOpen(true);
  };

  const handleRecurringEditorSubmit = async (values: RecurringTransactionEditorSubmit) => {
    const budgetForCreate = selectedAccount?.BudgetID || selectedBudget?.ID || 0;
    if (!budgetForCreate) return;
    if (!values.accountId) {
      toast.error('Select an account');
      return;
    }
    if (!values.categoryId) {
      toast.error('Select a category');
      return;
    }
    if (!values.amount || Number.isNaN(values.amount)) {
      toast.error('Enter a valid amount');
      return;
    }

    try {
      await createRecurring.mutateAsync({
        budgetId: budgetForCreate,
        accountId: values.accountId,
        categoryId: values.categoryId,
        name: values.name,
        memo: values.memo,
        amount: values.amount,
        direction: values.direction,
        schedule: values.schedule,
        notifyDaysBefore: values.notifyDaysBefore,
        active: values.active,
      });
      toast.success('Recurring transaction created', {
        description: 'We will remind you when it is almost due.',
      });
      setRecurringEditorOpen(false);
    } catch (error) {
      const message = getErrorMessage(error, 'Something went wrong.');
      toast.error('Unable to save recurring transaction', {
        description: message,
      });
    }
  };

  const handleOccurrenceAction = async (occurrenceId: number, action: 'ready' | 'skip') => {
    try {
      setProcessingOccurrenceId(occurrenceId);
      if (action === 'ready') {
        // Post dated on the due date, matching the recurring settings page.
        const result = await markRecurringReady.mutateAsync({ occurrenceId });
        const { template } = result.occurrence;
        toast.success('Transaction posted', {
          description: `${template.name} was added to your register.`,
        });
      } else {
        await skipRecurring.mutateAsync({ id: occurrenceId });
        toast.success('Occurrence skipped', {
          description: 'We will remind you again next time.',
        });
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Something went wrong.');
      toast.error('Action failed', { description: message });
    } finally {
      setProcessingOccurrenceId(null);
    }
  };

  const transactionStats = useMemo(() => {
    // If we have filtered stats from TransactionsTable (which includes semantic search filters), use those
    if (filteredStats) {
      return {
        recentCount: filteredStats.transactionCount,
        totalInflow: filteredStats.totalInflow,
        totalOutflow: filteredStats.totalOutflow,
      };
    }
    // Fallback to calculating from the register rows (date-filtered, incl. projections)
    return calculateTransactionStats(registerRows, mobilePageStats, transactionCurrencyDisplay);
  }, [registerRows, mobilePageStats, transactionCurrencyDisplay, filteredStats]);

  useEffect(() => {
    if (!isNaN(numericId) && selectedAccount && currentStoreAccount?.ID !== selectedAccount.ID) {
      setSelectedAccount(selectedAccount);
    }
  }, [numericId, selectedAccount, currentStoreAccount?.ID, setSelectedAccount]);

  useJumpToTransaction(transactionsData.length);

  if (isAccountsLoading) {
    return <CenteredLoader className="flex-1 p-4" label="Loading account information..." />;
  }

  if (!selectedAccount && !isAccountsLoading) {
    return (
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4 mx-auto">
            <Wallet className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-medium text-muted-foreground mb-2">Account not found</p>
          <p className="text-sm text-muted-foreground/70">
            The account you're looking for doesn't exist or has been deleted.
          </p>
        </div>
      </div>
    );
  }

  const showRecurringPanel =
    !isTransactionsLoading &&
    !isProcessingTransfer &&
    (recurringLoading ||
      upcomingRecurringOccurrences.length > 0 ||
      upcomingScheduledTransactions.length > 0);

  return (
    <TooltipProvider>
      <div className="flex-1 bg-muted/30 sm:bg-background">
        {/* Mobile Header */}
        <div className="sm:hidden px-3 pt-3 pb-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <AccountIcon className="w-3.5 h-3.5" />
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
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                  {selectedAccount?.Type}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                {selectedAccount?.Currency}
                {' · '}
                {mobilePageStats
                  ? `Page ${mobilePageStats.pageNumber + 1}/${mobilePageStats.totalPages}`
                  : `${transactionStats.recentCount} txns`}
                {selectedAccount?.ReconciledAt && (
                  <span>
                    {' '}
                    · Reconciled {new Date(selectedAccount.ReconciledAt).toLocaleDateString()}
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
              <span className="text-[10px] text-muted-foreground">Balance</span>
              <p className="text-sm font-bold tabular-nums text-foreground">
                {formatMilliAmount(displayBalanceToday)}
              </p>
            </div>
            <div className="w-px h-6 bg-border" />
            <FlowStat
              icon={ArrowUpRight}
              label="Inflow"
              value={formatMilliAmount(transactionStats.totalInflow)}
              color="success"
              size="sm"
            />
            <FlowStat
              icon={ArrowDownRight}
              label="Outflow"
              value={formatMilliAmount(transactionStats.totalOutflow)}
              color="destructive"
              size="sm"
            />
          </div>

          {displayLiabilityInfo && (
            <div>
              {balanceAccountToday > 0 ? (
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-success">Paid off!</div>
                    <div className="text-[10px] text-muted-foreground">
                      This liability has a positive balance.
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
                <EditAccountDialog
                  budgetId={selectedBudget?.ID || 0}
                  selectedAccount={selectedAccount}
                />
              )}
            </div>
          </div>
          <AccountSummaryCards
            displayBalanceToday={displayBalanceToday}
            transactionStats={transactionStats}
            displayLiabilityInfo={displayLiabilityInfo}
            balanceAccountToday={balanceAccountToday}
            formatter={maskedFormatter}
          />
        </div>

        {/* Transactions Section */}
        <div className="flex-1 sm:px-6 space-y-6">
          {showRecurringPanel && (
            <RecurringTransactionsPanel
              isLoading={recurringLoading}
              isFetching={recurringFetching}
              upcomingRecurringOccurrences={upcomingRecurringOccurrences}
              upcomingScheduledTransactions={upcomingScheduledTransactions}
              categoriesById={categoriesById}
              formatter={maskedFormatter}
              transactionCurrencyDisplay={transactionCurrencyDisplay}
              processingOccurrenceId={processingOccurrenceId}
              isMarkReadyPending={markRecurringReady.isPending}
              isSkipPending={skipRecurring.isPending}
              onOccurrenceAction={handleOccurrenceAction}
            />
          )}

          <AccountTransactionsSection
            isTransactionsLoading={isTransactionsLoading}
            isProcessingTransfer={isProcessingTransfer}
            transactionsData={registerRows}
            accountId={numericId}
            onMobilePageChange={handleMobilePageChange}
            onCreateRecurringFromSelection={handleCreateRecurringFromTransaction}
            categories={categories}
            onDateRangeChange={handleDateRangeChange}
            onFilteredStatsChange={handleFilteredStatsChange}
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
        open={recurringEditorOpen}
        mode="create"
        onOpenChange={setRecurringEditorOpen}
        accounts={accounts.filter((a) => !a.Archived)}
        categories={categories}
        initialValues={recurringEditorInitialValues}
        onSubmit={handleRecurringEditorSubmit}
        isSubmitting={createRecurring.isPending}
      />
    </TooltipProvider>
  );
}
