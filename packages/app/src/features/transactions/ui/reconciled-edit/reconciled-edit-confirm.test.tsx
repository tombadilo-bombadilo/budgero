import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  columnEditUnlocksReconciled,
  confirmColumnEdit,
  confirmReconciledEdit,
  confirmTotalEdit,
  useReconciledEditConfirmStore,
  confirmSplitSave,
} from './reconciled-edit-confirm';
import { ReconciledEditConfirmHost } from './ReconciledEditConfirmHost';

const preview = vi.fn();
const services = { transactions: { reconciledRowsUnlockedByEdit: preview } };

describe('reconciled edit confirm', () => {
  beforeEach(() => {
    preview.mockReset().mockReturnValue([]);
    useReconciledEditConfirmStore.setState({ pending: null });
  });

  it('only asks when the edit would unlock a reconciled row', async () => {
    expect(columnEditUnlocksReconciled(services, 1, 'OutflowNative', 2000)).toBe(false);
    await expect(confirmColumnEdit(services, 1, 'OutflowNative', 2000)).resolves.toBe(true);
    expect(useReconciledEditConfirmStore.getState().pending).toBeNull();

    preview.mockReturnValue([1]);
    expect(columnEditUnlocksReconciled(services, 1, 'OutflowNative', 2000)).toBe(true);
    expect(preview).toHaveBeenCalledWith(1, 'OutflowNative', 2000);
    // Without the preview (older services) or when it throws: no question.
    expect(columnEditUnlocksReconciled({}, 1, 'OutflowNative', 2000)).toBe(false);
    preview.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(columnEditUnlocksReconciled(services, 1, 'OutflowNative', 2000)).toBe(false);
  });

  it('checks both sides of a new split total', async () => {
    preview.mockImplementation((_id, column) => (column === 'InflowNative' ? [7] : []));
    const answer = confirmTotalEdit(services, 7, { inflow: 500, outflow: 0 }, 'native');
    expect(useReconciledEditConfirmStore.getState().pending?.kind).toBe('row');
    act(() => useReconciledEditConfirmStore.getState().settle(true));
    await expect(answer).resolves.toBe(true);
    expect(preview).toHaveBeenCalledWith(7, 'InflowNative', 500);

    preview.mockReturnValue([]);
    await expect(
      confirmTotalEdit(services, 7, { inflow: 0, outflow: 500 }, 'converted')
    ).resolves.toBe(true);
    expect(preview).toHaveBeenCalledWith(7, 'OutflowConverted', 500);
  });

  it('the dialog answers: cancel aborts, confirm goes ahead', async () => {
    const user = userEvent.setup();
    render(<ReconciledEditConfirmHost />);

    let answer: Promise<boolean>;
    act(() => {
      answer = confirmReconciledEdit('row');
    });
    expect(await screen.findByText('Change a reconciled amount?')).toBeInTheDocument();
    expect(screen.getByText(/marks it as uncleared/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(answer!).resolves.toBe(false);

    act(() => {
      answer = confirmReconciledEdit('transfer');
    });
    expect(await screen.findByText(/This transfer has a reconciled side/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save and mark uncleared' }));
    await expect(answer!).resolves.toBe(true);
    expect(useReconciledEditConfirmStore.getState().pending).toBeNull();
  });

  it('a newer question drops an unanswered one', async () => {
    const first = confirmReconciledEdit('row');
    const second = confirmReconciledEdit('row');
    await expect(first).resolves.toBe(false);
    useReconciledEditConfirmStore.getState().settle(true);
    await expect(second).resolves.toBe(true);
  });

  it('a split save asks when the core reports a reconciled mirror it changes or removes', async () => {
    const splitSaveUnlocksMirrors = vi.fn(async () => [12]);
    const quoteMirrorAmounts = vi.fn(async () => [
      { InflowNative: 900, OutflowNative: 0, InflowConverted: 1000, OutflowConverted: 0 },
    ]);
    const services = {
      transactions: {
        getTransactionByID: () => ({ AccountID: 1, BudgetID: 1, Date: '2026-03-10' }),
        splitSaveUnlocksMirrors,
      },
      splits: { quoteMirrorAmounts },
    } as never;
    const lines = [{ transfer_account_id: 5, inflow: 0, outflow: 1000, received_amount: 900 }];
    let answer: Promise<boolean> | undefined;
    await act(async () => {
      answer = confirmSplitSave(services, 7, undefined, 'converted', lines);
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(useReconciledEditConfirmStore.getState().pending?.kind).toBe('row')
    );
    act(() => useReconciledEditConfirmStore.getState().settle(false));
    await expect(answer).resolves.toBe(false);
    // The typed amount reaches the core check as the mirror's exact amounts.
    expect(splitSaveUnlocksMirrors).toHaveBeenCalledWith(7, {
      splits: [
        expect.objectContaining({
          TransferAccountID: 5,
          Mirror: expect.objectContaining({ InflowNative: 900 }),
        }),
      ],
    });

    splitSaveUnlocksMirrors.mockResolvedValueOnce([]);
    await expect(confirmSplitSave(services, 7, undefined, 'converted', lines)).resolves.toBe(true);
  });

  it('a missing rate for an entered amount fails the check before anything is written', async () => {
    const services = {
      transactions: {
        getTransactionByID: () => ({ AccountID: 1, BudgetID: 1, Date: '2026-03-10' }),
        splitSaveUnlocksMirrors: vi.fn(async () => []),
      },
      splits: {
        quoteMirrorAmounts: vi.fn(async () => {
          throw Object.assign(new Error('no rate'), {
            code: 'SPLIT_MIRROR_RATE_MISSING',
            fromCurrency: 'GBP',
            toCurrency: 'USD',
          });
        }),
      },
    } as never;
    const lines = [{ transfer_account_id: 5, inflow: 0, outflow: 1000, received_amount: 900 }];
    await expect(confirmSplitSave(services, 7, undefined, 'converted', lines)).rejects.toThrow(
      'Add a GBP to USD exchange rate to save this received amount.'
    );
  });
});
