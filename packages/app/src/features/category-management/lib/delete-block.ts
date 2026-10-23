import { t } from '@lingui/core/macro';
import type { CategoryDeleteBlock } from '@budgero/core/browser';

/** Why the Delete action is unavailable for a category, for the menu and toasts. */
export function describeDeleteBlock(block: CategoryDeleteBlock): string {
  const name = block.accountName ?? '';
  switch (block.reason) {
    case 'income':
      return t`The system Income category can't be deleted.`;
    case 'income_group':
      return t`The Income group can't be deleted.`;
    case 'credit_card':
      return t`It tracks payments for the ${name} credit card. Archive or delete the card first.`;
    default:
      return t`It tracks payments for the ${name} account. Archive or delete the account first.`;
  }
}
