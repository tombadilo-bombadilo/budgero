import * as React from 'react';
import type { Account } from '@budgero/core/browser';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';

/**
 * The accounts of a split editor on an existing transaction: every account of
 * the budget and the parent's own one. Register rows carry no AccountID;
 * there the parent's account is found by name, or is the open account.
 */
export function useSplitParentAccount(
  budgetId: number,
  parent: { AccountID?: number; Account?: string }
): { accounts: Account[]; ownAccount: Account | undefined } {
  const { data: accounts = [] } = useAccounts(budgetId);
  const selectedAccountId = useUiStore((state) => state.selectedAccount?.ID ?? null);
  const ownAccountId =
    parent.AccountID ??
    accounts.find((account) => parent.Account && account.Name === parent.Account)?.ID ??
    selectedAccountId;
  const ownAccount = React.useMemo(
    () => accounts.find((account) => account.ID === ownAccountId),
    [accounts, ownAccountId]
  );
  return { accounts, ownAccount };
}
