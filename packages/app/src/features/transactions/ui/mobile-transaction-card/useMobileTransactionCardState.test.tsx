import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { useMobileTransactionCardState } from './useMobileTransactionCardState';
import { useReconciledEditConfirmStore } from '../reconciled-edit/reconciled-edit-confirm';

const state = vi.hoisted(() => ({
  splits: [] as Record<string, unknown>[],
  upsert: vi.fn(),
}));

vi.mock('@entities/transaction/api/useTransactions', () => ({
  useTransactionSplits: () => ({ data: state.splits, isLoading: false }),
  useUpsertSplits: () => ({ mutateAsync: state.upsert, isPending: false }),
  useClearSplits: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTransactionColumn: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      { ID: 1, Name: 'Checking', Currency: 'USD', OnBudget: true },
      { ID: 5, Name: 'Euro', Currency: 'EUR', OnBudget: true },
    ],
    isLoading: false,
  }),
}));
vi.mock('@entities/currency/lib/currency-utils', () => ({
  getExchangeRate: vi.fn(async () => 0.9),
}));
const core = vi.hoisted(() => ({ unlocked: [] as number[] }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({
      transactions: {
        getTransactionByID: () => ({ AccountID: 1, BudgetID: 1, Date: '2026-03-10' }),
        splitSaveUnlocksMirrors: async () => core.unlocked,
      },
      splits: {
        quoteMirrorAmounts: async (_p: unknown, lines: unknown[]) => lines.map(() => null),
      },
    }),
  }),
}));

const transaction = {
  ID: 10,
  AccountID: 1,
  Date: '2026-03-10',
  Category: 'Split',
  InflowConverted: 0,
  OutflowConverted: 10_000,
} as unknown as GetTransactionsByAccountRow;

const mirror = {
  InflowNative: 8_800,
  OutflowNative: 0,
  InflowConverted: 9_700,
  OutflowConverted: 0,
};

function setup() {
  return renderHook(() =>
    useMobileTransactionCardState({
      transaction,
      budgetId: 1,
      getPrimaryInflow: (row) => row.InflowConverted,
      getPrimaryOutflow: (row) => row.OutflowConverted,
      amountCurrency: 'converted',
    })
  );
}

describe('mobile split editor transfer lines', () => {
  beforeEach(() => {
    state.upsert.mockReset().mockResolvedValue(undefined);
    useReconciledEditConfirmStore.setState({ pending: null });
    // Budget display mode: the line amounts are in the budget currency.
    useUiStore.setState({
      selectedBudget: { ID: 1, DisplayCurrency: 'USD' } as never,
    });
  });

  it('saves the received amount of a cross-currency line and locks its category', async () => {
    state.splits = [
      {
        ID: 1,
        CategoryID: null,
        TransferAccountID: 5,
        Memo: '',
        Payee: '',
        InflowConverted: 0,
        OutflowConverted: 10_000,
        Mirror: mirror,
        MirrorPinned: true,
      },
    ];
    const { result } = setup();
    act(() => result.current.initEditSplitsFromExisting());
    const [line] = result.current.editSplits!;
    expect(result.current.splitCategoryMode(line)).toBe('transfer-locked');
    expect(result.current.splitReceivedTarget(line)?.Name).toBe('Euro');
    act(() => result.current.updateSplitLine(0, { received_amount: 8_500, received_auto: false }));
    await act(() => result.current.saveSplits());
    expect(state.upsert.mock.calls[0][0].splits[0]).toMatchObject({
      transfer_account_id: 5,
      received_amount: 8_500,
    });
  });

  it('asks before unlocking a reconciled mirror, and keeps editing when cancelled', async () => {
    state.splits = [
      {
        ID: 1,
        CategoryID: null,
        TransferAccountID: 5,
        Memo: '',
        Payee: '',
        InflowConverted: 0,
        OutflowConverted: 10_000,
        Mirror: mirror,
        MirrorPinned: true,
        MirrorReconciled: true,
      },
    ];
    core.unlocked = [99];
    const { result } = setup();
    act(() => result.current.initEditSplitsFromExisting());
    act(() => result.current.updateSplitLine(0, { received_amount: 8_500, received_auto: false }));
    let saving: Promise<void> | undefined;
    act(() => {
      saving = result.current.saveSplits();
    });
    await waitFor(() => expect(useReconciledEditConfirmStore.getState().pending?.kind).toBe('row'));
    act(() => useReconciledEditConfirmStore.getState().settle(false));
    await act(() => saving!);
    expect(state.upsert).not.toHaveBeenCalled();
    expect(result.current.editSplits).not.toBeNull();
    core.unlocked = [];
  });

  it('estimates the received amount when the line amount changes', async () => {
    state.splits = [
      {
        ID: 1,
        CategoryID: null,
        TransferAccountID: 5,
        Memo: '',
        Payee: '',
        InflowConverted: 0,
        OutflowConverted: 10_000,
        Mirror: mirror,
        MirrorPinned: false,
      },
    ];
    const { result } = setup();
    act(() => result.current.initEditSplitsFromExisting());
    expect(result.current.editSplits![0].received_amount).toBe(8_800);
    act(() => result.current.updateSplitLine(0, { outflow: 20_000 }));
    await waitFor(() => expect(result.current.editSplits![0].received_amount).toBe(18_000));
  });

  it('an untouched estimate is not sent, and a missing amount explains the disabled Save', async () => {
    state.splits = [
      {
        ID: 1,
        CategoryID: null,
        TransferAccountID: 5,
        Memo: '',
        Payee: '',
        InflowConverted: 0,
        OutflowConverted: 10_000,
        Mirror: mirror,
        MirrorPinned: false,
      },
    ];
    const { result } = setup();
    act(() => result.current.initEditSplitsFromExisting());
    await act(() => result.current.saveSplits());
    expect(state.upsert.mock.calls[0][0].splits[0]).toMatchObject({ received_amount: null });

    act(() => result.current.initEditSplitsFromExisting());
    act(() => result.current.updateSplitLine(0, { received_amount: null, received_auto: false }));
    expect(result.current.splitSaveHint).toBe('Enter the amount received in Euro');
    expect(result.current.splitSaveDisabled).toBe(true);
  });
});
