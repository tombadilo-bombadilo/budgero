import type { Account, DebtSource } from '@budgero/core/browser';

/**
 * Parse an account's metadata (which can be a JSON string or an object) into a
 * plain record. Returns an empty object if parsing fails.
 */
function parseAccountMetadata(
  metadata: Account['Metadata'] | undefined | null
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return metadata as Record<string, unknown>;
}

/**
 * Find the credit card account whose metadata.cc_payment_category_id matches
 * the given category id. Used to route CC Payment row actions to the right
 * card.
 */
export function findCCAccountForCategory(
  accounts: Account[] | undefined,
  ccPaymentCategoryId: number
): Account | undefined {
  if (!accounts) return undefined;
  return accounts.find((account) => {
    const md = parseAccountMetadata(account.Metadata);
    return md.cc_payment_category_id === ccPaymentCategoryId;
  });
}

/**
 * Source accounts eligible to make a CC payment: on-budget, non-debt
 * (checking/savings/cash). Archived accounts are excluded.
 */
export function listSourceAccountsForCCPayment(accounts: Account[] | undefined): Account[] {
  if (!accounts) return [];
  const DEBT_TYPES = new Set(['credit', 'loan', 'mortgage']);
  return accounts.filter((a) => {
    if (a.Archived) return false;
    if (!a.OnBudget) return false;
    return !DEBT_TYPES.has((a.Type || '').toLowerCase());
  });
}

/** The slice of a budget row the CC-payment debt math reads. */
export interface CCPaymentRowFigures {
  available: number;
  fundingBreakdown?: unknown[];
  cardBalance?: number;
  debtBreakdown?: DebtSource[];
}

/**
 * What the linked card owes (its negative balance, as a positive amount), or
 * undefined when the row has no linked card balance.
 */
export function getCardDebt(item: Pick<CCPaymentRowFigures, 'cardBalance'>): number | undefined {
  return item.cardBalance !== undefined ? Math.max(0, 0 - item.cardBalance) : undefined;
}

export interface CCUnderfundedInfo {
  /** What the card owes. */
  owed: number;
  /** What the payment category has set aside (never negative). */
  setAside: number;
  /** owed − setAside; always > 0. */
  underfunded: number;
  /** Credit-overspend events that created the debt (may be empty). */
  events: DebtSource[];
  /** Sum of the events. */
  created: number;
  /** Part of `created` that has since been set aside. */
  covered: number;
}

/**
 * Credit Card Payment row that has less set aside than the card owes, i.e.
 * credit-card debt that isn't funded yet. Returns null for any other row.
 */
export function getCCUnderfundedInfo(item: CCPaymentRowFigures): CCUnderfundedInfo | null {
  if (item.fundingBreakdown === undefined) return null;
  const owed = getCardDebt(item) ?? 0;
  const setAside = Math.max(0, item.available);
  const underfunded = owed - setAside;
  if (underfunded <= 0) return null;
  const events = item.debtBreakdown ?? [];
  const created = events.reduce((sum, e) => sum + e.amount, 0);
  return {
    owed,
    setAside,
    underfunded,
    events,
    created,
    covered: Math.max(0, created - underfunded),
  };
}

/**
 * Credit Card Payment row that has more set aside than the card owes: the
 * surplus (> 0), or 0 for any other row. The mirror of getCCUnderfundedInfo —
 * a row is never both.
 */
export function getCCOverAssigned(item: CCPaymentRowFigures): number {
  if (item.fundingBreakdown === undefined) return 0;
  const owed = getCardDebt(item);
  return owed !== undefined && item.available > owed ? item.available - owed : 0;
}
