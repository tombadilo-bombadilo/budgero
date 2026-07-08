import { describe, expect, it } from 'vitest';
import { AccountTypeEnum, getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { ACCOUNT_TYPES } from './onboarding-data';

/**
 * Onboarding once shipped its own account-type vocabulary ('checking',
 * 'credit_card', ...) that didn't match the canonical AccountTypeEnum
 * ('Checking', 'Credit', ...). Every onboarded account then resolved to an
 * undefined type in the UI, and credit cards never got their CC Payments
 * category linkage. These tests pin the vocabulary together.
 */
describe('onboarding account types', () => {
  it('maps every onboarding type to a canonical AccountTypeEnum value', () => {
    const canonical = new Set<string>(Object.values(AccountTypeEnum));
    for (const typeDef of ACCOUNT_TYPES) {
      expect(canonical.has(typeDef.coreType), `coreType '${typeDef.coreType}'`).toBe(true);
      expect(getAccountTypeDefinition(typeDef.coreType)).not.toBeNull();
    }
  });

  it('creates credit cards as on-budget Credit accounts (CC payment mechanics)', () => {
    const credit = ACCOUNT_TYPES.find((t) => t.id === 'credit');
    expect(credit?.coreType).toBe(AccountTypeEnum.CREDIT);
    // Core only engages the per-card CC Payment category flow for on-budget
    // 'Credit' accounts — off-budget CCs silently skip the linkage.
    expect(credit?.onBudget).toBe(true);
  });

  it('keeps asset types on budget', () => {
    for (const id of ['checking', 'savings', 'cash'] as const) {
      const def = ACCOUNT_TYPES.find((t) => t.id === id);
      expect(def?.onBudget, id).toBe(true);
    }
  });

  it('marks only debt types as isDebt and labels the balance field per type', () => {
    for (const def of ACCOUNT_TYPES) {
      const isLiability = getAccountTypeDefinition(def.coreType)?.category === 'liability';
      expect(def.isDebt, `${def.id} isDebt`).toBe(isLiability);
      expect(def.balanceLabel).toBe(isLiability ? 'Balance owed' : 'Starting balance');
    }
  });
});
