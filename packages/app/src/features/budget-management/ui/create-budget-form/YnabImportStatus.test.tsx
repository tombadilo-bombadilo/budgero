import { fireEvent, render, screen } from '@testing-library/react';
import type {
  YNABImportProgressUpdate,
  YNABImportSummary,
  YNABReconciliationReport,
} from '@budgero/core/browser';
import { YnabImportStatus } from './YnabImportStatus';

const runningUpdates: YNABImportProgressUpdate[] = [
  {
    stage: 'preparing',
    status: 'passed',
    progress: 10,
    label: 'Budget created',
  },
  {
    stage: 'categories',
    status: 'running',
    progress: 12,
    label: 'Importing categories',
    detail: '22 categories',
  },
];

const summary: YNABImportSummary = {
  registerRowsImported: 4_250,
  transactionsCreated: 4_000,
  missingCategoriesCreated: [],
  splitTransactionsImported: 30,
  accountBalancesVerified: 8,
  readyToAssignMonthsVerified: 62,
};

const verification: YNABReconciliationReport = {
  status: 'passed',
  source: { transactions: 4_000, subtransactions: 250, registerRows: 4_250 },
  accounts: { checked: 8, matched: 8, debtBalanceAdjustments: [] },
  categories: { checked: 180, matched: 180, mismatches: [], omittedMismatches: 0 },
  readyToAssign: { checked: 62, matched: 62, mismatches: [] },
};

const defaultProps = {
  verification: null,
  currency: 'USD',
  isFinalizing: false,
  onAcceptWarnings: vi.fn(),
  onCancelPending: vi.fn(),
};

describe('YnabImportStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows stage progress and both API verification checks', () => {
    render(
      <YnabImportStatus
        sourceMode="api"
        updates={runningUpdates}
        error={null}
        summary={null}
        {...defaultProps}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByText('Importing from YNAB')).toBeInTheDocument();
    expect(screen.getByText('Importing categories')).toBeInTheDocument();
    expect(screen.getByText('22 categories')).toBeInTheDocument();
    expect(screen.getByText('Verify account balances')).toBeInTheDocument();
    expect(screen.getByText('Verify Ready to Assign by month')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('shows a durable failure warning and lets the user return to the form', () => {
    const onBack = vi.fn();
    render(
      <YnabImportStatus
        sourceMode="api"
        updates={runningUpdates}
        error="YNAB Ready to Assign integrity check failed for 2026-09"
        summary={null}
        {...defaultProps}
        onBack={onBack}
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByText('YNAB import stopped')).toBeInTheDocument();
    expect(screen.getByText('Integrity check failed')).toBeInTheDocument();
    expect(screen.getByText(/Ready to Assign integrity check failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to import' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('summarizes verified balances and RTA months before opening the budget', () => {
    const onContinue = vi.fn();
    render(
      <YnabImportStatus
        sourceMode="api"
        updates={[
          ...runningUpdates,
          {
            stage: 'complete',
            status: 'passed',
            progress: 100,
            label: 'Imported budget saved',
          },
        ]}
        error={null}
        summary={summary}
        {...defaultProps}
        verification={verification}
        onBack={vi.fn()}
        onContinue={onContinue}
      />
    );

    expect(screen.getByText('YNAB import verified')).toBeInTheDocument();
    expect(screen.getByText('8 of 8 exact')).toBeInTheDocument();
    expect(screen.getByText(/62 of 62 months/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open imported budget' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('shows reconciliation differences and requires an explicit keep-or-remove choice', () => {
    const onAcceptWarnings = vi.fn();
    const onCancelPending = vi.fn();
    const warned: YNABReconciliationReport = {
      ...verification,
      status: 'warning',
      categories: {
        checked: 180,
        matched: 179,
        omittedMismatches: 0,
        mismatches: [
          {
            month: '2026-09',
            categoryGroup: 'Bills',
            category: 'Mortgage',
            field: 'activity',
            expectedAmount: -1_850_000,
            computedAmount: -1_800_000,
            difference: 50_000,
          },
        ],
      },
      readyToAssign: {
        checked: 62,
        matched: 61,
        mismatches: [
          {
            month: '2026-09',
            expectedReadyToAssign: 100_000,
            computedReadyToAssign: 90_000,
            difference: -10_000,
            breakdown: {
              income: 500_000,
              assignments: 400_000,
              offBudgetTransfers: 10_000,
              inBudgetTransfers: 0,
              revaluations: 0,
              priorCashOverspend: 0,
            },
          },
        ],
      },
    };

    render(
      <YnabImportStatus
        sourceMode="api"
        updates={[
          ...runningUpdates,
          {
            stage: 'complete',
            status: 'warning',
            progress: 99,
            label: 'Waiting for your review',
          },
        ]}
        error={null}
        summary={summary}
        verification={warned}
        currency="USD"
        isFinalizing={false}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onAcceptWarnings={onAcceptWarnings}
        onCancelPending={onCancelPending}
      />
    );

    expect(screen.getByText('Your YNAB budget is ready')).toBeInTheDocument();
    expect(
      screen.getByText('It isn’t saved or synced until you choose below.')
    ).toBeInTheDocument();

    // Plain-language summary first: what matched, then what differs.
    expect(
      screen.getByText('Your account balances match YNAB and every transaction came across.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('In 1 month, Ready to Assign differs from what YNAB showed.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 category value in your budget history differs from YNAB.')
    ).toBeInTheDocument();
    expect(screen.getByText('We recommend keeping this budget.')).toBeInTheDocument();
    expect(screen.getByText(/Settings › Imports › Import History/)).toBeInTheDocument();
    // 2026-09 is within the last 12 months of the fixed test clock.
    expect(screen.queryByText(/more than a year old/)).not.toBeInTheDocument();

    // The technical tables are collapsed until asked for.
    const toggle = screen.getByRole('button', { name: 'Show details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Ready to Assign differences')).not.toBeInTheDocument();
    expect(screen.queryByText('Category-history differences')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('Ready to Assign differences')).toBeInTheDocument();
    expect(screen.getByText('Category-history differences')).toBeInTheDocument();

    // Keeping is the primary action and comes first; removing is secondary.
    const keep = screen.getByRole('button', { name: 'Keep this budget' });
    const remove = screen.getByRole('button', { name: 'Remove this import' });
    expect(keep.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(keep.className).toMatch(/\bbg-primary\b/);
    expect(remove.className).not.toMatch(/\bbg-primary\b/);
    expect(screen.queryByRole('button', { name: 'Import anyway' })).not.toBeInTheDocument();
    fireEvent.click(keep);
    fireEvent.click(remove);
    expect(onAcceptWarnings).toHaveBeenCalledOnce();
    expect(onCancelPending).toHaveBeenCalledOnce();
  });

  it('says when every difference is more than a year old', () => {
    const old: YNABReconciliationReport = {
      ...verification,
      status: 'warning',
      readyToAssign: {
        checked: 62,
        matched: 59,
        mismatches: ['2019-01', '2019-02', '2019-03'].map((month) => ({
          month,
          expectedReadyToAssign: 0,
          computedReadyToAssign: 1_000,
          difference: 1_000,
          breakdown: {
            income: 0,
            assignments: 0,
            offBudgetTransfers: 0,
            inBudgetTransfers: 0,
            revaluations: 0,
            priorCashOverspend: 0,
          },
        })),
      },
    };
    render(
      <YnabImportStatus
        sourceMode="api"
        updates={runningUpdates}
        error={null}
        summary={summary}
        {...defaultProps}
        verification={old}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    expect(
      screen.getByText('In 3 months, Ready to Assign differs from what YNAB showed.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/category value/)).not.toBeInTheDocument();
    expect(
      screen.getByText('All of these differences are more than a year old.')
    ).toBeInTheDocument();
  });

  it('renders Ready to Assign mismatches table with the requested headers', () => {
    const warned: YNABReconciliationReport = {
      ...verification,
      status: 'warning',
      readyToAssign: {
        checked: 62,
        matched: 61,
        mismatches: [
          {
            month: '2026-09',
            expectedReadyToAssign: 100_000,
            computedReadyToAssign: 90_000,
            difference: -10_000,
            breakdown: {
              income: 500_000,
              assignments: 400_000,
              offBudgetTransfers: 10_000,
              inBudgetTransfers: 0,
              revaluations: 0,
              priorCashOverspend: 0,
            },
          },
        ],
      },
    };

    render(
      <YnabImportStatus
        sourceMode="api"
        updates={[
          ...runningUpdates,
          {
            stage: 'rta-verification',
            status: 'warning',
            progress: 98,
            label: 'Verify Ready to Assign by month',
            detail: '1 of 62 months differ from YNAB',
          },
        ]}
        error={null}
        summary={summary}
        verification={warned}
        currency="USD"
        isFinalizing={false}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onAcceptWarnings={vi.fn()}
        onCancelPending={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    const headers = [
      'Month',
      'Difference',
      'Possible contributors',
      'YNAB value',
      'Budgero value',
      'Income',
      'Assigned',
      'Off-budget',
      'Prior cash overspend',
    ];

    for (const header of headers) {
      expect(screen.getAllByRole('columnheader', { name: header })[0]).toBeInTheDocument();
    }
    // Reports without attribution must not guess at a cause.
    expect(screen.getByText('Not attributed')).toBeInTheDocument();
    expect(screen.queryByText(/possible Transfer/i)).not.toBeInTheDocument();
  });

  it('renders affected categories and discrepancy root causes summary in Ready to Assign mismatches table', () => {
    const warnedWithCauses: YNABReconciliationReport = {
      status: 'warning',
      source: {
        transactions: 120,
        subtransactions: 10,
        registerRows: 130,
      },
      accounts: {
        checked: 4,
        matched: 4,
        debtBalanceAdjustments: [],
      },
      categories: {
        checked: 300,
        matched: 300,
        mismatches: [],
        omittedMismatches: 0,
      },
      readyToAssign: {
        checked: 62,
        matched: 61,
        mismatches: [
          {
            month: '2026-09',
            expectedReadyToAssign: 0,
            computedReadyToAssign: -268_970,
            difference: -268_970,
            breakdown: {
              income: 1_384_007_140,
              assignments: 1_384_212_840,
              offBudgetTransfers: 0,
              inBudgetTransfers: 0,
              revaluations: 0,
              priorCashOverspend: 63_270,
            },
            affectedCategories: [
              {
                categoryGroup: 'Bills',
                category: 'Electric',
                reason: 'cash_overspend',
                month: '2017-07',
                amount: -32_610,
              },
              {
                categoryGroup: 'Groceries',
                category: 'Food',
                reason: 'cash_overspend',
                month: '2018-01',
                amount: -30_660,
              },
              {
                categoryGroup: 'Immediate',
                category: 'Vacation',
                reason: 'assigned_diff',
                month: '2018-01',
                amount: -155_700,
              },
            ],
          },
        ],
      },
    };

    render(
      <YnabImportStatus
        sourceMode="api"
        updates={[
          ...runningUpdates,
          {
            stage: 'rta-verification',
            status: 'warning',
            progress: 98,
            label: 'Verify Ready to Assign by month',
            detail: '1 of 62 months differ from YNAB',
          },
        ]}
        error={null}
        summary={summary}
        verification={warnedWithCauses}
        currency="EUR"
        isFinalizing={false}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onAcceptWarnings={vi.fn()}
        onCancelPending={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    // Summary of possible contributors, worded as hints rather than causes
    expect(screen.getByText(/not an exact breakdown/)).toBeInTheDocument();
    expect(screen.queryByText(/originate from/)).not.toBeInTheDocument();

    // Each contributor renders once in the summary and once in the table, as plain text
    expect(screen.getAllByText('Bills › Electric')).toHaveLength(2);
    expect(screen.getAllByText('Groceries › Food')).toHaveLength(2);
    expect(screen.getAllByText('Immediate › Vacation')).toHaveLength(2);
    expect(screen.queryByText(/\$Bills|`/)).not.toBeInTheDocument();

    // Origin months and reasons are rendered
    expect(screen.getAllByText(/cash overspend in 2017-07/)).toHaveLength(2);
    expect(screen.getAllByText(/cash overspend in 2018-01/)).toHaveLength(2);
    expect(screen.getAllByText(/assignment difference in 2018-01/)).toHaveLength(2);
  });
});
