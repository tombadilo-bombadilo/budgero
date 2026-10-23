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
export function syncErrorCode(message: string): ErrorCode {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (/app update|newer changes|newer than this app/i.test(message)) return 'version_mismatch';
  if (/quota|storage|opfs|disk/i.test(message)) return 'storage_error';
  if (/network|fetch|websocket|connection|timed? ?out/i.test(message)) return 'network';
  if (/unauthori[sz]ed|401|token/i.test(message)) return 'unauthorized';
  if (/forbidden|403/i.test(message)) return 'forbidden';
  return 'unknown';
}
