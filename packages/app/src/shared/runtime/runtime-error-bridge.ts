/**
 * Runtime log → error reports. Production builds strip console output, so a
 * runtime `warn`/`error` (snapshot upload failed, remote mutation could not be
 * applied, offline queue not persisted…) used to vanish. This bridge keeps the
 * console behaviour and additionally reports warn/error entries as handled
 * exceptions: the component and the log message (a literal from our source,
 * slugified) identify the failure; the context values are never sent.
 */
import {
  logRuntime,
  type RuntimeComponentLogFn,
  type RuntimeLogContext,
  type RuntimeLogLevel,
} from '@budgero/runtime';
import { addBreadcrumb, captureAppError, slugifyEvent } from '@shared/lib/analytics/error-capture';
import { runtimeMessageCode } from '@shared/lib/analytics/error-codes';

/** Runtime loggers attach the thrown error as `originalError` or `error` (sometimes already a string). */
function errorFrom(context: RuntimeLogContext | undefined): unknown {
  if (!context) return undefined;
  for (const key of ['originalError', 'error', 'cause']) {
    const value = context[key];
    if (value instanceof Error) return value;
  }
  return undefined;
}

/** The message text the runtime logged (`errorMessage(error)`), when there is no Error object. */
function messageFrom(context: RuntimeLogContext | undefined): string | undefined {
  if (!context) return undefined;
  for (const key of ['error', 'reason', 'cause']) {
    const value = context[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

export const runtimeErrorBridge: RuntimeComponentLogFn = (
  level: RuntimeLogLevel,
  component: string,
  message: string,
  context?: RuntimeLogContext
): void => {
  logRuntime(level, component, message, context);
  if (level !== 'warn' && level !== 'error') return;
  const event = slugifyEvent(message);
  addBreadcrumb('runtime', `${component}:${event}`);
  const original = errorFrom(context);
  const error =
    original ??
    Object.assign(new Error(message), {
      name: level === 'error' ? 'RuntimeError' : 'RuntimeWarning',
    });
  // Without an Error object the code is derived from the logged message text
  // (matched locally, never sent) so sync/storage failures stop being 'unknown'.
  const code = original === undefined ? runtimeMessageCode(messageFrom(context), event) : undefined;
  captureAppError(error, {
    source: 'runtime',
    handled: true,
    synthetic: original === undefined,
    component,
    event,
    ...(code && code !== 'unknown' ? { code } : {}),
  });
};
