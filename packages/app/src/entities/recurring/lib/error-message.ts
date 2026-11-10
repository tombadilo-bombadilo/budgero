import { t } from '@lingui/core/macro';
import { RECURRING_SPLIT_ERROR_CODES } from '@budgero/core/browser';
import { getErrorMessage } from '@shared/lib/errors';

/**
 * What to tell the user when saving or posting a recurring transaction fails.
 * Core reports split-line problems by code; those get a translated message,
 * anything else falls back to the error's own text.
 */
export function recurringErrorMessage(error: unknown, fallback?: string): string {
  switch ((error as { code?: unknown } | null)?.code) {
    case RECURRING_SPLIT_ERROR_CODES.categoryMissing:
      return t`A split line's category no longer exists. Edit the recurring transaction and pick a category for it.`;
    case RECURRING_SPLIT_ERROR_CODES.accountMissing:
      return t`A split line transfers to an account that no longer exists. Edit the recurring transaction and pick another account.`;
    case RECURRING_SPLIT_ERROR_CODES.sumMismatch:
      return t`The split lines no longer add up to the amount. Edit the recurring transaction and update its split lines.`;
    case RECURRING_SPLIT_ERROR_CODES.ownAccount:
      return t`A split line can't transfer to the recurring transaction's own account.`;
    case RECURRING_SPLIT_ERROR_CODES.onTransfer:
      return t`A recurring transfer can't be split. Remove the split lines first.`;
    default:
      return getErrorMessage(error, fallback);
  }
}
