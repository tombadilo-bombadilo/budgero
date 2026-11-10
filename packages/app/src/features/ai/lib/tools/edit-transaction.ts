import { z } from 'zod';
import { getErrorMessage } from '@shared/lib/errors';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { failureText } from './add-transaction';
import { entityId, isoDate, listNames, resolveEntity } from './resolve-entity';
import type { ToolContext, ToolExecutionResult } from './types';

// Optional fields are nullish: many models send null for a field they leave out.
export const editTransactionSchema = z.object({
  transactionId: entityId().describe('ID of the existing transaction to edit'),
  categoryId: entityId().nullish().describe('New category ID'),
  categoryName: z.string().nullish().describe('New category name to match (re-categorize)'),
  payee: z.string().nullish().describe('New payee/merchant name'),
  memo: z.string().nullish().describe('New description/memo'),
  date: isoDate().nullish().describe('New date in YYYY-MM-DD format'),
});

export type EditTransactionArgs = z.infer<typeof editTransactionSchema>;

interface ColumnChange {
  columnName: string;
  newValue: string | number | null;
  label: string;
}

function collectChanges(
  args: EditTransactionArgs,
  resolved: { categoryId?: number; categoryName?: string }
): ColumnChange[] {
  const changes: ColumnChange[] = [];
  if (resolved.categoryId != null) {
    changes.push({
      columnName: 'CategoryID',
      newValue: resolved.categoryId,
      label: `category → ${resolved.categoryName ?? resolved.categoryId}`,
    });
  }
  // null means "leave it", the same as leaving the field out.
  if (args.payee != null) {
    changes.push({ columnName: 'Payee', newValue: args.payee, label: `payee → "${args.payee}"` });
  }
  if (args.memo != null) {
    changes.push({ columnName: 'Memo', newValue: args.memo, label: `memo → "${args.memo}"` });
  }
  if (args.date != null) {
    changes.push({ columnName: 'Date', newValue: args.date, label: `date → ${args.date}` });
  }
  return changes;
}

/** What an edit_transaction call will write. The confirm card and the write both come from this. */
export type EditTransactionPlan =
  { ok: true; changes: ColumnChange[] } | { ok: false; result: ToolExecutionResult };

export function planEditTransaction(
  args: EditTransactionArgs,
  context: ToolContext
): EditTransactionPlan {
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
  // A category that didn't match should fail loudly, not silently no-op.
  if (category.kind === 'not_found') {
    return {
      ok: false,
      result: {
        success: false,
        message: `Category "${args.categoryName?.trim() || `#${args.categoryId}`}" not found`,
        error: `Available categories: ${listNames(context.categories)}`,
      },
    };
  }

  const changes = collectChanges(
    args,
    category.kind === 'found'
      ? { categoryId: category.entity.ID, categoryName: category.entity.Name }
      : {}
  );
  if (changes.length === 0) {
    return {
      ok: false,
      result: {
        success: false,
        message: 'No changes specified',
        error: 'Specify at least one field to update (category, payee, memo, or date).',
      },
    };
  }
  return { ok: true, changes };
}

/** The arguments with the resolved category pinned by ID (see pinAddTransactionArgs). */
export function pinEditTransactionArgs(
  args: EditTransactionArgs,
  plan: Extract<EditTransactionPlan, { ok: true }>
): EditTransactionArgs {
  const category = plan.changes.find((c) => c.columnName === 'CategoryID');
  return category ? { ...args, categoryId: category.newValue as number } : args;
}

export async function executeEditTransaction(
  args: EditTransactionArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  try {
    const plan = planEditTransaction(args, context);
    if (!plan.ok) return plan.result;
    const { changes } = plan;

    if (!context.executeMutation) {
      return {
        success: false,
        message: 'Editing is not available in this session.',
        error: 'executeMutation not provided',
      };
    }

    // Each column update is its own mutation (individually undoable via the router).
    for (const change of changes) {
      await context.executeMutation({
        op: 'transactions.updateColumn',
        payload: {
          id: args.transactionId,
          columnName: change.columnName,
          newValue: change.newValue,
        },
        invalidates: [
          ['transactions', '*'],
          ['accounts', '*'],
        ],
        meta: { label: 'ai.edit_transaction', forceInvalidate: true },
      });
    }

    return {
      success: true,
      message: `Updated transaction #${args.transactionId}: ${changes.map((c) => c.label).join(', ')}`,
      data: {
        transactionId: args.transactionId,
        changes: changes.map((c) => ({ column: c.columnName, value: c.newValue })),
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: 'Failed to update transaction',
      error: getErrorMessage(error, 'Unknown error'),
    };
  }
}

export function generateEditTransactionPreview(
  args: EditTransactionArgs,
  context: ToolContext
): string {
  const sym = context.currencySymbol || 'RSD';

  let txInfo = `#${args.transactionId}`;
  try {
    const tx = context.services.transactions.getTransactionByID(args.transactionId);
    if (tx) {
      // Stored amounts are milliunits; the preview text shows decimals.
      const fmt = (milli: number) => toDecimal(roundMilli(milli)).toFixed(2);
      const amount =
        (tx.OutflowConverted ?? 0) > 0
          ? `-${sym} ${fmt(tx.OutflowConverted)}`
          : `+${sym} ${fmt(tx.InflowConverted ?? 0)}`;
      const currentCategory =
        context.categories.find((c) => c.ID === tx.CategoryID)?.Name ?? 'Uncategorized';
      txInfo = `${tx.Payee || tx.Memo || 'transaction'} (${amount}, ${currentCategory})`;
    }
  } catch {
    // Fall back to the bare id if the transaction can't be loaded.
  }

  const plan = planEditTransaction(args, context);
  if (!plan.ok) return `Edit ${txInfo}: ${failureText(plan.result)}`;
  return `Edit ${txInfo}: ${plan.changes.map((c) => c.label).join(' • ')}`;
}
