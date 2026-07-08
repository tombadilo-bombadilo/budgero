import type { Account } from '@budgero/core/browser';

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
