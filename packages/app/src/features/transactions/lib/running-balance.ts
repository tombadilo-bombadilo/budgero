import type { GetTransactionsByAccountRow } from '@budgero/core/browser';

/**
 * Pick and parse a transaction's running balance for the requested currency
 * display. Returns `null` when the balance is missing or unparseable.
 *
 * Shared by the desktop table row and the mobile card amounts; the desktop-only
 * `RunningBalanceProjected` styling stays caller-side.
 */
export function getRunningBalance(
  transaction: GetTransactionsByAccountRow,
  display: 'budget' | 'account'
): number | null {
  const candidate =
    display === 'budget'
      ? transaction.RunningBalance
      : (transaction.RunningBalanceOriginal ?? transaction.RunningBalance);
  if (candidate === null || candidate === undefined) return null;
  const value = typeof candidate === 'string' ? parseFloat(candidate) : candidate;
  return Number.isNaN(value) ? null : value;
}
