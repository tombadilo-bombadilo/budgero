import { describe, expect, it } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import {
  liabilityFormFromMetadata,
  mergeLiabilityMetadata,
  parseAccountMetadata,
} from './edit-account-metadata';

describe('mergeLiabilityMetadata', () => {
  it('a rename keeps every stored key of a credit card, incl. its entered minimum', () => {
    const md = parseAccountMetadata(
      JSON.stringify({
        liability: true,
        liability_type: 'credit',
        debt_total: 1_500_000,
        min_payment_monthly: 35_000,
        payment_frequency: 'monthly',
        cc_payment_category_id: 12,
      })
    );
    const form = liabilityFormFromMetadata(md);
    // Cards have no target date, so nothing can be calculated.
    expect(mergeLiabilityMetadata(md, 'Credit', form, { ...form }, null)).toEqual(md);
  });

  it('a rename keeps loan keys the form does not show', () => {
    const md = {
      liability: true,
      liability_type: 'loan',
      debt_total: 20_000_000,
      paid_so_far: 2_000_000,
      term_years: 5,
      interest_rate_annual: 4.5,
      min_payment_monthly: 380_000,
      start_date: '2025-01-15',
      target_date: '2030-01-15',
      payment_frequency: 'monthly',
      linked_category_id: 7,
      ynab_account_id: 'abc',
    };
    const form = liabilityFormFromMetadata(md);
    // A calculated value exists, but none of its inputs changed.
    expect(mergeLiabilityMetadata(md, 'Loan', form, { ...form }, asMilli(399_999))).toEqual(md);
  });

  it('overwrites only the fields the user changed', () => {
    const md = {
      liability: true,
      debt_total: 20_000_000,
      paid_so_far: 2_000_000,
      term_years: 5,
      interest_rate_annual: 4.5,
      min_payment_monthly: 380_000,
      target_date: '2030-01-15',
    };
    const initial = liabilityFormFromMetadata(md);
    const next = mergeLiabilityMetadata(
      md,
      'Loan',
      initial,
      { ...initial, debtTotal: 18_000, interestRate: 5 },
      asMilli(390_000)
    );
    expect(next).toMatchObject({
      debt_total: 18_000_000,
      interest_rate_annual: 5,
      min_payment_monthly: 390_000,
      paid_so_far: 2_000_000,
      term_years: 5,
      target_date: '2030-01-15',
    });
  });

  it('drops a field the user cleared', () => {
    const md = { liability: true, target_date: '2030-01-15', min_payment_monthly: 380_000 };
    const initial = liabilityFormFromMetadata(md);
    const next = mergeLiabilityMetadata(md, 'Loan', initial, { ...initial, targetDate: '' }, null);
    expect(JSON.parse(JSON.stringify(next))).toEqual({
      liability: true,
      liability_type: 'loan',
      payment_frequency: 'monthly',
      min_payment_monthly: 380_000,
    });
  });

  it('reads metadata stored as a JSON string', () => {
    expect(liabilityFormFromMetadata(parseAccountMetadata('{"debt_total":250000}'))).toEqual({
      debtTotal: 250,
      interestRate: 0,
      startDate: '',
      targetDate: '',
    });
    expect(parseAccountMetadata('not json')).toEqual({});
  });
});
