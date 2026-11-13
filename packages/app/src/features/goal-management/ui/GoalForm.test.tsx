import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalType, GoalPurpose, type Goal } from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';
import { GoalForm } from './GoalForm';

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const yearlyGoal: Goal = {
  ID: 7,
  Type: GoalType.TARGET_DATE,
  Purpose: GoalPurpose.SAVINGS,
  CategoryID: 3,
  Target: asMilli(300_000),
  StartDate: '2026-01-01',
  TargetDate: '2026-12-31',
  Recurring: true,
  CycleMonths: null,
};

const quarterlyGoal: Goal = {
  ...yearlyGoal,
  ID: 8,
  StartDate: '2026-08-18',
  TargetDate: '2026-10-31',
  CycleMonths: 3,
};

function renderForm(goal: Goal | null, onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <GoalForm
      goal={goal}
      categoryId={3}
      categoryName="Insurance"
      budgetId={1}
      currentMonth="2026-08"
      formatter={formatter}
      onSave={onSave}
      onCancel={() => {}}
    />
  );
  return onSave;
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /save|update|create/i }));

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('GoalForm — yearly presets', () => {
  it('pre-fills "Every year" for a legacy recurring goal and can switch to Never', async () => {
    const user = userEvent.setup();
    const onSave = renderForm(yearlyGoal);
    expect(screen.getByTestId('goal-repeat-select')).toHaveTextContent('Every year');
    expect(screen.getByTestId('goal-cycle-preview')).toHaveTextContent('Jan 2026 – Dec 2026');

    await user.click(screen.getByTestId('goal-repeat-select'));
    await user.click(await screen.findByRole('option', { name: /never/i }));
    expect(screen.queryByTestId('goal-cycle-preview')).not.toBeInTheDocument();
    await submit(user);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ Recurring: false, CycleMonths: null });
  });
});

describe('GoalForm — periodic presets', () => {
  it('a quarterly goal opens on the periodic preset with its start date and cadence', () => {
    renderForm(quarterlyGoal);
    expect(screen.getByText('Periodic Allocation Target')).toBeInTheDocument();
    expect(screen.getByTestId('goal-period-select')).toHaveTextContent('Quarter');
    expect(screen.getByTestId('goal-period-start')).toHaveTextContent('August 18th, 2026');
    // First cycle = start month + 3 months, viewed in Aug 2026
    expect(screen.getByTestId('goal-cycle-preview')).toHaveTextContent('Aug 2026 – Oct 2026');
    expect(screen.getByTestId('goal-cycle-preview')).toHaveTextContent('October 31st, 2026');
  });

  it('creating a periodic goal derives the target date from start + cadence and saves cadence', async () => {
    const user = userEvent.setup();
    const onSave = renderForm(null);
    await user.click(screen.getByText('Periodic Allocation Target'));
    // Amount (calculator cell: click the display, type, commit with Enter)
    await user.click(screen.getByText('Enter amount'));
    await user.keyboard('300{Enter}');
    // Cadence → 6 months
    await user.click(screen.getByTestId('goal-period-select'));
    await user.click(await screen.findByRole('option', { name: /6 months/i }));
    expect(screen.getByTestId('goal-cycle-preview')).toHaveTextContent('Repeats every 6 months');

    await submit(user);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Partial<Goal>;
    expect(saved).toMatchObject({
      Type: GoalType.TARGET_DATE,
      Recurring: true,
      CycleMonths: 6,
      StartDate: localToday(),
    });
    // Target date = last day of (start month + 5)
    const start = new Date();
    const expectedEnd = new Date(start.getFullYear(), start.getMonth() + 6, 0);
    expect(new Date(saved.TargetDate as string).getTime()).toBe(expectedEnd.getTime());
  });

  it('custom cadence: native validation blocks < 2, valid value is saved', async () => {
    const user = userEvent.setup();
    const onSave = renderForm(quarterlyGoal);
    await user.click(screen.getByTestId('goal-period-select'));
    await user.click(await screen.findByRole('option', { name: /n months/i }));
    const input = await screen.findByTestId('goal-repeat-custom-input');
    await user.type(input, '1');
    expect((input as HTMLInputElement).validity.valid).toBe(false);
    await submit(user);
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '4');
    expect(screen.getByTestId('goal-cycle-preview')).toHaveTextContent('Repeats every 4 months');
    await submit(user);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ Recurring: true, CycleMonths: 4 });
  });

  it('creates a target balance goal with no date and no repeat', async () => {
    const user = userEvent.setup();
    const onSave = renderForm(null);
    await user.click(screen.getByText('Target Balance'));
    expect(screen.queryByText('Target Date')).not.toBeInTheDocument();
    await user.click(screen.getByText('Enter amount'));
    await user.keyboard('5000{Enter}');

    await submit(user);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Partial<Goal>;
    expect(saved).toMatchObject({
      Type: GoalType.TARGET_BALANCE,
      Purpose: GoalPurpose.SAVINGS,
      Recurring: false,
      CycleMonths: null,
    });
    expect(saved.TargetDate).toBeUndefined();
  });
});

describe('GoalForm — compact type picker', () => {
  const titles = [
    'Monthly Available Target',
    'Monthly Allocation Target',
    'Yearly Available Target',
    'Yearly Allocation Target',
    'Periodic Available Target',
    'Periodic Allocation Target',
    'Target Balance',
  ];

  it('create: lists every type in pairs, one line each, the example only on the chosen one', () => {
    renderForm(null);
    const rows = screen
      .getAllByRole('button', { pressed: undefined })
      .filter((b) => b.dataset.testid?.startsWith('goal-preset-'));
    expect(rows.map((r) => r.querySelector('span > span')?.textContent)).toEqual(titles);
    expect(screen.getByTestId('goal-preset-monthly-available')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const examples = screen.getAllByTestId('goal-preset-example');
    expect(examples).toHaveLength(1);
    expect(examples[0]).toHaveTextContent('e.g. Groceries — start each month with X');
    expect(screen.getByTestId('goal-preset-monthly-available')).toContainElement(examples[0]);
  });

  it('picking a type collapses the list to it, shows its example and its fields', async () => {
    const user = userEvent.setup();
    renderForm(null);
    expect(screen.queryByText('Target Date')).not.toBeInTheDocument();
    await user.click(screen.getByText('Yearly Available Target'));

    const selected = screen.getByTestId('goal-preset-selected');
    expect(selected).toHaveTextContent('Yearly Available Target');
    expect(selected).toHaveTextContent('e.g. Car registration — need X ready by');
    expect(screen.queryByText('Monthly Available Target')).not.toBeInTheDocument();
    expect(screen.getByText('Target Date')).toBeInTheDocument();
    expect(screen.getByText('Enter amount')).toBeInTheDocument();
  });

  it('Change type reopens the list and a new pick replaces the fields', async () => {
    const user = userEvent.setup();
    const onSave = renderForm(null);
    await user.click(screen.getByText('Yearly Available Target'));
    await user.click(screen.getByRole('button', { name: 'Change type' }));
    for (const title of titles) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByTestId('goal-preset-yearly-available')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(screen.getByText('Monthly Allocation Target'));
    expect(screen.queryByText('Target Date')).not.toBeInTheDocument();
    await user.click(screen.getByText('Enter amount'));
    await user.keyboard('200{Enter}');
    await submit(user);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      Type: GoalType.MONTHLY_SAVINGS,
      Purpose: GoalPurpose.SAVINGS,
    });
  });

  it('edit: opens on the goal’s own type, collapsed, with its fields', async () => {
    const user = userEvent.setup();
    renderForm(yearlyGoal);
    expect(screen.getByTestId('goal-preset-selected')).toHaveTextContent(
      'Yearly Allocation Target'
    );
    expect(screen.queryByTestId('goal-preset-monthly-available')).not.toBeInTheDocument();
    expect(screen.getByText('Target Date')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change type' }));
    expect(screen.getByTestId('goal-preset-yearly-allocation')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('Cancel calls onCancel; the notice renders above the form', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <GoalForm
        goal={null}
        categoryId={3}
        categoryName="Insurance"
        budgetId={1}
        currentMonth="2026-08"
        formatter={formatter}
        onSave={vi.fn()}
        onCancel={onCancel}
        notice={<p data-testid="hint">Pick a type, enter the amount, save.</p>}
      />
    );
    expect(screen.getByTestId('hint')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('footer stacks on phones: save gets its own row, Delete + Cancel share the next', () => {
    render(
      <GoalForm
        goal={yearlyGoal}
        categoryId={3}
        categoryName="Insurance"
        budgetId={1}
        currentMonth="2026-08"
        formatter={formatter}
        onSave={vi.fn()}
        onCancel={() => {}}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const actions = screen.getByTestId('goal-form-actions');
    // Wraps instead of overflowing; no bottom safe-area band in a centered dialog.
    expect(actions).toHaveClass('flex-wrap');
    expect(actions.className).not.toMatch(/safe-area/);

    const update = within(actions).getByRole('button', { name: 'Update Goal' });
    const cancel = within(actions).getByRole('button', { name: 'Cancel' });
    const del = within(actions).getByRole('button', { name: 'Delete Goal' });
    expect(update).toHaveClass('order-first', 'basis-full', 'whitespace-normal', 'sm:basis-auto');
    for (const b of [cancel, del]) expect(b).toHaveClass('flex-auto', 'sm:flex-none');
    expect(del).toHaveClass('sm:mr-auto');
    // DOM (tab) order stays Delete, Cancel, Update.
    expect([...actions.querySelectorAll('button')]).toEqual([del, cancel, update]);
  });

  it('create state: no Delete, Create Goal on its own row above Cancel', () => {
    renderForm(null);
    const actions = screen.getByTestId('goal-form-actions');
    expect(within(actions).queryByRole('button', { name: 'Delete Goal' })).toBeNull();
    expect(within(actions).getByRole('button', { name: 'Create Goal' })).toHaveClass(
      'order-first',
      'basis-full'
    );
    expect(within(actions).getByRole('button', { name: 'Cancel' })).toHaveClass(
      'flex-auto',
      'sm:ml-auto'
    );
  });
});
