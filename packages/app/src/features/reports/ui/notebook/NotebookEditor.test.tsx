import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createQuestion, type QuestionSpec, type ValueKind } from '@features/reports/lib/question';
import { NotebookEditor } from './NotebookEditor';
import type { ValueOption } from './useFieldValueOptions';

const OPTIONS: Partial<Record<ValueKind, ValueOption[]>> = {
  category: [
    { value: 100, label: 'Groceries', group: 'Living' },
    { value: 101, label: 'Rent', group: 'Living' },
  ],
  account: [{ value: 1, label: 'Checking' }],
};
const valueOptions = (kind: ValueKind) => OPTIONS[kind] ?? [];

let latest: QuestionSpec;

function Harness({ initial }: { initial: QuestionSpec }) {
  const [spec, setSpec] = useState(initial);
  return (
    <NotebookEditor
      spec={spec}
      valueOptions={valueOptions}
      onChange={(next) => {
        latest = next;
        setSpec(next);
      }}
    />
  );
}

beforeAll(() => {
  // Radix popovers/selects and cmdk need these in jsdom.
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

describe('NotebookEditor', () => {
  it('starts with the Data step, the default filter chips and add-step buttons', () => {
    render(<Harness initial={createQuestion()} />);
    expect(screen.getByRole('combobox', { name: 'Data source' })).toHaveTextContent('Transactions');
    expect(screen.getByRole('button', { name: 'Edit filter: Transfer: no' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit filter: On-budget account: yes' })
    ).toBeInTheDocument();
    const addStep = screen.getByRole('group', { name: 'Add a step' });
    expect(
      within(addStep)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Summarize', 'Sort', 'Limit']);
    expect(screen.getByRole('button', { name: /Columns \(6\)/ })).toBeInTheDocument();
  });

  it('removes a filter chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createQuestion()} />);
    await user.click(screen.getByRole('button', { name: 'Remove filter: Transfer: no' }));
    expect(latest.filters).toEqual([{ field: 'on_budget', op: 'is', values: [true] }]);
  });

  it('adds a filter: field → operator → values', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createQuestion()} />);
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Category$/ }));
    await user.click(await screen.findByRole('option', { name: /Rent/ }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add filter' })
    );
    expect(latest.filters.at(-1)).toEqual({ field: 'category', op: 'is', values: [101] });
    expect(
      screen.getByRole('button', { name: 'Edit filter: Category is Rent' })
    ).toBeInTheDocument();
  });

  it('adds a relative date filter', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createQuestion('budget')} />);
    await user.click(screen.getByRole('button', { name: /Filter/ }));
    await user.click(await screen.findByRole('option', { name: /Month$/ }));
    const amount = screen.getByRole('spinbutton', { name: 'How many' });
    await user.clear(amount);
    await user.type(amount, '6');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add filter' })
    );
    expect(latest.filters).toEqual([
      {
        field: 'month',
        op: 'previous',
        values: [],
        amount: 6,
        unit: 'day',
        includeCurrent: true,
      },
    ]);
  });

  it('summarizes: metric picker, grouping with a date bucket, then removes the step', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createQuestion()} />);
    await user.click(screen.getByRole('button', { name: /Summarize/ }));
    // The metric picker opens on its own for an empty Summarize step.
    await user.click(await screen.findByRole('option', { name: /^Spending/ }));
    expect(latest.aggregations).toEqual([{ op: 'spending' }]);

    await user.click(screen.getByRole('button', { name: 'Pick a grouping' }));
    await user.click(await screen.findByRole('option', { name: /^Date$/ }));
    expect(latest.breakouts).toEqual([{ field: 'date', bucket: 'month' }]);
    expect(screen.getByRole('combobox', { name: 'Date granularity' })).toHaveTextContent('Month');

    await user.click(screen.getByRole('button', { name: 'Remove Summarize step' }));
    expect(latest.aggregations).toEqual([]);
    expect(latest.breakouts).toEqual([]);
  });

  it('sorts by an output column and toggles the direction', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={createQuestion('transactions', {
          aggregations: [{ op: 'spending' }],
          breakouts: [{ field: 'category' }],
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: /Sort/ }));
    await user.click(await screen.findByRole('option', { name: 'Spending' }));
    expect(latest.sort).toEqual([{ column: 'spending', direction: 'desc' }]);
    await user.click(
      screen.getByRole('button', { name: 'Spending: descending. Switch to ascending' })
    );
    expect(latest.sort).toEqual([{ column: 'spending', direction: 'asc' }]);
  });

  it('sets and clears a limit', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createQuestion()} />);
    await user.click(screen.getByRole('button', { name: /Limit/ }));
    const input = screen.getByRole('spinbutton', { name: 'Maximum number of rows' });
    await user.type(input, '25');
    expect(latest.limit).toBe(25);
    await user.clear(input);
    expect(latest.limit).toBeNull();
  });

  it('adds a custom column, shows it in raw rows, then removes it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createQuestion()} />);
    await user.click(screen.getByRole('button', { name: 'Custom column' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Expression' }), {
      target: { value: 'abs([Amount])' },
    });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Size');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(latest.customColumns).toEqual([
      { id: 'expr_1', name: 'Size', expression: 'abs([amount])' },
    ]);
    expect(latest.columns).toEqual([
      'date',
      'account',
      'payee',
      'category',
      'memo',
      'amount',
      'expr_1',
    ]);
    await user.click(screen.getByRole('button', { name: 'Remove custom column: Size' }));
    expect(latest.customColumns).toBeUndefined();
    expect(latest.columns).toEqual(['date', 'account', 'payee', 'category', 'memo', 'amount']);
  });

  it('writes a custom metric from the metric picker', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createQuestion()} />);
    await user.click(screen.getByRole('button', { name: /Summarize/ }));
    await user.click(await screen.findByRole('option', { name: /Custom metric…/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Expression' }), {
      target: { value: '(Income - Spending) / Income * 100' },
    });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Savings rate');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(latest.aggregations).toEqual([
      { op: 'custom', name: 'Savings rate', expression: '(Income - Spending) / Income * 100' },
    ]);
    expect(screen.getByRole('button', { name: 'Change metric: Savings rate' })).toBeInTheDocument();
  });

  it('metric options: compare and running total need a date grouping', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={createQuestion('transactions', {
          aggregations: [{ op: 'spending' }],
          breakouts: [{ field: 'date', bucket: 'month' }],
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Options for Spending' }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Compare to previous period' })
    );
    expect(latest.aggregations).toEqual([{ op: 'spending', compare: true }]);
    await user.click(
      screen.getByRole('button', { name: 'Options for Spending vs previous period' })
    );
    await user.click(await screen.findByRole('menuitemradio', { name: 'Running total' }));
    expect(latest.aggregations).toEqual([{ op: 'spending', compare: true, modifier: 'running' }]);
    expect(
      screen.getByRole('button', {
        name: 'Change metric: Spending (running total) vs previous period',
      })
    ).toBeInTheDocument();

    // Without a date grouping, the time-series options are off.
    await user.click(screen.getByRole('button', { name: 'Remove grouping: Date' }));
    expect(latest.aggregations).toEqual([{ op: 'spending' }]);
  });
});
