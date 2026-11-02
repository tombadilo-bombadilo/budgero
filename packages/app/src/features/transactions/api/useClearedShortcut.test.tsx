import { cleanup, fireEvent, render } from '@testing-library/react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useClearedShortcut } from './useClearedShortcut';

const mutate = vi.fn();
vi.mock('@entities/transaction/api/useTransactions', () => ({
  useSetTransactionsCleared: () => ({ mutate, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (ID: number, extra: Partial<GetTransactionsByAccountRow> = {}) =>
  ({ ID, Cleared: false, Reconciled: false, ...extra }) as GetTransactionsByAccountRow;

function Harness({ ids, rows }: { ids: number[]; rows: GetTransactionsByAccountRow[] }) {
  useClearedShortcut(ids, rows);
  return <input aria-label="memo" />;
}

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

describe('useClearedShortcut', () => {
  it('clears selected rows, skipping reconciled and projected ones', () => {
    render(
      <Harness
        ids={[1, 2, 3, -4]}
        rows={[
          row(1),
          row(2, { Cleared: true }),
          row(3, { Reconciled: true }),
          row(-4, { IsProjected: true }),
        ]}
      />
    );
    fireEvent.keyDown(window, { key: 'c' });
    expect(mutate).toHaveBeenCalledWith({ ids: [1, 2], cleared: true }, expect.any(Object));
  });

  it('unclears when every selected row is already cleared', () => {
    render(<Harness ids={[2]} rows={[row(2, { Cleared: true })]} />);
    fireEvent.keyDown(window, { key: 'C' });
    expect(mutate).toHaveBeenCalledWith({ ids: [2], cleared: false }, expect.any(Object));
  });

  it('ignores typing, modifiers, and empty selections', () => {
    const { getByLabelText, rerender } = render(<Harness ids={[1]} rows={[row(1)]} />);
    fireEvent.keyDown(getByLabelText('memo'), { key: 'c' });
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    rerender(<Harness ids={[]} rows={[row(1)]} />);
    fireEvent.keyDown(window, { key: 'c' });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('ignores a keydown without a key (autofill, extensions)', () => {
    render(<Harness ids={[1]} rows={[row(1)]} />);
    const event = new KeyboardEvent('keydown');
    Object.defineProperty(event, 'key', { value: undefined });
    expect(() => window.dispatchEvent(event)).not.toThrow();
    expect(mutate).not.toHaveBeenCalled();
  });
});
