import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
// Onboarding step definitions, copy, and preset data.
// Password is intentionally placed near the end of each path so the final
// apply pipeline can set it immediately before creating the workspace.

import { AccountTypeEnum } from '@entities/account/model/accountTypes';
import type {
  YNABApiPlanSnapshot,
  YNABImportConfig,
  YNABImportPreview,
} from '@budgero/core/browser';

export type StartMode = 'fresh' | 'ynab' | 'demo';

// 'join' is an invitee-only path — used when a brand new user lands via a
// /join#code=… link. It bypasses workspace/budget/accounts setup entirely
// since they're joining an existing space owned by someone else.
// 'from_demo' is the setup a demo user runs from "Start my own budget": the
// master password already exists, so it is only the budget's own steps.
export type ActivePath = StartMode | 'join' | 'from_demo';

export interface OnboardingStepDef {
  id: string;
  title: MessageDescriptor;
  subtitle: MessageDescriptor;
  hint: MessageDescriptor;
}

export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  {
    id: 'welcome',
    title: msg`Welcome to Budgero`,
    subtitle: msg`A field guide to zero-based budgeting.`,
    hint: msg`2 min to set up`,
  },
  {
    id: 'start_mode',
    title: msg`How are you starting?`,
    subtitle: msg`Fresh, or bringing a budget with you?`,
    hint: msg`Pick your path`,
  },
  {
    id: 'currency',
    title: msg`Where do you keep your money?`,
    subtitle: msg`Choose the currency for your budget. You can change the display language in Settings → Appearance.`,
    hint: msg`Budget currency`,
  },
  {
    id: 'ynab_import',
    title: msg`Bring your YNAB budget over`,
    subtitle: msg`Connect your YNAB account or upload a YNAB export, and we’ll rebuild accounts, categories, and history in Budgero.`,
    hint: msg`Import & map`,
  },
  {
    id: 'accounts',
    title: msg`Add your first accounts`,
    subtitle: msg`Tell Budgero where the money actually lives.`,
    hint: msg`Checking, savings, credit`,
  },
  {
    id: 'categories',
    title: msg`Make a few envelopes`,
    subtitle: msg`Group by needs, wants, and savings — or invent your own.`,
    hint: msg`Where money goes`,
  },
  {
    id: 'where_heard',
    title: msg`How did you hear about us?`,
    subtitle: msg`Totally optional — it just helps us know where to find more people like you.`,
    hint: msg`Optional`,
  },
  {
    id: 'password',
    title: msg`Lock it with a master password`,
    subtitle: msg`Budgero encrypts everything on your device. Only you hold the key.`,
    hint: msg`Encryption key`,
  },
  {
    id: 'done',
    title: msg`You’re ready`,
    subtitle: msg`Next, you give every coin a job. We’ll show you how.`,
    hint: msg`Finish line`,
  },
];

// Paths: password is second-to-last so apply can run it first in the pipeline.
export const PATH_STEPS: Record<ActivePath, string[]> = {
  // Invitee shortcut: just confirm intent, set encryption key, redeem.
  // Workspace/budget/accounts/categories all live with the
  // existing space they're joining — they don't need to build their own.
  join: ['welcome', 'where_heard', 'password', 'done'],
  // Setup asks only what the budget can't work without; how zero-based
  // budgeting works is explained in the app, at the moment it matters.
  fresh: ['start_mode', 'currency', 'accounts', 'categories', 'password', 'done'],
  ynab: ['start_mode', 'ynab_import', 'password', 'done'],
  // The demo needs an encryption key before it can exist, so it asks only for that.
  demo: ['start_mode', 'password'],
  from_demo: ['currency', 'accounts', 'categories', 'done'],
};

export interface CurrencyDef {
  code: string;
  sym: string;
  name: MessageDescriptor;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', sym: '$', name: msg`US Dollar` },
  { code: 'EUR', sym: '€', name: msg`Euro` },
  { code: 'GBP', sym: '£', name: msg`British Pound` },
  { code: 'CAD', sym: 'C$', name: msg`Canadian Dollar` },
  { code: 'AUD', sym: 'A$', name: msg`Australian Dollar` },
  { code: 'JPY', sym: '¥', name: msg`Japanese Yen` },
  { code: 'INR', sym: '₹', name: msg`Indian Rupee` },
  { code: 'BRL', sym: 'R$', name: msg`Brazilian Real` },
];

export interface AccountTypeDef {
  id: 'checking' | 'savings' | 'cash' | 'credit';
  name: MessageDescriptor;
  /**
   * The canonical account type stored in the DB. MUST be an
   * {@link AccountTypeEnum} value — the rest of the app resolves display and
   * liability behavior via that enum, and core recognizes credit cards as
   * 'Credit' (case-insensitive) to create the CC Payments linkage.
   */
  coreType: AccountTypeEnum;
  onBudget: boolean;
  /**
   * Debt account: the balance field asks for the amount OWED (positive) and
   * the created account opens with a negative balance. Assets take the
   * entered balance as-is.
   */
  isDebt: boolean;
  /** Balance-field label + placeholder shown in onboarding. */
  balanceLabel: MessageDescriptor;
}

export const ACCOUNT_TYPES: AccountTypeDef[] = [
  {
    id: 'checking',
    name: msg`Checking`,
    coreType: AccountTypeEnum.CHECKING,
    onBudget: true,
    isDebt: false,
    balanceLabel: msg`Starting balance`,
  },
  {
    id: 'savings',
    name: msg`Savings`,
    coreType: AccountTypeEnum.SAVINGS,
    onBudget: true,
    isDebt: false,
    balanceLabel: msg`Starting balance`,
  },
  {
    id: 'cash',
    name: msg`Cash`,
    coreType: AccountTypeEnum.CASH,
    onBudget: true,
    isDebt: false,
    balanceLabel: msg`Starting balance`,
  },
  {
    // On-budget: YNAB-style CC payment mechanics (spending auto-funds the
    // per-card payment category) only engage for on-budget credit accounts.
    id: 'credit',
    name: msg`Credit card`,
    coreType: AccountTypeEnum.CREDIT,
    onBudget: true,
    isDebt: true,
    balanceLabel: msg`Balance owed`,
  },
];

export interface CategoryPreset {
  label: MessageDescriptor;
  color: string;
  items: string[];
}

export const CATEGORY_PRESETS: Record<'needs' | 'wants' | 'savings', CategoryPreset> = {
  needs: {
    label: msg`NEEDS`,
    color: '#14b8a6',
    items: ['Rent / Mortgage', 'Groceries', 'Utilities', 'Transportation', 'Insurance'],
  },
  wants: {
    label: msg`WANTS`,
    color: '#f97316',
    items: ['Dining out', 'Subscriptions', 'Hobbies', 'Shopping'],
  },
  savings: {
    label: msg`SAVINGS`,
    color: '#2f7d31',
    items: ['Emergency fund', 'Vacation', 'Retirement'],
  },
};

// Category items double as selection keys and DB seeds, so they stay stable
// English internally. Display (and created category names) resolve through
// this map, falling back to the key for anything unmapped.
export const CATEGORY_ITEM_LABELS: Record<string, MessageDescriptor> = {
  'Rent / Mortgage': msg`Rent / Mortgage`,
  Groceries: msg`Groceries`,
  Utilities: msg`Utilities`,
  Transportation: msg`Transportation`,
  Insurance: msg`Insurance`,
  'Dining out': msg`Dining out`,
  Subscriptions: msg`Subscriptions`,
  Hobbies: msg`Hobbies`,
  Shopping: msg`Shopping`,
  'Emergency fund': msg`Emergency fund`,
  Vacation: msg`Vacation`,
  Retirement: msg`Retirement`,
};

// Reverse-lookup: category-name → group. Used when flattening selected envelopes.
export const CATEGORY_TO_GROUP: Record<string, 'needs' | 'wants' | 'savings'> = Object.fromEntries(
  (Object.entries(CATEGORY_PRESETS) as ['needs' | 'wants' | 'savings', CategoryPreset][]).flatMap(
    ([groupKey, group]) => group.items.map((item) => [item, groupKey] as const)
  )
);

export interface AccountInput {
  id: number;
  type: AccountTypeDef['id'];
  name: string;
  balance: string;
}

// "How did you hear about us?" choices. `id` is the stable value persisted to
// the user record (where_heard_about); 'other' swaps the radio list for a free
// text field whose contents are stored verbatim instead.
export interface HeardOption {
  id: string;
  label: MessageDescriptor;
}

export const HEARD_OPTIONS: HeardOption[] = [
  { id: 'search', label: msg`Search engine (Google, etc.)` },
  { id: 'friend', label: msg`Friend or colleague` },
  { id: 'reddit', label: msg`Reddit` },
  { id: 'x', label: msg`X (Twitter)` },
  { id: 'facebook', label: msg`Facebook` },
  { id: 'instagram', label: msg`Instagram` },
  { id: 'tiktok', label: msg`TikTok` },
  { id: 'youtube', label: msg`YouTube` },
  { id: 'product_hunt', label: msg`Product Hunt` },
  { id: 'blog', label: msg`Blog or article` },
  { id: 'other', label: msg`Other` },
];

/**
 * Resolve the value persisted to `where_heard_about` from the form state.
 * Presets persist their stable `id`; 'other' persists the trimmed free text
 * (falling back to 'other' when left blank). Empty string means "skipped".
 */
export function resolveHeardValue(source: string, other: string): string {
  if (!source) return '';
  if (source === 'other') return other.trim() || 'other';
  return source;
}

export interface OnboardingFormState {
  startMode: StartMode | null;
  /** When set, OnboardingFlow runs the invitee shortcut path instead of
   *  the regular fresh/ynab paths. Captured from sessionStorage on mount
   *  (a brand new user clicked a /join#code=… invite link). */
  joinSecret: string | null;
  currency: string;
  budgetName: string;
  password: string;
  passwordConfirm: string;
  accounts: AccountInput[];
  selectedCats: string[];
  ynabFile: { name: string; size: string; bytes: ArrayBuffer } | null;
  ynabApiSnapshot: YNABApiPlanSnapshot | null;
  ynabPreview: YNABImportPreview | null;
  ynabDateOrder?: YNABImportConfig['dateOrder'];
  ynabCreditPaymentMappings?: YNABImportConfig['creditPaymentMappings'];
  ynabSourceNumberFormat?: string;
  /** Selected HEARD_OPTIONS id, or '' if untouched/skipped. */
  heardSource: string;
  /** Free text shown when heardSource === 'other'. */
  heardOther: string;
}

export const INITIAL_STATE: OnboardingFormState = {
  startMode: null,
  joinSecret: null,
  currency: 'USD',
  budgetName: '',
  password: '',
  passwordConfirm: '',
  accounts: [{ id: 1, type: 'checking', name: '', balance: '' }],
  selectedCats: ['Rent / Mortgage', 'Groceries', 'Utilities', 'Dining out', 'Emergency fund'],
  ynabFile: null,
  ynabApiSnapshot: null,
  ynabPreview: null,
  heardSource: '',
  heardOther: '',
};
