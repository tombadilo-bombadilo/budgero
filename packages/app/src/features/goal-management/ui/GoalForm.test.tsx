import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
