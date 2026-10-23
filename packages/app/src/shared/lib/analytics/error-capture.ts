/**
 * Scrubbed error reports (PostHog error tracking, `$exception`).
 *
 * What leaves the device: the error type/name, our error_code, the normalized
 * route (area) and stack frames as file:line:col. Never the message text,
 * function names, locals, breadcrumbs or full URLs.
 */
import { toErrorCode } from './error-codes';
import { captureScrubbedException, normalizePagePath } from './track';

const MAX_FRAMES = 30;
const MAX_PER_MINUTE = 10;
const SAFE_NAME = /^[A-Za-z_$][\w$.]{0,63}$/;

export interface ScrubbedFrame {
  platform: 'web:javascript';
  filename: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}

/** Keep only a same-origin asset path (no query/hash); anything else is opaque. */
function scrubFilename(raw: string): { filename: string; inApp: boolean } {
  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : undefined);
    const sameOrigin = typeof window !== 'undefined' && url.origin === window.location.origin;
    if (sameOrigin && /^https?:$/.test(url.protocol)) {
      return { filename: url.pathname, inApp: true };
    }
  } catch {
    /* fall through */
  }
  return { filename: '<external>', inApp: false };
}

/** Parse V8 / SpiderMonkey / JSC stack lines into file:line:col frames. */
export function parseStackFrames(stack: string | undefined): ScrubbedFrame[] {
  if (!stack) return [];
  const frames: ScrubbedFrame[] = [];
  for (const line of stack.split('\n')) {
    const match = /((?:[a-z][\w+.-]*:\/\/|\/)[^\s()]*?):(\d+):(\d+)\)?\s*$/i.exec(line.trim());
    if (!match) continue;
    const { filename, inApp } = scrubFilename(match[1]);
    frames.push({
      platform: 'web:javascript',
      filename,
      lineno: Number(match[2]),
      colno: Number(match[3]),
      in_app: inApp,
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  // PostHog (like Sentry) expects the crashing frame last.
  return frames.reverse();
}

function errorType(error: unknown): string {
  if (error instanceof Error || (error && typeof error === 'object' && 'name' in error)) {
    const name = String((error as { name?: unknown }).name ?? '');
    const ctorName = (error as { constructor?: { name?: string } }).constructor?.name ?? '';
    const pick = name && name !== 'Error' ? name : ctorName || name;
    return SAFE_NAME.test(pick) ? pick : Error.name;
  }
  return 'NonError';
}

/** Build the `$exception` props for an error. Exported for tests. */
export function buildExceptionProps(
  error: unknown,
  options: { handled: boolean; source: string }
): Record<string, unknown> {
  const type = errorType(error);
  const code = toErrorCode(error, 'app');
  const stack =
    error && typeof error === 'object' && typeof (error as { stack?: unknown }).stack === 'string'
      ? ((error as { stack: string }).stack as string)
      : undefined;
  const area =
    typeof window !== 'undefined' ? normalizePagePath(window.location.pathname) : 'unknown';
  return {
    $exception_list: [
      {
        type,
        value: code,
        mechanism: { handled: options.handled, synthetic: false, type: options.source },
        stacktrace: { type: 'raw', frames: parseStackFrames(stack) },
      },
    ],
    $exception_level: 'error',
    error_code: code,
    area,
  };
}

let windowStart = 0;
let windowCount = 0;
const seen = new WeakSet();

/** Report one error (deduplicated, rate limited). */
export function captureAppError(error: unknown, source = 'manual', handled = true): void {
  if (error && typeof error === 'object') {
    if (seen.has(error)) return;
    seen.add(error);
  }
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (++windowCount > MAX_PER_MINUTE) return;
  try {
    captureScrubbedException(buildExceptionProps(error, { handled, source }));
  } catch {
    /* never let reporting throw */
  }
}

let installed = false;

/** Window error + unhandledrejection handlers. Idempotent. */
export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event: ErrorEvent) => {
    // Resource load errors have no `error`; skip them.
    if (!event.error && !event.message) return;
    captureAppError(event.error ?? { name: 'Error' }, 'onerror', false);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    captureAppError(event.reason, 'onunhandledrejection', false);
  });
}
