import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format, addDays, addMonths } from 'date-fns';
import { UpcomingTransactionsCard } from './UpcomingTransactionsCard';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockOccurrences = vi.fn<[], unknown[]>(() => []);
vi.mock('@entities/recurring/api/useRecurringTransactions', () => ({
  useRecurringOccurrences: () => ({
    data: mockOccurrences(),
    isLoading: false,
  }),
}));

const mockTransactions = vi.fn<[], unknown[]>(() => []);
vi.mock('@entities/transaction/api/queries', () => ({
  useAllTransactionsDetailed: () => ({
    data: mockTransactions(),
    isLoading: false,
  }),
}));

vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({
    data: [{ ID: 1, Name: 'Checking' }],
  }),
}));

vi.mock('@entities/transaction/api/mutations', () => ({
  useDeleteTransaction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@features/transactions/api/useTransactionCellCommit', () => ({
  useTransactionCellCommit: () => ({ mutate: vi.fn(), isPending: false, pendingId: null }),
}));

vi.mock('@features/transactions/ui/mobile-transaction-card', () => ({
  MobileTransactionCard: () => <div data-testid="mobile-transaction-card" />,
}));

const globalLocalizer = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function makeOccurrence(
  id: number,
  recurringTransactionId: number,
  dueDate: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    recurringTransactionId,
    dueDate,
    status: 'scheduled',
    transactionId: null,
    template: {
      name: `Template ${recurringTransactionId}`,
      amount: 100_000, // $100 in milliunits
      direction: 'outflow',
      accountId: 1,
      memo: '',
    },
    ...overrides,
  };
}

function makeTransaction(id: number, date: string, overrides: Record<string, unknown> = {}) {
  return {
    ID: id,
    Date: date,
    CategoryID: 1,
    Category: 'Bills',
    Memo: '',
    Payee: `Payee ${id}`,
    Reconciled: false,
    Inflow: 0,
    Outflow: 50_000, // $50 in milliunits
    RunningBalance: null,
    Account: 'Checking',
    ...overrides,
  };
}

describe('UpcomingTransactionsCard', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockOccurrences.mockReturnValue([]);
    mockTransactions.mockReturnValue([]);
  });

  it('navigates to recurring settings when clicking Manage automations', async () => {
    const user = userEvent.setup();

    render(<UpcomingTransactionsCard budgetId={1} globalLocalizer={globalLocalizer} />);

    await user.click(screen.getByRole('button', { name: /manage automations/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/settings/recurring');
  });

  it('shows only the next occurrence per recurring template', () => {
    const in5 = format(addDays(new Date(), 5), 'yyyy-MM-dd');
    const in35 = format(addDays(new Date(), 35), 'yyyy-MM-dd');
    mockOccurrences.mockReturnValue([makeOccurrence(1, 10, in5), makeOccurrence(2, 10, in35)]);

    render(<UpcomingTransactionsCard budgetId={1} globalLocalizer={globalLocalizer} />);

    expect(screen.getAllByText('Template 10')).toHaveLength(1);
    expect(screen.getByText(/due in 5 days/i)).toBeInTheDocument();
  });

  it('includes future one-off transactions within 3 months and excludes later ones', () => {
    const in10 = format(addDays(new Date(), 10), 'yyyy-MM-dd');
    const in4Months = format(addMonths(new Date(), 4), 'yyyy-MM-dd');
    mockTransactions.mockReturnValue([makeTransaction(1, in10), makeTransaction(2, in4Months)]);

    render(<UpcomingTransactionsCard budgetId={1} globalLocalizer={globalLocalizer} />);

    expect(screen.getByText('Payee 1')).toBeInTheDocument();
    expect(screen.queryByText('Payee 2')).not.toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('does not duplicate transactions created by a ready occurrence', () => {
    const in7 = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    mockOccurrences.mockReturnValue([
      makeOccurrence(1, 10, in7, { status: 'ready', transactionId: 99 }),
    ]);
    mockTransactions.mockReturnValue([makeTransaction(99, in7)]);

    render(<UpcomingTransactionsCard budgetId={1} globalLocalizer={globalLocalizer} />);

    expect(screen.getByText('Template 10')).toBeInTheDocument();
    expect(screen.queryByText('Payee 99')).not.toBeInTheDocument();
  });

  it('excludes past-dated transactions', () => {
    const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd');
    mockTransactions.mockReturnValue([makeTransaction(1, yesterday)]);

    render(<UpcomingTransactionsCard budgetId={1} globalLocalizer={globalLocalizer} />);

    expect(screen.queryByText('Payee 1')).not.toBeInTheDocument();
  });

  it('navigates to the account page when clicking a recurring item', async () => {
    const user = userEvent.setup();
    const in5 = format(addDays(new Date(), 5), 'yyyy-MM-dd');
    mockOccurrences.mockReturnValue([makeOccurrence(1, 10, in5)]);

    render(<UpcomingTransactionsCard budgetId={1} globalLocalizer={globalLocalizer} />);

    await user.click(screen.getByText('Template 10'));

    expect(mockNavigate).toHaveBeenCalledWith('/accounts/1');
  });

  it('opens the quick-edit dialog when clicking a scheduled one-off item', async () => {
    const user = userEvent.setup();
    const in10 = format(addDays(new Date(), 10), 'yyyy-MM-dd');
    mockTransactions.mockReturnValue([makeTransaction(1, in10)]);

    render(<UpcomingTransactionsCard budgetId={1} globalLocalizer={globalLocalizer} />);

    expect(screen.queryByTestId('mobile-transaction-card')).not.toBeInTheDocument();

    await user.click(screen.getByText('Payee 1'));

    expect(screen.getByTestId('mobile-transaction-card')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
