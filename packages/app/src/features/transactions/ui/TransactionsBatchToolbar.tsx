import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import * as React from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@shared/ui/select';
import { Button } from '@shared/ui/button';
import {
  Loader2,
  Trash2,
  MoveHorizontal,
  Tag,
  AlertCircle,
  RefreshCw,
  CircleCheck,
  Copy,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@shared/ui/dropdown-menu';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useBatchEditTransactions,
  useSetTransactionsCleared,
} from '@entities/transaction/api/useTransactions';
import { CLEARED_SHORTCUT_KEY } from '@features/transactions/api/useClearedShortcut';
import {
  DUPLICATE_SHORTCUT_KEY,
  useDuplicateSelected,
} from '@features/transactions/api/useDuplicateShortcut';
import { useDeleteSelected } from '@features/transactions/api/useDeleteSelected';
import {
  CATEGORIZE_SHORTCUT_KEY,
  MOVE_SHORTCUT_KEY,
  PAYEE_SHORTCUT_KEY,
  useBatchEditShortcuts,
} from '@features/transactions/api/useBatchEditShortcuts';
import { getKeyboardShortcutLabels } from '@shared/lib/keyboard-shortcuts';
import { PayeeCombobox } from '@features/payees/ui/PayeeCombobox';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useActiveAccounts } from '@entities/account/api/useActiveAccounts';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { LabelCombobox } from '@features/labels/ui/LabelCombobox';
import { useConnectivity } from '@shared/hooks/useConnectivity';
import { ManualRatePrompt } from '@features/currencies/ui/ManualRatePrompt';
import { getLocalOrManualRate, saveManualRate } from '@entities/currency/lib/currency-utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { toastError } from '@shared/lib/errors';

interface TransactionsBatchToolbarProps {
  selectedRowIds: number[];
  clearSelection: () => void;
  onCreateRecurring?: (transaction: GetTransactionsByAccountRow) => void;
  /** Register rows the selection refers to. */
  rows: GetTransactionsByAccountRow[];
}

export function TransactionsBatchToolbar({
  selectedRowIds,
  clearSelection,
  onCreateRecurring,
  rows,
}: TransactionsBatchToolbarProps) {
  const { t } = useLingui();

  const numSelected = selectedRowIds.length;
  const [newCategoryID, setNewCategoryID] = useState<number>(-1);
  const [newAccountID, setNewAccountID] = useState<string>('-1');
  const [newPayee, setNewPayee] = useState<string>('');
  // undefined: leave labels alone; null: remove them; a number: set that label.
  const [newLabelId, setNewLabelId] = useState<number | null | undefined>(undefined);
  const [working, setWorking] = useState<boolean>(false);
  // Edit menu opened from the keyboard: G jumps to the category picker, M to the account picker.
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [shortcutTarget, setShortcutTarget] = useState<'category' | 'account' | 'payee' | null>(
    null
  );
  const { overall: isFullyOnline } = useConnectivity();
  const [showRatePrompt, setShowRatePrompt] = useState(false);
  const [pendingRatePair, setPendingRatePair] = useState<{ from: string; to: string } | null>(null);

  const selectedAccount = useUiStore((state) => state.selectedAccount);
  const selectedBudget = useUiStore((state) => state.selectedBudget);

  // Fetch accounts using the account hook (archived accounts are excluded from batch move targets).
  const { data: accountsData } = useActiveAccounts(selectedBudget?.ID || 0);

  const { deleteRows, isDeleting } = useDeleteSelected();
  const batchEditMutation = useBatchEditTransactions();
  const setClearedMutation = useSetTransactionsCleared();
  const { duplicateRows, isPending: isDuplicating } = useDuplicateSelected();
  const duplicateShortcut = getKeyboardShortcutLabels().shift(DUPLICATE_SHORTCUT_KEY);

  const selectedRowIdSet = React.useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
  const selectedTransactions = React.useMemo(
    () => rows.filter((transaction) => selectedRowIdSet.has(transaction.ID)),
    [rows, selectedRowIdSet]
  );
  const singleSelectedTransaction =
    selectedTransactions.length === 1 ? selectedTransactions[0] : null;
  const canCreateRecurring = Boolean(onCreateRecurring && singleSelectedTransaction);

  const hasUncategorized = selectedTransactions.some((t) => !t.CategoryID || t.CategoryID === 0);
  const uncategorizedCount = selectedTransactions.filter(
    (t) => !t.CategoryID || t.CategoryID === 0
  ).length;

  // A G/M picker is the whole interaction: closing it (pick or Escape) closes
  // the edit menu too, so focus returns to the register and G/M work again.
  const closeShortcutMenu = () => {
    setEditMenuOpen(false);
    setShortcutTarget(null);
  };

  useBatchEditShortcuts((target) => {
    if (target === 'account' && accountsData.length < 2) return false;
    if (target === 'payee' && !selectedBudget) return false;
    setShortcutTarget(target);
    setEditMenuOpen(true);
    return true;
  });

  const handleDelete = React.useCallback(
    () => deleteRows(selectedRowIds, clearSelection),
    [deleteRows, selectedRowIds, clearSelection]
  );

  const handleSetCleared = (cleared: boolean) => {
    setClearedMutation.mutate(
      { ids: selectedRowIds, cleared },
      {
        onSuccess: ({ changed }) => {
          const count = changed.length;
          toast.success(
            cleared
              ? plural(count, {
                  one: '# transaction marked cleared',
                  other: '# transactions marked cleared',
                })
              : plural(count, {
                  one: '# transaction marked uncleared',
                  other: '# transactions marked uncleared',
                })
          );
        },
        onError: (error) =>
          toastError(t`Could not update cleared status`, error, t`Please try again.`),
      }
    );
  };

  // Shortcut picks apply right away and pass their value in, since the state
  // update from the same pick hasn't landed yet.
  async function handleBatchEdits(
    overrides: { categoryId?: number; accountId?: string; payee?: string } = {}
  ) {
    const shortcutPick =
      overrides.categoryId !== undefined ||
      overrides.accountId !== undefined ||
      overrides.payee !== undefined;
    const categoryId = overrides.categoryId ?? (shortcutPick ? -1 : newCategoryID);
    const accountId = overrides.accountId ?? (shortcutPick ? '-1' : newAccountID);
    const payee = overrides.payee ?? (shortcutPick ? '' : newPayee);
    const labelId = shortcutPick ? undefined : newLabelId;
    setWorking(true);

    if (categoryId === -1 && accountId === '-1' && !payee && labelId === undefined) {
      console.error('No category, account, payee, or label selected.');
      setWorking(false);
      return;
    }

    try {
      const newAccountIdInt = parseInt(accountId, 10);

      // If moving to new account across currencies while offline and no cached/manual rate, prompt once
      if (newAccountIdInt != -1 && selectedAccount && selectedBudget) {
        const target = accountsData.find((a) => a.ID === newAccountIdInt);
        if (target && target.Currency !== selectedAccount.Currency && !isFullyOnline) {
          const r = await getLocalOrManualRate(
            selectedAccount.Currency,
            target.Currency,
            getTodayISO(),
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

      // One op for the whole selection: one write, one sync op, one undo step.
      // selectedAccount is null on the All Transactions page; the edits only
      // need the transaction ids.
      await batchEditMutation.mutateAsync({
        edits: selectedRowIds.map((id) => ({
          id,
          ...(newAccountIdInt != -1 ? { accountId: newAccountIdInt } : {}),
          ...(categoryId != -1 ? { categoryId } : {}),
          ...(payee ? { payee } : {}),
          ...(labelId !== undefined ? { labelId } : {}),
        })),
      });

      const count = selectedRowIds.length;
      toast.success(
        plural(count, {
          one: `# transaction updated`,
          other: `# transactions updated`,
        })
      );

      clearSelection();
      setNewPayee('');
      setNewLabelId(undefined);
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
          budgetId={selectedBudget.ID}
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
        <span className="text-sm font-medium">
          <Trans>{numSelected} selected</Trans>
        </span>
        {hasUncategorized && (
          <div className="flex items-center gap-1 text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span className="text-xs">
              <Trans>{uncategorizedCount} uncategorized</Trans>
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canCreateRecurring && singleSelectedTransaction && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            aria-label={t`Create recurring transaction`}
            onClick={() => {
              onCreateRecurring?.(singleSelectedTransaction);
              clearSelection();
            }}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2"
          aria-label={t`Duplicate`}
          title={t`Duplicate (press ${duplicateShortcut})`}
          disabled={isDuplicating}
          onClick={() => duplicateRows(selectedTransactions)}
        >
          <Copy className="h-3 w-3" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              aria-label={t`Cleared status`}
              title={t`Cleared status (press ${CLEARED_SHORTCUT_KEY})`}
              disabled={setClearedMutation.isPending}
            >
              <CircleCheck className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleSetCleared(true)}>
              <Trans>Mark cleared</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSetCleared(false)}>
              <Trans>Mark uncleared</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Compact Action Menu */}
        <DropdownMenu
          open={editMenuOpen}
          onOpenChange={(open) => {
            setEditMenuOpen(open);
            if (!open) setShortcutTarget(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              aria-label={t`Change category, account, payee or label`}
              title={t`Change category (${CATEGORIZE_SHORTCUT_KEY}), move (${MOVE_SHORTCUT_KEY}) or set payee (${PAYEE_SHORTCUT_KEY})`}
            >
              <Tag className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              <Trans>Change Category</Trans>
            </div>
            <div className="px-2 pb-2">
              <div className="[&>div]:text-xs [&>button]:text-xs [&>div>button]:text-xs [&>button]:h-8">
                <SearchableCategorySelect
                  key={shortcutTarget === 'category' ? 'shortcut' : 'menu'}
                  defaultOpen={shortcutTarget === 'category'}
                  onOpenChange={(open) => {
                    if (!open && shortcutTarget === 'category') closeShortcutMenu();
                  }}
                  budgetId={selectedBudget?.ID || 0}
                  selectedCategoryId={newCategoryID}
                  onCategorySelect={(categoryId) => {
                    setNewCategoryID(categoryId);
                    if (shortcutTarget !== 'category') return;
                    closeShortcutMenu();
                    void handleBatchEdits({ categoryId });
                  }}
                  triggerClassName="w-full min-w-0"
                  popoverContentClassName="w-64 max-w-[calc(100vw-2rem)]"
                />
              </div>
            </div>
            {accountsData.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  <Trans>Move to Account</Trans>
                </div>
                <div className="px-2 pb-2">
                  <Select
                    defaultOpen={shortcutTarget === 'account'}
                    key={shortcutTarget === 'account' ? 'shortcut' : 'menu'}
                    onOpenChange={(open) => {
                      if (!open && shortcutTarget === 'account') closeShortcutMenu();
                    }}
                    onValueChange={(accountId) => {
                      setNewAccountID(accountId);
                      if (shortcutTarget !== 'account') return;
                      closeShortcutMenu();
                      void handleBatchEdits({ accountId });
                    }}
                  >
                    <SelectTrigger className="w-full text-xs h-8">
                      <SelectValue placeholder={t`Select account`} />
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
                  <Trans>Set Payee</Trans>
                </div>
                <div className="px-2 pb-2">
                  <PayeeCombobox
                    key={shortcutTarget === 'payee' ? 'shortcut' : 'menu'}
                    defaultOpen={shortcutTarget === 'payee'}
                    onOpenChange={(open) => {
                      if (!open && shortcutTarget === 'payee') closeShortcutMenu();
                    }}
                    budgetId={selectedBudget.ID}
                    value={newPayee}
                    onChange={(payee) => {
                      setNewPayee(payee);
                      if (shortcutTarget !== 'payee' || !payee) return;
                      closeShortcutMenu();
                      void handleBatchEdits({ payee });
                    }}
                    triggerClassName="w-full text-xs h-8"
                    popoverContentClassName="w-64 max-w-[calc(100vw-2rem)]"
                    placeholder={t`Select payee`}
                  />
                </div>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  <Trans>Set Label</Trans>
                </div>
                <div className="px-2 pb-2 space-y-1">
                  <LabelCombobox
                    budgetId={selectedBudget.ID}
                    value={newLabelId ?? null}
                    onChange={(labelId) => setNewLabelId(labelId)}
                    placeholder={newLabelId === undefined ? t`Keep current labels` : t`No label`}
                    triggerClassName="w-full text-xs h-8"
                    allowClear
                  />
                  {newLabelId === null && (
                    <p className="text-[11px] text-muted-foreground">
                      <Trans>Labels will be removed from the selected transactions.</Trans>
                    </p>
                  )}
                </div>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void handleBatchEdits()}
              disabled={working || batchEditMutation.isPending}
            >
              {working || batchEditMutation.isPending ? (
                <Trans>
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  Applying...
                </Trans>
              ) : (
                <Trans>
                  <MoveHorizontal className="h-3 w-3 mr-2" />
                  Apply Changes
                </Trans>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Delete Button */}
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={working || isDeleting}
          className="h-8 px-2"
        >
          {isDeleting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>

        {/* Clear Selection */}
        <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8 px-2 text-xs">
          <Trans>Clear</Trans>
        </Button>
      </div>
    </div>
  );
}
