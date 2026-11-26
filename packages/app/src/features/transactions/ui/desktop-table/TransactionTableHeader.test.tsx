import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransactionSortState } from '@features/transactions/lib/transaction-sort';
import { TransactionTableHeader } from './TransactionTableHeader';
import type { ColumnWidths } from './useColumnResize';

const widths = new Proxy({} as ColumnWidths, { get: () => 100 });

function renderHeader(sort: TransactionSortState = null, extra = {}) {
  const onSortChange = vi.fn();
  const onResize = vi.fn();
  render(
    <table>
      <TransactionTableHeader
        allPageRowsSelected={false}
        somePageRowsSelected={false}
        onToggleSelectPage={vi.fn()}
        columnWidths={widths}
        onResize={onResize}
        sort={sort}
        onSortChange={onSortChange}
        showBalanceColumn
        {...extra}
      />
    </table>
  );
  return { onSortChange, onResize };
}

const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });
const sortButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('TransactionTableHeader sorting', () => {
  afterEach(cleanup);

  it('sorts the clicked column', () => {
    const { onSortChange } = renderHeader();
    fireEvent.click(sortButton('Payee'));
    expect(onSortChange).toHaveBeenCalledWith('payee');
    fireEvent.click(sortButton('Outflow'));
    expect(onSortChange).toHaveBeenLastCalledWith('amount');
    fireEvent.click(sortButton('Status'));
    expect(onSortChange).toHaveBeenLastCalledWith('status');
  });

  it('is keyboard operable with Enter and Space', async () => {
    const user = userEvent.setup();
    const { onSortChange } = renderHeader();
    sortButton('Memo').focus();
    await user.keyboard('{Enter}');
    expect(onSortChange).toHaveBeenCalledWith('memo');
    sortButton('Category').focus();
    await user.keyboard(' ');
    expect(onSortChange).toHaveBeenLastCalledWith('category');
  });

  it('marks only the sorted column with aria-sort', () => {
    renderHeader({ column: 'payee', direction: 'desc' });
    expect(header('Payee')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Date')).not.toHaveAttribute('aria-sort');
    cleanup();
    renderHeader({ column: 'date', direction: 'asc' });
    expect(header('Date')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Payee')).not.toHaveAttribute('aria-sort');
  });

  it('does not sort the running balance', () => {
    renderHeader();
    expect(header('Balance')).not.toHaveAttribute('aria-sort');
    expect(screen.queryByRole('button', { name: /^Balance/ })).toBeNull();
  });

  it('shows the account column sort only when the column is shown', () => {
    renderHeader(null, { hideAccountColumn: true });
    expect(screen.queryByRole('button', { name: /^Account/ })).toBeNull();
    cleanup();
    const { onSortChange } = renderHeader();
    fireEvent.click(sortButton('Account'));
    expect(onSortChange).toHaveBeenCalledWith('account');
  });

  it('resizing a column never starts a sort', () => {
    const { onSortChange, onResize } = renderHeader();
    const handle = header('Payee').querySelector('[aria-label="Resize column"]')!;
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.click(handle);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith('payee', 40);
    expect(onResize).toHaveBeenCalledWith('payee', 10);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('hides the Memo and Payee columns when they are switched off', () => {
    renderHeader(null, { showMemoColumn: false });
    expect(screen.queryByRole('button', { name: /^Memo/ })).toBeNull();
    expect(sortButton('Payee')).toBeInTheDocument();
    cleanup();
    renderHeader(null, { showPayeeColumn: false });
    expect(screen.queryByRole('button', { name: /^Payee/ })).toBeNull();
    expect(sortButton('Memo')).toBeInTheDocument();
  });
});
