import * as React from 'react';
import { useLingui } from '@lingui/react/macro';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';
import { PayeeSelectCell } from './PayeeSelectCell';
import { splitPayeeUpdate, splitTransferUpdate } from '../../lib/split-transfer';

/** The fields a split line's payee cell changes (snake_case, as the split editors keep them). */
export interface SplitLinePayeePatch {
  payee: string;
  transfer_account_id: number | null;
  category_id?: null;
}

interface SplitLinePayeeCellProps {
  budgetId: number;
  /** The split parent (its account is never offered as a transfer target). */
  parent: { AccountID?: number; Account?: string };
  payee: string;
  transferAccountId: number | null | undefined;
  onChange: (patch: SplitLinePayeePatch) => void;
  triggerClassName?: string;
}

/**
 * Payee cell of an existing split's line (Split details dialog, mobile card).
 * Like the add form's split editor: "Transfer : Account" choices for the
 * other open accounts, and a payee typed as "Transfer : Account" makes the
 * line a transfer; picking another account retargets it, a plain payee turns
 * it back into a normal line (its category is picked next to it).
 */
export function SplitLinePayeeCell({
  budgetId,
  parent,
  payee,
  transferAccountId,
  onChange,
  triggerClassName,
}: SplitLinePayeeCellProps) {
  const { t } = useLingui();
  const { data: accounts = [] } = useAccounts(budgetId);
  const selectedAccountId = useUiStore((state) => state.selectedAccount?.ID ?? null);
  // Register rows carry no AccountID; there the open account is the parent's.
  const ownAccountId =
    parent.AccountID ??
    accounts.find((account) => parent.Account && account.Name === parent.Account)?.ID ??
    selectedAccountId;
  const transferAccounts = React.useMemo(
    () => accounts.filter((account) => account.ID !== ownAccountId && !account.Archived),
    [accounts, ownAccountId]
  );
  const transferName = accounts.find((account) => account.ID === transferAccountId)?.Name;

  const apply = (update: { payee?: string; transferAccountId?: number | null }) =>
    onChange({
      payee: update.payee ?? '',
      transfer_account_id: update.transferAccountId ?? null,
      ...(update.transferAccountId ? { category_id: null } : {}),
    });

  return (
    <PayeeSelectCell
      budgetId={budgetId}
      value={payee}
      onCommit={(next) => apply(splitPayeeUpdate(next, transferAccounts))}
      transferAccounts={transferAccounts}
      onSelectTransfer={(id) => apply(splitTransferUpdate(id))}
      selectedTransferAccountId={transferAccountId ?? null}
      displayValue={transferAccountId ? t`Transfer: ${transferName ?? ''}` : undefined}
      triggerClassName={triggerClassName}
    />
  );
}
