import { track } from './track';
import { countBucket, durationBucket, type ImportSource } from './events';
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
