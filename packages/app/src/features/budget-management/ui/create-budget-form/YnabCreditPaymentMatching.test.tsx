import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YnabCreditPaymentMatching } from './YnabCreditPaymentMatching';
import {
  hasCompleteCreditPaymentMappings,
  type CreditPaymentMatching,
  type CreditPaymentMappings,
} from './ynab-credit-payment-matching';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.scrollIntoView = () => {};
});

const matching: CreditPaymentMatching = {
  planId: 'plan-1',
  serverKnowledge: 42,
  accounts: [
    {
      accountId: 'card-a',
      name: 'Visa',
      balance: -120_000,
      closed: false,
      note: 'Personal card',
      candidateCategoryIds: ['cat-a', 'cat-b'],
      recentTransactions: [{ date: '2026-09-01', payee: 'Groceries', amount: -25_000 }],
    },
    {
      accountId: 'card-b',
      name: 'Visa',
      balance: -240_000,
      closed: true,
      candidateCategoryIds: ['cat-a', 'cat-b'],
      recentTransactions: [],
    },
  ],
  categories: [
    {
      categoryId: 'cat-a',
      name: 'Visa',
      available: 40_000,
      assigned: 10_000,
      note: 'Personal payments',
    },
    { categoryId: 'cat-b', name: 'Visa', available: 30_000, assigned: 20_000 },
  ],
};

it('requires explicit distinct choices and shows context for duplicate names', async () => {
  const user = userEvent.setup();
  function Form() {
    const [value, onChange] = React.useState<CreditPaymentMappings>();
    return (
      <>
        <YnabCreditPaymentMatching
          matching={matching}
          value={value}
          onChange={onChange}
          currency="USD"
        />
        <button disabled={!hasCompleteCreditPaymentMappings(matching, value)}>Import</button>
      </>
    );
  }
  render(<Form />);
  const first = screen.getByRole('combobox', { name: 'Visa · Card 1' });
  const second = screen.getByRole('combobox', { name: 'Visa · Card 2 · Closed' });
  expect(first).toHaveTextContent('Choose its payment category');
  expect(second).toHaveTextContent('Choose its payment category');
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  expect(screen.getByText('Account balance: -$120.00')).toBeInTheDocument();
  expect(screen.getByText('Personal card')).toBeInTheDocument();
  expect(screen.getByText('2026-09-01 · Groceries · -$25.00')).toBeInTheDocument();

  await user.click(first);
  const firstOption = await screen.findByRole('option', { name: /Category 1/ });
  expect(firstOption).toHaveTextContent('Available $40.00 · Assigned $10.00 · Personal payments');
  await user.click(screen.getByRole('option', { name: /Category 2/ }));
  expect(first).toHaveTextContent('Category 2');

  await user.click(second);
  expect(await screen.findByRole('option', { name: /Category 2/ })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  expect(screen.getByRole('button', { name: 'Import', hidden: true })).toBeDisabled();
  await user.click(screen.getByRole('option', { name: /Category 1/ }));
  expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();

  await user.click(first);
  await user.click(await screen.findByRole('option', { name: 'Choose its payment category' }));
  expect(first).toHaveTextContent('Choose its payment category');
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  await user.click(second);
  expect(await screen.findByRole('option', { name: /Category 2/ })).not.toHaveAttribute(
    'aria-disabled'
  );
});

it.each([
  {
    planId: 'another-plan',
    serverKnowledge: 42,
    byAccountId: { 'card-a': 'cat-a', 'card-b': 'cat-b' },
  },
  { planId: 'plan-1', serverKnowledge: 41, byAccountId: { 'card-a': 'cat-a', 'card-b': 'cat-b' } },
  { planId: 'plan-1', serverKnowledge: 42, byAccountId: { 'card-a': 'cat-a', 'card-b': 'cat-a' } },
  {
    planId: 'plan-1',
    serverKnowledge: 42,
    byAccountId: { 'card-a': 'cat-a', 'card-b': 'unrelated-category' },
  },
])('rejects stale, duplicate, or unrelated selections: %j', (value) => {
  expect(hasCompleteCreditPaymentMappings(matching, value)).toBe(false);
});

it('does not display selections made for a different snapshot', () => {
  render(
    <YnabCreditPaymentMatching
      matching={matching}
      value={{ planId: 'plan-1', serverKnowledge: 41, byAccountId: { 'card-a': 'cat-a' } }}
      onChange={vi.fn()}
      currency="USD"
    />
  );
  expect(screen.getByRole('combobox', { name: 'Visa · Card 1' })).toHaveTextContent(
    'Choose its payment category'
  );
});
