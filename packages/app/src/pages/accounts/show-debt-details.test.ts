import { describe, expect, it } from 'vitest';
import { showsDebtDetails } from './account-page.utils';

describe('showsDebtDetails', () => {
  it('shows debt details for credit cards, loans and mortgages', () => {
    expect(showsDebtDetails({ Type: 'credit' })).toBe(true);
    expect(showsDebtDetails({ Type: 'loan' })).toBe(true);
    expect(showsDebtDetails({ Type: 'mortgage' })).toBe(true);
  });

  it('hides them for an overdrawn checking or savings account', () => {
    expect(showsDebtDetails({ Type: 'checking', Metadata: {} })).toBe(false);
    expect(showsDebtDetails({ Type: 'savings', Metadata: null })).toBe(false);
    expect(showsDebtDetails({ Type: 'checking', Metadata: 'not json' })).toBe(false);
  });

  it('shows them for any account flagged as a liability, also with JSON metadata', () => {
    expect(showsDebtDetails({ Type: 'other', Metadata: { liability: true } })).toBe(true);
    expect(showsDebtDetails({ Type: 'checking', Metadata: '{"liability":true}' })).toBe(true);
  });
});
