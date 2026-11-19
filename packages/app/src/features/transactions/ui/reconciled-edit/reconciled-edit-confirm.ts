import { create } from 'zustand';
import {
  asMilli,
  type SplitMirrorAmounts,
  type Services,
  type TransactionService,
} from '@budgero/core/browser';
import {
  prepareSplitMutationLines,
  type UpsertSplitLineInput,
} from '@entities/transaction/api/splits';
import { normalizeSplitLines, readReceivedAmount } from '@shared/mutations/op-code-registry/shared';

/**
 * Ask before an edit that changes the bank amount of a reconciled
 * transaction. Saving it marks the row uncleared (core:
 * unreconcileIfNativeChanged), so it needs reconciling again. One dialog
 * (ReconciledEditConfirmHost, mounted in the dashboard layout) serves every
 * edit entry point: register cells on desktop and mobile, the split editors
 * and the transfer rate dialog.
 */

/** 'row': a register or split edit; 'transfer': the transfer rate / amounts dialog. */
export type ReconciledEditKind = 'row' | 'transfer';

interface PendingConfirm {
  kind: ReconciledEditKind;
  resolve: (confirmed: boolean) => void;
}

interface ReconciledEditConfirmState {
  pending: PendingConfirm | null;
  /** Answer the open question (true = save the edit). */
  settle: (confirmed: boolean) => void;
}

export const useReconciledEditConfirmStore = create<ReconciledEditConfirmState>()((set, get) => ({
  pending: null,
  settle: (confirmed) => {
    const { pending } = get();
    if (!pending) return;
    set({ pending: null });
    pending.resolve(confirmed);
  },
}));

/** Show the dialog; resolves true when the user goes ahead, false when they cancel. */
export function confirmReconciledEdit(kind: ReconciledEditKind): Promise<boolean> {
  return new Promise((resolve) => {
    // A newer question replaces an unanswered one (that edit is dropped).
    useReconciledEditConfirmStore.getState().settle(false);
    useReconciledEditConfirmStore.setState({ pending: { kind, resolve } });
  });
}

/** The part of the transaction service the checks need. */
export interface ReconciledEditServices {
  transactions?: {
    reconciledRowsUnlockedByEdit?: (
      transactionId: number,
      columnName: string,
      newValue: unknown
    ) => number[];
  };
}

/** Whether `updateColumn(transactionId, column, value)` would unlock a reconciled row. */
export function columnEditUnlocksReconciled(
  services: ReconciledEditServices | null | undefined,
  transactionId: number,
  column: string,
  value: unknown
): boolean {
  const preview = services?.transactions?.reconciledRowsUnlockedByEdit;
  if (typeof preview !== 'function') return false;
  try {
    return preview.call(services!.transactions, transactionId, column, value).length > 0;
  } catch {
    return false; // the edit itself reports the problem
  }
}

/**
 * Ask first when a column edit would unlock a reconciled row; resolves true
 * when the edit should go ahead (nothing to ask, or confirmed).
 */
export async function confirmColumnEdit(
  services: ReconciledEditServices | null | undefined,
  transactionId: number,
  column: string,
  value: unknown
): Promise<boolean> {
  if (!columnEditUnlocksReconciled(services, transactionId, column, value)) return true;
  return confirmReconciledEdit('row');
}

/**
 * The same for a new total of a split parent (split editors): either side of
 * the total can change.
 */
export async function confirmTotalEdit(
  services: ReconciledEditServices | null | undefined,
  transactionId: number,
  total: { inflow: number; outflow: number },
  currency: 'native' | 'converted'
): Promise<boolean> {
  const [inflow, outflow] =
    currency === 'native'
      ? ['InflowNative', 'OutflowNative']
      : ['InflowConverted', 'OutflowConverted'];
  const unlocks =
    columnEditUnlocksReconciled(services, transactionId, inflow, total.inflow) ||
    columnEditUnlocksReconciled(services, transactionId, outflow, total.outflow);
  return unlocks ? confirmReconciledEdit('row') : true;
}

/** The services a split-save check reads (core TransactionService / SplitService). */
interface SplitSaveServices extends ReconciledEditServices {
  transactions?: ReconciledEditServices['transactions'] &
    Partial<Pick<TransactionService, 'getTransactionByID' | 'splitSaveUnlocksMirrors'>>;
  splits?: Partial<Pick<Services['splits'], 'quoteMirrorAmounts'>>;
}

/**
 * IDs of reconciled transfer mirrors a split-editor save would unlock (their
 * signed bank amount changes) or delete (their line is removed or
 * retargeted), as the core computes them for the save's lines (each editor
 * line as it is sent, `received_amount` included). None when it can't tell:
 * the save then reports its own problem.
 */
async function mirrorsUnlockedBySplitSave(
  services: SplitSaveServices | null | undefined,
  transactionId: number,
  total: { inflow: number; outflow: number } | undefined,
  currency: 'native' | 'converted',
  lines: readonly UpsertSplitLineInput[]
): Promise<number[]> {
  const transactions = services?.transactions;
  if (!transactions?.splitSaveUnlocksMirrors || !transactions.getTransactionByID) return [];
  try {
    const prepared = prepareSplitMutationLines([...lines], undefined, currency);
    const normalized = normalizeSplitLines(prepared);
    const received = prepared.map((line) => readReceivedAmount(line));
    const quotes: (SplitMirrorAmounts | null)[] =
      received.some((amount) => amount !== null) && services?.splits?.quoteMirrorAmounts
        ? await services.splits.quoteMirrorAmounts(
            transactions.getTransactionByID.call(transactions, transactionId),
            normalized,
            received
          )
        : [];
    return await transactions.splitSaveUnlocksMirrors.call(transactions, transactionId, {
      ...(total
        ? { amount: { inflow: asMilli(total.inflow), outflow: asMilli(total.outflow), currency } }
        : {}),
      splits: normalized.map((line, index) =>
        quotes[index] ? { ...line, Mirror: quotes[index] } : line
      ),
    });
  } catch {
    return [];
  }
}

/**
 * Ask once before a split-editor save that unlocks a reconciled row: the
 * parent (a new total) or a transfer line's mirror (changed, removed or
 * retargeted). Resolves true when the save should go ahead.
 */
export async function confirmSplitSave(
  services: SplitSaveServices | null | undefined,
  transactionId: number,
  total: { inflow: number; outflow: number } | undefined,
  currency: 'native' | 'converted',
  lines: readonly UpsertSplitLineInput[]
): Promise<boolean> {
  const mirrors = await mirrorsUnlockedBySplitSave(services, transactionId, total, currency, lines);
  if (mirrors.length) return confirmReconciledEdit('row');
  return total ? confirmTotalEdit(services, transactionId, total, currency) : true;
}
