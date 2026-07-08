import { toast } from 'sonner';

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Centralizes the `error instanceof Error ? error.message : fallback` idiom that
 * recurs across the app's catch blocks. Returns `error.message` for `Error`
 * instances and the `fallback` otherwise — behaviorally identical to that
 * ternary, so it does not (deliberately) coerce non-Error values to strings.
 */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Show an error toast whose description is derived from a thrown value.
 *
 * Collapses the `toast.error(title, { description: getErrorMessage(error) })`
 * idiom that recurs across the app's catch blocks.
 */
export function toastError(title: string, error: unknown, fallback?: string): void {
  toast.error(title, { description: getErrorMessage(error, fallback) });
}
