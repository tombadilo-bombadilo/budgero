import { z } from 'zod';
import { fromDecimal, ZERO_MILLI } from '@budgero/core/browser';
import { getErrorMessage } from '@shared/lib/errors';
import { matchByName } from './match-by-name';
import type { ToolContext, ToolExecutionResult } from './types';

export const addTransactionSchema = z.object({
  amount: z.number().positive().describe('Transaction amount (always positive)'),
  isExpense: z.boolean().describe('True if expense/outflow, false if income/inflow'),
  accountId: z.number().optional().describe('Account ID to use'),
  accountName: z.string().optional().describe('Account name to match'),
  categoryId: z.number().optional().describe('Category ID to use'),
  categoryName: z.string().optional().describe('Category name to match'),
  date: z.string().describe('Date in YYYY-MM-DD format'),
  memo: z.string().describe('Transaction description/memo'),
  payee: z.string().optional().describe('Payee/merchant name'),
});

export type AddTransactionArgs = z.infer<typeof addTransactionSchema>;

export async function executeAddTransaction(
  args: AddTransactionArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  try {
    let { accountId } = args;
    if (!accountId && args.accountName) {
      const match = matchByName(context.accounts, args.accountName, (a) => a.Name);
      accountId = match?.ID;
    }

    if (!accountId) {
      const accountList = context.accounts.map((a) => a.Name).join(', ');
      return {
        success: false,
        message: 'Please specify an account',
        error: `Please specify which account to use. Available accounts: ${accountList}`,
      };
    }

    let { categoryId } = args;
    let { categoryName } = args;
    if (!categoryId && args.categoryName) {
      const match = matchByName(context.categories, args.categoryName, (c) => c.Name);
      categoryId = match?.ID;
      categoryName = match?.Name;
    }

    const account = context.accounts.find((a) => a.ID === accountId);
    const category = context.categories.find((c) => c.ID === categoryId);
    const sym = context.currencySymbol || 'RSD';

    const memo = args.memo || args.payee || category?.Name || categoryName || 'Transaction';

    let transactionId: number;
    if (context.executeMutation) {
      transactionId = await context.executeMutation<number>({
        op: 'transactions.add',
        payload: {
          // The LLM speaks decimal currency; ops carry integer milliunits
          inflow: args.isExpense ? ZERO_MILLI : fromDecimal(args.amount),
          outflow: args.isExpense ? fromDecimal(args.amount) : ZERO_MILLI,
          accountId,
          categoryId: categoryId || 0,
          budgetId: context.budgetId,
          date: args.date,
          memo,
          transferId: '',
          payee: args.payee,
        },
        invalidates: [
          ['transactions', '*'],
          ['accounts', '*'],
        ],
        meta: { label: 'ai.add_transaction', forceInvalidate: true },
      });
    } else {
      transactionId = await context.services.transactions.addTransaction(
        args.isExpense ? ZERO_MILLI : fromDecimal(args.amount),
        args.isExpense ? fromDecimal(args.amount) : ZERO_MILLI,
        accountId,
        categoryId || 0,
        context.budgetId,
        args.date,
        memo,
        '',
        args.payee
      );
    }

    const categoryNote = category
      ? ` in ${category.Name}`
      : args.categoryName
        ? ` (category "${args.categoryName}" not found - left uncategorized)`
        : ' (uncategorized)';

    return {
      success: true,
      message: `Added ${args.isExpense ? 'expense' : 'income'} of ${sym}${args.amount.toFixed(2)} to ${account?.Name || 'account'}${categoryNote}`,
      data: {
        transactionId,
        amount: args.amount,
        isExpense: args.isExpense,
        accountId,
        categoryId,
        date: args.date,
        memo,
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: 'Failed to add transaction',
      error: getErrorMessage(error, 'Unknown error'),
    };
  }
}

export function generateAddTransactionPreview(
  args: AddTransactionArgs,
  context: ToolContext
): string {
  const account =
    context.accounts.find((a) => a.ID === args.accountId) ||
    context.accounts.find((a) => a.Name.toLowerCase() === args.accountName?.toLowerCase());
  const category =
    context.categories.find((c) => c.ID === args.categoryId) ||
    context.categories.find((c) => c.Name.toLowerCase() === args.categoryName?.toLowerCase());

  const sym = context.currencySymbol || 'RSD';

  const memo = args.memo || args.payee || category?.Name || 'Transaction';

  const parts = [
    `${args.isExpense ? 'Expense' : 'Income'}: ${sym}${args.amount.toFixed(2)}`,
    `Date: ${args.date}`,
  ];

  if (account) parts.push(`Account: ${account.Name}`);
  if (category) parts.push(`Category: ${category.Name}`);
  if (args.payee) parts.push(`Payee: ${args.payee}`);
  parts.push(`Memo: ${memo}`);

  return parts.join(' • ');
}
