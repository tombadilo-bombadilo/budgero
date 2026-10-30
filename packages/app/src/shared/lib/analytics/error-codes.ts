/**
 * Map thrown values to our own error codes. Only the code leaves the device;
 * error messages never do. Recognition is by error name / status, so this
 * module stays free of feature imports.
 */
import type { ErrorCode } from './events';

export type ErrorArea = 'import' | 'bank' | 'ai' | 'push' | 'sync' | 'app';

interface ErrorLike {
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
}

function statusCode(status: number): ErrorCode | null {
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'payment_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'server_error';
  return null;
}

/** `DatabaseError.code` is a SQLite failure class set by the adapter (core classifySqliteError). */
function databaseErrorCode(code: unknown): ErrorCode {
  switch (code) {
    case 'constraint':
      return 'db_constraint';
    case 'locked':
      return 'db_locked';
    case 'corrupt':
      return 'db_corrupt';
    case 'readonly':
      return 'db_readonly';
    case 'full':
      return 'db_full';
    default:
      return 'db_error';
  }
}

/**
 * Best-effort mapping of an unknown error to an ErrorCode. Messages are
 * inspected only to recognise a few fixed browser/library strings (fetch
 * failures); they are never returned.
 */
export function toErrorCode(error: unknown, area: ErrorArea = 'app'): ErrorCode {
  if (error == null) return 'unknown';
  const e = (typeof error === 'object' ? error : {}) as ErrorLike;
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';

  if (name === 'AbortError') return 'cancelled';
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'QuotaExceededError') return 'quota_exceeded';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (
    name === 'TypeError' &&
    /failed to fetch|networkerror|load failed|network request failed/i.test(message)
  ) {
    return 'network';
  }
  if (name === 'FormatTooNewError') return 'format_too_new';
  if (name === 'DatabaseError') return databaseErrorCode(e.code);
  if (name === 'ApiError' && e.status === 0) {
    // api-client uses status 0 for its own failures: an aborted timeout or a fetch that never got a response.
    return (e as { response?: unknown }).response === 'timeout' ? 'timeout' : 'network';
  }

  if (area === 'bank') {
    if (name === 'InvalidPrivateKeyError') return 'invalid_key';
    if (name === 'AuthorizationError') return 'consent_expired';
    if (name === 'SimpleFINError' && e.status == null) return 'invalid_token';
  }
  if (area === 'import' && (name === 'SyntaxError' || /zip|parse/i.test(name))) {
    return 'parse_error';
  }
  if (area === 'ai' && /APICallError|AI_APICallError|InvalidResponse|NoContent/i.test(name)) {
    const mapped = typeof e.statusCode === 'number' ? statusCode(e.statusCode) : null;
    return mapped ?? 'model_error';
  }

  const status =
    typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : 0;
  const byStatus = status ? statusCode(status) : null;
  if (byStatus) {
    if (area === 'bank' && (byStatus === 'unauthorized' || byStatus === 'forbidden')) {
      return 'consent_expired';
    }
    return byStatus;
  }
  if (area === 'bank' && /SimpleFINError|EnableBankingError/.test(name)) return 'provider_error';
  return 'unknown';
}

/**
 * The runtime reports sync problems as display text only; map the few we can
 * recognise to codes. The text itself never leaves the device.
 */
/** The fixed code the runtime attached to a sync error (see runtime SyncErrorCode). */
export function syncErrorCode(error: { code: string } | null | undefined): ErrorCode {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  switch (error?.code) {
    case 'session_expired':
    case 'session_rejected':
      return 'unauthorized';
    case 'update_required':
      return 'update_required';
    case 'mutation_quarantined':
      return 'mutation_quarantined';
    case 'snapshot_unavailable':
      return 'snapshot_unavailable';
    case 'snapshot_upload_failed':
      return 'snapshot_upload_failed';
    case 'mutation_rejected':
      return 'sync_rejected';
    default:
      return 'unknown';
  }
}
