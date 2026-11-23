import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { asMilli } from '@shared/lib/currency/milli';
import { SplitEditor, type SplitLine } from './SplitEditor';

vi.mock('@entities/currency/lib/currency-utils', () => ({
  // 1 USD = 0.9 EUR on the parent's date.
  getExchangeRate: vi.fn(async (from: string, to: string) =>
    from === 'USD' && to === 'EUR' ? 0.9 : null
  ),
}));
vi.mock('@shared/ui/calculator-cell', () => ({
  CalculatorCell: ({
    value,
    onCommit,
    'data-testid': testId,
  }: {
    value: number;
    onCommit: (value: number) => void;
    'data-testid'?: string;
  }) => (
    <input
      data-testid={testId ?? 'amount'}
      defaultValue={String(value)}
      key={value}
      onBlur={(event) => onCommit(Number(event.target.value))}
    />
  ),
}));
vi.mock('@features/category-management/ui/SearchableCategorySelect', () => ({
  SearchableCategorySelect: ({
    onCategorySelect,
    includeTransfers,
  }: {
    onCategorySelect: (id: number) => void;
    includeTransfers?: boolean;
  }) => (
    <button
      type="button"
      data-transfers={String(Boolean(includeTransfers))}
      onClick={() => onCategorySelect(9)}
    >
      Pick category
    </button>
  ),
}));
vi.mock('@features/transactions/ui/cells/PayeeSelectCell', () => ({
  PayeeSelectCell: () => null,
}));

const parent = { ID: 1, Name: 'Checking', Currency: 'USD', OnBudget: true };
const accounts = [
  { ID: 2, Name: 'Savings', Currency: 'USD', OnBudget: true },
  { ID: 3, Name: 'Euro', Currency: 'EUR', OnBudget: true },
  { ID: 4, Name: 'Mortgage', Currency: 'USD', OnBudget: false },
];

const line = (fields: Partial<SplitLine>): SplitLine => ({
  id: 'a',
  memo: '',
  payee: '',
  inflow: asMilli(0),
  outflow: asMilli(100_000),
  ...fields,
});

function Harness({
  initial,
  onChange,
  templateLines,
}: {
  initial: SplitLine[];
  onChange?: (lines: SplitLine[]) => void;
  templateLines?: boolean;
}) {
  const [lines, setLines] = React.useState(initial);
  return (
    <SplitEditor
      budgetId={1}
      isSplit
      onToggleSplit={() => undefined}
      splitLines={lines}
      onSplitLinesChange={(next) => {
        setLines(next);
        onChange?.(next);
      }}
      remaining={0}
      parentAmount={-100_000}
      formatter={new Intl.NumberFormat()}
      transferAccounts={accounts}
      parentAccount={parent}
      date="2026-03-10"
      templateLines={templateLines}
    />
  );
}

describe('SplitEditor transfer lines', () => {
  it('locks the category of a transfer between on-budget accounts', () => {
    render(<Harness initial={[line({ transferAccountId: 2 })]} />);
    expect(screen.getByTestId('split-transfer-category-locked')).toHaveTextContent('Transfers');
    expect(screen.queryByText('Pick category')).toBeNull();
    expect(screen.queryByTestId('split-received-amount')).toBeNull();
  });

  it('lets a line to an off-budget account pick a category and stay a transfer', () => {
    const onChange = vi.fn();
    render(<Harness initial={[line({ transferAccountId: 4 })]} onChange={onChange} />);
    const picker = screen.getByText('Pick category');
    expect(picker).toHaveAttribute('data-transfers', 'true');
    fireEvent.click(picker);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ categoryId: 9, transferAccountId: 4 }),
    ]);
  });

  it('a category on a normal line keeps it a normal line', () => {
    const onChange = vi.fn();
    render(<Harness initial={[line({})]} onChange={onChange} />);
    fireEvent.click(screen.getByText('Pick category'));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ categoryId: 9, transferAccountId: undefined }),
    ]);
  });

  it('asks what a cross-currency line received, prefilled at the rate, and keeps a typed amount', async () => {
    const onChange = vi.fn();
    render(<Harness initial={[line({ transferAccountId: 3 })]} onChange={onChange} />);
    expect(screen.getByText('Received in Euro (EUR)')).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ receivedAmount: 90_000 }),
      ])
    );
    const input = screen.getByTestId('split-received-amount');
    fireEvent.change(input, { target: { value: '88000' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ receivedAmount: 88_000, receivedAuto: false }),
    ]);
  });

  it('an entered received amount scales with the line amount and stays entered', async () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={[line({ transferAccountId: 3, receivedAmount: 80_000, receivedAuto: false })]}
        onChange={onChange}
      />
    );
    const outflow = screen
      .getAllByTestId('amount')
      .find((input) => (input as HTMLInputElement).value === '100000')!;
    fireEvent.change(outflow, { target: { value: '150000' } });
    fireEvent.blur(outflow);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ outflow: 150_000, receivedAmount: 120_000, receivedAuto: false }),
    ]);
    // Typing one afterwards sets it exactly.
    const input = screen.getByTestId('split-received-amount');
    fireEvent.change(input, { target: { value: '110000' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ receivedAmount: 110_000, receivedAuto: false }),
    ]);
  });

  it('shows "Sent from" for an inflow line', () => {
    render(
      <Harness
        initial={[line({ transferAccountId: 3, inflow: asMilli(100_000), outflow: asMilli(0) })]}
      />
    );
    expect(screen.getByText('Sent from Euro (EUR)')).toBeInTheDocument();
  });

  it('recurring template lines keep the old shape: no received amount, no category', () => {
    render(<Harness initial={[line({ transferAccountId: 3 })]} templateLines />);
    expect(screen.queryByTestId('split-received-amount')).toBeNull();
    expect(screen.getByTestId('split-transfer-category-locked')).toBeInTheDocument();
  });
});
