import React, { useCallback, useEffect } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { type TransactionColumnName as DbTransactionColumn } from '@entities/transaction/api/mutations';
import { useTransactionCellCommit } from './useTransactionCellCommit';
import { useAddTransactionHandler } from './useAddTransactionHandler';

export function useTransactionTable(initialData: GetTransactionsByAccountRow[]) {
  const [data, setData] = React.useState<GetTransactionsByAccountRow[]>(() => initialData);
  const [openDialog, setOpenDialog] = React.useState(false);
  const [rowSelection, setRowSelection] = React.useState<Record<number, boolean>>({});

  // Get state from UI store - use selective subscriptions to avoid unnecessary re-renders
  const selectedAccount = useUiStore((state) => state.selectedAccount);
  const accountLocalizer = useUiStore((state) => state.accountLocalizer);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const transactionCurrencyDisplay = useUiStore((state) => state.transactionCurrencyDisplay);

  // Shared add-transaction logic (same hook used by mobile layouts)
  const { handleAddTransaction, addTransactionMutation } = useAddTransactionHandler({
    onDialogClose: useCallback(() => setOpenDialog(false), []),
  });
  const cellCommit = useTransactionCellCommit();

  // Effect to update data when initialData changes
  useEffect(() => {
    let frame: number | null = null;
    frame = window.requestAnimationFrame(() => setData(initialData));
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [initialData]);

  const handleCellCommit = (
    transactionId: number,
    columnId: string,
    newVal: string | number | Date | null
  ) => {
    const patch = cellCommit.mutate(transactionId, columnId as DbTransactionColumn, newVal, {
      accountId: selectedAccount?.ID || 0,
      transactionCurrencyDisplay,
    });

    if (!patch) return;

    setData((oldData) =>
      oldData.map((row) =>
        row.ID === transactionId ? ({ ...row, ...patch } as GetTransactionsByAccountRow) : row
      )
    );
  };

  const selectedRowIds = Object.keys(rowSelection)
    .filter((id) => rowSelection[parseInt(id)])
    .map((id) => parseInt(id));

  /** Apply a checkbox change to one or more rows; `replace` starts from an empty selection. */
  const toggleRowSelection = (
    rowIds: string[],
    checked: boolean,
    { replace = false }: { replace?: boolean } = {}
  ) => {
    setRowSelection((current) => {
      const newSelection: Record<number, boolean> = replace ? {} : { ...current };
      for (const id of rowIds) {
        const parsedId = parseInt(id, 10);
        if (!Number.isFinite(parsedId)) continue;
        if (checked) {
          newSelection[parsedId] = true;
        } else {
          delete newSelection[parsedId];
        }
      }
      return newSelection;
    });
  };

  return {
    data,
    openDialog,
    rowSelection,
    selectedAccount,
    accountLocalizer,
    globalLocalizer,
    addTransactionMutation,
    updateTransactionColumnMutation: {
      isPending: cellCommit.isPending,
      get variables() {
        return cellCommit.pendingId ? { transactionId: cellCommit.pendingId } : undefined;
      },
    },
    setOpenDialog,
    setRowSelection,
    toggleRowSelection,
    handleCellCommit,
    handleAddTransaction,
    selectedRowIds,
  };
}
