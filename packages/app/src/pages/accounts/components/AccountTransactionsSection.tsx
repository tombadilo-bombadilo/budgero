import React from 'react';
import type { DateRange } from 'react-day-picker';
import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { TransactionsTable, type FilteredStats } from '@features/transactions';
import type { GetTransactionsByAccountRow, Category } from '@budgero/core/browser';
import type { MobilePageStats } from '../account-page.utils';

export interface AccountTransactionsSectionProps {
  isTransactionsLoading: boolean;
  isProcessingTransfer: boolean;
  transactionsData: GetTransactionsByAccountRow[];
  accountId: number;
  onMobilePageChange: (stats: MobilePageStats | null) => void;
  onCreateRecurringFromSelection: (transaction: GetTransactionsByAccountRow) => void;
  categories?: Category[];
  onDateRangeChange?: (range: DateRange | undefined) => void;
  onFilteredStatsChange?: (stats: FilteredStats) => void;
  headerActions?: React.ReactNode;
}

export const AccountTransactionsSection = React.memo(function AccountTransactionsSection({
  isTransactionsLoading,
  isProcessingTransfer,
  transactionsData,
  accountId,
  onMobilePageChange,
  onCreateRecurringFromSelection,
  categories,
  onDateRangeChange,
  onFilteredStatsChange,
  headerActions,
}: AccountTransactionsSectionProps) {
  if (isTransactionsLoading || isProcessingTransfer) {
    return (
      <CenteredLoader
        className="py-12"
        label={isProcessingTransfer ? 'Processing transfer...' : 'Loading transactions...'}
      />
    );
  }

  return (
    <TransactionsTable
      initialData={transactionsData}
      hideAccountColumn
      onMobilePageChange={onMobilePageChange}
      onCreateRecurringFromSelection={onCreateRecurringFromSelection}
      preselectedAccountId={accountId}
      categories={categories}
      onDateRangeChange={onDateRangeChange}
      onFilteredStatsChange={onFilteredStatsChange}
      headerActions={headerActions}
    />
  );
});
