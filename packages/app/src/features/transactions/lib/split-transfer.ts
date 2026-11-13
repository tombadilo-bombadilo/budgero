/**
 * Split lines that move money to another of your accounts. A line is a
 * transfer when it carries transferAccountId; the core then writes the
 * matching row in that account. The payee picker offers "Transfer : Account"
 * for each line, and a payee typed as "Transfer : Account" (or picked from old
 * payee history) is read the same way, so it never ends up as plain text.
 */
import type { SplitLine } from '../ui/form/SplitEditor';

interface AccountLike {
  ID: number;
  Name: string;
}

const TRANSFER_PAYEE = /^\s*transfer\s*(?:to|from)?\s*:\s*(.+?)\s*$/i;

/** The account a payee such as "Transfer : Savings" names, if it is one of the accounts. */
export function transferAccountFromPayee(
  payee: string,
  accounts: AccountLike[],
  ownAccountId?: number | null
): number | null {
  const name = payee.match(TRANSFER_PAYEE)?.[1]?.toLowerCase();
  if (!name) return null;
  const matches = accounts.filter(
    (account) => account.ID !== ownAccountId && account.Name.trim().toLowerCase() === name
  );
  return matches.length === 1 ? matches[0].ID : null;
}

/** The line changes for a payee commit: a transfer when it names an account. */
export function splitPayeeUpdate(
  payee: string,
  accounts: AccountLike[],
  ownAccountId?: number | null
): Partial<SplitLine> {
  const transferAccountId = transferAccountFromPayee(payee, accounts, ownAccountId);
  return transferAccountId
    ? { payee: '', transferAccountId, categoryId: null }
    : { payee, transferAccountId: null };
}

/** The line changes for picking "Transfer : Account" in the payee picker. */
export function splitTransferUpdate(accountId: number): Partial<SplitLine> {
  return { payee: '', transferAccountId: accountId, categoryId: null };
}
