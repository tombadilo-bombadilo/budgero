import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import { resolveCategoryId } from '../../lib/category-selection';
import { useAddTransactionForm } from './useAddTransactionForm';
import { TransactionDetailsSection } from './TransactionDetailsSection';

/**
 * Category names aren't unique: a card's payment category is named after the
 * card, so a budget can hold two "Chase CC". Picking the second must save the
 * second.
 */
const fixtures = vi.hoisted(() => ({
  categories: [
    { ID: 1, Name: 'Chase CC' },
    { ID: 2, Name: 'Chase CC' },
    { ID: 3, Name: 'Groceries' },
    { ID: 4, Name: 'Transfers' },
  ],
  accounts: [
    { ID: 41, Name: 'Checking', BudgetID: 4, Currency: 'USD', Type: 'checking', OnBudget: true },
    {
      ID: 42,
      Name: 'Brokerage',
      BudgetID: 4,
      Currency: 'USD',
      Type: 'investment',
      OnBudget: false,
    },
  ],
}));

vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-a' }));
vi.mock('@shared/hooks/useConnectivity', () => ({
  useConnectivity: () => ({ clerkToken: 'x', apiReachable: true }),
}));
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
vi.mock('./useAutofillIntegration', () => ({
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

// The picker itself: one button per category, reporting the picked ID.
vi.mock('@features/category-management/ui/SearchableCategorySelect', () => ({
  SearchableCategorySelect: (props: {
    selectedCategoryId: number | null;
    onCategorySelect: (id: number) => void;
  }) => (
    <div data-testid="picker" data-selected={props.selectedCategoryId ?? ''}>
      {fixtures.categories.map((category) => (
        <button
          key={category.ID}
          type="button"
          onClick={() => props.onCategorySelect(category.ID)}
        >{`${category.Name} #${category.ID}`}</button>
      ))}
    </div>
  ),
}));
vi.mock('@features/payees/ui/PayeeCombobox', () => ({ PayeeCombobox: () => null }));
vi.mock('@features/labels/ui/LabelCombobox', () => ({ LabelCombobox: () => null }));
vi.mock('../form', () => ({
  TransactionTypeSelector: () => null,
  AmountInput: () => null,
  DatePickerQuick: () => null,
  FromAccountSelect: () => null,
  ToAccountSelect: () => null,
  CurrencyConversionNotice: () => null,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function openForm(selectedAccountId = 41) {
  const save = vi.fn().mockResolvedValue(101);
  const addTransfer = vi.fn().mockResolvedValue({});
  const view = renderHook(() =>
    useAddTransactionForm({
      budgetId: 4,
      selectedAccountId,
      onAddTransaction: save,
      onAddTransfer: addTransfer,
      onCancel: vi.fn(),
      disableLastUsed: true,
    })
  );
  return { ...view, save, addTransfer };
}

describe('category is resolved by ID, not name', () => {
  it('resolveCategoryId prefers a known ID over the first same-named category', () => {
    expect(resolveCategoryId(fixtures.categories, 'Chase CC', 2)).toBe(2);
    expect(resolveCategoryId(fixtures.categories, 'Chase CC', null, 2)).toBe(2);
    // Stale ID (deleted, or renamed away): fall back to the name.
    expect(resolveCategoryId(fixtures.categories, 'Groceries', 99)).toBe(3);
    expect(resolveCategoryId(fixtures.categories, 'Groceries', 2)).toBe(3);
    expect(resolveCategoryId(fixtures.categories, 'Missing')).toBeNull();
    expect(resolveCategoryId(fixtures.categories, '')).toBeNull();
  });

  it('the picker reports the picked ID and shows it as selected', () => {
    const onCategoryChange = vi.fn();
    const props = {
      budgetId: 4,
      amount: null,
      amountTouched: false,
      currencyCode: 'USD',
      transactionType: 'outflow' as const,
      amountInputNonce: 0,
      amountFocusSignal: 0,
      globalLocalizer: new Intl.NumberFormat('en-US'),
      onAmountCommit: vi.fn(),
      onAmountTouched: vi.fn(),
      onAmountEditingChange: vi.fn(),
      onTransactionTypeChange: vi.fn(),
      transactionDate: null,
      dateOpen: false,
      onDateOpenChange: vi.fn(),
      onDateChange: vi.fn(),
      selectedFromAccount: '41',
      selectedToAccount: '',
      onFromAccountChange: vi.fn(),
      onToAccountChange: vi.fn(),
      accounts: fixtures.accounts,
      accountsLoading: false,
      isTransfer: false,
      needsCurrencyConversion: false,
      convertedAmount: null,
      isLoadingRate: false,
      selectedAccount: undefined,
      toAccount: null,
      canUseCurrencyApi: true,
      receivedAmount: null,
      onReceivedAmountChange: vi.fn(),
      transferInvolvesOffBudget: false,
      payee: '',
      onPayeeChange: vi.fn(),
      selectedLabelId: null,
      onLabelChange: vi.fn(),
      onCategoryChange,
      categories: fixtures.categories,
      categoriesLoading: false,
      isSplit: false,
      memo: '',
      onMemoChange: vi.fn(),
    };
    const view = render(<TransactionDetailsSection {...props} selectedCategory="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Chase CC #2' }));
    expect(onCategoryChange).toHaveBeenCalledWith('Chase CC', 2);

    view.rerender(
      <TransactionDetailsSection {...props} selectedCategory="Chase CC" selectedCategoryId={2} />
    );
    expect(screen.getByTestId('picker')).toHaveAttribute('data-selected', '2');
  });

  it('saves the second of two same-named categories', async () => {
    const form = openForm();
    act(() => {
      form.result.current.form.setCategory('Chase CC', 2);
      form.result.current.form.setAmount(asMilli(25_000));
    });
    await act(async () => {
      await form.result.current.handleSubmit();
    });
    expect(form.save).toHaveBeenCalledTimes(1);
    expect(form.save.mock.calls[0][1]).toBe(2);
  });

  it('puts the picked category ID on the on-budget leg of an off-budget transfer', async () => {
    const form = openForm();
    act(() => {
      form.result.current.form.setTransactionType('transfer');
      form.result.current.form.setToAccount('42');
      form.result.current.form.setCategory('Chase CC', 2);
      form.result.current.form.setAmount(asMilli(25_000));
    });
    await act(async () => {
      await form.result.current.handleSubmit();
    });
    expect(form.addTransfer).toHaveBeenCalledTimes(1);
    const request = form.addTransfer.mock.calls[0][0];
    expect(request.source.categoryId).toBe(2);
    expect(request.destination.categoryId).toBe(4);
  });
});
