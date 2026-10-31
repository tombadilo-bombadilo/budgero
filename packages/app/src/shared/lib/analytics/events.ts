/**
 * The analytics event registry: every event the app may send, with the exact
 * props each one carries and every value each prop may take.
 *
 * The schema is the single source of truth. Types are derived from it, so an
 * unknown event, an unknown prop or a value outside a prop's list does not
 * compile; `sanitizeEvent` re-checks the same lists at runtime, so a value
 * that slips through a cast still never leaves the device. Values are fixed
 * enums or buckets only: never free text, names, amounts, dates, IDs or error
 * messages.
 */

// ---------------------------------------------------------------------------
// Shared value lists
// ---------------------------------------------------------------------------

export const COUNT_BUCKETS = ['0', '1-10', '10-100', '100-1k', '1k-10k', '10k+'] as const;
export type CountBucket = (typeof COUNT_BUCKETS)[number];

export const DURATION_BUCKETS = ['<10s', '10-60s', '1-5m', '5-15m', '15m+'] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export const AGE_BUCKETS = ['<1h', '1-24h', '1d+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const ACTIONS_BUCKETS = ['1', '2-3', '4+'] as const;
export type ActionsBucket = (typeof ACTIONS_BUCKETS)[number];

const OUTCOMES = ['ok', 'error', 'cancelled'] as const;
const OK_ERROR = ['ok', 'error'] as const;

/**
 * Our own error codes. Raw error messages never leave the device: errors are
 * mapped to one of these (see error-codes.ts), anything unrecognised becomes
 * 'unknown'. 'none' marks a successful outcome.
 */
export const ERROR_CODES = [
  'none',
  'unknown',
  'network',
  'offline',
  'timeout',
  'cancelled',
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payment_required',
  'rate_limited',
  'server_error',
  'quota_exceeded',
  // imports
  'invalid_file',
  'parse_error',
  // bank sync
  'provider_error',
  'consent_expired',
  'invalid_token',
  'invalid_key',
  'popup_blocked',
  // AI
  'not_configured',
  'model_error',
  // push queue
  'decryption_failed',
  'invalid_payload',
  'format_too_new',
  'mutation_error',
  // sync
  'version_mismatch',
  'storage_error',
  'update_required',
  'sync_rejected',
  'mutation_quarantined',
  'snapshot_unavailable',
  'snapshot_upload_failed',
  'queue_persist_failed',
  // local database (SQLite failure class, never the message)
  'db_constraint',
  'db_locked',
  'db_corrupt',
  'db_readonly',
  'db_full',
  'db_error',
  // rendering and loading
  'render_error',
  'chunk_load_failed',
] as const;

/** How a space activation obtained its local database (runtime SpaceActivationPath). */
export const ACTIVATION_PATHS = [
  'server_snapshot',
  'local',
  'local_after_download_failure',
  'local_reset',
  'fresh',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Step ids of pages/onboarding/onboarding-data.ts (a test keeps them equal). */
export const ONBOARDING_STEP_IDS = [
  'welcome',
  'start_mode',
  'rules',
  'currency',
  'zbb',
  'workspace',
  'share',
  'ynab_import',
  'accounts',
  'categories',
  'goal',
  'where_heard',
  'theme',
  'password',
  'done',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];
const ONBOARDING_PATHS = ['fresh', 'ynab', 'join'] as const;

export const IMPORT_SOURCES = ['ynab_api', 'ynab_zip', 'csv', 'pdf', 'ofx', 'qif', 'camt'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
const IMPORT_CONTEXTS = ['onboarding', 'app'] as const;

/** Onboarding YNAB step: how the user tried to bring their data. */
export const YNAB_IMPORT_METHODS = ['api', 'zip'] as const;
export type YnabImportMethod = (typeof YNAB_IMPORT_METHODS)[number];
/** A method, or leaving the YNAB step for the fresh path without importing. */
const YNAB_IMPORT_CHOICES = [...YNAB_IMPORT_METHODS, 'start_fresh'] as const;
/** Why a YNAB token or export was rejected (pages/onboarding/steps/ynab-source-errors.ts). */
export const YNAB_SOURCE_FAILURE_REASONS = [
  'unauthorized',
  'rate_limited',
  'network',
  'no_plans',
  'not_zip',
  'not_ynab_export',
  'unknown',
] as const;
/** Which help the user opened on the YNAB step. */
export const YNAB_HELP_TOPICS = [
  'token_steps',
  'token_popover',
  'ynab_developer_settings',
  'import_guide',
] as const;
export type YnabHelpTopic = (typeof YNAB_HELP_TOPICS)[number];

const BANK_PROVIDERS = ['simplefin', 'enablebanking'] as const;
const BANK_SYNC_TRIGGERS = ['manual', 'auto', 'link'] as const;

/** AccountTypeEnum values (core), plus 'other' for anything unexpected. */
const ACCOUNT_TYPES = [
  'Checking',
  'Savings',
  'Cash',
  'Credit',
  'Loan',
  'Mortgage',
  'Real Estate',
  'Other Asset',
  'Investment',
  'Crypto',
  'Retirement',
  'other',
] as const;

/** GoalType values (core). */
export const GOAL_TYPES = [
  'monthly',
  'yearly',
  'target-date',
  'monthly-savings',
  'target-balance',
] as const;
/** Goal funding actions in the budget view. */
const GOAL_FUNDING_METHODS = ['auto_assign_underfunded', 'fund_underfunded', 'fund_goal'] as const;

/** RuleMode (core): one_time rules run by hand. */
const RULE_TRIGGERS = ['manual', 'continuous', 'autofill'] as const;
/** What started a rule run. */
const RULE_RUN_TRIGGERS = ['manual', 'on_add', 'bank_sync', 'import'] as const;

/** RecurringIntervalUnit (core). */
const RECURRING_FREQUENCIES = ['day', 'week', 'month', 'year'] as const;
const RECURRING_KINDS = ['expense', 'income', 'transfer'] as const;
const RECURRING_POST_HOW = ['mark_ready', 'post_now'] as const;

/** Where a new transaction came from. */
export const TRANSACTION_ENTRIES = [
  'inline',
  'dialog',
  'mobile_dialog',
  'command_palette',
  'receipt_scan',
  'ai_assistant',
  'cc_payment',
  'archive_balance',
  'transfer_convert',
  'recurring',
  'bank_sync',
  'import',
  'push',
  'other',
] as const;
export type TransactionEntry = (typeof TRANSACTION_ENTRIES)[number];

/** Settings → Data: the CSV zip and the SQLite database backup. */
const EXPORT_FORMATS = ['csv', 'sqlite'] as const;

const FEATURES = [
  'reports',
  'rules',
  'recurring',
  'goals',
  'scenarios',
  'shared_budget',
  'multi_currency',
  'reconcile',
  'split',
  'transfer_convert',
] as const;
const FEATURE_ACTIONS = ['opened', 'created'] as const;

const MONEY_INTEGRITY_KINDS = ['transactions', 'account_balance'] as const;

/** CANCEL_REASON_OPTIONS values (never the free-text notes). */
const CANCEL_REASONS = [
  'too_expensive',
  'missing_features',
  'bugs_or_performance',
  'switching_apps',
  'other',
] as const;
const YES_NO = ['yes', 'no'] as const;

/** Each setting and the values it may report. */
export const SETTING_VALUES = {
  rta_mode: ['cumulative', 'monthly'],
  budget_row_density: ['compact', 'comfortable'],
  transaction_row_density: ['compact', 'comfortable'],
  inline_entry: ['inline', 'dialog'],
  theme: ['default', 'phosphor', 'mesa', 'obsidian', 'paper'],
  language: ['en', 'de', 'fr', 'es', 'nl'],
  week_start: ['sunday', 'monday'],
  same_day_order: ['newest', 'amount'],
  hide_zero_amounts: ['on', 'off'],
  number_animations: ['on', 'off'],
  dialog_blur: ['on', 'off'],
  home_page: ['dashboard', 'planning', 'accounts', 'analytics'],
} as const satisfies Record<string, readonly string[]>;
export type SettingKey = keyof typeof SETTING_VALUES;
export type SettingValue<S extends SettingKey> = (typeof SETTING_VALUES)[S][number];

const SETTING_KEYS = Object.keys(SETTING_VALUES) as SettingKey[];
const ALL_SETTING_VALUES = [...new Set(Object.values(SETTING_VALUES).flat())];

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const NONE = {} as const;

export const EVENT_SCHEMA = {
  // Name-only events kept under their historical names.
  'Transaction Logged': { entry: TRANSACTION_ENTRIES },
  'Transaction Edited': NONE,
  'Transaction Deleted': NONE,
  'Account Added': { type: ACCOUNT_TYPES, currency_is_budget_currency: YES_NO },
  'Assignment Upserted': NONE,
  'Category Added': NONE,
  'Category Edited': NONE,
  'Category Deleted': NONE,
  'Category Group Added': NONE,
  'Category Group Edited': NONE,
  'Category Group Deleted': NONE,
  'Budget Created': NONE,
  'Imported from YNAB': NONE,
  'Imported CSV/PDF': NONE,
  'Shared Budget': NONE,
  'Signup Viewed': NONE,
  'Trial Started': NONE,

  // Onboarding
  onboarding_step_viewed: { step: ONBOARDING_STEP_IDS, path: ONBOARDING_PATHS },
  onboarding_step_completed: { step: ONBOARDING_STEP_IDS, path: ONBOARDING_PATHS },
  onboarding_finished: { path: ONBOARDING_PATHS, duration_bucket: DURATION_BUCKETS },

  // Onboarding YNAB step (before import_started, which fires only after the password step)
  ynab_import_method_chosen: { method: YNAB_IMPORT_CHOICES },
  ynab_import_source_loaded: { method: YNAB_IMPORT_METHODS },
  ynab_import_validation_failed: {
    method: YNAB_IMPORT_METHODS,
    reason: YNAB_SOURCE_FAILURE_REASONS,
  },
  ynab_import_help_opened: { topic: YNAB_HELP_TOPICS },

  // Imports
  import_started: { source: IMPORT_SOURCES, context: IMPORT_CONTEXTS },
  import_finished: {
    source: IMPORT_SOURCES,
    context: IMPORT_CONTEXTS,
    outcome: OUTCOMES,
    error_code: ERROR_CODES,
    rows_bucket: COUNT_BUCKETS,
    duration_bucket: DURATION_BUCKETS,
  },

  // Bank sync
  bank_connect_started: { provider: BANK_PROVIDERS },
  bank_connect_finished: { provider: BANK_PROVIDERS, outcome: OUTCOMES, error_code: ERROR_CODES },
  bank_sync_run: {
    provider: BANK_PROVIDERS,
    trigger: BANK_SYNC_TRIGGERS,
    outcome: OK_ERROR,
    error_code: ERROR_CODES,
    new_tx_bucket: COUNT_BUCKETS,
  },

  // AI assistant (never the prompt or the reply)
  ai_assistant_opened: NONE,
  ai_message_sent: { outcome: OK_ERROR, error_code: ERROR_CODES },

  // Goals
  goal_created: { type: GOAL_TYPES },
  goal_edited: { type: GOAL_TYPES },
  goal_deleted: { type: GOAL_TYPES },
  goal_funded: { method: GOAL_FUNDING_METHODS },

  // Rules
  rule_created: { trigger: RULE_TRIGGERS, actions_bucket: ACTIONS_BUCKETS },
  rule_edited: { trigger: RULE_TRIGGERS, actions_bucket: ACTIONS_BUCKETS },
  rule_deleted: { trigger: RULE_TRIGGERS, actions_bucket: ACTIONS_BUCKETS },
  rule_run: { trigger: RULE_RUN_TRIGGERS, outcome: OK_ERROR, matched_bucket: COUNT_BUCKETS },
  rule_run_undone: NONE,

  // Recurring
  recurring_created: { frequency: RECURRING_FREQUENCIES, kind: RECURRING_KINDS },
  recurring_edited: { frequency: RECURRING_FREQUENCIES, kind: RECURRING_KINDS },
  recurring_deleted: { frequency: RECURRING_FREQUENCIES, kind: RECURRING_KINDS },
  recurring_posted: { how: RECURRING_POST_HOW },
  recurring_skipped: NONE,

  // Push API (a device applying a queued push item)
  push_applied: { outcome: OK_ERROR, error_code: ERROR_CODES, age_bucket: AGE_BUCKETS },

  // Workspaces, accounts, settings
  workspace_switched: NONE,
  account_closed: NONE,
  reconcile_completed: NONE,
  setting_changed: { setting: SETTING_KEYS, value: ALL_SETTING_VALUES },

  // Export
  export_done: { format: EXPORT_FORMATS },
  backup_downloaded: { format: EXPORT_FORMATS },

  // Usage
  feature_used: { feature: FEATURES, action: FEATURE_ACTIONS },

  // Health
  sync_error: { code: ERROR_CODES },
  snapshot_restore: { outcome: OK_ERROR, error_code: ERROR_CODES },
  // Every workspace open: the denominator for sync failures. A fallback path
  // (local_after_download_failure, local_reset) with outcome ok is still a
  // failure worth counting; error_code is the code of what caused it.
  space_activation: {
    outcome: OK_ERROR,
    path: ACTIVATION_PATHS,
    error_code: ERROR_CODES,
    duration_bucket: DURATION_BUCKETS,
  },
  update_required_shown: NONE,
  money_integrity_warning_shown: { kind: MONEY_INTEGRITY_KINDS },

  // Commerce ('Purchase' has its own typed helper in analytics.ts)
  'Subscription Canceled': { reason: CANCEL_REASONS },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type AnalyticsEventName = keyof typeof EVENT_SCHEMA;
const EVENT_NAMES: ReadonlySet<string> = new Set(Object.keys(EVENT_SCHEMA));

/** The exact props of an event: every key required, each a value from its list. */
export type AnalyticsEventProps<E extends AnalyticsEventName> = {
  -readonly [
    K in keyof (typeof EVENT_SCHEMA)[E]
  ]: (typeof EVENT_SCHEMA)[E][K] extends readonly (infer V)[] ? V : never;
};

/** Events that carry no props. */
export type NameOnlyEventName = {
  [E in AnalyticsEventName]: keyof (typeof EVENT_SCHEMA)[E] extends never ? E : never;
}[AnalyticsEventName];

export type AnalyticsEventArgs<E extends AnalyticsEventName> = E extends NameOnlyEventName
  ? []
  : [props: AnalyticsEventProps<E>];

/**
 * Rebuild an event's props from its schema: only known keys, only listed
 * values. Returns null when the event is unknown or any prop is missing or out
 * of its list (an out-of-list error_code becomes 'unknown' instead). The input
 * object is never forwarded, so stray keys cannot ride along.
 */
export function sanitizeEvent(name: string, props: unknown): Record<string, string> | null {
  if (!EVENT_NAMES.has(name)) return null;
  const schema = EVENT_SCHEMA[name as AnalyticsEventName] as Record<string, readonly string[]>;
  const input = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(schema)) {
    const value = input[key];
    if (typeof value === 'string' && allowed.includes(value)) {
      out[key] = value;
    } else if (key === 'error_code' || key === 'code') {
      out[key] = 'unknown';
    } else {
      return null;
    }
  }
  if (name === 'setting_changed') {
    const allowed = SETTING_VALUES[out.setting as SettingKey] as readonly string[] | undefined;
    if (!allowed?.includes(out.value)) return null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bucket helpers
// ---------------------------------------------------------------------------

export function countBucket(n: number): CountBucket {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n <= 10) return '1-10';
  if (n <= 100) return '10-100';
  if (n <= 1000) return '100-1k';
  if (n <= 10000) return '1k-10k';
  return '10k+';
}

export function durationBucket(ms: number): DurationBucket {
  const s = Number.isFinite(ms) ? ms / 1000 : 0;
  if (s < 10) return '<10s';
  if (s < 60) return '10-60s';
  if (s < 300) return '1-5m';
  if (s < 900) return '5-15m';
  return '15m+';
}

export function ageBucket(ms: number): AgeBucket {
  const h = Number.isFinite(ms) ? ms / 3_600_000 : 0;
  if (h < 1) return '<1h';
  if (h < 24) return '1-24h';
  return '1d+';
}

export function actionsBucket(n: number): ActionsBucket {
  if (n <= 1) return '1';
  if (n <= 3) return '2-3';
  return '4+';
}
