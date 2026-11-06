import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
/**
 * Map of URL segments to human-readable breadcrumb labels
 */
export const BREADCRUMB_LABEL_MAP: Record<string, MessageDescriptor> = {
  dashboard: msg`Dashboard`,
  budget: msg`Budget`,
  budgeting: msg`Budgeting`,
  accounts: msg`Accounts`,
  all: msg`All Transactions`,
  warranties: msg`Warranties`,
  reports: msg`Reports`,
  prebuilt: msg`Prebuilt`,
  dashboards: msg`Custom Dashboards`,
  question: msg`Questions`,
  new: msg`New question`,
  settings: msg`Settings`,
  automations: msg`Automations`,
  rules: msg`Rules`,
  recurring: msg`Recurring`,
  about: msg`About`,
};

/**
 * Maximum number of accounts to show per section before showing "Show More"
 */
export const MAX_ACCOUNTS_PER_SECTION = 4;

/**
 * Show the account search box once the budget has more than this many accounts.
 */
export const ACCOUNT_SEARCH_THRESHOLD = 8;
