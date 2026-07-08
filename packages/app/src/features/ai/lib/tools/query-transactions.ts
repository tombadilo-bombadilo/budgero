import { z } from 'zod';
import { capitalize } from '@shared/lib/utils';
import { getErrorMessage } from '@shared/lib/errors';
import { fromDecimal, toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import type { ToolContext, ToolExecutionResult } from './types';

export const queryTransactionsSchema = z.object({
  filters: z
    .object({
      categoryName: z.string().optional().describe('Filter by category name'),
      accountName: z.string().optional().describe('Filter by account name'),
      payee: z.string().optional().describe('Filter by payee (partial match)'),
      memo: z.string().optional().describe('Filter by memo (partial match)'),
      dateFrom: z.string().optional().describe('Start date YYYY-MM-DD'),
      dateTo: z.string().optional().describe('End date YYYY-MM-DD'),
      minAmount: z.number().optional().describe('Minimum amount (decimal currency units)'),
      maxAmount: z.number().optional().describe('Maximum amount (decimal currency units)'),
      type: z.enum(['expense', 'income', 'all']).optional().describe('Transaction type filter'),
      excludeCategory: z
        .string()
        .optional()
        .describe('Exclude transactions in this category (partial match)'),
      excludePayee: z
        .string()
        .optional()
        .describe('Exclude transactions with this payee (partial match)'),
      excludeAccount: z
        .string()
        .optional()
        .describe('Exclude transactions from this account (partial match)'),
    })
    .optional(),

  aggregation: z
    .enum(['list', 'sum', 'count', 'max', 'min', 'average'])
    .describe('How to aggregate results'),

  groupBy: z
    .enum(['category', 'month', 'payee', 'account'])
    .optional()
    .describe('Group results by field'),

  orderBy: z.enum(['date', 'amount', 'payee']).optional().describe('Order results by field'),

  orderDirection: z.enum(['asc', 'desc']).optional().describe('Sort direction'),

  limit: z.number().optional().describe('Max number of results'),
});

export type QueryTransactionsArgs = z.infer<typeof queryTransactionsSchema>;

interface Transaction {
  ID: number;
  Date: string;
  Payee?: string;
  Memo?: string;
  Category?: string;
  CategoryID?: number;
  Account?: string;
  AccountID?: number;
  AccountId?: number;
  Inflow?: number;
  Outflow?: number;
}

/** Absolute transaction amount in milliunits (stored representation). */
function getAbsAmount(tx: Transaction): number {
  return Math.max(tx.Outflow || 0, tx.Inflow || 0);
}

export async function executeQueryTransactions(
  args: QueryTransactionsArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  try {
    // Stored amounts are milliunits; the LLM and formatCurrency speak decimals.
    const formatMilliCurrency = (milli: number) =>
      context.formatCurrency(toDecimal(roundMilli(milli)));
    let transactions = context.services.transactions.getAllTransactions(
      context.budgetId
    ) as Transaction[];

    const accounts = context.services.accounts.listAccounts(context.budgetId);
    const accountMap = new Map(accounts.map((a) => [a.ID, a.Name]));

    transactions = transactions.map((tx) => ({
      ...tx,
      Account: accountMap.get(tx.AccountID || tx.AccountId || 0) || 'Unknown',
    }));

    // Filter out transfers and initial balances by default
    transactions = transactions.filter((tx) => {
      const category = (tx.Category || '').toLowerCase();
      const payee = (tx.Payee || '').toLowerCase();

      if (category.includes('transfer')) return false;
      if (payee.includes('transfer to') || payee.includes('transfer from')) return false;
      if (payee.includes('starting balance') || payee.includes('initial balance')) return false;
      if (payee.includes('opening balance')) return false;

      return true;
    });

    if (args.filters) {
      const f = args.filters;

      if (f.categoryName) {
        const catLower = f.categoryName.toLowerCase();
        transactions = transactions.filter((tx) => tx.Category?.toLowerCase().includes(catLower));
      }

      if (f.accountName) {
        const accLower = f.accountName.toLowerCase();
        transactions = transactions.filter((tx) => tx.Account?.toLowerCase().includes(accLower));
      }

      if (f.payee) {
        const payeeLower = f.payee.toLowerCase();
        transactions = transactions.filter((tx) => tx.Payee?.toLowerCase().includes(payeeLower));
      }

      if (f.memo) {
        const memoLower = f.memo.toLowerCase();
        transactions = transactions.filter((tx) => tx.Memo?.toLowerCase().includes(memoLower));
      }

      if (f.dateFrom) {
        const { dateFrom } = f;
        transactions = transactions.filter((tx) => tx.Date >= dateFrom);
      }

      if (f.dateTo) {
        const { dateTo } = f;
        transactions = transactions.filter((tx) => tx.Date <= dateTo);
      }

      if (f.minAmount !== undefined) {
        // LLM-provided decimal → milliunits before comparing to stored amounts
        const minMilli = fromDecimal(f.minAmount);
        transactions = transactions.filter((tx) => getAbsAmount(tx) >= minMilli);
      }

      if (f.maxAmount !== undefined) {
        const maxMilli = fromDecimal(f.maxAmount);
        transactions = transactions.filter((tx) => getAbsAmount(tx) <= maxMilli);
      }

      if (f.type === 'expense') {
        transactions = transactions.filter((tx) => (tx.Outflow || 0) > 0);
      } else if (f.type === 'income') {
        transactions = transactions.filter((tx) => (tx.Inflow || 0) > 0);
      }

      if (f.excludeCategory) {
        const excCat = f.excludeCategory.toLowerCase();
        transactions = transactions.filter((tx) => !tx.Category?.toLowerCase().includes(excCat));
      }

      if (f.excludePayee) {
        const excPayee = f.excludePayee.toLowerCase();
        transactions = transactions.filter((tx) => !tx.Payee?.toLowerCase().includes(excPayee));
      }

      if (f.excludeAccount) {
        const excAcc = f.excludeAccount.toLowerCase();
        transactions = transactions.filter((tx) => !tx.Account?.toLowerCase().includes(excAcc));
      }
    }

    // Apply ordering before aggregation
    const orderDir = args.orderDirection || 'desc';
    const orderMult = orderDir === 'desc' ? -1 : 1;

    if (args.orderBy === 'date') {
      transactions.sort(
        (a, b) => orderMult * (new Date(a.Date).getTime() - new Date(b.Date).getTime())
      );
    } else if (args.orderBy === 'amount') {
      transactions.sort((a, b) => orderMult * (getAbsAmount(a) - getAbsAmount(b)));
    } else if (args.orderBy === 'payee') {
      transactions.sort((a, b) => orderMult * (a.Payee || '').localeCompare(b.Payee || ''));
    } else {
      transactions.sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime());
    }

    switch (args.aggregation) {
      case 'list': {
        const limit = args.limit || 10;
        const results = transactions.slice(0, limit);

        if (results.length === 0) {
          return {
            success: true,
            message: 'No transactions found matching your criteria.',
            data: { transactions: [], count: 0 },
          };
        }

        const list = results
          .map((tx) => {
            const amount = tx.Outflow
              ? `-${formatMilliCurrency(tx.Outflow)}`
              : `+${formatMilliCurrency(tx.Inflow || 0)}`;
            const desc = tx.Payee || tx.Memo || 'No description';
            // Include id so the model can target this row with edit_transaction.
            return `#${tx.ID} | ${tx.Date} | ${desc} | ${tx.Category || 'Uncategorized'} | ${tx.Account} | ${amount}`;
          })
          .join('\n');

        return {
          success: true,
          message: `Found ${transactions.length} transactions${transactions.length > limit ? ` (showing ${limit})` : ''}:\n${list}`,
          data: { transactions: results, totalCount: transactions.length },
        };
      }

      case 'sum': {
        if (args.groupBy) {
          return executeGroupedAggregation(
            transactions,
            args.groupBy,
            'sum',
            formatMilliCurrency,
            args.limit
          );
        }

        // Exact integer milliunit sums
        const totalOutflow = transactions.reduce((sum, tx) => sum + (tx.Outflow || 0), 0);
        const totalInflow = transactions.reduce((sum, tx) => sum + (tx.Inflow || 0), 0);
        const net = totalInflow - totalOutflow;

        return {
          success: true,
          message: `Total from ${transactions.length} transactions: Expenses ${formatMilliCurrency(totalOutflow)}, Income ${formatMilliCurrency(totalInflow)}, Net ${formatMilliCurrency(net)}`,
          data: {
            totalOutflow: toDecimal(roundMilli(totalOutflow)),
            totalInflow: toDecimal(roundMilli(totalInflow)),
            net: toDecimal(roundMilli(net)),
            count: transactions.length,
          },
        };
      }

      case 'count': {
        if (args.groupBy) {
          return executeGroupedAggregation(
            transactions,
            args.groupBy,
            'count',
            formatMilliCurrency,
            args.limit
          );
        }

        return {
          success: true,
          message: `Found ${transactions.length} transactions matching your criteria.`,
          data: { count: transactions.length },
        };
      }

      case 'max': {
        if (transactions.length === 0) {
          return {
            success: true,
            message: 'No transactions found.',
            data: null,
          };
        }

        const sorted = [...transactions].sort((a, b) => getAbsAmount(b) - getAbsAmount(a));
        const max = sorted[0];
        const amount = max.Outflow
          ? `-${formatMilliCurrency(max.Outflow)}`
          : `+${formatMilliCurrency(max.Inflow || 0)}`;

        return {
          success: true,
          message: `Largest transaction: ${max.Date} | ${max.Payee || max.Memo || 'No description'} | ${max.Category || 'Uncategorized'} | ${max.Account} | ${amount}`,
          data: { transaction: max, amount: toDecimal(roundMilli(getAbsAmount(max))) },
        };
      }

      case 'min': {
        if (transactions.length === 0) {
          return {
            success: true,
            message: 'No transactions found.',
            data: null,
          };
        }

        const nonZero = transactions.filter((tx) => getAbsAmount(tx) > 0);
        if (nonZero.length === 0) {
          return {
            success: true,
            message: 'No non-zero transactions found.',
            data: null,
          };
        }

        const sorted = nonZero.sort((a, b) => getAbsAmount(a) - getAbsAmount(b));
        const min = sorted[0];
        const amount = min.Outflow
          ? `-${formatMilliCurrency(min.Outflow)}`
          : `+${formatMilliCurrency(min.Inflow || 0)}`;

        return {
          success: true,
          message: `Smallest transaction: ${min.Date} | ${min.Payee || min.Memo || 'No description'} | ${min.Category || 'Uncategorized'} | ${min.Account} | ${amount}`,
          data: { transaction: min, amount: toDecimal(roundMilli(getAbsAmount(min))) },
        };
      }

      case 'average': {
        if (args.groupBy) {
          return executeGroupedAggregation(
            transactions,
            args.groupBy,
            'average',
            formatMilliCurrency,
            args.limit
          );
        }

        if (transactions.length === 0) {
          return {
            success: true,
            message: 'No transactions found to calculate average.',
            data: null,
          };
        }

        const totalOutflow = transactions.reduce((sum, tx) => sum + (tx.Outflow || 0), 0);
        const totalInflow = transactions.reduce((sum, tx) => sum + (tx.Inflow || 0), 0);
        // Averages of milli integers are float milli; rounded back at display
        const avgOutflow = totalOutflow / transactions.length;
        const avgInflow = totalInflow / transactions.length;

        return {
          success: true,
          message: `Average across ${transactions.length} transactions: Expense ${formatMilliCurrency(avgOutflow)}, Income ${formatMilliCurrency(avgInflow)}`,
          data: {
            avgOutflow: toDecimal(roundMilli(avgOutflow)),
            avgInflow: toDecimal(roundMilli(avgInflow)),
            count: transactions.length,
          },
        };
      }

      default:
        return {
          success: false,
          message: 'Unknown aggregation type',
          error: `Aggregation ${args.aggregation} is not supported`,
        };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: 'Query failed',
      error: getErrorMessage(error, 'Unknown error'),
    };
  }
}

function executeGroupedAggregation(
  transactions: Transaction[],
  groupBy: 'category' | 'month' | 'payee' | 'account',
  aggregation: 'sum' | 'count' | 'average',
  /** Formats a MILLIUNIT amount (callers pass a milli-aware wrapper). */
  formatCurrency: (amountMilli: number) => string,
  limit?: number
): ToolExecutionResult {
  const groups = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    let key: string;
    switch (groupBy) {
      case 'category':
        key = tx.Category || 'Uncategorized';
        break;
      case 'month':
        key = tx.Date.slice(0, 7);
        break;
      case 'payee':
        key = tx.Payee || 'No Payee';
        break;
      case 'account':
        key = tx.Account || 'Unknown';
        break;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(tx);
  }

  const results: { group: string; value: number; count: number }[] = [];

  for (const [group, txs] of groups) {
    const totalOutflow = txs.reduce((sum, tx) => sum + (tx.Outflow || 0), 0);
    const totalInflow = txs.reduce((sum, tx) => sum + (tx.Inflow || 0), 0);
    const count = txs.length;

    let value: number;
    switch (aggregation) {
      case 'sum':
        value = totalOutflow - totalInflow;
        break;
      case 'count':
        value = count;
        break;
      case 'average':
        value = count > 0 ? (totalOutflow - totalInflow) / count : 0;
        break;
    }

    results.push({ group, value, count });
  }

  results.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const limited = limit ? results.slice(0, limit) : results;

  const groupLabel = groupBy === 'month' ? 'Month' : capitalize(groupBy);
  const aggLabel =
    aggregation === 'sum' ? 'Spending' : aggregation === 'count' ? 'Count' : 'Average';

  const list = limited
    .map((r) => {
      if (aggregation === 'count') {
        return `${r.group}: ${r.count} transactions`;
      }
      const sign = r.value >= 0 ? '-' : '+';
      return `${r.group}: ${sign}${formatCurrency(Math.abs(r.value))} (${r.count} txs)`;
    })
    .join('\n');

  return {
    success: true,
    message: `${aggLabel} by ${groupLabel}${limit ? ` (top ${limit})` : ''}:\n${list}`,
    data: {
      groups: limited.map((r) =>
        aggregation === 'count' ? r : { ...r, value: toDecimal(roundMilli(r.value)) }
      ),
      groupBy,
      aggregation,
    },
  };
}
