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
    ? { payee: '', transferAccountId, categoryId: null, receivedAmount: null, receivedAuto: true }
    : { payee, transferAccountId: null, receivedAmount: null, receivedAuto: true };
}

/** The line changes for picking "Transfer : Account" in the payee picker. */
export function splitTransferUpdate(accountId: number): Partial<SplitLine> {
  return {
    payee: '',
    transferAccountId: accountId,
    categoryId: null,
    receivedAmount: null,
    receivedAuto: true,
  };
}

/** An account a split line can transfer to, as the split editors know it. */
export interface SplitTransferAccount {
  ID: number;
  Name: string;
  Currency?: string;
  OnBudget?: boolean | number;
}

const onBudget = (account: { OnBudget?: boolean | number } | null | undefined) =>
  account?.OnBudget == null ? true : Number(account.OnBudget) !== 0;

/**
 * How a split line's category behaves: a normal line picks one; a transfer
 * between on-budget accounts is always Transfers (locked, like a non-split
 * on-budget transfer); a transfer from an on-budget parent to an off-budget
 * (tracking) account may pick a category (spending, e.g. a mortgage payment)
 * or none (the money leaves Ready to Assign), like a non-split off-budget leg.
 */
export type SplitLineCategoryMode = 'category' | 'transfer-locked' | 'transfer-optional';

export function splitLineCategoryMode(
  parent: { OnBudget?: boolean | number } | null | undefined,
  target: { OnBudget?: boolean | number } | null | undefined
): SplitLineCategoryMode {
  if (!target) return 'category';
  return onBudget(parent) && !onBudget(target) ? 'transfer-optional' : 'transfer-locked';
}

/** A transfer line to an account in another currency asks what the other account received. */
export function needsReceivedAmount(
  parentCurrency: string | null | undefined,
  target: { Currency?: string } | null | undefined
): boolean {
  return Boolean(parentCurrency && target?.Currency && target.Currency !== parentCurrency);
}

/** The received amount's magnitude from stored mirror amounts. */
export function mirrorMagnitude(
  mirror: { InflowNative: number; OutflowNative: number } | null | undefined
): number | null {
  if (!mirror) return null;
  const value = Math.abs(Number(mirror.InflowNative) - Number(mirror.OutflowNative));
  return value > 0 ? value : null;
}
