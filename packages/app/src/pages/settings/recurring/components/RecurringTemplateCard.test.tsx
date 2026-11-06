import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecurringTransaction } from '@budgero/core/browser';
import { RecurringTemplateCard } from './RecurringTemplateCard';

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverMock,
  });
});

const longMemo = 'A recurring transaction memo that is much wider than its card'.repeat(4);

const budgetLocalizer = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const accountLocalizer = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const template: RecurringTransaction = {
  id: 1,
  budgetId: 1,
  accountId: 1,
  toAccountId: null,
  categoryId: 1,
  splits: null,
  name: 'Monthly bill',
  memo: longMemo,
  amount: 123_000 as RecurringTransaction['amount'],
  direction: 'outflow',
  schedule: {
    startDate: '2026-08-26',
    intervalUnit: 'month',
    intervalCount: 1,
  },
  notifyDaysBefore: 0,
  lastOccurrenceDate: null,
  active: true,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

describe('RecurringTemplateCard', () => {
  it('shows the account currency and the budget equivalent for foreign-currency templates', () => {
    // This is the regression case: the page-level localizer is USD, while the
    // recurring template amount belongs to a EUR account.
    render(
      <RecurringTemplateCard
        template={{
          ...template,
          amount: 2_000_000 as RecurringTransaction['amount'],
          accountId: 7,
        }}
        accountName="Foreign account"
        accountCurrency="EUR"
        categoryName="Travel"
        occurrences={[]}
        accountLocalizer={accountLocalizer}
        budgetAmount={2_400_000}
        budgetCurrency="USD"
        budgetLocalizer={budgetLocalizer}
        isProcessing={false}
        isTogglePending={false}
        onToggleActive={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        processingOccurrenceId={null}
        isMarkReadyPending={false}
        isSkipPending={false}
        isOccurrencesFetching={false}
        onMarkReady={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText('-€2,000.00')).toBeInTheDocument();
    expect(screen.getByText(/≈\s*-\$2,400\.00/)).toBeInTheDocument();
  });

  it('truncates long memos and exposes the full text on hover', async () => {
    const user = userEvent.setup();
    render(
      <RecurringTemplateCard
        template={template}
        accountName="Checking"
        categoryName="Bills"
        occurrences={[]}
        accountLocalizer={{ format: (value) => String(value) }}
        isProcessing={false}
        isTogglePending={false}
        onToggleActive={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        processingOccurrenceId={null}
        isMarkReadyPending={false}
        isSkipPending={false}
        isOccurrencesFetching={false}
        onMarkReady={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    const memo = screen.getByText(longMemo);
    expect(memo).toHaveClass('truncate');

    await user.hover(memo);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(longMemo);
  });
});
