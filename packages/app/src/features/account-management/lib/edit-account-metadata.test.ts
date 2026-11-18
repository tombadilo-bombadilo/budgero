import { describe, expect, it } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import {
  liabilityFormFromMetadata,
  mergeLiabilityMetadata,
  parseAccountMetadata,
  suggestedMonthlyPayment,
} from './edit-account-metadata';

const TODAY = '2026-11-18';

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
      { ...initial, debtTotal: 18_000, rates: [{ rate_annual: 5 }] },
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
      rates: [{ rate_annual: 0 }],
      startDate: '',
      targetDate: '',
    });
    expect(parseAccountMetadata('not json')).toEqual({});
  });
});

describe('interest rate schedule edits', () => {
  const loan = {
    liability: true,
    liability_type: 'loan',
    interest_rate_annual: 4.5,
    min_payment_monthly: 380_000,
    target_date: '2030-01-15',
    payment_frequency: 'monthly',
  };

  it('a single rate reads as one initial row and saves the legacy way', () => {
    const initial = liabilityFormFromMetadata(loan, TODAY);
    expect(initial.rates).toEqual([{ rate_annual: 4.5 }]);
    const next = mergeLiabilityMetadata(
      loan,
      'Loan',
      initial,
      { ...initial, rates: [{ rate_annual: 4.75 }] },
      asMilli(390_000),
      TODAY
    );
    expect(JSON.parse(JSON.stringify(next))).toEqual({
      ...loan,
      interest_rate_annual: 4.75,
      min_payment_monthly: 390_000,
    });
  });

  it('adding a dated change stores the schedule and keeps today’s rate in interest_rate_annual', () => {
    const initial = liabilityFormFromMetadata(loan, TODAY);
    const rates = [
      { rate_annual: 4.5 },
      { effective_date: '2027-03-01', rate_annual: 6.1 },
      { effective_date: '2025-01-01', rate_annual: 5 },
    ];
    const next = mergeLiabilityMetadata(
      loan,
      'Loan',
      initial,
      { ...initial, rates },
      asMilli(400_000),
      TODAY
    );
    expect(next).toMatchObject({
      interest_rate_annual: 5,
      interest_rate_annual_synced: 5,
      interest_rate_schedule: [
        { rate_annual: 4.5 },
        { effective_date: '2025-01-01', rate_annual: 5 },
        { effective_date: '2027-03-01', rate_annual: 6.1 },
      ],
      // A rate edit recalculates the payment.
      min_payment_monthly: 400_000,
    });
    // Re-opened, the form shows the same rows; a rename keeps everything.
    const reopened = liabilityFormFromMetadata(next, TODAY);
    expect(reopened.rates).toHaveLength(3);
    expect(
      mergeLiabilityMetadata(next, 'Loan', reopened, { ...reopened }, asMilli(1), TODAY)
    ).toEqual(next);
  });

  it('removing every dated change returns to the legacy single rate', () => {
    const md = {
      ...loan,
      interest_rate_annual: 5,
      interest_rate_annual_synced: 5,
      interest_rate_schedule: [
        { rate_annual: 5 },
        { effective_date: '2027-03-01', rate_annual: 6 },
      ],
    };
    const initial = liabilityFormFromMetadata(md, TODAY);
    const next = mergeLiabilityMetadata(
      md,
      'Loan',
      initial,
      { ...initial, rates: [{ rate_annual: 5 }] },
      null,
      TODAY
    );
    expect(JSON.parse(JSON.stringify(next))).toEqual({ ...loan, interest_rate_annual: 5 });
  });

  it('a save after a scheduled change took effect refreshes interest_rate_annual', () => {
    const md = {
      ...loan,
      interest_rate_annual: 4.5,
      interest_rate_annual_synced: 4.5,
      interest_rate_schedule: [
        { rate_annual: 4.5 },
        { effective_date: '2026-10-01', rate_annual: 6 },
      ],
    };
    const initial = liabilityFormFromMetadata(md, TODAY);
    const next = mergeLiabilityMetadata(md, 'Loan', initial, { ...initial }, null, TODAY);
    expect(next).toMatchObject({ interest_rate_annual: 6, interest_rate_annual_synced: 6 });
  });

  it('folds a rate an older client changed into the schedule as of today', () => {
    const md = {
      ...loan,
      interest_rate_annual: 7,
      interest_rate_annual_synced: 4.5,
      interest_rate_schedule: [
        { rate_annual: 4.5 },
        { effective_date: '2027-03-01', rate_annual: 6 },
      ],
    };
    const initial = liabilityFormFromMetadata(md, TODAY);
    expect(initial.rates).toEqual([
      { rate_annual: 4.5 },
      { effective_date: TODAY, rate_annual: 7 },
      { effective_date: '2027-03-01', rate_annual: 6 },
    ]);
    const next = mergeLiabilityMetadata(md, 'Loan', initial, { ...initial }, null, TODAY);
    expect(next).toMatchObject({
      interest_rate_annual: 7,
      interest_rate_annual_synced: 7,
      interest_rate_schedule: initial.rates,
    });
  });

  it('suggests the annuity payment for one rate and a higher one for a step-up', () => {
    const r = 0.06 / 12;
    const annuity = (10_000_000 * r) / (1 - (1 + r) ** -120);
    expect(suggestedMonthlyPayment(10_000_000, [{ rate_annual: 6 }], 120, TODAY)).toBe(annuity);
    const stepUp = suggestedMonthlyPayment(
      10_000_000,
      [{ rate_annual: 6 }, { effective_date: '2028-11-18', rate_annual: 9 }],
      120,
      TODAY
    );
    expect(stepUp).toBeGreaterThan(annuity);
  });
});
