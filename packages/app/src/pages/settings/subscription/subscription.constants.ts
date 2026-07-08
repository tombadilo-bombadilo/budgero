export const CANCEL_REASON_OPTIONS = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'missing_features', label: 'Missing features' },
  { value: 'bugs_or_performance', label: 'Bugs or performance issues' },
  { value: 'switching_apps', label: "I'm switching to another app" },
  { value: 'other', label: 'Other' },
] as const;

export type CancelReasonValue = (typeof CANCEL_REASON_OPTIONS)[number]['value'];

export const STATUS_COLORS: Record<string, string> = {
  founding_member: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  beta_access: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  on_trial: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  cancelled: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  expired: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  past_due: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  unpaid: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  default: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

export const STATUS_TEXT: Record<string, string> = {
  founding_member: 'Founding Member',
  beta_access: 'Free Access',
  active: 'Active',
  trialing: 'Free Trial',
  on_trial: 'Free Trial',
  cancelled: 'Cancelled',
  expired: 'Expired',
  past_due: 'Past Due',
  unpaid: 'Payment Required',
  inactive: 'No Subscription',
};

export const PLAN_INTERVAL_LABELS: Record<string, string> = {
  year: 'Yearly',
  month: 'Monthly',
};
