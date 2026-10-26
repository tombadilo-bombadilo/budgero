/**
 * Maps the raw errors of the onboarding YNAB source step to a fixed reason, so
 * the step can show a message that says what to do next and analytics can
 * count why a source was rejected without ever sending the raw message.
 */

export type YnabApiFailureReason =
  'unauthorized' | 'rate_limited' | 'network' | 'no_plans' | 'unknown';

export type YnabZipFailureReason = 'not_zip' | 'not_ynab_export' | 'unknown';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function classifyYnabApiError(error: unknown): YnabApiFailureReason {
  const message = messageOf(error);
  if (/no plans are available/i.test(message)) return 'no_plans';
  if (/unauthori[sz]ed|\(401\)/i.test(message)) return 'unauthorized';
  if (/too many requests|rate limit|\(429\)/i.test(message)) return 'rate_limited';
  // fetch() rejects with a TypeError when the request never got a response:
  // "Failed to fetch" (Chromium), "NetworkError …" (Firefox), "Load failed" (Safari).
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror/i.test(message) ||
    /^load failed$/i.test(message)
  ) {
    return 'network';
  }
  return 'unknown';
}

export function classifyYnabZipError(error: unknown): YnabZipFailureReason {
  const message = messageOf(error);
  if (/central directory|is this a zip file|corrupted zip|not a zip/i.test(message)) {
    return 'not_zip';
  }
  if (/not found in zip/i.test(message)) return 'not_ynab_export';
  return 'unknown';
}
