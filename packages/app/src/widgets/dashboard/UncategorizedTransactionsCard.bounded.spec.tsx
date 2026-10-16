/**
 * The dashboard's uncategorized card reads the newest rows and the counts
 * (not the whole ledger), and its AI dialog loads the ledger only when opened.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UncategorizedTransactionsCard } from './UncategorizedTransactionsCard';

const mocks = vi.hoisted(() => ({
  recent: vi.fn(),
  counts: vi.fn(),
  allTransactions: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock('@entities/transaction/api/useUncategorizedTransactions', () => ({
  useRecentUncategorizedTransactions: (budgetId: number, limit: number) =>
    mocks.recent(budgetId, limit),
  useUncategorizedTransactions: (budgetId: number) => mocks.counts(budgetId),
}));
vi.mock('@entities/transaction/api/useTransactions', () => ({
  useAllTransactions: (...args: unknown[]) => mocks.allTransactions(...args),
  useDeleteTransaction: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('@features/transactions/api/useTransactionCellCommit', () => ({
  useTransactionCellCommit: () => ({ mutate: vi.fn() }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({ data: [{ ID: 7, Name: 'Checking' }] }),
}));
vi.mock('@features/ai/api/useLLMSettings', () => ({
  useLLMSettings: () => ({ data: { Enabled: true } }),
}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: unknown) => unknown) =>
    selector({ accountLocalizer: null, privacyMaskNumbers: false }),
}));
vi.mock('@features/transactions/ui/TransactionQuickViewDialog', () => ({
  TransactionQuickViewDialog: () => null,
}));
vi.mock('@features/transactions/ui/DeleteTransactionDialog', () => ({
  DeleteTransactionDialog: () => null,
}));
vi.mock('@features/ai/ui/AICategorizeDialog', () => ({
  AICategorizeDialog: (props: { open: boolean }) => {
    mocks.dialog(props);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const row = (ID: number, Date: string, Memo: string) => ({
  ID,
  Date,
  Memo,
  AccountId: 7,
  AccountName: 'Checking',
  CategoryID: 1,
  Category: 'Uncategorized',
  InflowConverted: 0,
  OutflowConverted: 12_500,
  RunningBalanceConverted: 0,
});

describe('UncategorizedTransactionsCard', () => {
  it('lists the newest rows and the full count without loading the ledger', () => {
    mocks.recent.mockReturnValue({
      data: [row(3, '2026-10-12', 'Coffee'), row(2, '2026-10-02', 'Books')],
      isLoading: false,
    });
    mocks.counts.mockReturnValue({ data: { total: 14, byAccount: {} }, isLoading: false });
    render(
      <UncategorizedTransactionsCard
        budgetId={5}
        globalLocalizer={new Intl.NumberFormat('en-US')}
      />
    );
    expect(mocks.recent).toHaveBeenCalledWith(5, 6);
    expect(mocks.counts).toHaveBeenCalledWith(5);
    expect(mocks.allTransactions).not.toHaveBeenCalled();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Coffee');
    expect(items[1]).toContain('Books');
    expect(screen.getByText('14 transactions waiting')).toBeTruthy();
    expect(mocks.dialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }));
  });

  it('shows the empty state when nothing is uncategorized', () => {
    mocks.recent.mockReturnValue({ data: [], isLoading: false });
    mocks.counts.mockReturnValue({ data: { total: 0, byAccount: {} }, isLoading: false });
    render(
      <UncategorizedTransactionsCard
        budgetId={5}
        globalLocalizer={new Intl.NumberFormat('en-US')}
      />
    );
    expect(screen.getByText('Great job! No uncategorised transactions left.')).toBeTruthy();
    expect(screen.getByText('All caught up')).toBeTruthy();
  });
});
