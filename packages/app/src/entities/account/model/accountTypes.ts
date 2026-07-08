import {
  Wallet,
  PiggyBank,
  Coins,
  CreditCard,
  Landmark,
  Home,
  Building2,
  Package,
  TrendingUp,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import { AccountTypeEnum } from '@budgero/core/browser';

// The canonical vocabulary lives in core (it owns what accounts.Type means);
// this module layers UI metadata (icons, colors, copy) on top of it.
export { AccountTypeEnum };

export interface AccountTypeDefinition {
  name: string;
  category: 'asset' | 'liability';
  budgetType: 'always-on' | 'always-off' | 'flexible';
  color: string; // CSS variable name
  icon: LucideIcon;
  description: string;
}

export const ACCOUNT_TYPES: Record<AccountTypeEnum, AccountTypeDefinition> = {
  [AccountTypeEnum.CHECKING]: {
    name: 'Checking',
    category: 'asset',
    budgetType: 'always-on',
    color: 'var(--color-account-checking)',
    icon: Wallet,
    description: 'Primary spending account for everyday transactions',
  },
  [AccountTypeEnum.SAVINGS]: {
    name: 'Savings',
    category: 'asset',
    budgetType: 'always-on',
    color: 'var(--color-account-savings)',
    icon: PiggyBank,
    description: 'Savings account for storing money and earning interest',
  },
  [AccountTypeEnum.CASH]: {
    name: 'Cash',
    category: 'asset',
    budgetType: 'always-on',
    color: 'var(--color-account-cash)',
    icon: Coins,
    description: 'Physical cash and petty cash funds',
  },
  [AccountTypeEnum.CREDIT]: {
    name: 'Credit',
    category: 'liability',
    budgetType: 'flexible',
    color: 'var(--color-account-credit)',
    icon: CreditCard,
    description: 'Credit cards and revolving credit accounts',
  },
  [AccountTypeEnum.LOAN]: {
    name: 'Loan',
    category: 'liability',
    budgetType: 'flexible',
    color: 'var(--color-account-loan)',
    icon: Landmark,
    description: 'Personal loans, auto loans, and installment debt',
  },
  [AccountTypeEnum.MORTGAGE]: {
    name: 'Mortgage',
    category: 'liability',
    budgetType: 'always-off',
    color: 'var(--color-account-mortgage)',
    icon: Home,
    description: 'Home mortgage and real estate loans',
  },
  [AccountTypeEnum.REAL_ESTATE]: {
    name: 'Real Estate',
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-real-estate)',
    icon: Building2,
    description: 'Property investments and real estate holdings',
  },
  [AccountTypeEnum.OTHER_ASSET]: {
    name: 'Other Asset',
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-other-asset)',
    icon: Package,
    description: 'Vehicles, collectibles, and other valuable assets',
  },
  [AccountTypeEnum.INVESTMENT]: {
    name: 'Investment',
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-investment)',
    icon: TrendingUp,
    description: 'Brokerage accounts, stocks, bonds, and mutual funds',
  },
  [AccountTypeEnum.RETIREMENT]: {
    name: 'Retirement',
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-retirement)',
    icon: Briefcase,
    description: '401(k), IRA, pension, and other retirement accounts',
  },
};

// Set of account type names that represent liabilities, derived from ACCOUNT_TYPES
export const LIABILITY_ACCOUNT_TYPES: ReadonlySet<string> = new Set(
  Object.entries(ACCOUNT_TYPES)
    .filter(([_, def]) => def.category === 'liability')
    .map(([type]) => type)
);

export function getAccountTypeDefinition(type: string): AccountTypeDefinition | null {
  const enumValue = Object.values(AccountTypeEnum).find((v) => v === type);
  return enumValue ? ACCOUNT_TYPES[enumValue] : null;
}

export function getAccountTypesByBudgetType(budgetType: 'on' | 'off'): AccountTypeEnum[] {
  return Object.entries(ACCOUNT_TYPES)
    .filter(([_, def]) => {
      if (budgetType === 'on') {
        return def.budgetType === 'always-on' || def.budgetType === 'flexible';
      }
      return def.budgetType === 'always-off' || def.budgetType === 'flexible';
    })
    .map(([type, _]) => type as AccountTypeEnum);
}

export function isLiabilityType(type: string): boolean {
  const def = getAccountTypeDefinition(type);
  return def?.category === 'liability' || false;
}
