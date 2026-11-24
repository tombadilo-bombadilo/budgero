/**
 * Retry policy for app queries. Services are briefly unbound during startup
 * and workspace switches (the old DB is closed before the new one is
 * loaded); queries landing there wait it out with short retries, up to
 * ~15 s, instead of failing after the usual single retry.
 */
export const SERVICES_NOT_READY_RETRIES = 30;
export const SERVICES_NOT_READY_DELAY_MS = 500;

function isServicesNotReady(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'ServicesNotReadyError';
}

export function queryRetry(failureCount: number, error: unknown): boolean {
  return failureCount < (isServicesNotReady(error) ? SERVICES_NOT_READY_RETRIES : 1);
}

export function queryRetryDelay(attempt: number, error: unknown): number {
  return isServicesNotReady(error)
    ? SERVICES_NOT_READY_DELAY_MS
    : Math.min(1000 * 2 ** attempt, 30_000);
}
