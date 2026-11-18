import { t } from '@lingui/core/macro';
import type { TransactionSplit } from '@budgero/core/browser';
import { mirrorMagnitude } from '../../lib/split-transfer';

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
      payee?: string;
      inflow?: number;
      outflow?: number;
      amount?: number;
    };

/**
 * Extract amount from a split, handling both camelCase and PascalCase properties
 */
export const extractSplitAmount = (
  split: SplitLike,
  amountCurrency: 'converted' | 'native' = 'converted'
): number => {
  const s = split as Record<string, unknown>;
  const outflow = Number(
    amountCurrency === 'native'
      ? (s.OutflowNative ?? s.outflow_original ?? s.outflow ?? s.OutflowConverted ?? 0)
      : (s.outflow ?? s.OutflowConverted ?? 0)
  );
  const inflow = Number(
    amountCurrency === 'native'
      ? (s.InflowNative ?? s.inflow_original ?? s.inflow ?? s.InflowConverted ?? 0)
      : (s.inflow ?? s.InflowConverted ?? 0)
  );
  if (outflow !== 0) return Math.abs(outflow);
  if (inflow !== 0) return Math.abs(inflow);
  return Math.abs(Number(s.amount ?? s.Amount ?? 0));
};

export const extractSplitFlows = (
  split: SplitLike,
  amountCurrency: 'converted' | 'native' = 'converted'
): { inflow: number; outflow: number } => {
  const s = split as Record<string, unknown>;
  const inflow = Number(
    amountCurrency === 'native'
      ? (s.InflowNative ?? s.inflow_original ?? s.inflow ?? s.InflowConverted ?? 0)
      : (s.inflow ?? s.InflowConverted ?? 0)
  );
  const outflow = Number(
    amountCurrency === 'native'
      ? (s.OutflowNative ?? s.outflow_original ?? s.outflow ?? s.OutflowConverted ?? 0)
      : (s.outflow ?? s.OutflowConverted ?? 0)
  );
  if (inflow !== 0 || outflow !== 0) {
    return { inflow: Math.abs(inflow), outflow: Math.abs(outflow) };
  }
  return { inflow: 0, outflow: Math.abs(Number(s.amount ?? s.Amount ?? 0)) };
};

/**
 * Convert a split to an editable format
 */
export const toEditableSplit = (
  split: SplitLike,
  idx: number,
  amountCurrency: 'converted' | 'native' = 'converted'
): EditableSplit => {
  const s = split as Record<string, unknown>;
  const flows = extractSplitFlows(split, amountCurrency);
  return {
    id: String(s.id ?? s.ID ?? idx),
    category_id: (s.category_id ?? s.CategoryID ?? null) as number | null,
    transfer_account_id: (s.transfer_account_id ?? s.TransferAccountID ?? null) as number | null,
    memo: String(s.memo ?? s.Memo ?? ''),
    payee: String(s.payee ?? s.Payee ?? ''),
    ...flows,
    ...receivedFromMirror(split, flows.inflow + flows.outflow),
  };
};

/**
 * The received-amount fields of a line loaded with its mirror
 * (SplitService.getSplitsWithMirrors): the mirror's stored amount, entered
 * (not re-estimated) when the mirror is pinned, and whether it is reconciled.
 */
export function receivedFromMirror(
  split: SplitLike,
  lineAmount: number
): Pick<
  EditableSplit,
  'received_amount' | 'received_auto' | 'received_base' | 'mirror_received' | 'mirror_reconciled'
> {
  const s = split as Record<string, unknown>;
  const mirror = s.Mirror as { InflowNative: number; OutflowNative: number } | undefined;
  const received = mirrorMagnitude(mirror);
  if (received === null) return {};
  return {
    received_amount: received,
    received_auto: !s.MirrorPinned,
    received_base: lineAmount,
    mirror_received: received,
    mirror_reconciled: Boolean(s.MirrorReconciled),
  };
}

/**
 * Editable split type used in the split editor
 */
export interface EditableSplit {
  id: string;
  category_id: number | null;
  transfer_account_id: number | null;
  memo: string;
  payee: string;
  inflow: number;
  outflow: number;
  /** Cross-currency transfer lines: what the other account received (its currency). */
  received_amount?: number | null;
  /** The received amount follows the line amount (estimated) until one is typed. */
  received_auto?: boolean;
  /** The line amount a loaded received amount belongs to. */
  received_base?: number | null;
  /** The stored mirror's amount and lock state when the editor opened. */
  mirror_received?: number | null;
  mirror_reconciled?: boolean;
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
      ? t`Category #${String(split.category_id ?? split.CategoryID)}`
      : null);
  if (cat) return String(cat);
  if (split.transfer_account_name || split.TransferAccountName) {
    return t`Transfer to ${String(split.transfer_account_name || split.TransferAccountName)}`;
  }
  if (split.transfer_account_id || split.TransferAccountID) {
    return t`Transfer acct #${String(split.transfer_account_id ?? split.TransferAccountID)}`;
  }
  return 'Unassigned';
};

/**
 * Check if a split represents income based on inflow/outflow values
 */
export const isSplitIncomeAmount = (split: SplitLike, fallbackIsIncome: boolean): boolean => {
  const s = split as Record<string, unknown>;
  const inflow = Number(s.inflow ?? s.InflowConverted ?? 0);
  const outflow = Number(s.outflow ?? s.OutflowConverted ?? 0);
  if (inflow !== 0 || outflow !== 0) {
    return inflow > 0;
  }
  return fallbackIsIncome;
};
