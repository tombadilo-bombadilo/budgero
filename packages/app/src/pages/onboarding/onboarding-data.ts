// Onboarding step definitions, copy, and preset data.
// Password is intentionally placed near the end of each path so the final
// apply pipeline can set it immediately before creating the workspace.

import { formatDateISO } from '@shared/lib/date-utils';
import { AccountTypeEnum } from '@entities/account/model/accountTypes';

export type StartMode = 'fresh' | 'ynab';

// 'join' is an invitee-only path — used when a brand new user lands via a
// /join#code=… link. It bypasses workspace/budget/accounts setup entirely
// since they're joining an existing space owned by someone else.
export type ActivePath = StartMode | 'join';

export interface OnboardingStepDef {
  id: string;
  title: string;
  subtitle: string;
  hint: string;
}

export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  {
    id: 'welcome',
    title: 'Welcome to Budgero',
    subtitle: 'A field guide to zero-based budgeting.',
    hint: '2 min to set up',
  },
  {
    id: 'start_mode',
    title: 'How are you starting?',
    subtitle: 'Fresh, or bringing a budget with you?',
    hint: 'Pick your path',
  },
  {
    id: 'rules',
    title: 'Three house rules',
    subtitle: 'Before we build anything, here’s how Budgero thinks about money.',
    hint: 'How Budgero thinks',
  },
  {
    id: 'currency',
    title: 'Where do you keep your money?',
    subtitle: 'Pick your currency and locale. Everything else adapts.',
    hint: 'Language & money',
  },
  {
    id: 'zbb',
    title: 'Give every coin a job',
    subtitle: 'The one rule of zero-based budgeting.',
    hint: 'The core idea',
  },
  {
    id: 'rewards',
    title: 'Earn up to 35% off',
    subtitle:
      'Build real budgeting habits during your trial and unlock a discount — automatically.',
    hint: 'Trial rewards',
  },
  {
    id: 'workspace',
    title: 'Name your budget',
    subtitle: 'A household, a side hustle, a trip — whatever you’re planning for.',
    hint: 'Your workspace',
  },
  {
    id: 'share',
    title: 'Invite your people',
    subtitle:
      'Budgero is better together. Share this workspace with up to five others — included free.',
    hint: 'Up to 5 seats · free',
  },
  {
    id: 'ynab_import',
    title: 'Bring your YNAB budget over',
    subtitle:
      'Drop your YNAB export and we’ll rebuild accounts, categories, and history in Budgero.',
    hint: 'Import & map',
  },
  {
    id: 'accounts',
    title: 'Add your first accounts',
    subtitle: 'Tell Budgero where the money actually lives.',
    hint: 'Checking, savings, credit',
  },
  {
    id: 'categories',
    title: 'Make a few envelopes',
    subtitle: 'Group by needs, wants, and savings — or invent your own.',
    hint: 'Where money goes',
  },
  {
    id: 'goal',
    title: 'Pick a savings goal',
    subtitle: 'One jar to get you started. Big or small.',
    hint: 'Optional but encouraged',
  },
  {
    id: 'where_heard',
    title: 'How did you hear about us?',
    subtitle: 'Totally optional — it just helps us know where to find more people like you.',
    hint: 'Optional',
  },
  {
    id: 'theme',
    title: 'Pick a look',
    subtitle: 'Budgero comes in a few flavors. Pick one that feels like you.',
    hint: 'Make it yours',
  },
  {
    id: 'password',
    title: 'Lock it with a master password',
    subtitle: 'Budgero encrypts everything on your device. Only you hold the key.',
    hint: 'Encryption key',
  },
  {
    id: 'done',
    title: 'You’re ready',
    subtitle: 'Every coin now has a place to land.',
    hint: 'Finish line',
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
    'rewards',
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
    'rewards',
    'workspace',
    'share',
    'ynab_import',
    'where_heard',
    'theme',
    'password',
    'done',
  ],
};

// Trial-reward tiers surfaced on the onboarding 'rewards' step. Mirrors the
// tiers in the dashboard rewards card / RewardsPage so new users learn the
// discount exists. SaaS-only — the step is filtered out of self-host builds.
export interface RewardTier {
  percent: number;
  label: string;
}

export const REWARD_TIERS: RewardTier[] = [
  { percent: 10, label: 'Log 5 transactions' },
  { percent: 20, label: 'Reconcile an account, then create and fund a goal' },
  { percent: 35, label: 'Keep budgeting across two calendar months' },
];

export interface CurrencyDef {
  code: string;
  sym: string;
  name: string;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', sym: '$', name: 'US Dollar' },
  { code: 'EUR', sym: '€', name: 'Euro' },
  { code: 'GBP', sym: '£', name: 'British Pound' },
  { code: 'CAD', sym: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', sym: 'A$', name: 'Australian Dollar' },
  { code: 'JPY', sym: '¥', name: 'Japanese Yen' },
  { code: 'INR', sym: '₹', name: 'Indian Rupee' },
  { code: 'BRL', sym: 'R$', name: 'Brazilian Real' },
];

export interface AccountTypeDef {
  id: 'checking' | 'savings' | 'cash' | 'credit';
  name: string;
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
  balanceLabel: string;
}

export const ACCOUNT_TYPES: AccountTypeDef[] = [
  {
    id: 'checking',
    name: 'Checking',
    coreType: AccountTypeEnum.CHECKING,
    onBudget: true,
    isDebt: false,
    balanceLabel: 'Starting balance',
  },
  {
    id: 'savings',
    name: 'Savings',
    coreType: AccountTypeEnum.SAVINGS,
    onBudget: true,
    isDebt: false,
    balanceLabel: 'Starting balance',
  },
  {
    id: 'cash',
    name: 'Cash',
    coreType: AccountTypeEnum.CASH,
    onBudget: true,
    isDebt: false,
    balanceLabel: 'Starting balance',
  },
  {
    // On-budget: YNAB-style CC payment mechanics (spending auto-funds the
    // per-card payment category) only engage for on-budget credit accounts.
    id: 'credit',
    name: 'Credit card',
    coreType: AccountTypeEnum.CREDIT,
    onBudget: true,
    isDebt: true,
    balanceLabel: 'Balance owed',
  },
];

export interface CategoryPreset {
  label: string;
  color: string;
  items: string[];
}

export const CATEGORY_PRESETS: Record<'needs' | 'wants' | 'savings', CategoryPreset> = {
  needs: {
    label: 'NEEDS',
    color: '#14b8a6',
    items: ['Rent / Mortgage', 'Groceries', 'Utilities', 'Transportation', 'Insurance'],
  },
  wants: {
    label: 'WANTS',
    color: '#f97316',
    items: ['Dining out', 'Subscriptions', 'Hobbies', 'Shopping'],
  },
  savings: {
    label: 'SAVINGS',
    color: '#2f7d31',
    items: ['Emergency fund', 'Vacation', 'Retirement'],
  },
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
  label: string;
  /** Default-mode amount. For 'monthly' this is $/month, for 'target' it's total. */
  target: number;
  mode: GoalMode;
  /** Horizon for 'target' mode — months from today. Ignored for 'monthly'. */
  monthsOut: number;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { id: 'emergency', label: 'Emergency fund', target: 250, mode: 'monthly', monthsOut: 12 },
  { id: 'vacation', label: 'Vacation', target: 2500, mode: 'target', monthsOut: 6 },
  { id: 'home', label: 'Home down payment', target: 25000, mode: 'target', monthsOut: 36 },
  { id: 'car', label: 'New car', target: 8000, mode: 'target', monthsOut: 12 },
  { id: 'custom', label: 'Something else', target: 500, mode: 'monthly', monthsOut: 6 },
];

export interface ThemeOption {
  id: string;
  name: string;
  tag: string;
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
    name: 'Paper',
    tag: 'Editorial, parchment. The Budgero classic.',
    bg: '#fbf7eb',
    fg: '#141414',
    accent: '#c6392c',
    recommended: true,
  },
  {
    id: 'default',
    name: 'Classic',
    tag: 'Clean, neutral, out of the way.',
    bg: '#ffffff',
    fg: '#18181b',
    accent: '#2f7d31',
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    tag: 'CRT green-on-black. For terminal lovers.',
    bg: '#0a140a',
    fg: '#5dff8f',
    accent: '#5dff8f',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    tag: 'Dark with copper warmth.',
    bg: '#1e1e2a',
    fg: '#e8d4a8',
    accent: '#d89a5e',
  },
  {
    id: 'mesa',
    name: 'Mesa',
    tag: 'Warm desert clay.',
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
  label: string;
}

export const HEARD_OPTIONS: HeardOption[] = [
  { id: 'search', label: 'Search engine (Google, etc.)' },
  { id: 'friend', label: 'Friend or colleague' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'x', label: 'X (Twitter)' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'product_hunt', label: 'Product Hunt' },
  { id: 'blog', label: 'Blog or article' },
  { id: 'other', label: 'Other' },
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
  accounts: [{ id: 1, type: 'checking', name: 'Everyday checking', balance: '' }],
  selectedCats: ['Rent / Mortgage', 'Groceries', 'Utilities', 'Dining out', 'Emergency fund'],
  goal: {
    id: EMERGENCY_TEMPLATE.id,
    label: EMERGENCY_TEMPLATE.label,
    target: EMERGENCY_TEMPLATE.target,
    mode: EMERGENCY_TEMPLATE.mode,
    targetDate: addMonthsIso(EMERGENCY_TEMPLATE.monthsOut),
  },
  theme: 'paper',
  zbbAssigned: { rent: '', groceries: '', savings: '' },
  invites: [],
  ynabFile: null,
  heardSource: '',
  heardOther: '',
};

export const WORKSPACE_SUGGESTIONS = [
  'Household 2026',
  'Freelance',
  'Europe trip',
  'Emergency rebuild',
];
