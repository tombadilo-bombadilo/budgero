import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAccounts } from '@entities/account/api/useAccounts';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type {
  GetTransactionsByAccountRow,
  GetTransactionsByAccountAndMonthRow,
  GetTransactionsByCategoryAndMonthRow,
  GetAllTransactions,
  TransferRateDetails,
  AccountTransactionCursor,
  AccountTransactionPage,
  AccountTransactionSummary,
  SimilarTransaction,
} from '@budgero/core/browser';

export const ACCOUNT_TRANSACTION_PAGE_SIZE = 200;

/**
 * Fetch all transactions for a given account.
 */
export function useTransactions(accountId: number | null) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  return useQuery<GetTransactionsByAccountRow[]>({
    queryKey: ['transactions', spaceKey, accountId],
    queryFn: async () => {
      if (!spaceId || !accountId) return [];
      const services = runtime.services();
      return services.transactions.getTransactionsByAccount(accountId);
    },
    enabled: Boolean(spaceId) && Boolean(accountId),
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Incremental account-register query. Date/ID keysets keep every database read
 * bounded even when an account has tens of thousands of transactions.
 */
export function useAccountTransactionPages(
  accountId: number | null,
  fromDate?: string,
  toDate?: string
) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);

  return useInfiniteQuery<
    AccountTransactionPage,
    Error,
    { pages: AccountTransactionPage[]; pageParams: (AccountTransactionCursor | null)[] },
    readonly (string | number)[],
    AccountTransactionCursor | null
  >({
    queryKey: [
      'accountTransactionPages',
      spaceKey,
      accountId ?? 0,
      fromDate ?? '',
      toDate ?? '',
      ACCOUNT_TRANSACTION_PAGE_SIZE,
    ],
    queryFn: async ({ pageParam }) => {
      if (!spaceId || !accountId) return { rows: [], nextCursor: null };
      return runtime.services().transactions.getTransactionsByAccountPage(accountId, {
        limit: ACCOUNT_TRANSACTION_PAGE_SIZE,
        cursor: pageParam,
        fromDate,
        toDate,
      });
    },
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(spaceId) && Boolean(accountId),
    staleTime: 1000 * 60 * 5,
  });
}

/** Full selected range, enabled only while correctness-sensitive client search is active. */
export function useAccountTransactionsForSearch(
  accountId: number | null,
  fromDate: string | undefined,
  toDate: string | undefined,
  enabled: boolean
) {
  return useSpaceQuery<GetTransactionsByAccountRow[]>({
    key: ['accountTransactionRange', accountId ?? 0, fromDate ?? '', toDate ?? ''],
    enabled: enabled && Boolean(accountId),
    queryFn: (services) =>
      services.transactions.getTransactionsByAccountRange(accountId as number, fromDate, toDate),
  });
}

/**
 * Existing transactions that may be the same payment as one being entered
 * (same account and direction, amount and date within the configured range).
 */
export function useSimilarTransactions(
  accountId: number | null,
  date: string | null,
  amountNative: number,
  options: { enabled: boolean; toleranceBps: number; dayWindow: number }
) {
  const { enabled, toleranceBps, dayWindow } = options;
  return useSpaceQuery<SimilarTransaction[]>({
    key: ['similarTransactions', accountId ?? 0, date ?? '', amountNative, toleranceBps, dayWindow],
    enabled: enabled && Boolean(accountId) && Boolean(date) && amountNative !== 0,
    queryFn: (services) =>
      services.transactions.findSimilarTransactions({
        accountId: accountId as number,
        date: date as string,
        amountNative,
        toleranceBps,
        dayWindow,
      }),
  });
}

/** Small aggregate query used by account headers and pagination counts. */
export function useAccountTransactionSummary(
  accountId: number | null,
  fromDate?: string,
  toDate?: string,
  enabled = true
) {
  return useSpaceQuery<AccountTransactionSummary>({
    key: ['accountTransactionSummary', accountId ?? 0, fromDate ?? '', toDate ?? ''],
    enabled: enabled && Boolean(accountId),
    queryFn: (services) =>
      services.transactions.getAccountTransactionSummary(accountId as number, fromDate, toDate),
  });
}

/** Future-dated rows are used by the small scheduled-transactions panel, not the main register. */
export function useFutureAccountTransactions(accountId: number | null, afterDate: string) {
  return useSpaceQuery<GetTransactionsByAccountRow[]>({
    key: ['futureAccountTransactions', accountId ?? 0, afterDate],
    enabled: Boolean(accountId),
    queryFn: (services) =>
      services.transactions.getTransactionsByAccountRange(accountId as number, afterDate),
  });
}

/**
 * Fetch all transactions for a given account in a specific month.
 */
export function useMonthlyTransactions(accountId: number, month: string) {
  return useSpaceQuery<GetTransactionsByAccountAndMonthRow[]>({
    key: ['monthlyTransactions', accountId, month],
    enabled: Boolean(accountId) && Boolean(month),
    queryFn: (services) => services.transactions.getTransactionsByAccountAndMonth(accountId, month),
  });
}

/**
 * Fetch monthly transactions for all accounts in a budget.
 */
export function useAllAccountsMonthlyTransactions(budgetId: number, month: string) {
  const { data: accounts } = useAccounts(budgetId);
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);

  return useQuery<GetTransactionsByAccountAndMonthRow[]>({
    queryKey: ['allAccountsMonthlyTransactions', spaceKey, budgetId, month],
    queryFn: async () => {
      if (!spaceId || !accounts || accounts.length === 0) return [];

      // One query for every account; same rows and order as one query per account, concatenated.
      return runtime.services().transactions.getTransactionsByAccountsAndMonth(
        accounts.map((account) => account.ID),
        month
      );
    },
    enabled: Boolean(spaceId) && Boolean(budgetId) && Boolean(month) && Boolean(accounts),
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Fetch transactions by category and month.
 */
export function useTransactionsByCategoryAndMonth(
  budgetId: number,
  categoryName: string,
  month: string
) {
  return useSpaceQuery<GetTransactionsByCategoryAndMonthRow[]>({
    key: ['transactionsByCategoryAndMonth', budgetId, categoryName, month],
    enabled: Boolean(budgetId) && Boolean(categoryName) && Boolean(month),
    queryFn: (services) =>
      services.transactions.getTransactionsByCategoryAndMonth(budgetId, categoryName, month),
  });
}

export function useTransactionsByCategoryAndRange(
  budgetId: number,
  categoryId: number | null,
  startDate: string,
  endDate: string,
  accountIds?: number[],
  enabled = true
) {
  const normalizedAccountIds = accountIds?.length
    ? Array.from(new Set(accountIds)).sort((a, b) => a - b)
    : undefined;

  return useSpaceQuery<GetTransactionsByCategoryAndMonthRow[]>({
    key: [
      'transactionsByCategoryRange',
      budgetId,
      categoryId ?? 'uncategorized',
      startDate,
      endDate,
      normalizedAccountIds?.join('_') ?? 'all-accounts',
    ],
    enabled:
      enabled &&
      Boolean(budgetId) &&
      Boolean(startDate) &&
      Boolean(endDate) &&
      (categoryId === null || typeof categoryId === 'number'),
    queryFn: (services) =>
      services.transactions.getTransactionsByCategoryAndRange(
        budgetId,
        categoryId,
        startDate,
        endDate,
        normalizedAccountIds
      ),
  });
}

/**
 * Fetch all transactions for a budget.
 */
export interface AllTransactionsQueryOptions {
  enabled?: boolean;
  limit?: number;
}

export function useAllTransactions(
  budgetId: number,
  { enabled = true, limit }: AllTransactionsQueryOptions = {}
) {
  return useSpaceQuery<GetAllTransactions[]>({
    key:
      limit === undefined
        ? ['allTransactions', budgetId]
        : ['allTransactions', budgetId, 'limit', limit],
    enabled: Boolean(budgetId) && enabled,
    queryFn: (services) => services.transactions.getAllTransactions(budgetId, limit),
  });
}

/**
 * Fetch all transactions for a budget with full details (same format as account transactions).
 * Includes Account field for each transaction. `afterDate` limits it to rows dated after that day.
 */
export function useAllTransactionsDetailed(
  budgetId: number,
  { afterDate }: { afterDate?: string } = {}
) {
  return useSpaceQuery<GetTransactionsByAccountRow[]>({
    key: afterDate
      ? ['allTransactionsDetailed', budgetId, 'after', afterDate]
      : ['allTransactionsDetailed', budgetId],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.transactions.getAllTransactionsDetailed(budgetId, afterDate),
  });
}

/**
 * Budget-wide transactions with split parents expanded into their split lines.
 * For aggregation (analytics); registers want useAllTransactionsDetailed.
 */
export function useAllTransactionsAnalytics(budgetId: number) {
  return useSpaceQuery<GetTransactionsByAccountRow[]>({
    key: ['allTransactionsAnalytics', budgetId],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.transactions.getAllTransactionsAnalytics(budgetId),
  });
}

export function useTransferRateDetails(transferId: string | null) {
  return useSpaceQuery<TransferRateDetails | null>({
    key: ['transferRateDetails', transferId ?? 'none'],
    enabled: Boolean(transferId),
    queryFn: (services) =>
      transferId ? services.transactions.getTransferRateDetails(transferId) : null,
  });
}
