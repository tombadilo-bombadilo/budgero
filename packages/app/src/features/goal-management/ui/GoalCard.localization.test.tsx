import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GoalPurpose, GoalType, type Goal } from '@budgero/core/browser';
import { activateLocale, SUPPORTED_LOCALES } from '@shared/i18n';
import { asMilli } from '@shared/lib/currency/milli';
import { GoalCard } from './GoalCard';

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const goal: Goal = {
  ID: 1,
  CategoryID: 1,
  Purpose: GoalPurpose.SPENDING,
  Type: GoalType.MONTHLY,
  Target: asMilli(123000),
  StartDate: '2026-09-01',
};
const props = {
  goal,
  categoryName: 'Test goal',
  currentMonth: '2026-09',
  formatter,
  finances: { available: 80000, assigned: 0, activity: 80000 },
};

afterEach(async () => {
  cleanup();
  await activateLocale('en', false);
});

it.each(SUPPORTED_LOCALES)(
  'renders the actual missing amount in %s goal status and explanation',
  async (locale) => {
    await activateLocale(locale, false);
    const view = render(<GoalCard {...props} />);
    expect(view.container.textContent).not.toMatch(/[{}]/);
    // The status line carries the $43 shortfall. The recommendation ("Assign
    // $43…") and the "Still Needed" row would only repeat it, so they're hidden.
    expect(view.container.textContent?.match(/\$43\.00/g)?.length).toBe(1);
    // The explanation opens on demand and is localized too.
    fireEvent.click(screen.getByTestId('goal-card-how-it-works'));
    expect(view.container.textContent).not.toMatch(/[{}]/);
    if (locale === 'en') {
      expect(view.container).toHaveTextContent('Need $43.00 more available');
      expect(view.container).not.toHaveTextContent('Assign $43.00 to reach your target');
      expect(view.container).toHaveTextContent('Leftover balance rolls into next month');
    }
  }
);

it('keeps amounts in the budget currency when the display language changes', async () => {
  await activateLocale('en', false);
  const view = render(<GoalCard {...props} />);
  await act(() => activateLocale('de', false));
  expect(view.container).toHaveTextContent('$43.00');
  expect(view.container.textContent).not.toMatch(/[{}]/);
  expect(view.container).not.toHaveTextContent('Need');
});
