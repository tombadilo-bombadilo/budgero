import type { Account, GetTransactionsByAccountRow } from '@budgero/core/browser';

/** An account offered as a "Transfer: Account" choice in the payee picker. */
export type TransferPayeeAccount = Pick<Account, 'ID' | 'Name' | 'OnBudget'>;

export interface TransferPayeeOptions {
  /** Accounts to list in the transfer group (empty hides the group). */
  accounts: TransferPayeeAccount[];
  /** The partner account when the row already is a linked transfer. */
  selectedAccountId: number | null;
  /** Whether the row can be turned back into a plain transaction (not when reconciled). */
  canUnlink: boolean;
}

type TransferPayeeRow = Pick<
  GetTransactionsByAccountRow,
  | 'ID'
  | 'TransferID'
  | 'Reconciled'
  | 'Category'
  | 'IsProjected'
  | 'AccountID'
  | 'Account'
  | 'TransferAccountOnBudget'
  | 'TransferAccountName'
>;

const NO_OPTIONS: TransferPayeeOptions = {
  accounts: [],
  selectedAccountId: null,
  canUnlink: false,
};

/**
 * True for a simple two-leg transfer row. Mirrors that belong to a split line
 * (`split_transfer_*`) are managed by their parent transaction and are never
 * converted or unlinked from the payee cell.
 */
export function isLinkedTransferRow(row: Pick<TransferPayeeRow, 'TransferID'>): boolean {
  const transferId = row.TransferID?.trim();
  return Boolean(transferId) && !transferId!.startsWith('split_transfer_');
}

/**
 * Decide which "Transfer : Account" choices the payee picker offers for a row.
 *
 * - Plain, editable rows can become a transfer to any other (non-archived) account.
 * - Existing transfers show their partner as the selected choice. Picking a regular
 *   payee behaves as before (transfers touching an off-budget account keep a custom
 *   payee; on-budget ones have none); `canUnlink` enables an explicit action that turns
 *   the row back into a plain transaction.
 * - Projected, split and reconciled plain rows get no transfer choices.
 */
export function getTransferPayeeOptions(
  row: TransferPayeeRow,
  accounts: Account[],
  ownAccountId?: number | null
): TransferPayeeOptions {
  if (row.IsProjected || row.ID <= 0) return NO_OPTIONS;

  if (row.TransferID?.trim()) {
    if (!isLinkedTransferRow(row)) return NO_OPTIONS;
    // The register row carries the partner's name (not its ID), so match by name.
    const ownId = row.AccountID ?? ownAccountId ?? null;
    const partnerName = row.TransferAccountName;
    const partner = partnerName
      ? accounts.find((account) => account.Name === partnerName && account.ID !== ownId)
      : undefined;
    const canUnlink = !row.Reconciled;
    if (!partner) return { accounts: [], selectedAccountId: null, canUnlink };
    return {
      accounts: [
        {
          ID: partner.ID,
          Name: partner.Name,
          OnBudget:
            row.TransferAccountOnBudget == null
              ? Boolean(partner.OnBudget)
              : Number(row.TransferAccountOnBudget) !== 0,
        },
      ],
      selectedAccountId: partner.ID,
      canUnlink,
    };
  }

  if (row.Reconciled || row.Category === 'Split') return NO_OPTIONS;

  const ownId = row.AccountID ?? ownAccountId ?? null;
  const candidates = accounts
    .filter((account) => !account.Archived)
    .filter((account) => account.ID !== ownId)
    .filter((account) => !row.Account || account.Name !== row.Account)
    .map((account) => ({
      ID: account.ID,
      Name: account.Name,
      OnBudget: Boolean(account.OnBudget),
    }));

  // On-budget accounts first; the original order is kept within each group.
  return {
    accounts: [...candidates.filter((a) => a.OnBudget), ...candidates.filter((a) => !a.OnBudget)],
    selectedAccountId: null,
    canUnlink: false,
  };
}

/**
 * Converting an on-budget row into an on-budget transfer replaces its category
 * with "Transfers", which removes that spending from category activity. The
 * caller asks the user before doing so.
 */
export function conversionReplacesCategory(
  row: Pick<GetTransactionsByAccountRow, 'Category' | 'CategoryID' | 'AccountOnBudget'>,
  counterpartOnBudget: boolean
): boolean {
  if (Number(row.AccountOnBudget ?? 1) === 0 || !counterpartOnBudget) return false;
  if (!row.CategoryID) return false;
  return row.Category !== 'Transfers' && row.Category !== 'Uncategorized';
}
