import { describe, expect, it } from 'vitest';
import { detectColumnMapping, looksLikeYnabRegister } from '../src/services/import/parsing.js';
import {
  createImportNameMaps,
  resolveImportCategoryId,
} from '../src/services/import/category-resolver.js';

const YNAB_REGISTER = [
  'Account',
  'Flag',
  'Date',
  'Payee',
  'Category Group/Category',
  'Category Group',
  'Category',
  'Memo',
  'Outflow',
  'Inflow',
  'Cleared',
];

describe('column auto-detection', () => {
  it('maps the category and account columns of a YNAB register', () => {
    expect(detectColumnMapping(YNAB_REGISTER)).toMatchObject({
      date: 'Date',
      payee: 'Payee',
      memo: 'Memo',
      inflow: 'Inflow',
      outflow: 'Outflow',
      category: 'Category',
      account: 'Account',
    });
  });

  it('does not mistake a group or an account number for the category or account', () => {
    const detected = detectColumnMapping(['Date', 'Amount', 'Category Group', 'Account Number']);
    expect(detected.category).toBeUndefined();
    expect(detected.account).toBeUndefined();
  });

  it('recognises a YNAB register and nothing else', () => {
    expect(looksLikeYnabRegister(YNAB_REGISTER)).toBe(true);
    expect(looksLikeYnabRegister(['Date', 'Payee', 'Category', 'Amount', 'Account'])).toBe(false);
  });
});

describe('category resolution', () => {
  it("sends YNAB's Ready to Assign inflows to Income", async () => {
    const maps = createImportNameMaps({ categories: [], categoryGroups: [] });
    const resolve = (name: string) =>
      resolveImportCategoryId({
        columnCategory: 'Category',
        row: { Category: name },
        inflow: 100,
        incomeId: 1,
        uncategorizedId: 2,
        selectedBudgetId: 9,
        ...maps,
        addCategoryGroup: async () => 50,
        addCategory: async () => 60,
      });
    expect(await resolve('Ready to Assign')).toBe(1);
    expect(await resolve('Inflow: Ready to Assign')).toBe(1);
    expect(await resolve('To be Budgeted')).toBe(1);
  });
});
