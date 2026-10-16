import { asMilli } from '@budgero/core/browser';
import { getCardDebt, getCCOverAssigned, getCCUnderfundedInfo } from './cc-payment.utils';

const ccRow = (available: number, cardBalance?: number) => ({
  available: asMilli(available),
  fundingBreakdown: [],
  cardBalance: cardBalance === undefined ? undefined : asMilli(cardBalance),
});

describe('cc-payment status math', () => {
  it('reads card debt as a positive amount, and 0 for a card in credit', () => {
    expect(getCardDebt({ cardBalance: asMilli(-500) })).toBe(500);
    expect(getCardDebt({ cardBalance: asMilli(200) })).toBe(0);
    expect(getCardDebt({})).toBeUndefined();
  });

  it('flags an underfunded card with owed, set aside and the shortfall', () => {
    const info = getCCUnderfundedInfo({
      ...ccRow(300, -1000),
      debtBreakdown: [
        { categoryId: 1, categoryName: 'Food', month: '2026-08', amount: asMilli(600) },
        { categoryId: 2, categoryName: 'Fun', month: '2026-09', amount: asMilli(400) },
      ],
    });
    expect(info).toMatchObject({
      owed: 1000,
      setAside: 300,
      underfunded: 700,
      created: 1000,
      covered: 300,
    });
    expect(getCCOverAssigned(ccRow(300, -1000))).toBe(0);
  });

  it('treats a negative available as nothing set aside', () => {
    expect(getCCUnderfundedInfo(ccRow(-50, -100))).toMatchObject({ setAside: 0, underfunded: 100 });
  });

  it('flags an over-assigned card and never both states at once', () => {
    expect(getCCOverAssigned(ccRow(1000, -400))).toBe(600);
    expect(getCCUnderfundedInfo(ccRow(1000, -400))).toBeNull();
  });

  it('flags nothing when set aside matches the debt, or for non-CC rows', () => {
    expect(getCCUnderfundedInfo(ccRow(400, -400))).toBeNull();
    expect(getCCOverAssigned(ccRow(400, -400))).toBe(0);
    const regular = { available: asMilli(-100), cardBalance: asMilli(-500) };
    expect(getCCUnderfundedInfo(regular)).toBeNull();
    expect(getCCOverAssigned({ available: asMilli(900), cardBalance: asMilli(-500) })).toBe(0);
    // CC row without a linked card balance: nothing to compare against.
    expect(getCCUnderfundedInfo(ccRow(0))).toBeNull();
    expect(getCCOverAssigned(ccRow(100))).toBe(0);
  });
});
