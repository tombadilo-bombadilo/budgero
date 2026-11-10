import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import { LabelCombobox } from '@features/labels/ui/LabelCombobox';
import { getLastUsedTransactionStorageKey } from '../../lib/last-used-storage';
import { useAddTransactionForm } from './useAddTransactionForm';
import { AddTransactionForm } from './AddTransactionForm';
import type { TransactionDetailsSection } from './TransactionDetailsSection';
import type { TransactionSplitSection } from './TransactionSplitSection';

const fixtures = vi.hoisted(() => ({
  spaceId: 'space-a',
  budgetId: 4,
  labelsLoaded: true,
  labelDeleted: false,
  categories: [
    { ID: 1, Name: 'Groceries' },
    { ID: 2, Name: 'Uncategorized' },
  ],
  accounts: [
    { ID: 41, BudgetID: 4, Currency: 'USD', Type: 'checking', OnBudget: true },
    { ID: 42, BudgetID: 4, Currency: 'USD', Type: 'savings', OnBudget: true },
    { ID: 51, BudgetID: 5, Currency: 'USD', Type: 'checking', OnBudget: true },
  ],
  labels: [{ ID: 8, BudgetID: 4, Name: 'Budget A label', Color: '#22AA44', UsageCount: 0 }],
}));

vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => fixtures.spaceId }));
vi.mock('@shared/hooks/useConnectivity', () => ({ useConnectivity: () => ({}) }));
vi.mock('@entities/currency/lib/currency-utils', () => ({}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      selectedBudget: { ID: fixtures.budgetId, DisplayCurrency: 'USD' },
      globalLocalizer: new Intl.NumberFormat('en-US'),
    }),
  buildCurrencyLocalizer: () => null,
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useCategories: () => ({ data: fixtures.categories, isLoading: false }),
}));
vi.mock('@entities/account/api/useActiveAccounts', () => ({
  useActiveAccounts: (budgetId: number) => ({
    data: fixtures.accounts.filter((account) => account.BudgetID === budgetId),
    isLoading: false,
  }),
}));
vi.mock('@entities/label/api/useLabels', () => ({
  useLabels: (budgetId: number) => ({
    labels:
      fixtures.labelsLoaded && !fixtures.labelDeleted
        ? fixtures.labels.filter((label) => label.BudgetID === budgetId)
        : [],
    isSuccess: fixtures.labelsLoaded,
  }),
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
vi.mock('./TransactionFormHeader', () => ({ TransactionFormHeader: () => null }));
vi.mock('./RecurringOptionsSection', () => ({ RecurringOptionsSection: () => null }));
vi.mock('../form/DuplicateTransactionHint', () => ({ DuplicateTransactionHint: () => null }));
vi.mock('./TransactionDetailsSection', () => ({
  TransactionDetailsSection: (props: React.ComponentProps<typeof TransactionDetailsSection>) => (
    <>
      <input
        aria-label="Payee"
        value={props.payee}
        onChange={(event) => props.onPayeeChange(event.target.value)}
      />
      <input
        aria-label="Memo"
        value={props.memo}
        onChange={(event) => props.onMemoChange(event.target.value)}
      />
      <LabelCombobox
        budgetId={props.budgetId}
        value={props.selectedLabelId}
        onChange={props.onLabelChange}
      />
    </>
  ),
}));
vi.mock('./TransactionSplitSection', () => ({
  TransactionSplitSection: (props: React.ComponentProps<typeof TransactionSplitSection>) => (
    <button type="button" onClick={props.onToggleSplit}>
      {props.isSplit ? 'Split transaction' : 'Single transaction'}
    </button>
  ),
}));

function openForm(budgetId: number, selectedAccountId?: number) {
  fixtures.budgetId = budgetId;
  const save = vi.fn().mockResolvedValue(101);
  const view = renderHook(() =>
    useAddTransactionForm({
      budgetId,
      selectedAccountId,
      onAddTransaction: save,
      onAddTransfer: vi.fn(),
      onCancel: vi.fn(),
    })
  );
  return { ...view, save };
}

function remember(budgetId: number, fields: object) {
  localStorage.setItem(
    getLastUsedTransactionStorageKey(fixtures.spaceId, budgetId)!,
    JSON.stringify({ outflow: fields })
  );
}

beforeEach(() => {
  fixtures.spaceId = 'space-a';
  fixtures.labelsLoaded = true;
  fixtures.labelDeleted = false;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('add transaction defaults', () => {
  it('resets an open form, including its draft and splits, on budget and space changes', () => {
    remember(4, { payee: 'Cafe A', category: 'Groceries', accountId: '41', labelId: 8 });
    fixtures.budgetId = 4;
    const props = { onAddTransaction: vi.fn(), onAddTransfer: vi.fn(), onCancel: vi.fn() };
    const view = render(<AddTransactionForm budgetId={4} selectedAccountId={41} {...props} />);
    expect(screen.getByRole('textbox', { name: 'Payee' })).toHaveValue('Cafe A');
    expect(screen.getByRole('combobox')).toHaveTextContent('Budget A label');
    fireEvent.change(screen.getByRole('textbox', { name: 'Memo' }), {
      target: { value: 'Draft in A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Single transaction' }));
    expect(screen.getByRole('button', { name: 'Split transaction' })).toBeInTheDocument();

    fixtures.budgetId = 5;
    view.rerender(<AddTransactionForm budgetId={5} selectedAccountId={51} {...props} />);
    expect(screen.getByRole('textbox', { name: 'Payee' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Memo' })).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveTextContent('No label');
    expect(screen.getByRole('button', { name: 'Single transaction' })).toBeInTheDocument();

    fixtures.budgetId = 4;
    view.rerender(<AddTransactionForm budgetId={4} selectedAccountId={41} {...props} />);
    expect(screen.getByRole('textbox', { name: 'Payee' })).toHaveValue('Cafe A');
    fixtures.spaceId = 'space-b';
    view.rerender(<AddTransactionForm budgetId={4} selectedAccountId={41} {...props} />);
    expect(screen.getByRole('textbox', { name: 'Payee' })).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveTextContent('No label');
  });

  it('saves a labeled expense in A, then saves in B with no foreign defaults or hidden label', async () => {
    const a = openForm(4, 41);
    act(() => {
      a.result.current.form.setPayee('Cafe A');
      a.result.current.form.setCategory('Groceries');
      a.result.current.form.setLabelId(8);
      a.result.current.form.setAmount(asMilli(1000));
    });
    await act(async () => {
      await a.result.current.handleSubmit();
    });
    expect(a.save.mock.calls[0][7]).toBe(8);
    a.unmount();

    const b = openForm(5, 51);
    expect(b.result.current.form.payee).toBe('');
    expect(b.result.current.form.selectedCategory).toBe('');
    expect(b.result.current.form.selectedLabelId).toBeNull();
    act(() => {
      b.result.current.form.setCategory('Groceries');
      b.result.current.form.setAmount(asMilli(2000));
    });
    await act(async () => {
      await b.result.current.handleSubmit();
    });
    expect(b.save.mock.calls[0][6]).toBe(51);
    expect(b.save.mock.calls[0][7]).toBeNull();
    b.unmount();

    const restored = openForm(4);
    expect(restored.result.current.form).toMatchObject({
      payee: 'Cafe A',
      selectedCategory: 'Groceries',
      selectedLabelId: 8,
      selectedFromAccount: '41',
    });
  });

  it.each([8, 999])(
    'discards a foreign or deleted label (%s) before submitting',
    async (labelId) => {
      remember(5, { payee: 'Cafe B', category: 'Groceries', accountId: '51', labelId });
      const b = openForm(5, 51);
      expect(b.result.current.form.selectedLabelId).toBeNull();
      act(() => b.result.current.form.setAmount(asMilli(1000)));
      await act(async () => {
        await b.result.current.handleSubmit();
      });
      expect(b.save.mock.calls[0][7]).toBeNull();
    }
  );

  it('waits for labels to load before restoring a valid remembered label', () => {
    remember(4, { category: 'Groceries', accountId: '41', labelId: 8 });
    fixtures.labelsLoaded = false;
    const form = openForm(4, 41);
    expect(form.result.current.form.selectedLabelId).toBeNull();
    fixtures.labelsLoaded = true;
    form.rerender();
    expect(form.result.current.form.selectedLabelId).toBe(8);
  });

  it('does not restore an account or category that is no longer available', () => {
    remember(5, { category: 'Deleted category', accountId: '41', labelId: null });
    const form = openForm(5);
    expect(form.result.current.form.selectedCategory).toBe('');
    expect(form.result.current.form.selectedFromAccount).toBe('');
  });

  it('clears a label deleted while the form is open', () => {
    remember(4, { category: 'Groceries', accountId: '41', labelId: 8 });
    const form = openForm(4, 41);
    expect(form.result.current.form.selectedLabelId).toBe(8);
    fixtures.labelDeleted = true;
    form.rerender();
    expect(form.result.current.form.selectedLabelId).toBeNull();
  });

  it('keeps an explicitly preselected account ahead of the remembered account', () => {
    remember(4, { category: 'Groceries', accountId: '41', labelId: 8 });
    const form = openForm(4, 42);
    expect(form.result.current.form.selectedFromAccount).toBe('42');
  });
});

describe('split lines the form refuses', () => {
  const line = (id: string, fields: object) => ({
    id,
    inflow: asMilli(0),
    outflow: asMilli(500),
    ...fields,
  });

  async function submitSplit(lines: object[]) {
    const form = openForm(4, 41);
    act(() => {
      form.result.current.form.setAmount(asMilli(1000));
      form.result.current.setIsSplit(true);
      form.result.current.setSplitLines(lines as never);
    });
    await act(async () => {
      await form.result.current.handleSubmit();
    });
    return form;
  }

  it('saves a line that transfers to another account', async () => {
    const form = await submitSplit([
      line('a', { categoryId: 1 }),
      line('b', { transferAccountId: 42 }),
    ]);
    expect(form.save).toHaveBeenCalledTimes(1);
    expect(form.save.mock.calls[0][11]).toEqual([
      expect.objectContaining({ categoryId: 1, transferAccountId: null }),
      expect.objectContaining({ categoryId: null, transferAccountId: 42 }),
    ]);
  });

  it('refuses a line with both a category and a transfer account', async () => {
    const form = await submitSplit([
      line('a', { categoryId: 1 }),
      line('b', { categoryId: 1, transferAccountId: 42 }),
    ]);
    expect(form.save).not.toHaveBeenCalled();
  });

  it("refuses a line that transfers to the transaction's own account", async () => {
    const form = await submitSplit([
      line('a', { categoryId: 1 }),
      line('b', { transferAccountId: 41 }),
    ]);
    expect(form.save).not.toHaveBeenCalled();
  });
});
