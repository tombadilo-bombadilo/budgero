import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import { RecurringTransactionEditor } from './RecurringTransactionEditor';

/**
 * Recurring templates keep their split lines (#118): the shared form shows the
 * split editor in recurring mode, starts from the template's lines and
 * submits them with the template.
 */
const fixtures = vi.hoisted(() => ({
  categories: [
    { ID: 1, Name: 'Chase CC', BudgetID: 4 },
    { ID: 2, Name: 'Chase CC', BudgetID: 4 },
    { ID: 3, Name: 'Groceries', BudgetID: 4 },
  ],
  accounts: [
    { ID: 41, Name: 'Checking', BudgetID: 4, Currency: 'USD', Type: 'checking', OnBudget: true },
    { ID: 42, Name: 'Savings', BudgetID: 4, Currency: 'USD', Type: 'savings', OnBudget: true },
  ],
  splitSection: null as Record<string, unknown> | null,
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
  TransactionSplitSection: (props: Record<string, unknown>) => {
    fixtures.splitSection = props;
    return null;
  },
}));
vi.mock('@features/transactions/ui/add-transaction/TransactionFormActions', () => ({
  TransactionFormActions: () => <button type="submit">Save</button>,
}));
vi.mock('@features/transactions/ui/form/DuplicateTransactionHint', () => ({
  DuplicateTransactionHint: () => null,
}));

afterEach(cleanup);

const lines = [
  {
    categoryId: 3,
    transferAccountId: null,
    memo: 'food',
    payee: '',
    inflow: asMilli(0),
    outflow: asMilli(30_000),
  },
  {
    categoryId: null,
    transferAccountId: 42,
    memo: '',
    payee: '',
    inflow: asMilli(0),
    outflow: asMilli(20_000),
  },
];

const template = {
  name: 'Payday',
  accountId: 41,
  amount: asMilli(50_000),
  direction: 'outflow' as const,
  categoryId: null,
  schedule: { startDate: '2026-11-01', intervalUnit: 'month' as const, intervalCount: 1 },
};

function renderEditor(
  mode: 'create' | 'edit',
  initialValues: Record<string, unknown>,
  onSubmit = vi.fn()
) {
  const view = render(
    <RecurringTransactionEditor
      open
      mode={mode}
      onOpenChange={vi.fn()}
      budgetId={4}
      accounts={fixtures.accounts as never}
      categories={fixtures.categories as never}
      initialValues={initialValues as never}
      onSubmit={onSubmit}
    />
  );
  return { onSubmit, submit: () => fireEvent.submit(view.baseElement.querySelector('form')!) };
}

describe('recurring editor with split lines', () => {
  it('starts from the template lines and saves them', async () => {
    const { onSubmit, submit } = renderEditor('edit', { ...template, splits: lines });

    expect(fixtures.splitSection).toMatchObject({ isSplit: true, isTransfer: false });
    expect(fixtures.splitSection!.splitLines).toMatchObject(lines);
    // Transfer lines can target any other account.
    expect((fixtures.splitSection!.transferAccounts as { ID: number }[]).map((a) => a.ID)).toEqual([
      42,
    ]);

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      categoryId: null,
      amount: 50_000,
      direction: 'outflow',
      splits: lines,
    });
  });

  it('submits lines entered in recurring mode', async () => {
    const { onSubmit, submit } = renderEditor('create', { ...template, categoryId: 3 });
    expect(fixtures.splitSection).toMatchObject({ isSplit: false });

    act(() => (fixtures.splitSection!.onToggleSplit as () => void)());
    act(() =>
      (fixtures.splitSection!.onSplitLinesChange as (value: unknown) => void)(
        lines.map((line, index) => ({ ...line, id: `line-${index}` }))
      )
    );
    expect(fixtures.splitSection).toMatchObject({ isSplit: true, remaining: 0 });

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: null, splits: lines });
  });

  it('does not submit lines that do not add up', async () => {
    const { onSubmit, submit } = renderEditor('edit', {
      ...template,
      splits: [lines[0], { ...lines[1], outflow: asMilli(10_000) }],
    });
    submit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('plain templates submit no lines', async () => {
    const { onSubmit, submit } = renderEditor('edit', { ...template, categoryId: 3 });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: 3, splits: null });
  });
});
