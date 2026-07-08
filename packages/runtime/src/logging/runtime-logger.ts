import { errorMessage } from '../utils/diagnostics';

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type RuntimeLogContext = Record<string, unknown>;

/** Component-scoped log function injected into runtime services. */
export type RuntimeLogFn = (
  level: RuntimeLogLevel,
  message: string,
  context?: RuntimeLogContext
) => void;

/** Component-taking log function (RuntimeCoordinator-level injection point). */
export type RuntimeComponentLogFn = (
  level: RuntimeLogLevel,
  component: string,
  message: string,
  context?: RuntimeLogContext
) => void;

const LOG_PREFIX = '[Runtime]';

function isDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('budgero_debug') === '1';
  } catch {
    return false;
  }
}

export function logRuntime(
  level: RuntimeLogLevel,
  component: string,
  message: string,
  context?: RuntimeLogContext
): void {
  if ((level === 'debug' || level === 'info') && !isDebugEnabled()) {
    return;
  }

  const prefix = `${LOG_PREFIX}[${component}]`;
  const logFn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug'
          ? console.debug
          : console.log;

  if (context && Object.keys(context).length > 0) {
    logFn(`${prefix} ${message}`, context);
  } else {
    logFn(`${prefix} ${message}`);
  }
}

export function logRuntimeError(
  component: string,
  message: string,
  error: unknown,
  context?: RuntimeLogContext
): void {
  logRuntime('error', component, message, {
    error: errorMessage(error),
    originalError: error,
    ...context,
  });
}

/**
 * Create a component-scoped log function.
 * When `override` (a component-taking logger, e.g. `RuntimeCoordinatorDeps.runtimeLog`)
 * is provided, the component name is bound into it; otherwise falls back to
 * the built-in console logger.
 */
export function scopedLogger(component: string, override?: RuntimeComponentLogFn): RuntimeLogFn {
  if (override) {
    return (level, message, context) => override(level, component, message, context);
  }
  return (level, message, context) => logRuntime(level, component, message, context);
}
