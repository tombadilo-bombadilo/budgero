import { z } from 'zod';
import { formatDateISO, startOfMonth, endOfMonth, getMonthKey } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import type { ToolContext, ToolExecutionResult } from './types';

/** Service amounts are milliunits; the LLM sees decimal currency values. */
const milliToDecimal = (milli: number) => toDecimal(roundMilli(milli));

export const queryBudgetSchema = z.object({
  queryType: z.enum([
    'ready_to_assign',
    'account_balances',
    'category_spending',
    'recent_transactions',
    'monthly_summary',
  ]),
  categoryId: z.number().optional(),
  categoryName: z.string().optional(),
  accountId: z.number().optional(),
  accountName: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().optional(),
});

export type QueryBudgetArgs = z.infer<typeof queryBudgetSchema>;

export async function executeQueryBudget(
  args: QueryBudgetArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  try {
    const today = new Date();
    const currentMonth = getMonthKey(today);
    const disp = context.currencySymbol;

    switch (args.queryType) {
      case 'ready_to_assign': {
        const rta = milliToDecimal(
          context.services.monthlyBudgets.getReadyToAssign(context.budgetId, currentMonth)
        );
        return {
          success: true,
          message: `Ready to assign: ${disp} ${rta.toFixed(2)}`,
          data: { readyToAssign: rta },
        };
      }

      case 'account_balances': {
        const accounts = context.services.accounts.listAccounts(context.budgetId);
        const balances = accounts.map((a) => ({
          name: a.Name,
          balance: milliToDecimal(a.Balance || 0),
          currency: a.Currency || disp,
          balanceConverted: milliToDecimal(a.BalanceConverted ?? a.Balance ?? 0),
          type: a.Type,
          onBudget: Boolean(a.OnBudget),
        }));
        // Sum the converted balances — native balances are in different currencies.
        const total = balances.reduce((sum, a) => sum + a.balanceConverted, 0);

        const accountList = balances
          .map((a) =>
            a.currency === disp
              ? `${a.name}: ${disp} ${a.balanceConverted.toFixed(2)}`
              : `${a.name}: ${a.currency} ${a.balance.toFixed(2)} (≈ ${disp} ${a.balanceConverted.toFixed(2)})`
          )
          .join(', ');

        return {
          success: true,
          message: `Account balances (total: ${disp} ${total.toFixed(2)}): ${accountList}`,
          data: { accounts: balances, total, displayCurrency: disp },
        };
      }

      case 'category_spending': {
        const monthStart = args.startDate || formatDateISO(startOfMonth(today));
        const monthEnd = args.endDate || formatDateISO(endOfMonth(today));

        let { categoryId } = args;
        if (!categoryId && args.categoryName) {
          const categoryNameLower = args.categoryName.toLowerCase();
          const match = context.categories.find((c) => c.Name.toLowerCase() === categoryNameLower);
          categoryId = match?.ID;
        }

        if (categoryId) {
          const txs = context.services.transactions.getTransactionsByCategoryAndRange(
            context.budgetId,
            categoryId,
            monthStart,
            monthEnd
          );
          // Exact milliunit sum → decimal for the LLM
          const total = milliToDecimal(txs.reduce((sum, t) => sum + (t.Outflow || 0), 0));
          const category = context.categories.find((c) => c.ID === categoryId);

          return {
            success: true,
            message: `Spending in ${category?.Name || 'category'}: ${disp} ${total.toFixed(2)} (${txs.length} transactions)`,
            data: { categoryId, spending: total, transactionCount: txs.length },
          };
        }
        const topCategories = context.services.analytics.getTopSpendingCategories(
          monthStart,
          monthEnd,
          context.budgetId,
          args.limit || 5
        );

        const list = topCategories
          .map(
            (c) => `${c.CategoryName}: ${disp} ${Math.abs(milliToDecimal(c.Spending)).toFixed(2)}`
          )
          .join(', ');

        return {
          success: true,
          message: `Top spending categories: ${list}`,
          data: { categories: topCategories },
        };
      }

      case 'recent_transactions': {
        const allTxs = context.services.transactions.getAllTransactions(context.budgetId);
        const recent = allTxs
          .sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())
          .slice(0, args.limit || 10);

        const list = recent
          .map(
            (t) =>
              `${t.Date}: ${t.Payee || t.Memo || 'No description'} - ${disp} ${milliToDecimal(t.Outflow || t.Inflow || 0).toFixed(2)}`
          )
          .join('\n');

        return {
          success: true,
          message: `Recent transactions:\n${list}`,
          data: { transactions: recent },
        };
      }

      case 'monthly_summary': {
        const monthStart = args.startDate || formatDateISO(startOfMonth(today));
        const monthEnd = args.endDate || formatDateISO(endOfMonth(today));

        const summary = context.services.analytics.getPeriodSummary(
          monthStart,
          monthEnd,
          context.budgetId
        );

        return {
          success: true,
          message: `Monthly summary: Income ${disp} ${milliToDecimal(summary.TotalIncome).toFixed(2)}, Spending ${disp} ${Math.abs(milliToDecimal(summary.TotalSpending)).toFixed(2)}, Net ${disp} ${milliToDecimal(summary.NetCashflow).toFixed(2)}`,
          data: summary,
        };
      }

      default:
        return {
          success: false,
          message: 'Unknown query type',
          error: `Query type ${args.queryType} is not supported`,
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
