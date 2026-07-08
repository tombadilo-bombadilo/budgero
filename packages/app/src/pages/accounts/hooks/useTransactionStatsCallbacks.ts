import { useCallback, useState } from 'react';
import type { FilteredStats } from '@features/transactions';
import type { MobilePageStats } from '../account-page.utils';

/**
 * Shared mobile-page and filtered-stats state for transaction views.
 *
 * Both AccountPage and AllTransactionsPage track stats emitted by
 * TransactionsTable. The setters bail out when the incoming value is
 * field-for-field identical to the previous one, preventing excessive
 * re-renders. The bail-out logic is non-trivial, so it lives here once.
 */
export function useTransactionStatsCallbacks() {
  const [mobilePageStats, setMobilePageStats] = useState<MobilePageStats | null>(null);

  // State to track filtered stats (includes semantic search filters)
  const [filteredStats, setFilteredStats] = useState<FilteredStats | null>(null);

  const handleMobilePageChange = useCallback((next: MobilePageStats | null) => {
    setMobilePageStats((prev) => {
      if (prev === next) return prev;
      if (!prev || !next) return next;
      const unchanged =
        prev.totalInflow === next.totalInflow &&
        prev.totalOutflow === next.totalOutflow &&
        prev.transactionCount === next.transactionCount &&
        prev.pageNumber === next.pageNumber &&
        prev.totalPages === next.totalPages;
      return unchanged ? prev : next;
    });
  }, []);

  const handleFilteredStatsChange = useCallback((next: FilteredStats) => {
    setFilteredStats((prev) => {
      if (prev === next) return prev;
      if (!prev) return next;
      const unchanged =
        prev.totalInflow === next.totalInflow &&
        prev.totalOutflow === next.totalOutflow &&
        prev.transactionCount === next.transactionCount;
      return unchanged ? prev : next;
    });
  }, []);

  return {
    mobilePageStats,
    filteredStats,
    handleMobilePageChange,
    handleFilteredStatsChange,
  };
}
