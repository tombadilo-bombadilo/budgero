import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransferRateDialog } from './TransferRateDialog';
import { ReconciledEditConfirmHost } from '../reconciled-edit';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateAmounts: vi.fn(),
  rate: 117,
  destinationReconciled: false,
}));

vi.mock('@shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('@entities/transaction/api/useTransactions', () => ({
  useTransferRateDetails: () => ({
    data: {
      transferId: 'transfer-1',
      date: '2026-08-30',
      budgetId: 7,
      budgetCurrency: 'USD',
      source: {
        transactionId: 1,
        accountId: 10,
        accountName: 'Euro account',
        currency: 'EUR',
        amount: 100_000,
        budgetAmount: 115_000,
        budgetRate: 1.15,
        rateOverride: false,
        reconciled: false,
        cleared: false,
      },
      destination: {
        transactionId: 2,
        accountId: 11,
        accountName: 'Dinar account',
        currency: 'RSD',
        amount: 11_700_000,
        budgetAmount: 115_000,
        budgetRate: 0.0098290598,
        rateOverride: false,
        reconciled: mocks.destinationReconciled,
        cleared: mocks.destinationReconciled,
      },
      rate: mocks.rate,
      transferRateOverride: false,
      hasRateOverride: false,
      hasReconciledLeg: mocks.destinationReconciled,
    },
    isLoading: false,
  }),
  useUpdateTransferRate: () => ({ mutateAsync: mocks.update, isPending: false }),
  useUpdateTransferAmounts: () => ({ mutateAsync: mocks.updateAmounts, isPending: false }),
}));

function renderDialog() {
  return render(
    <>
      <TransferRateDialog transferId="transfer-1" />
      <ReconciledEditConfirmHost />
    </>
  );
}

/** Type a new amount into one of the dialog's amount cells and commit it. */
function typeAmount(testId: string, text: string) {
  // The calculator cell shows a display button until clicked.
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));
  const input = within(screen.getByTestId(testId)).getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('TransferRateDialog', () => {
  beforeEach(() => {
    mocks.rate = 117;
    mocks.destinationReconciled = false;
    mocks.update.mockReset().mockResolvedValue(undefined);
    mocks.updateAmounts.mockReset().mockResolvedValue(undefined);
  });

  it('distinguishes the direct transfer rate from both budget rates and edits it', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: /transfer rate/i }));

    expect(screen.getByTestId('transfer-sent-amount')).toHaveTextContent('100');
    expect(screen.getByTestId('transfer-received-amount')).toHaveTextContent('11,700');
    expect(screen.getByText('Budget valuation')).toBeInTheDocument();
    expect(screen.getByText(/1 EUR = 1.15 USD/)).toBeInTheDocument();

    const input = screen.getByLabelText('1 EUR equals');
    await user.clear(input);
    await user.type(input, '118.25');
    // The received amount follows the rate; the sent amount stays.
    expect(screen.getByTestId('transfer-received-amount')).toHaveTextContent('11,825');
    await user.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(mocks.update).toHaveBeenCalledWith({ transferId: 'transfer-1', rate: 118.25 });
    expect(mocks.updateAmounts).not.toHaveBeenCalled();
  });

  it('saves typed sent and received amounts; the rate follows them', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /transfer rate/i }));

    typeAmount('transfer-received-amount', '11000');
    expect(screen.getByLabelText('1 EUR equals')).toHaveValue('110');
    typeAmount('transfer-sent-amount', '125');
    expect(screen.getByLabelText('1 EUR equals')).toHaveValue('88');

    await user.click(screen.getByRole('button', { name: 'Save amounts' }));
    expect(mocks.updateAmounts).toHaveBeenCalledWith({
      transferId: 'transfer-1',
      sentAmount: 125_000,
      receivedAmount: 11_000_000,
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('asks before changing a transfer with a reconciled side; cancel keeps the edit unsaved', async () => {
    mocks.destinationReconciled = true;
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /transfer rate/i }));

    typeAmount('transfer-received-amount', '11000');
    await user.click(screen.getByRole('button', { name: 'Save amounts' }));
    expect(await screen.findByText('Change a reconciled amount?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.updateAmounts).not.toHaveBeenCalled();
    // The rate dialog stays open with the typed amount.
    expect(screen.getByTestId('transfer-received-amount')).toHaveTextContent('11,000');

    await user.click(screen.getByRole('button', { name: 'Save amounts' }));
    await user.click(await screen.findByRole('button', { name: 'Save and mark uncleared' }));
    expect(mocks.updateAmounts).toHaveBeenCalledWith({
      transferId: 'transfer-1',
      sentAmount: 100_000,
      receivedAmount: 11_000_000,
    });
  });

  it('does not ask when the reconciled side keeps its amount', async () => {
    mocks.destinationReconciled = true;
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /transfer rate/i }));

    typeAmount('transfer-sent-amount', '125');
    await user.click(screen.getByRole('button', { name: 'Save amounts' }));
    expect(screen.queryByText('Change a reconciled amount?')).not.toBeInTheDocument();
    expect(mocks.updateAmounts).toHaveBeenCalledWith({
      transferId: 'transfer-1',
      sentAmount: 125_000,
      receivedAmount: 11_700_000,
    });
  });

  it('refreshes the field after undo without replacing an in-progress edit', async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();

    await user.click(screen.getByRole('button', { name: /transfer rate/i }));
    const input = screen.getByLabelText('1 EUR equals');
    expect(input).toHaveValue('117');

    mocks.rate = 116;
    rerender(
      <>
        <TransferRateDialog transferId="transfer-1" />
        <ReconciledEditConfirmHost />
      </>
    );
    expect(input).toHaveValue('116');

    await user.clear(input);
    await user.type(input, '115');
    mocks.rate = 114;
    rerender(
      <>
        <TransferRateDialog transferId="transfer-1" />
        <ReconciledEditConfirmHost />
      </>
    );
    expect(input).toHaveValue('115');
  });
});
