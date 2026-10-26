import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
// Onboarding step definitions, copy, and preset data.
// Password is intentionally placed near the end of each path so the final
// apply pipeline can set it immediately before creating the workspace.

import { formatDateISO } from '@shared/lib/date-utils';
import { AccountTypeEnum } from '@entities/account/model/accountTypes';
import type {
  YNABApiPlanSnapshot,
  YNABImportConfig,
  YNABImportPreview,
} from '@budgero/core/browser';

export type StartMode = 'fresh' | 'ynab';

// 'join' is an invitee-only path — used when a brand new user lands via a
// /join#code=… link. It bypasses workspace/budget/accounts setup entirely
// since they're joining an existing space owned by someone else.
export type ActivePath = StartMode | 'join';

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
    id: 'rules',
    title: msg`Three house rules`,
    subtitle: msg`Before we build anything, here’s how Budgero thinks about money.`,
    hint: msg`How Budgero thinks`,
  },
  {
    id: 'currency',
    title: msg`Where do you keep your money?`,
    subtitle: msg`Choose the currency for your budget. You can change the display language in Settings → Appearance.`,
    hint: msg`Budget currency`,
  },
  {
    id: 'zbb',
    title: msg`Give every coin a job`,
    subtitle: msg`The one rule of zero-based budgeting.`,
    hint: msg`The core idea`,
  },
  {
    id: 'workspace',
    title: msg`Name your budget`,
    subtitle: msg`A household, a side hustle, a trip — whatever you’re planning for.`,
    hint: msg`Your workspace`,
  },
  {
    id: 'share',
    title: msg`Invite your people`,
    subtitle: msg`Budgero is better together. Share this workspace with up to five others — included free.`,
    hint: msg`Up to 5 seats · free`,
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
    id: 'goal',
    title: msg`Pick a savings goal`,
    subtitle: msg`One jar to get you started. Big or small.`,
    hint: msg`Optional but encouraged`,
  },
  {
    id: 'where_heard',
    title: msg`How did you hear about us?`,
    subtitle: msg`Totally optional — it just helps us know where to find more people like you.`,
    hint: msg`Optional`,
  },
  {
    id: 'theme',
    title: msg`Pick a look`,
    subtitle: msg`Budgero comes in a few flavors. Pick one that feels like you.`,
    hint: msg`Make it yours`,
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
    subtitle: msg`Every coin now has a place to land.`,
    hint: msg`Finish line`,
  },
];

// Paths: password is second-to-last so apply can run it first in the pipeline.
export const PATH_STEPS: Record<ActivePath, string[]> = {
  // Invitee shortcut: just confirm intent, set encryption key, redeem.
  // Workspace/budget/accounts/categories/goal/theme all live with the
  // existing space they're joining — they don't need to build their own.
  join: ['welcome', 'where_heard', 'password', 'done'],
  fresh: [
    'welcome',
    'start_mode',
    'rules',
    'currency',
    'zbb',
    'workspace',
    'share',
    'accounts',
    'categories',
    'goal',
    'where_heard',
    'theme',
    'password',
    'done',
  ],
  ynab: [
    'welcome',
    'start_mode',
    'rules',
    'currency',
    'workspace',
    'share',
    'ynab_import',
    'where_heard',
    'theme',
    'password',
    'done',
  ],
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

// A goal's mode picks which Budgero goal shape we create at apply time:
//   'monthly' → GoalType.MONTHLY_SAVINGS (assign X each month)
//   'target'  → GoalType.TARGET_DATE     (allocate total by a date)
// Both are SAVINGS-purpose goals attached to a category under SAVINGS.
export type GoalMode = 'monthly' | 'target';

export interface GoalTemplate {
  id: string;
  label: MessageDescriptor;
  /** Default-mode amount. For 'monthly' this is $/month, for 'target' it's total. */
  target: number;
  mode: GoalMode;
  /** Horizon for 'target' mode — months from today. Ignored for 'monthly'. */
  monthsOut: number;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { id: 'emergency', label: msg`Emergency fund`, target: 250, mode: 'monthly', monthsOut: 12 },
  { id: 'vacation', label: msg`Vacation`, target: 2500, mode: 'target', monthsOut: 6 },
  { id: 'home', label: msg`Home down payment`, target: 25000, mode: 'target', monthsOut: 36 },
  { id: 'car', label: msg`New car`, target: 8000, mode: 'target', monthsOut: 12 },
  { id: 'custom', label: msg`Something else`, target: 500, mode: 'monthly', monthsOut: 6 },
];

export interface ThemeOption {
  id: string;
  name: MessageDescriptor;
  tag: MessageDescriptor;
  bg: string;
  fg: string;
  accent: string;
  recommended?: boolean;
}

// Theme ids match AppThemeId in `@shared/lib/theme`. Editing the list here without
// updating the theme system will leave those ids unclickable in the dashboard.
export const THEMES_AVAILABLE: ThemeOption[] = [
  {
    id: 'paper',
    name: msg`Paper`,
    tag: msg`Editorial, parchment. The Budgero classic.`,
    bg: '#fbf7eb',
    fg: '#141414',
    accent: '#c6392c',
    recommended: true,
  },
  {
    id: 'default',
    name: msg`Classic`,
    tag: msg`Clean, neutral, out of the way.`,
    bg: '#ffffff',
    fg: '#18181b',
    accent: '#2f7d31',
  },
  {
    id: 'phosphor',
    name: msg`Phosphor`,
    tag: msg`CRT green-on-black. For terminal lovers.`,
    bg: '#0a140a',
    fg: '#5dff8f',
    accent: '#5dff8f',
  },
  {
    id: 'obsidian',
    name: msg`Obsidian`,
    tag: msg`Dark with copper warmth.`,
    bg: '#1e1e2a',
    fg: '#e8d4a8',
    accent: '#d89a5e',
  },
  {
    id: 'mesa',
    name: msg`Mesa`,
    tag: msg`Warm desert clay.`,
    bg: '#efe0c5',
    fg: '#3a2418',
    accent: '#c06a3c',
  },
];

// Budgero has two roles only: owner + collaborator. Every onboarding invite
// maps to a collaborator, so the invite row doesn't need a role picker.
export interface InviteInput {
  id: number;
  email: string;
}

// Populated at the end of the apply pipeline — the owner reads these off the
// Done screen and sends the URL to the invitee themselves. The server never
// sees the secret, so there is no automated delivery option.
export interface InviteResult {
  email: string;
  url: string;
  secret: string;
}

export interface InviteFailure {
  email: string;
  reason: string;
}

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
  acknowledgedRules: boolean;
  accounts: AccountInput[];
  selectedCats: string[];
  goal: {
    id: string;
    label: string;
    target: number;
    mode: GoalMode;
    /** ISO YYYY-MM-DD. Only applied when mode === 'target'. */
    targetDate: string;
  };
  theme: string;
  zbbAssigned: { rent: string; groceries: string; savings: string };
  invites: InviteInput[];
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

/** Compute an ISO YYYY-MM-DD string `monthsOut` months from today. */
export function addMonthsIso(monthsOut: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsOut);
  return formatDateISO(d);
}

const EMERGENCY_TEMPLATE = GOAL_TEMPLATES[0];

export const INITIAL_STATE: OnboardingFormState = {
  startMode: null,
  joinSecret: null,
  currency: 'USD',
  budgetName: '',
  password: '',
  passwordConfirm: '',
  acknowledgedRules: false,
  accounts: [{ id: 1, type: 'checking', name: '', balance: '' }],
  selectedCats: ['Rent / Mortgage', 'Groceries', 'Utilities', 'Dining out', 'Emergency fund'],
  goal: {
    id: EMERGENCY_TEMPLATE.id,
    label: '',
    target: EMERGENCY_TEMPLATE.target,
    mode: EMERGENCY_TEMPLATE.mode,
    targetDate: addMonthsIso(EMERGENCY_TEMPLATE.monthsOut),
  },
  theme: 'paper',
  zbbAssigned: { rent: '', groceries: '', savings: '' },
  invites: [],
  ynabFile: null,
  ynabApiSnapshot: null,
  ynabPreview: null,
  heardSource: '',
  heardOther: '',
};

export const WORKSPACE_SUGGESTIONS: MessageDescriptor[] = [
  msg`Household 2026`,
  msg`Freelance`,
  msg`Europe trip`,
  msg`Emergency rebuild`,
];
