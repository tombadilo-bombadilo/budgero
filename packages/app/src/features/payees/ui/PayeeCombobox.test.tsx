import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PayeeCombobox } from './PayeeCombobox';

vi.mock('@entities/payee/api/usePayees', () => ({
  usePayees: () => ({ data: [], isFetching: false }),
}));

beforeAll(() => {
  // cmdk/Radix expect these browser APIs, which jsdom lacks.
  class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollIntoView = () => {};
});

const transferAccounts = [
  { ID: 2, Name: 'Savings', OnBudget: true },
  { ID: 3, Name: 'Brokerage', OnBudget: false },
];

function setup(props: Partial<React.ComponentProps<typeof PayeeCombobox>> = {}) {
  const onChange = vi.fn();
  const onSelectTransfer = vi.fn();
  const onUnlinkTransfer = vi.fn();
  render(
    <PayeeCombobox
      budgetId={1}
      value=""
      onChange={onChange}
      payees={['Landlord']}
      onSelectTransfer={onSelectTransfer}
      onUnlinkTransfer={onUnlinkTransfer}
      {...props}
    />
  );
  return { onChange, onSelectTransfer, onUnlinkTransfer, user: userEvent.setup() };
}

describe('PayeeCombobox transfer choices', () => {
  it('lists accounts as "Transfer: Account" and marks off-budget ones', async () => {
    const { user } = setup({ transferAccounts });

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText('Transfer: Savings')).toBeInTheDocument();
    expect(screen.getByText('Transfer: Brokerage')).toBeInTheDocument();
    expect(screen.getByText('Off budget')).toBeInTheDocument();
    expect(screen.getByText('Landlord')).toBeInTheDocument();
  });

  it('reports an account pick through onSelectTransfer, not onChange', async () => {
    const { user, onChange, onSelectTransfer } = setup({ transferAccounts });

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Transfer: Savings'));

    expect(onSelectTransfer).toHaveBeenCalledExactlyOnceWith(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still treats a regular payee that matches an account name as a payee', async () => {
    const { user, onChange, onSelectTransfer } = setup({
      transferAccounts,
      payees: ['Savings'],
    });

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Savings'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('Savings');
    expect(onSelectTransfer).not.toHaveBeenCalled();
  });

  it('offers no transfer group unless transfer accounts are provided', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Transfer: Savings')).not.toBeInTheDocument();
    expect(screen.getByText('Landlord')).toBeInTheDocument();
  });

  describe('on an existing transfer', () => {
    const selected = {
      transferAccounts: [transferAccounts[0]],
      selectedTransferAccountId: 2,
      displayValue: 'Transfer: Savings',
    };

    it('shows the partner account as the current value', () => {
      setup(selected);

      expect(screen.getByRole('combobox')).toHaveTextContent('Transfer: Savings');
    });

    it('does nothing when the current partner is picked again', async () => {
      const { user, onSelectTransfer, onChange } = setup(selected);

      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getAllByText('Transfer: Savings').at(-1)!);

      expect(onSelectTransfer).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('offers to convert back and hides "Clear payee"', async () => {
      const { user, onUnlinkTransfer } = setup({ ...selected, value: 'Brokerage' });

      await user.click(screen.getByRole('combobox'));
      expect(screen.queryByText('Clear payee')).not.toBeInTheDocument();

      await user.click(screen.getByText('Convert to regular transaction'));
      expect(onUnlinkTransfer).toHaveBeenCalledTimes(1);
    });

    it('omits the convert-back action when unlinking is not allowed', async () => {
      const { user } = setup({ ...selected, onUnlinkTransfer: undefined });

      await user.click(screen.getByRole('combobox'));

      expect(screen.queryByText('Convert to regular transaction')).not.toBeInTheDocument();
    });
  });
});
