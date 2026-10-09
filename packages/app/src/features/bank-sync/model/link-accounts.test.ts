import { describe, expect, it } from 'vitest';
import { isSupportedBankCurrency } from './link-accounts';

describe('isSupportedBankCurrency', () => {
  it('accepts a real currency code', () => {
    expect(isSupportedBankCurrency('EUR')).toBe(true);
  });

  it('rejects XXX, the ISO 4217 "unknown currency" placeholder', () => {
    expect(isSupportedBankCurrency('XXX')).toBe(false);
  });

  it('rejects malformed codes', () => {
    expect(isSupportedBankCurrency('eur')).toBe(false);
    expect(isSupportedBankCurrency('EU')).toBe(false);
  });
});
