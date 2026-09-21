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

    expect(screen.getByText('Review YNAB differences')).toBeInTheDocument();
    expect(screen.getByText('Ready to Assign differences')).toBeInTheDocument();
    expect(screen.getByText('Category-history differences')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and remove' }));
    expect(onAcceptWarnings).toHaveBeenCalledOnce();
    expect(onCancelPending).toHaveBeenCalledOnce();
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

    const headers = [
      'YEAR-MONTH',
      'DIFFERENCE',
      'CATEGORY',
      'YNAB VALUE',
      'Budgero VALUE',
      'Income',
      'Assigned',
      'Off-budget',
      'Prior cash overspend',
    ];

    for (const header of headers) {
      expect(screen.getAllByRole('columnheader', { name: header })[0]).toBeInTheDocument();
    }
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

    // Root causes summary section is rendered
    expect(screen.getByText('Discrepancy Causes by Origin Month')).toBeInTheDocument();
    expect(
      screen.getByText(/Ready to Assign differences across months originate from/)
    ).toBeInTheDocument();

    // Specific category groups and names are rendered in the table and summary
    expect(screen.getAllByText(/Bills › Electric/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Groceries › Food/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Immediate › Vacation/).length).toBeGreaterThanOrEqual(1);

    // Origin months and reasons are rendered
    expect(screen.getAllByText(/cash overspend in 2017-07/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/cash overspend in 2018-01/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/assigned diff in 2018-01/).length).toBeGreaterThanOrEqual(1);
  });
});
