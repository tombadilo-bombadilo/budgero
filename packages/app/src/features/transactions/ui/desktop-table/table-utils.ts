import type { TransactionSplit } from '@budgero/core/browser';

/**
 * Split data can come from different sources with different casing
 * This type handles both PascalCase (from DB) and camelCase (from legacy/forms)
 */
export type SplitLike =
  | TransactionSplit
  | {
      id?: number;
      category_id?: number | null;
      transfer_account_id?: number | null;
      memo?: string;
      inflow?: number;
      outflow?: number;
      amount?: number;
    };

/**
 * Extract amount from a split, handling both camelCase and PascalCase properties
 */
export const extractSplitAmount = (split: SplitLike): number => {
  const s = split as Record<string, unknown>;
  const outflow = Number(s.outflow ?? s.Outflow ?? 0);
  const inflow = Number(s.inflow ?? s.Inflow ?? 0);
  if (outflow !== 0) return Math.abs(outflow);
  if (inflow !== 0) return Math.abs(inflow);
  return Math.abs(Number(s.amount ?? s.Amount ?? 0));
};

/**
 * Convert a split to an editable format
 */
export const toEditableSplit = (
  split: SplitLike,
  idx: number
): {
  id: string;
  category_id: number | null;
  transfer_account_id: number | null;
  memo: string;
  amount: number;
} => {
  const s = split as Record<string, unknown>;
  return {
    id: String(s.id ?? s.ID ?? idx),
    category_id: (s.category_id ?? s.CategoryID ?? null) as number | null,
    transfer_account_id: (s.transfer_account_id ?? s.TransferAccountID ?? null) as number | null,
    memo: String(s.memo ?? s.Memo ?? ''),
    amount: extractSplitAmount(split),
  };
};

/**
 * Editable split type used in the split editor
 */
export interface EditableSplit {
  id: string;
  category_id: number | null;
  transfer_account_id: number | null;
  memo: string;
  amount: number;
}

/**
 * Get category label from split data
 */
export const getSplitCategoryLabel = (split: SplitLike & Record<string, unknown>): string => {
  const cat =
    split.category_name ||
    split.CategoryName ||
    split.category ||
    ((split.category_id ?? split.CategoryID)
      ? `Category #${split.category_id ?? split.CategoryID}`
      : null);
  if (cat) return String(cat);
  if (split.transfer_account_name || split.TransferAccountName) {
    return `Transfer to ${split.transfer_account_name || split.TransferAccountName}`;
  }
  if (split.transfer_account_id || split.TransferAccountID) {
    return `Transfer acct #${split.transfer_account_id ?? split.TransferAccountID}`;
  }
  return 'Unassigned';
};

/**
 * Check if a split represents income based on inflow/outflow values
 */
export const isSplitIncomeAmount = (split: SplitLike, fallbackIsIncome: boolean): boolean => {
  const s = split as Record<string, unknown>;
  const inflow = Number(s.inflow ?? s.Inflow ?? 0);
  const outflow = Number(s.outflow ?? s.Outflow ?? 0);
  if (inflow !== 0 || outflow !== 0) {
    return inflow > 0;
  }
  return fallbackIsIncome;
};
