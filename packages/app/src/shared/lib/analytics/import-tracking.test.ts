import type { YNABReadyToAssignMismatch, YNABReconciliationReport } from '@budgero/core/browser';
import { sanitizeEvent } from './events';
import { startYnabReview, ynabReviewShape } from './import-tracking';

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('./track', () => ({ track: mocks.track }));

const NOW = new Date('2026-11-15T12:00:00Z');

function rtaMismatch(
  month: string,
  causes: YNABReadyToAssignMismatch['affectedCategories'] = []
): YNABReadyToAssignMismatch {
  return {
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
    affectedCategories: causes,
  };
}

const base: YNABReconciliationReport = {
  status: 'warning',
  source: { transactions: 10, subtransactions: 0, registerRows: 10 },
  accounts: { checked: 2, matched: 2, debtBalanceAdjustments: [] },
  categories: { checked: 40, matched: 40, mismatches: [], omittedMismatches: 0 },
  readyToAssign: { checked: 24, matched: 24, mismatches: [] },
};

describe('ynabReviewShape', () => {
  it('reports cause kinds, category fields and recent months without values', () => {
    const report: YNABReconciliationReport = {
      ...base,
      accounts: {
        checked: 2,
        matched: 2,
        debtBalanceAdjustments: [
          {
            accountName: 'Synthetic loan',
            date: '2026-01-01',
            amount: 1,
            balanceBefore: 0,
            expectedBalance: 1,
          },
        ],
      },
      categories: {
        checked: 40,
        matched: 37,
        omittedMismatches: 0,
        // The visible list is capped; allMismatches holds every field.
        mismatches: [],
        allMismatches: (['assigned', 'available', 'available'] as const).map((field) => ({
          month: '2026-06',
          categoryGroup: 'Bills',
          category: 'Synthetic',
          field,
          expectedAmount: 0,
          computedAmount: 1,
          difference: 1,
        })),
      },
      readyToAssign: {
        checked: 24,
        matched: 21,
        mismatches: [
          rtaMismatch('2024-01', [
            {
              categoryGroup: 'Bills',
              category: 'Synthetic',
              reason: 'assigned_diff',
              month: '2024-01',
              amount: -1,
            },
          ]),
          rtaMismatch('2024-02'),
          rtaMismatch('2026-10'),
        ],
      },
    };

    const shape = ynabReviewShape(report, NOW);
    expect(shape).toEqual({
      checks: 'both',
      rta_months_bucket: '3-5',
      months_checked_bucket: '10-100',
      category_values_bucket: '1-10',
      cause_cash_overspend: 'no',
      cause_assigned_diff: 'yes',
      cause_not_attributed: 'yes',
      category_assigned: 'yes',
      category_activity: 'no',
      category_available: 'yes',
      debt_adjustments: 'yes',
      recency: 'includes_recent',
    });
    expect(JSON.stringify(shape)).not.toMatch(/20\d\d|Synthetic|Bills/);
    expect(
      sanitizeEvent('ynab_import_review_shown', { source: 'ynab_api', context: 'app', ...shape })
    ).not.toBeNull();
  });

  it('calls differences older than 12 months older_only', () => {
    const report: YNABReconciliationReport = {
      ...base,
      readyToAssign: { checked: 24, matched: 23, mismatches: [rtaMismatch('2025-10')] },
    };
    expect(ynabReviewShape(report, NOW)).toMatchObject({ checks: 'rta', recency: 'older_only' });
    const recent: YNABReconciliationReport = {
      ...base,
      readyToAssign: { checked: 24, matched: 23, mismatches: [rtaMismatch('2025-11')] },
    };
    expect(ynabReviewShape(recent, NOW).recency).toBe('includes_recent');
  });
});

describe('startYnabReview', () => {
  beforeEach(() => mocks.track.mockClear());

  it('reports the screen once it opens and only the first decision', () => {
    const review = startYnabReview(
      {
        ...base,
        readyToAssign: { checked: 24, matched: 23, mismatches: [rtaMismatch('2026-01')] },
      },
      'ynab_zip',
      'app'
    );
    review.decided('remove');
    review.decided('keep');
    review.decided('left');

    expect(mocks.track.mock.calls.map(([name]) => name)).toEqual([
      'ynab_import_review_shown',
      'ynab_import_review_decided',
    ]);
    const decided = mocks.track.mock.calls[1][1];
    expect(decided).toEqual({
      source: 'ynab_zip',
      context: 'app',
      decision: 'remove',
      duration_bucket: '<10s',
    });
    expect(sanitizeEvent('ynab_import_review_decided', decided)).toEqual(decided);
  });
});
