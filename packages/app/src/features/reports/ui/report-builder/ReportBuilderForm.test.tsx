import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createDefaultSpec, type ReportBuilderSpec } from '../../lib/report-builder';
import { ReportBuilderForm } from './ReportBuilderForm';
import type { BuilderFilterOptions } from './useBuilderFilterOptions';

const options: BuilderFilterOptions = {
  accounts: [
    { value: 1, label: 'Checking' },
    { value: 2, label: 'Savings' },
  ],
  categoryGroups: [{ value: 10, label: 'Living' }],
  categories: [
    { value: 100, label: 'Groceries', group: 'Living' },
    { value: 101, label: 'Rent', group: 'Living' },
  ],
  payees: [{ value: "O'Brien's", label: "O'Brien's" }],
  labels: [{ value: 5, label: 'Vacation' }],
};

let latest: ReportBuilderSpec;

function Harness({ initial }: { initial: ReportBuilderSpec }) {
  const [spec, setSpec] = useState(initial);
  return (
    <ReportBuilderForm
      spec={spec}
      options={options}
      onChange={(next) => {
        latest = next;
        setSpec(next);
      }}
    />
  );
}

beforeAll(() => {
  // Radix popovers/selects need these in jsdom.
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe('ReportBuilderForm', () => {
  it('shows the current spec', () => {
    render(<Harness initial={createDefaultSpec()} />);
    expect(screen.getByRole('combobox', { name: 'Measure' })).toHaveTextContent('Spending');
    expect(screen.getByRole('combobox', { name: 'Group by' })).toHaveTextContent('Category');
    expect(screen.getByRole('combobox', { name: 'Split by' })).toHaveTextContent('None');
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent(
      'Last 12 months'
    );
    expect(screen.getByLabelText('Show top')).toHaveValue(12);
    expect(screen.getByRole('switch', { name: 'Include transfers' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Include off-budget accounts' })).not.toBeChecked();
  });

  it('maps measure, group by and split by selections to the spec', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createDefaultSpec()} />);

    await user.click(screen.getByRole('combobox', { name: 'Measure' }));
    await user.click(await screen.findByRole('option', { name: 'Income' }));
    expect(latest.measure).toBe('income');

    await user.click(screen.getByRole('combobox', { name: 'Group by' }));
    await user.click(await screen.findByRole('option', { name: 'Month' }));
    expect(latest.groupBy).toBe('month');
    // Time axes: chronological, no Top N.
    expect(latest.limit).toBeNull();
    expect(screen.queryByLabelText('Show top')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Split by' }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByRole('option', { name: 'Month' })).not.toBeInTheDocument();
    await user.click(within(listbox).getByRole('option', { name: 'Account' }));
    expect(latest.splitBy).toBe('account');

    // Back to a category: Top N comes back with its default.
    await user.click(screen.getByRole('combobox', { name: 'Group by' }));
    await user.click(await screen.findByRole('option', { name: 'Payee' }));
    expect(latest).toMatchObject({ groupBy: 'payee', limit: 12, sort: 'valueDesc' });
  });

  it('chart type, toggles and Top N', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createDefaultSpec({ splitBy: 'month' })} />);

    await user.click(screen.getByRole('switch', { name: 'Include transfers' }));
    await user.click(screen.getByRole('switch', { name: 'Include off-budget accounts' }));
    expect(latest).toMatchObject({ includeTransfers: true, includeOffBudget: true });

    const limit = screen.getByLabelText('Show top');
    await user.clear(limit);
    expect(latest.limit).toBeNull();
    await user.type(limit, '5');
    expect(latest.limit).toBe(5);

    await user.click(screen.getByRole('radio', { name: 'Pie' }));
    expect(latest).toMatchObject({ chartType: 'pie', splitBy: null });
    expect(screen.getByRole('combobox', { name: 'Split by' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Single number' }));
    expect(latest.chartType).toBe('stat');
    expect(screen.getByRole('combobox', { name: 'Group by' })).toBeDisabled();
  });

  it('income vs spending disables pie and single number', async () => {
    render(<Harness initial={createDefaultSpec({ measure: 'incomeVsSpending' })} />);
    expect(screen.getByRole('radio', { name: 'Pie' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Single number' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Split by' })).toBeDisabled();
  });

  it('multi-select filters store ids and payee names', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createDefaultSpec()} />);

    await user.click(screen.getByRole('combobox', { name: 'Accounts: All' }));
    await user.click(await screen.findByRole('option', { name: /Savings/ }));
    expect(latest.filters.accountIds).toEqual([2]);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('combobox', { name: 'Payees: All' }));
    await user.click(await screen.findByRole('option', { name: /O'Brien's/ }));
    expect(latest.filters.payees).toEqual(["O'Brien's"]);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Clear Accounts filter' }));
    expect(latest.filters.accountIds).toEqual([]);
  });

  it('custom date range shows from / to pickers', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createDefaultSpec()} />);
    await user.click(screen.getByRole('combobox', { name: 'Date range' }));
    await user.click(await screen.findByRole('option', { name: 'Custom range' }));
    expect(latest.dateRange).toEqual({ preset: 'custom' });
    expect(screen.getByRole('group', { name: 'From' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'To' })).toBeInTheDocument();
  });
});
