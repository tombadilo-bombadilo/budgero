import { useQuery } from '@tanstack/react-query';
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
} from '@budgero/core/browser';

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

      const allTransactions = await Promise.all(
        accounts.map((account) => {
          const services = runtime.services();
          return services.transactions.getTransactionsByAccountAndMonth(account.ID, month);
        })
      );

      return allTransactions.flat();
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
export function useAllTransactions(budgetId: number) {
  return useSpaceQuery<GetAllTransactions[]>({
    key: ['allTransactions', budgetId],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.transactions.getAllTransactions(budgetId),
  });
}

/**
 * Fetch all transactions for a budget with full details (same format as account transactions).
 * Includes Account field for each transaction.
 */
export function useAllTransactionsDetailed(budgetId: number) {
  return useSpaceQuery<GetTransactionsByAccountRow[]>({
    key: ['allTransactionsDetailed', budgetId],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.transactions.getAllTransactionsDetailed(budgetId),
  });
}
