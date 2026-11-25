import type { YNABReconciliationReport } from '@budgero/core/browser';
import { track } from './track';
import {
  countBucket,
  durationBucket,
  smallCountBucket,
  timingBucket,
  type AnalyticsEventProps,
  type ImportSource,
  type YnabReviewDecision,
} from './events';
import { toErrorCode } from './error-codes';

type ImportContext = 'onboarding' | 'app';

export interface ImportRun {
  ok(rows: number): void;
  error(error: unknown): void;
  cancelled(): void;
}

/** import_started now; the returned run reports import_finished exactly once. */
export function startImportRun(source: ImportSource, context: ImportContext): ImportRun {
  const startedAt = Date.now();
  let done = false;
  track('import_started', { source, context });
  const finish = (
    outcome: 'ok' | 'error' | 'cancelled',
    errorCode: ReturnType<typeof toErrorCode>,
    rows: number
  ) => {
    if (done) return;
    done = true;
    track('import_finished', {
      source,
      context,
      outcome,
      error_code: errorCode,
      rows_bucket: countBucket(rows),
      duration_bucket: timingBucket(Date.now() - startedAt),
    });
  };
  return {
    ok: (rows) => finish('ok', 'none', rows),
    error: (error) => finish('error', toErrorCode(error, 'import'), 0),
    cancelled: () => finish('cancelled', 'cancelled', 0),
  };
}

/** import_accounts_mapped: a finished import that had "Accounts in this file". */
export function trackAccountsMapped(
  source: ImportSource,
  summary: {
    accounts: number;
    existing: number;
    created: number;
    skipped: number;
    rememberedUsed: boolean;
  }
): void {
  track('import_accounts_mapped', {
    source,
    accounts_bucket: smallCountBucket(summary.accounts),
    existing_bucket: smallCountBucket(summary.existing),
    new_bucket: smallCountBucket(summary.created),
    skipped_bucket: smallCountBucket(summary.skipped),
    remembered: summary.rememberedUsed ? 'yes' : 'no',
  });
}

type YnabReviewShape = Omit<AnalyticsEventProps<'ynab_import_review_shown'>, 'source' | 'context'>;

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/** 'YYYY-MM' of the month 12 months before `now`: months before it are "older". */
function recentCutoff(now: Date): string {
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The review screen's shape from a verification report: which checks differ,
 * how many values, which cause kinds appear and how recent the differences
 * are. Months, amounts and names are only read here, never returned.
 */
export function ynabReviewShape(
  verification: YNABReconciliationReport,
  now: Date = new Date()
): YnabReviewShape {
  const rtaMismatches = verification.readyToAssign.mismatches;
  const categoryMismatches =
    verification.categories.allMismatches ?? verification.categories.mismatches;
  const hasRta = rtaMismatches.length > 0;
  const hasCategory = verification.categories.checked > verification.categories.matched;
  const causes = rtaMismatches.flatMap((m) => m.affectedCategories ?? []);
  const fields = new Set(categoryMismatches.map((m) => m.field));
  const cutoff = recentCutoff(now);
  const months = [...rtaMismatches.map((m) => m.month), ...categoryMismatches.map((m) => m.month)];
  return {
    checks: hasRta && hasCategory ? 'both' : hasRta ? 'rta' : 'category',
    rta_months_bucket: smallCountBucket(rtaMismatches.length),
    months_checked_bucket: countBucket(verification.readyToAssign.checked),
    category_values_bucket: countBucket(
      verification.categories.checked - verification.categories.matched
    ),
    cause_cash_overspend: yesNo(causes.some((c) => c.reason === 'cash_overspend')),
    cause_assigned_diff: yesNo(causes.some((c) => c.reason === 'assigned_diff')),
    cause_not_attributed: yesNo(rtaMismatches.some((m) => !m.affectedCategories?.length)),
    category_assigned: yesNo(fields.has('assigned')),
    category_activity: yesNo(fields.has('activity')),
    category_available: yesNo(fields.has('available')),
    debt_adjustments: yesNo(verification.accounts.debtBalanceAdjustments.length > 0),
    recency: months.some((month) => month.slice(0, 7) >= cutoff) ? 'includes_recent' : 'older_only',
  };
}

export interface YnabReviewRun {
  decided(decision: YnabReviewDecision): void;
}

/** ynab_import_review_shown now; the returned run reports the decision exactly once. */
export function startYnabReview(
  verification: YNABReconciliationReport,
  source: ImportSource,
  context: ImportContext
): YnabReviewRun {
  const shownAt = Date.now();
  let done = false;
  track('ynab_import_review_shown', { source, context, ...ynabReviewShape(verification) });
  return {
    decided: (decision) => {
      if (done) return;
      done = true;
      track('ynab_import_review_decided', {
        source,
        context,
        decision,
        duration_bucket: durationBucket(Date.now() - shownAt),
      });
    },
  };
}
