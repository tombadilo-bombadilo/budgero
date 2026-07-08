import createDebug from 'debug';

/**
 * Namespaced diagnostic logger for `@budgero/core`.
 *
 * A library should never write to stdout unconditionally. Diagnostics go through
 * `debug`, which is **silent by default** and opt-in via the `DEBUG` env var, e.g.
 * `DEBUG=budgero:core:*` (Node) or `localStorage.debug = 'budgero:core:*'` (browser).
 * Reserve `console.warn` / `console.error` for genuine, surfacing problems.
 *
 * @example
 *   const log = createLogger('currency');
 *   log('no rate found for %s -> %s', from, to);
 */
export function createLogger(namespace: string) {
  return createDebug(`budgero:core:${namespace}`);
}
