/**
 * Runtime diagnostics utilities for consistent error handling.
 */

/**
 * Extract a human-readable message from an unknown error value.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Type guard to check if an error indicates a decryption failure.
 */
export function isDecryptionError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof DOMException) {
    return (
      error.name === 'OperationError' ||
      error.name === 'DataError' ||
      error.name === 'InvalidAccessError'
    );
  }

  const message = typeof error === 'string' ? error : errorMessage(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('decryption failed') ||
    normalized.includes('failed to decrypt') ||
    normalized.includes('file is not a database') ||
    normalized.includes('database disk image is malformed') ||
    normalized.includes('file is encrypted') ||
    normalized.includes('wrong key or password') ||
    normalized.includes('unsupported state or unable to authenticate data')
  );
}

/**
 * Cancellation error for AbortSignal-based cancellation.
 */
export class CancellationError extends Error {
  constructor(message = 'Operation cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

/**
 * Check AbortSignal and throw CancellationError if aborted.
 */
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancellationError();
  }
}
