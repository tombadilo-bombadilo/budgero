import * as React from 'react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { applyOpInvalidations } from '@shared/lib/query-utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@shared/ui/select';
import { Button } from '@shared/ui/button';
import { Loader2, Trash2, MoveHorizontal, Tag, AlertCircle, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@shared/ui/dropdown-menu';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useDeleteTransaction,
  useMoveTransactionToNewCategory,
  useMoveTransactionToNewAccount,
  useTransactions,
  useUpdateTransactionColumn,
} from '@entities/transaction/api/useTransactions';
import { PayeeCombobox } from '@features/payees/ui/PayeeCombobox';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useActiveAccounts } from '@entities/account/api/useActiveAccounts';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { useConnectivity } from '@shared/hooks/useConnectivity';
import { ManualRatePrompt } from '@features/currencies/ui/ManualRatePrompt';
import { getLocalOrManualRate, saveManualRate } from '@entities/currency/lib/currency-utils';
import { getMonthKey } from '@shared/lib/date-utils';
import { toastError } from '@shared/lib/errors';

interface TransactionsBatchToolbarProps {
  selectedRowIds: number[];
  clearSelection: () => void;
  onCreateRecurring?: (transaction: GetTransactionsByAccountRow) => void;
}

export function TransactionsBatchToolbar({
  selectedRowIds,
  clearSelection,
  onCreateRecurring,
}: TransactionsBatchToolbarProps) {
  const numSelected = selectedRowIds.length;
  const [newCategoryID, setNewCategoryID] = useState<number>(-1);
  const [newAccountID, setNewAccountID] = useState<string>('-1');
  const [newPayee, setNewPayee] = useState<string>('');
  const [working, setWorking] = useState<boolean>(false);
  const { overall: isFullyOnline } = useConnectivity();
  const [showRatePrompt, setShowRatePrompt] = useState(false);
  const [pendingRatePair, setPendingRatePair] = useState<{ from: string; to: string } | null>(null);

  const selectedAccount = useUiStore((state) => state.selectedAccount);
  const selectedBudget = useUiStore((state) => state.selectedBudget);

  // Fetch accounts using the account hook (archived accounts are excluded from batch move targets).
  const { data: accountsData } = useActiveAccounts(selectedBudget?.ID || 0);

  const queryClient = useQueryClient();
  const deleteTransactionMutation = useDeleteTransaction();
  const moveToNewCategoryMutation = useMoveTransactionToNewCategory();
  const moveToNewAccountMutation = useMoveTransactionToNewAccount();
  const updateTransactionColumnMutation = useUpdateTransactionColumn();

  const { data: allTransactions = [] } = useTransactions(selectedAccount?.ID || 0);

  const selectedTransactions = allTransactions.filter((t) => selectedRowIds.includes(t.ID));
  const singleSelectedTransaction =
    selectedTransactions.length === 1 ? selectedTransactions[0] : null;
  const canCreateRecurring = Boolean(onCreateRecurring && singleSelectedTransaction);

  const hasUncategorized = selectedTransactions.some((t) => !t.CategoryID || t.CategoryID === 0);
  const uncategorizedCount = selectedTransactions.filter(
    (t) => !t.CategoryID || t.CategoryID === 0
  ).length;

  const handleDelete = React.useCallback(async () => {
    try {
      // Delete selected transactions - core will handle transfer pairs automatically.
      // Suppress per-item invalidation; invalidate once after the whole batch.
      await Promise.all(
        selectedRowIds.map((id) =>
          deleteTransactionMutation.mutateAsync({
            transactionId: id,
            accountId: selectedAccount?.ID || 0,
            skipInvalidate: true,
          })
        )
      );
      applyOpInvalidations(queryClient, 'transactions.delete');

      const count = selectedRowIds.length;
      toast.success(`${count} transaction${count === 1 ? '' : 's'} deleted`, {
        description: 'The selected transaction(s) have been permanently removed.',
      });

      clearSelection();
    } catch (error) {
      console.error('Error deleting transactions:', error);
      toastError('Failed to delete transactions', error, 'Please try again.');
    }
  }, [selectedRowIds, selectedAccount, deleteTransactionMutation, clearSelection, queryClient]);

  async function handleBatchEdits() {
    setWorking(true);

    if (newCategoryID === -1 && newAccountID === '-1' && !newPayee) {
      console.error('No category, account, or payee selected.');
      setWorking(false);
      return;
    }

    try {
      const newAccountIdInt = parseInt(newAccountID, 10);

      // If moving to new account across currencies while offline and no cached/manual rate, prompt once
      if (newAccountIdInt != -1 && selectedAccount && selectedBudget) {
        const target = accountsData.find((a) => a.ID === newAccountIdInt);
        if (target && target.Currency !== selectedAccount.Currency && !isFullyOnline) {
          const month = getMonthKey(new Date());
          const r = await getLocalOrManualRate(
            selectedAccount.Currency,
            target.Currency,
            month,
            selectedBudget.ID
          );
          if (!r) {
            setPendingRatePair({ from: selectedAccount.Currency, to: target.Currency });
            setShowRatePrompt(true);
            setWorking(false);
            return;
          }
        }
      }

      // Apply each row's edits with per-item invalidation suppressed; a single
      // invalidation pass runs after the whole batch (below) instead of once
      // per mutation, which would refetch every affected query N times.
      // selectedAccount is null on the All Transactions page; these mutations
      // only need the transaction id, so don't gate on it.
      const didMoveAccount = newAccountIdInt != -1;
      const didMoveCategory = newCategoryID != -1;
      const didUpdatePayee = !!newPayee;

      for (const id of selectedRowIds) {
        if (didMoveAccount) {
          await moveToNewAccountMutation.mutateAsync({
            transactionId: id,
            newAccountId: newAccountIdInt,
            skipInvalidate: true,
          });
        }

        if (didMoveCategory) {
          await moveToNewCategoryMutation.mutateAsync({
            transactionId: id,
            newCategoryId: newCategoryID,
            accountId: selectedAccount?.ID ?? 0,
            skipInvalidate: true,
          });
        }

        if (didUpdatePayee) {
          await updateTransactionColumnMutation.mutateAsync({
            transactionId: id,
            column: 'Payee',
            value: newPayee,
            accountId: selectedAccount?.ID ?? 0,
            skipInvalidate: true,
          });
        }
      }

      // One invalidation pass for whichever op kinds actually ran.
      if (didMoveAccount) applyOpInvalidations(queryClient, 'transactions.moveToNewAccount');
      if (didMoveCategory) applyOpInvalidations(queryClient, 'transactions.moveToNewCategory');
      if (didUpdatePayee) applyOpInvalidations(queryClient, 'transactions.updateColumn');

      const count = selectedRowIds.length;
      toast.success(`${count} transaction${count === 1 ? '' : 's'} updated`);

      clearSelection();
      setNewPayee('');
    } catch (error) {
      console.error('Error applying batch edits:', error);
      toastError('Failed to apply batch edits', error, 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex items-center justify-between w-full">
      {showRatePrompt && pendingRatePair && selectedBudget && (
        <ManualRatePrompt
          from={pendingRatePair.from}
          to={pendingRatePair.to}
          onCancel={() => setShowRatePrompt(false)}
          onConfirm={async (rate, base, quote) => {
            await saveManualRate(base, quote, rate, selectedBudget.ID);
            setShowRatePrompt(false);
            // resume
            void handleBatchEdits();
          }}
        />
      )}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{numSelected} selected</span>
        {hasUncategorized && (
          <div className="flex items-center gap-1 text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span className="text-xs">{uncategorizedCount} uncategorized</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canCreateRecurring && singleSelectedTransaction && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            aria-label="Create recurring transaction"
            onClick={() => {
              onCreateRecurring?.(singleSelectedTransaction);
              clearSelection();
            }}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
        {/* Compact Action Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 px-2">
              <Tag className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Change Category
            </div>
            <div className="px-2 pb-2">
              <div className="[&>div]:text-xs [&>button]:text-xs [&>div>button]:text-xs [&>button]:h-8">
                <SearchableCategorySelect
                  budgetId={selectedBudget?.ID || 0}
                  selectedCategoryId={newCategoryID}
                  onCategorySelect={setNewCategoryID}
                  triggerClassName="w-full min-w-0"
                  popoverContentClassName="w-64 max-w-[calc(100vw-2rem)]"
                />
              </div>
            </div>
            {accountsData.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Move to Account
                </div>
                <div className="px-2 pb-2">
                  <Select onValueChange={setNewAccountID}>
                    <SelectTrigger className="w-full text-xs h-8">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent className="text-xs">
                      {accountsData
                        .filter((account) => account.ID !== selectedAccount?.ID)
                        .map((account) => (
                          <SelectItem key={account.ID} value={account.ID.toString()}>
                            {account.Name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {selectedBudget && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Set Payee
                </div>
                <div className="px-2 pb-2">
                  <PayeeCombobox
                    budgetId={selectedBudget.ID}
                    value={newPayee}
                    onChange={setNewPayee}
                    triggerClassName="w-full text-xs h-8"
                    popoverContentClassName="w-64 max-w-[calc(100vw-2rem)]"
                    placeholder="Select payee"
                  />
                </div>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleBatchEdits}
              disabled={
                working ||
                moveToNewCategoryMutation.isPending ||
                moveToNewAccountMutation.isPending ||
                updateTransactionColumnMutation.isPending
              }
            >
              {working ||
              moveToNewCategoryMutation.isPending ||
              moveToNewAccountMutation.isPending ||
              updateTransactionColumnMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <MoveHorizontal className="h-3 w-3 mr-2" />
                  Apply Changes
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Delete Button */}
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={working || deleteTransactionMutation.isPending}
          className="h-8 px-2"
        >
          {deleteTransactionMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>

        {/* Clear Selection */}
        <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8 px-2 text-xs">
          Clear
        </Button>
      </div>
    </div>
  );
}
