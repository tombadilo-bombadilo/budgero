/**
 * The AI categorize dialog (mounted closed by the dashboard card) loads the
 * whole ledger only while open, and waits for it before offering to analyze.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AICategorizeDialog } from './AICategorizeDialog';

const mocks = vi.hoisted(() => ({ allTransactions: vi.fn() }));

vi.mock('@entities/transaction/api/useTransactions', () => ({
  useAllTransactions: (...args: unknown[]) => mocks.allTransactions(...args),
}));
vi.mock('@features/transactions/api/useTransactionCellCommit', () => ({
  useTransactionCellCommit: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useCategories: () => ({ data: [] }),
  useCategoryGroups: () => ({ data: [] }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({ useAccounts: () => ({ data: [] }) }));
vi.mock('@features/ai/api/useLLMSettings', () => ({
  useLLMSettings: () => ({
    data: { Enabled: true, EndpointURL: 'http://llm', TextModel: 'm', Provider: 'openai' },
  }),
}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: unknown) => unknown) =>
    selector({ selectedBudget: { ID: 5, DisplayCurrency: 'USD' } }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const renderDialog = (open: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AICategorizeDialog open={open} onOpenChange={() => {}} budgetId={5} />
    </QueryClientProvider>
  );

const uncategorized = { ID: 1, CategoryID: 0, Category: null, Date: '2026-10-01', Memo: 'x' };

describe('AICategorizeDialog ledger loading', () => {
  it('does not load the ledger while closed', () => {
    mocks.allTransactions.mockReturnValue({ data: undefined, isLoading: false });
    renderDialog(false);
    expect(mocks.allTransactions).toHaveBeenCalledWith(5, { enabled: false });
  });

  it('loads it when open and waits for it before enabling Analyze', () => {
    mocks.allTransactions.mockReturnValue({ data: undefined, isLoading: true });
    const view = renderDialog(true);
    expect(mocks.allTransactions).toHaveBeenLastCalledWith(5, { enabled: true });
    expect(screen.queryByText(/^Found/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: /Analyze Transactions/ }) as HTMLButtonElement).disabled
    ).toBe(true);

    mocks.allTransactions.mockReturnValue({ data: [uncategorized], isLoading: false });
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AICategorizeDialog open onOpenChange={() => {}} budgetId={5} />
      </QueryClientProvider>
    );
    expect(screen.getByText(/^Found/).textContent).toContain('1');
    expect(
      (screen.getByRole('button', { name: /Analyze Transactions/ }) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
