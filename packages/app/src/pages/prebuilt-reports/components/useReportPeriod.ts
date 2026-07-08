import { format } from 'date-fns';
import { useUiStore } from '@shared/store/useUiStore';

/**
 * The globally selected report period: the ui-store date range, its
 * `yyyy-MM-dd` derivation (empty strings when unset), and the active budget.
 */
export function useReportPeriod() {
  const dateRange = useUiStore((state) => state.dateRange);
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);

  const startDate = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
  const endDate = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';

  return { dateRange, budgetId, startDate, endDate };
}
