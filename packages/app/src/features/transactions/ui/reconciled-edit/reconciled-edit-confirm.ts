import { create } from 'zustand';

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
