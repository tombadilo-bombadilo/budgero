import { z } from 'zod';
import { fromDecimal, ZERO_MILLI } from '@budgero/core/browser';
import { getErrorMessage } from '@shared/lib/errors';
import { entityId, isoDate, listNames, positiveAmount, resolveEntity } from './resolve-entity';
import type { ToolContext, ToolExecutionResult } from './types';

// Optional fields are nullish: many models send null for a field they leave out.
export const addTransactionSchema = z.object({
  amount: positiveAmount().describe('Transaction amount (always positive)'),
  isExpense: z.boolean().describe('True if expense/outflow, false if income/inflow'),
  accountId: entityId().nullish().describe('Account ID to use'),
  accountName: z.string().nullish().describe('Account name to match'),
  categoryId: entityId().nullish().describe('Category ID to use'),
  categoryName: z.string().nullish().describe('Category name to match'),
  date: isoDate().describe('Date in YYYY-MM-DD format'),
  memo: z.string().nullish().describe('Transaction description/memo'),
  payee: z.string().nullish().describe('Payee/merchant name'),
});

export type AddTransactionArgs = z.infer<typeof addTransactionSchema>;

type Account = ToolContext['accounts'][number];
type Category = ToolContext['categories'][number];

/** What an add_transaction call will write. The confirm card and the write both come from this. */
export type AddTransactionPlan =
  | {
      ok: true;
      account: Account;
      /** Undefined: the transaction is written uncategorized. */
      category?: Category;
      memo: string;
    }
  | { ok: false; result: ToolExecutionResult };

export function planAddTransaction(
  args: AddTransactionArgs,
  context: ToolContext
): AddTransactionPlan {
  const accounts = context.accounts.filter((a) => !a.Archived);
  const account = resolveEntity(accounts, args.accountId, args.accountName);
  if (account.kind === 'ambiguous') {
    return {
      ok: false,
      result: {
        success: false,
        message: `More than one account matches "${args.accountName}"`,
        error: `Which one: ${listNames(account.candidates)}?`,
      },
    };
  }
  if (account.kind !== 'found') {
    return {
      ok: false,
      result: {
        success: false,
        message:
          account.kind === 'not_found' && args.accountName
            ? `Account "${args.accountName}" not found`
            : 'Please specify an account',
        error: `Available accounts: ${listNames(accounts)}`,
      },
    };
  }

  const category = resolveEntity(context.categories, args.categoryId, args.categoryName);
  if (category.kind === 'ambiguous') {
    return {
      ok: false,
      result: {
        success: false,
        message: `More than one category matches "${args.categoryName}"`,
        error: `Which one: ${listNames(category.candidates)}?`,
      },
    };
  }
  // A category the budget doesn't have goes back to the model with the real
  // ones, so it picks one or asks; it never quietly becomes "uncategorized".
  if (category.kind === 'not_found') {
    return {
      ok: false,
      result: {
        success: false,
        message: `Category "${args.categoryName?.trim() || `#${args.categoryId}`}" not found`,
        error: `Available categories: ${listNames(context.categories)}. Use one of these, or leave the category out to record it uncategorized.`,
      },
    };
  }
  const found = category.kind === 'found' ? category.entity : undefined;

  return {
    ok: true,
    account: account.entity,
    category: found,
    memo: args.memo || args.payee || found?.Name || 'Transaction',
  };
}

/**
 * The arguments with the resolved account and category pinned by ID, so the
 * write after Confirm can't resolve to anything but what the card showed.
 */
export function pinAddTransactionArgs(
  args: AddTransactionArgs,
  plan: Extract<AddTransactionPlan, { ok: true }>
): AddTransactionArgs {
  return {
    ...args,
    accountId: plan.account.ID,
    accountName: plan.account.Name,
    categoryId: plan.category?.ID ?? null,
    categoryName: plan.category?.Name ?? args.categoryName,
    memo: plan.memo,
  };
}

export async function executeAddTransaction(
  args: AddTransactionArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  try {
    const plan = planAddTransaction(args, context);
    if (!plan.ok) return plan.result;
    const { account, category, memo } = plan;
    const accountId = account.ID;
    const categoryId = category?.ID;
    const sym = context.currencySymbol || 'RSD';

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
          payee: args.payee ?? undefined,
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
        args.payee ?? undefined
      );
    }

    const categoryNote = category ? ` in ${category.Name}` : ' (uncategorized)';

    return {
      success: true,
      message: `Added ${args.isExpense ? 'expense' : 'income'} of ${sym}${args.amount.toFixed(2)} to ${account.Name}${categoryNote}`,
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

/** The confirm card text for a plan that can be written. */
export function describeAddTransactionPlan(
  args: AddTransactionArgs,
  plan: Extract<AddTransactionPlan, { ok: true }>,
  context: ToolContext
): string {
  const sym = context.currencySymbol || 'RSD';
  const parts = [
    `${args.isExpense ? 'Expense' : 'Income'}: ${sym}${args.amount.toFixed(2)}`,
    `Date: ${args.date}`,
    `Account: ${plan.account.Name}`,
    plan.category ? `Category: ${plan.category.Name}` : 'Category: none (uncategorized)',
  ];
  if (args.payee) parts.push(`Payee: ${args.payee}`);
  parts.push(`Memo: ${plan.memo}`);
  return parts.join(' • ');
}

export function generateAddTransactionPreview(
  args: AddTransactionArgs,
  context: ToolContext
): string {
  const plan = planAddTransaction(args, context);
  return plan.ok ? describeAddTransactionPlan(args, plan, context) : failureText(plan.result);
}

/** A failed result as one line: what the user reads and what the model sees in the history. */
export function failureText(result: ToolExecutionResult): string {
  if (!result.error) return result.message;
  return `${result.message.replace(/[.!?]+$/, '')}. ${result.error}`;
}
