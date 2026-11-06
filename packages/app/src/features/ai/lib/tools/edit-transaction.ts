import { z } from 'zod';
import { getErrorMessage } from '@shared/lib/errors';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { matchByName } from './match-by-name';
import type { ToolContext, ToolExecutionResult } from './types';

// Optional fields are nullish: many models send null for a field they leave out.
export const editTransactionSchema = z.object({
  transactionId: z.coerce.number().describe('ID of the existing transaction to edit'),
  categoryId: z.number().nullish().describe('New category ID'),
  categoryName: z.string().nullish().describe('New category name to match (re-categorize)'),
  payee: z.string().nullish().describe('New payee/merchant name'),
  memo: z.string().nullish().describe('New description/memo'),
  date: z.string().nullish().describe('New date in YYYY-MM-DD format'),
});

export type EditTransactionArgs = z.infer<typeof editTransactionSchema>;

interface ColumnChange {
  columnName: string;
  newValue: string | number | null;
  label: string;
}

/** Resolve the target category id + display name from args (id wins over name). */
function resolveCategory(
  args: EditTransactionArgs,
  context: ToolContext
): { categoryId?: number; categoryName?: string } {
  // An ID the budget doesn't have counts as no ID, so the name is matched instead.
  const byId = context.categories.find((c) => c.ID === args.categoryId);
  if (byId) {
    return { categoryId: byId.ID, categoryName: byId.Name };
  }
  if (args.categoryName) {
    const match = matchByName(context.categories, args.categoryName, (c) => c.Name);
    return { categoryId: match?.ID, categoryName: match?.Name };
  }
  return {};
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

export async function executeEditTransaction(
  args: EditTransactionArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  try {
    const resolved = resolveCategory(args, context);

    // A category name that didn't match should fail loudly, not silently no-op.
    if (args.categoryName && resolved.categoryId == null) {
      const list = context.categories.map((c) => c.Name).join(', ');
      return {
        success: false,
        message: `Category "${args.categoryName}" not found`,
        error: `Available categories: ${list}`,
      };
    }

    const changes = collectChanges(args, resolved);
    if (changes.length === 0) {
      return {
        success: false,
        message: 'No changes specified',
        error: 'Specify at least one field to update (category, payee, memo, or date).',
      };
    }

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

  const resolved = resolveCategory(args, context);
  const parts: string[] = [];
  if (resolved.categoryId != null || args.categoryName) {
    parts.push(`Category → ${resolved.categoryName ?? args.categoryName}`);
  }
  if (args.payee !== undefined) parts.push(`Payee → "${args.payee}"`);
  if (args.memo !== undefined) parts.push(`Memo → "${args.memo}"`);
  if (args.date !== undefined) parts.push(`Date → ${args.date}`);

  return `Edit ${txInfo}: ${parts.join(' • ') || 'no changes'}`;
}
