import * as React from 'react';
import { useLingui } from '@lingui/react/macro';
import type { Account, GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';
import { useTransactionLinks } from '@entities/transaction/api/transactionLinks';
import {
  getTransferPayeeOptions,
  type TransferPayeeOptions,
} from '@features/transactions/lib/transfer-payee-options';
import { useTransferConversionActions } from '@features/transactions/api/transfer-conversion-context';
import { PayeeSelectCell } from './PayeeSelectCell';

interface TransactionPayeeCellProps {
  budgetId: number;
  transaction: GetTransactionsByAccountRow;
  /** Passed by the desktop table; the mobile card lets the cell load them. */
  accounts?: Account[];
  payees?: string[];
  /** A regular payee was chosen or typed. */
  onCommit: (payee: string) => void;
  triggerClassName?: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The payee editor for an existing transaction. Next to the regular payees it offers
 * the budget's other accounts as "Transfer: Account", which converts the row into a
 * transfer; on an existing transfer it shows the partner account as selected and
 * offers to convert the row back. Outside the transactions table (no conversion
 * actions in context) it is a plain payee picker.
 */
export function TransactionPayeeCell({
  budgetId,
  transaction,
  accounts: providedAccounts,
  payees,
  onCommit,
  triggerClassName,
  defaultOpen,
  onOpenChange,
}: TransactionPayeeCellProps) {
  const { t } = useLingui();
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  const ownAccountId = useUiStore((state) => state.selectedAccount?.ID ?? null);
  const accountsQuery = useAccounts(budgetId, providedAccounts === undefined);
  const accounts = providedAccounts ?? accountsQuery.data;
  const transferActions = useTransferConversionActions();

  const baseOptions = React.useMemo<TransferPayeeOptions>(
    () =>
      transferActions
        ? getTransferPayeeOptions(transaction, accounts ?? [], ownAccountId)
        : { accounts: [], selectedAccountId: null, canUnlink: false },
    [transferActions, transaction, accounts, ownAccountId]
  );

  // Converting deletes and re-creates the row, which clears warranty / recurring /
  // bank-review links, so conversion is only offered when there are none. This is a
  // single-row lookup that runs only while the picker is open.
  const checkLinks =
    Boolean(transferActions) && open && (baseOptions.accounts.length > 0 || baseOptions.canUnlink);
  const { data: links } = useTransactionLinks(transaction.ID, checkLinks);
  const hasLinks = Boolean(links?.warranty || links?.recurringOccurrence || links?.bankReview);
  const isTransferRow = Boolean(transaction.TransferID?.trim());
  const options = React.useMemo<TransferPayeeOptions>(() => {
    if (!checkLinks) return baseOptions;
    const clear = links !== undefined && !hasLinks;
    return isTransferRow
      ? { ...baseOptions, canUnlink: baseOptions.canUnlink && clear }
      : { ...baseOptions, accounts: clear ? baseOptions.accounts : [] };
  }, [baseOptions, checkLinks, hasLinks, isTransferRow, links]);

  const selectedTransfer = options.accounts.find(
    (account) => account.ID === options.selectedAccountId
  );
  // Transfers touching an off-budget account may carry a typed payee; show it as usual.
  const displayValue =
    selectedTransfer && !transaction.Payee ? t`Transfer: ${selectedTransfer.Name}` : undefined;

  return (
    <PayeeSelectCell
      budgetId={budgetId}
      value={transaction.Payee ?? ''}
      payees={payees}
      onCommit={onCommit}
      triggerClassName={triggerClassName}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
      transferAccounts={options.accounts}
      selectedTransferAccountId={options.selectedAccountId}
      displayValue={displayValue}
      onSelectTransfer={
        transferActions
          ? (accountId) => transferActions.requestConversion(transaction.ID, accountId)
          : undefined
      }
      onUnlinkTransfer={
        transferActions && options.canUnlink
          ? () => transferActions.requestUnlink(transaction.ID)
          : undefined
      }
    />
  );
}
