import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { Category } from '@budgero/core/browser';

// Account business calculations now live in core (services/accounts/account-calcs).
export {
  computeLiabilityInfo,
  convertLiabilityInfoToBudgetCurrency,
  calculateTransactionStats,
} from '@budgero/core/browser';
export type { LiabilityInfo, TransactionStats, MobilePageStats } from '@budgero/core/browser';

/**
 * Generates a human-readable label for a date range.
 */
export function formatPeriodLabel(dateRange: DateRange | undefined): string {
  if (dateRange?.from && dateRange?.to) {
    return `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`;
  }
  if (dateRange?.from) {
    return format(dateRange.from, 'MMM d, yyyy');
  }
  if (dateRange?.to) {
    return format(dateRange.to, 'MMM d, yyyy');
  }
  return 'All transactions';
}

/**
 * Creates a map of category IDs to names for quick lookup.
 */
export function buildCategoriesMap(categories: Category[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const cat of categories || []) {
    map.set(cat.ID, cat.Name);
  }
  return map;
}
