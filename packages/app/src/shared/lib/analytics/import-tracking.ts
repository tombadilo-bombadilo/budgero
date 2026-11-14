import { track } from './track';
import { countBucket, durationBucket, smallCountBucket, type ImportSource } from './events';
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
      duration_bucket: durationBucket(Date.now() - startedAt),
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
