import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
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
  Bitcoin,
  type LucideIcon,
} from 'lucide-react';
import { AccountTypeEnum } from '@budgero/core/browser';

// The canonical vocabulary lives in core (it owns what accounts.Type means);
// this module layers UI metadata (icons, colors, copy) on top of it.
export { AccountTypeEnum };

export interface AccountTypeDefinition {
  name: MessageDescriptor;
  category: 'asset' | 'liability';
  budgetType: 'always-on' | 'always-off' | 'flexible';
  color: string; // CSS variable name
  icon: LucideIcon;
  description: MessageDescriptor;
}

export const ACCOUNT_TYPES: Record<AccountTypeEnum, AccountTypeDefinition> = {
  [AccountTypeEnum.CHECKING]: {
    name: msg`Checking`,
    category: 'asset',
    budgetType: 'always-on',
    color: 'var(--color-account-checking)',
    icon: Wallet,
    description: msg`Primary spending account for everyday transactions`,
  },
  [AccountTypeEnum.SAVINGS]: {
    name: msg`Savings`,
    category: 'asset',
    budgetType: 'always-on',
    color: 'var(--color-account-savings)',
    icon: PiggyBank,
    description: msg`Savings account for storing money and earning interest`,
  },
  [AccountTypeEnum.CASH]: {
    name: msg`Cash`,
    category: 'asset',
    budgetType: 'always-on',
    color: 'var(--color-account-cash)',
    icon: Coins,
    description: msg`Physical cash and petty cash funds`,
  },
  [AccountTypeEnum.CREDIT]: {
    name: msg`Credit`,
    category: 'liability',
    budgetType: 'flexible',
    color: 'var(--color-account-credit)',
    icon: CreditCard,
    description: msg`Credit cards and revolving credit accounts`,
  },
  [AccountTypeEnum.LOAN]: {
    name: msg`Loan`,
    category: 'liability',
    budgetType: 'flexible',
    color: 'var(--color-account-loan)',
    icon: Landmark,
    description: msg`Personal loans, auto loans, and installment debt`,
  },
  [AccountTypeEnum.MORTGAGE]: {
    name: msg`Mortgage`,
    category: 'liability',
    budgetType: 'always-off',
    color: 'var(--color-account-mortgage)',
    icon: Home,
    description: msg`Home mortgage and real estate loans`,
  },
  [AccountTypeEnum.REAL_ESTATE]: {
    name: msg`Real Estate`,
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-real-estate)',
    icon: Building2,
    description: msg`Property investments and real estate holdings`,
  },
  [AccountTypeEnum.OTHER_ASSET]: {
    name: msg`Other Asset`,
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-other-asset)',
    icon: Package,
    description: msg`Vehicles, collectibles, and other valuable assets`,
  },
  [AccountTypeEnum.INVESTMENT]: {
    name: msg`Investment`,
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-investment)',
    icon: TrendingUp,
    description: msg`Brokerage accounts, stocks, bonds, and mutual funds`,
  },
  [AccountTypeEnum.RETIREMENT]: {
    name: msg`Retirement`,
    category: 'asset',
    budgetType: 'always-off',
    color: 'var(--color-account-retirement)',
    icon: Briefcase,
    description: msg`401(k), IRA, pension, and other retirement accounts`,
  },
  [AccountTypeEnum.CRYPTO]: {
    name: msg`Crypto`,
    category: 'asset',
    budgetType: 'flexible',
    color: 'var(--color-account-investment)',
    icon: Bitcoin,
    description: msg`Wallets and exchange balances held in cryptocurrency`,
  },
};

// Set of account type names that represent liabilities, derived from ACCOUNT_TYPES
export const LIABILITY_ACCOUNT_TYPES: ReadonlySet<string> = new Set(
  Object.entries(ACCOUNT_TYPES)
    .filter(([_, def]) => def.category === 'liability')
    .map(([type]) => type)
);

export function getAccountTypeDefinition(type: string): AccountTypeDefinition | null {
  // Types are matched like core does: case-insensitively ('credit' is a Credit account).
  const lower = (type ?? '').toLowerCase();
  const enumValue = Object.values(AccountTypeEnum).find((v) => v.toLowerCase() === lower);
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
