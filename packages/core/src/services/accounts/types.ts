/**
 * Account service type definitions
 * These types use PascalCase for API consistency
 */

import type { MilliUnits } from '../../money/index.js';

/**
 * Account type - represents a financial account
 */
export interface Account {
  ID: number;
  Name: string;
  Currency: string;
  Type: string;
  ReconciledAt?: string;
  Balance: MilliUnits;
  BalanceConverted?: MilliUnits;
  /**
   * Net impact of future-dated (scheduled) transactions on Balance /
   * BalanceConverted. Subtract to get the realized as-of-today balance.
   */
  FutureImpactOriginal?: MilliUnits;
  FutureImpactConverted?: MilliUnits;
  BudgetID: number;
  /** Sort order within the budget; rendered order in the sidebar and mobile nav */
  Position?: number;
  Metadata?: string | Record<string, unknown>;
  OnBudget: boolean;
  Archived?: boolean;
  // Additional fields from the Wails version
  Deleted?: boolean;
}

/**
 * Canonical account-type vocabulary — THE single source of truth.
 *
 * The DB stores these values verbatim in accounts.Type; the app's UI metadata
 * and onboarding presets key off this enum. Raw SQL compares with
 * LOWER(Type) and the helpers below normalize case, so legacy rows with
 * off-case values keep working — but every new write must use these strings.
 */
export enum AccountTypeEnum {
  CHECKING = 'Checking',
  SAVINGS = 'Savings',
  CASH = 'Cash',
  CREDIT = 'Credit',
  LOAN = 'Loan',
  MORTGAGE = 'Mortgage',
  REAL_ESTATE = 'Real Estate',
  OTHER_ASSET = 'Other Asset',
  INVESTMENT = 'Investment',
  RETIREMENT = 'Retirement',
}

const normalizeAccountType = (type: string | null | undefined): string =>
  (type ?? '').toLowerCase();

/** Liability accounts: negative balances represent debt. */
export const LIABILITY_ACCOUNT_TYPES: readonly AccountTypeEnum[] = [
  AccountTypeEnum.CREDIT,
  AccountTypeEnum.LOAN,
  AccountTypeEnum.MORTGAGE,
];

/**
 * Debt accounts whose payment IS the expense — they get a linked Liabilities
 * category. Credit cards are excluded: CC spending is categorized when the
 * card is used, and payments draw from the per-card CC Payment category.
 */
export const DEBT_ACCOUNT_TYPES: readonly AccountTypeEnum[] = [
  AccountTypeEnum.LOAN,
  AccountTypeEnum.MORTGAGE,
];

/** Types that default to off-budget when the caller doesn't specify. */
export const DEFAULT_OFF_BUDGET_ACCOUNT_TYPES: readonly AccountTypeEnum[] = [
  AccountTypeEnum.MORTGAGE,
  AccountTypeEnum.REAL_ESTATE,
  AccountTypeEnum.OTHER_ASSET,
  AccountTypeEnum.INVESTMENT,
  AccountTypeEnum.RETIREMENT,
];

const LIABILITY_TYPE_SET = new Set(LIABILITY_ACCOUNT_TYPES.map(normalizeAccountType));
const DEBT_TYPE_SET = new Set(DEBT_ACCOUNT_TYPES.map(normalizeAccountType));
const OFF_BUDGET_TYPE_SET = new Set(DEFAULT_OFF_BUDGET_ACCOUNT_TYPES.map(normalizeAccountType));

export function isLiabilityAccountType(type: string | null | undefined): boolean {
  return LIABILITY_TYPE_SET.has(normalizeAccountType(type));
}

export function isCreditAccountType(type: string | null | undefined): boolean {
  return normalizeAccountType(type) === normalizeAccountType(AccountTypeEnum.CREDIT);
}

export function isDebtAccountType(type: string | null | undefined): boolean {
  return DEBT_TYPE_SET.has(normalizeAccountType(type));
}

export function defaultOnBudgetForType(type: string | null | undefined): boolean {
  return !OFF_BUDGET_TYPE_SET.has(normalizeAccountType(type));
}
