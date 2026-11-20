import { t } from '@lingui/core/macro';
import { scaleMagnitude } from '@budgero/core/browser';
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

/** How followEnteredReceived reads and writes a split editor's line (each keeps its own shape). */
export interface EnteredReceivedAccess<L> {
  target: (line: L) => number | null | undefined;
  /** The line's amount (magnitude). */
  amount: (line: L) => number;
  received: (line: L) => number | null | undefined;
  /** false once the user typed a received amount (or it was entered before). */
  auto: (line: L) => boolean;
  withReceived: (line: L, received: number) => L;
}

/**
 * `after` (a line edit of `before`) with an entered received amount scaled in
 * proportion to the line's new amount (received * new / old, exact integer
 * arithmetic, as the core scales a pinned mirror when its parent changes):
 * the line keeps the rate the amount was entered at, and it stays entered.
 * Left as it is when the edit also changes the target or the received amount
 * (typing one sets it exactly), or when either amount is zero. An auto
 * (estimated) amount follows the rate instead (useAutoReceivedAmounts).
 */
export function followEnteredReceived<L>(before: L, after: L, access: EnteredReceivedAccess<L>): L {
  const received = Number(access.received(after));
  if (access.auto(before) || access.auto(after) || !(received > 0)) return after;
  if (Number(access.received(before)) !== received) return after;
  if (access.target(before) !== access.target(after)) return after;
  const from = access.amount(before);
  const to = access.amount(after);
  if (!(from > 0) || !(to > 0) || from === to) return after;
  return access.withReceived(after, scaleMagnitude(received, from, to));
}

/** followEnteredReceived for lines edited in place (same order, e.g. "assign remaining"). */
export function followEnteredReceivedLines<L>(
  before: readonly L[],
  after: L[],
  access: EnteredReceivedAccess<L>
): L[] {
  return after.map((line, index) =>
    index < before.length ? followEnteredReceived(before[index], line, access) : line
  );
}

/** EnteredReceivedAccess for the add form's and the inline row's lines. */
export const SPLIT_LINE_RECEIVED: EnteredReceivedAccess<SplitLine> = {
  target: (line) => line.transferAccountId,
  amount: (line) => line.inflow || line.outflow,
  received: (line) => line.receivedAmount,
  auto: (line) => line.receivedAuto !== false,
  withReceived: (line, receivedAmount) => ({ ...line, receivedAmount }),
};

/** Why a split can't be saved yet: a cross-currency transfer line has no amount for the other side. */
export function missingReceivedMessage(
  target: SplitTransferAccount,
  lineIsInflow: boolean
): string {
  return lineIsInflow
    ? t`Enter the amount sent from ${target.Name}`
    : t`Enter the amount received in ${target.Name}`;
}

/**
 * Whether a row's TransferID makes it a transfer with its own direct rate. A
 * split's mirror rows share their parent's key (`split_transfer_...`): the
 * parent's lines drive them, so they have no transfer rate to edit.
 */
export function hasTransferRate(transferId: string | null | undefined): transferId is string {
  return Boolean(transferId?.trim()) && !transferId!.startsWith('split_transfer_');
}
