import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import { recurringInitialToTransactionValues } from '@features/transactions/ui/add-transaction/recurring-form';
import { RecurringTransactionEditor } from './RecurringTransactionEditor';

/**
 * A recurring template stores a category ID. Category names aren't unique
 * (per-card payment categories are named after the card), so editing a
 * template filed under the second "Chase CC" must save the second one.
 */
const fixtures = vi.hoisted(() => ({
  categories: [
    { ID: 1, Name: 'Chase CC', BudgetID: 4 },
    { ID: 2, Name: 'Chase CC', BudgetID: 4 },
    { ID: 3, Name: 'Groceries', BudgetID: 4 },
  ],
  accounts: [
    { ID: 41, Name: 'Checking', BudgetID: 4, Currency: 'USD', Type: 'checking', OnBudget: true },
  ],
}));

vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-a' }));
vi.mock('@shared/hooks/useConnectivity', () => ({ useConnectivity: () => ({}) }));
vi.mock('@entities/currency/lib/currency-utils', () => ({}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      selectedBudget: { ID: 4, DisplayCurrency: 'USD' },
      globalLocalizer: new Intl.NumberFormat('en-US'),
    }),
  buildCurrencyLocalizer: () => null,
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useCategories: () => ({ data: fixtures.categories, isLoading: false }),
}));
vi.mock('@entities/account/api/useActiveAccounts', () => ({
  useActiveAccounts: () => ({ data: fixtures.accounts, isLoading: false }),
}));
vi.mock('@entities/label/api/useLabels', () => ({
  useLabels: () => ({ labels: [], isSuccess: true }),
}));
vi.mock('@entities/transaction/api/useTransactions', () => ({
  useDeleteTransaction: () => ({}),
  useUpsertSplits: () => ({}),
}));
vi.mock('@features/transactions/ui/add-transaction/useAutofillIntegration', () => ({
  useAutofillIntegration: () => ({
    autofillAppliedFields: new Set(),
    autofillAppliedSuggestions: [],
    resetAutofillSession: vi.fn(),
    logAutofillApplications: vi.fn(),
    payeeCategoryApplied: false,
    payeeCategorySource: null,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@features/currencies/ui/ManualRatePrompt', () => ({ ManualRatePrompt: () => null }));
vi.mock('@features/account-management/ui/AddAccountDialog', () => ({
  AddAccountDialog: () => null,
}));
vi.mock('@entities/recurring/api/useRecurringTransactions', () => ({
  useCreateRecurringTransaction: () => ({ isPending: false }),
}));
vi.mock('@features/transactions/ui/add-transaction/TransactionFormHeader', () => ({
  TransactionFormHeader: () => null,
}));
vi.mock('@features/transactions/ui/add-transaction/RecurringOptionsSection', () => ({
  RecurringOptionsSection: () => null,
}));
vi.mock('@features/transactions/ui/add-transaction/TransactionDetailsSection', () => ({
  TransactionDetailsSection: () => null,
}));
vi.mock('@features/transactions/ui/add-transaction/TransactionSplitSection', () => ({
  TransactionSplitSection: () => null,
}));
vi.mock('@features/transactions/ui/add-transaction/TransactionFormActions', () => ({
  TransactionFormActions: () => <button type="submit">Save</button>,
}));
vi.mock('@features/transactions/ui/form/DuplicateTransactionHint', () => ({
  DuplicateTransactionHint: () => null,
}));

afterEach(cleanup);

const template = {
  name: 'Card payment',
  accountId: 41,
  amount: asMilli(50_000),
  direction: 'outflow' as const,
  categoryId: 2,
  schedule: { startDate: '2026-11-01', intervalUnit: 'month' as const, intervalCount: 1 },
};

describe('recurring editor keeps the category ID', () => {
  it('maps the template category ID into the form', () => {
    expect(
      recurringInitialToTransactionValues({ ...template, categoryName: 'Chase CC' })
    ).toMatchObject({ selectedCategory: 'Chase CC', selectedCategoryId: 2 });
  });

  it('saves the second of two same-named categories', async () => {
    const onSubmit = vi.fn();
    const view = render(
      <RecurringTransactionEditor
        open
        mode="edit"
        onOpenChange={vi.fn()}
        budgetId={4}
        accounts={fixtures.accounts as never}
        categories={fixtures.categories as never}
        initialValues={template}
        onSubmit={onSubmit}
      />
    );
    fireEvent.submit(view.baseElement.querySelector('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: 2, accountId: 41 });
  });
});
