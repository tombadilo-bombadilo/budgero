import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  columnEditUnlocksReconciled,
  confirmColumnEdit,
  confirmReconciledEdit,
  confirmTotalEdit,
  useReconciledEditConfirmStore,
  splitLinesUnlockMirrors,
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

  it('split lines unlock a reconciled mirror only when its amount changes', () => {
    const line = { mirror_reconciled: true, mirror_received: 900, received_base: 1000 };
    expect(splitLinesUnlockMirrors([{ line, lineAmount: 1000, received: 900 }])).toBe(false);
    expect(splitLinesUnlockMirrors([{ line, lineAmount: 1000, received: 850 }])).toBe(true);
    // Same-currency line: the mirror follows the line amount.
    expect(splitLinesUnlockMirrors([{ line, lineAmount: 1000, received: null }])).toBe(false);
    expect(splitLinesUnlockMirrors([{ line, lineAmount: 1200, received: null }])).toBe(true);
    expect(
      splitLinesUnlockMirrors([
        { line: { ...line, mirror_reconciled: false }, lineAmount: 1200, received: 1 },
      ])
    ).toBe(false);
  });
});
