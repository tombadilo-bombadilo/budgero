import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRANSACTION_TABLE_COLUMNS } from '@features/transactions/lib/table-columns';
import { TransactionColumnsMenu } from './TransactionColumnsMenu';

describe('TransactionColumnsMenu', () => {
  it('lists Payee, Memo, Label and Balance and toggles Label and Balance', async () => {
    const user = userEvent.setup();
    const onToggleLabelColumn = vi.fn();
    const onToggleBalanceColumn = vi.fn();
    render(
      <TransactionColumnsMenu
        columns={DEFAULT_TRANSACTION_TABLE_COLUMNS}
        onChange={() => {}}
        showLabelColumn
        onToggleLabelColumn={onToggleLabelColumn}
        showBalanceColumn={false}
        onToggleBalanceColumn={onToggleBalanceColumn}
      />
    );

    await user.click(screen.getByRole('button', { name: /Columns/ }));
    const items = screen.getAllByRole('menuitemcheckbox').map((el) => el.textContent);
    expect(items).toEqual(['Payee', 'Memo', 'Label', 'Balance', 'Wrap long memos']);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Label' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Balance' })).toHaveAttribute(
      'aria-checked',
      'false'
    );

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Balance' }));
    expect(onToggleBalanceColumn).toHaveBeenCalledTimes(1);
    // The menu stays open between choices.
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Label' }));
    expect(onToggleLabelColumn).toHaveBeenCalledTimes(1);
  });
});
