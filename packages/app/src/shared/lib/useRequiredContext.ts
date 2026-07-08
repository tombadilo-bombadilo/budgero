import { useContext, type Context } from 'react';

/**
 * Read a context that must be provided, throwing when the calling hook is
 * used outside its provider. Checks `== null` so it works for contexts using
 * either an `undefined` or `null` empty sentinel.
 *
 * @param name Concept name, e.g. `'Runtime'` — produces
 *   "useRuntime must be used within a RuntimeProvider".
 */
export function useRequiredContext<T>(context: Context<T>, name: string): NonNullable<T> {
  const value = useContext(context);
  if (value == null) {
    throw new Error(`use${name} must be used within a ${name}Provider`);
  }
  return value;
}
