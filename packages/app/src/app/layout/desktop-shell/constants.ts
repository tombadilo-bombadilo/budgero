/**
 * Map of URL segments to human-readable breadcrumb labels
 */
export const BREADCRUMB_LABEL_MAP: Record<string, string> = {
  dashboard: 'Dashboard',
  budget: 'Budget',
  accounts: 'Accounts',
  reports: 'Reports',
  dashboards: 'Custom Dashboards',
  explorer: 'Explorer',
  settings: 'Settings',
  automations: 'Automations',
  rules: 'Rules',
  about: 'About',
};

/**
 * Maximum number of accounts to show per section before showing "Show More"
 */
export const MAX_ACCOUNTS_PER_SECTION = 4;

/**
 * Show the account search box once the budget has more than this many accounts.
 */
export const ACCOUNT_SEARCH_THRESHOLD = 8;
