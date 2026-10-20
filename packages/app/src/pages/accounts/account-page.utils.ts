import { t } from '@lingui/core/macro';
import { formatDate as format } from '@shared/lib/date-format';
import type { DateRange } from 'react-day-picker';
import { isLiabilityAccountType, type Account, type Category } from '@budgero/core/browser';

// Account business calculations now live in core (services/accounts/account-calcs).
export {
  computeLiabilityInfo,
  convertLiabilityInfoToBudgetCurrency,
  calculateTransactionStats,
} from '@budgero/core/browser';
export type { LiabilityInfo, TransactionStats, MobilePageStats } from '@budgero/core/browser';

/**
 * Whether the account page shows debt details and the payoff simulator: credit
 * cards, loans and mortgages, or accounts flagged as a liability. A checking or
 * savings account that is merely overdrawn doesn't get them.
 */
export function showsDebtDetails(account: Pick<Account, 'Type'> & { Metadata?: unknown }): boolean {
  if (isLiabilityAccountType(account.Type)) return true;
  let metadata: unknown = account.Metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return false;
    }
  }
  return Boolean(
    metadata && typeof metadata === 'object' && (metadata as { liability?: unknown }).liability
  );
}

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
  return t`All transactions`;
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

/**
 * The account query is authoritative. A refetch may return an updated object
 * for the same account ID (for example after changing its currency), and the
 * shared UI store must receive that object so account-scoped formatters update.
 */
export function shouldSyncSelectedAccount(
  queriedAccount: Account | null,
  storedAccount: Account | null
): queriedAccount is Account {
  return queriedAccount !== null && queriedAccount !== storedAccount;
}
