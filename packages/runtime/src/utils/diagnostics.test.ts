import { describe, expect, it } from 'vitest';
import { CancellationError, checkAbort, isDecryptionError } from './diagnostics';

describe('diagnostics', () => {
  it('detects decryption errors', () => {
    expect(isDecryptionError(null)).toBe(false);
    expect(isDecryptionError(new DOMException('x', 'DataError'))).toBe(true);
    expect(isDecryptionError(new DOMException('x', 'InvalidAccessError'))).toBe(true);
    expect(isDecryptionError(new Error('wrong key or password'))).toBe(true);
    expect(isDecryptionError('failed to decrypt file')).toBe(true);
    expect(isDecryptionError({ message: 'unsupported state or unable to authenticate data' })).toBe(
      false
    );
    expect(isDecryptionError(new Error('other'))).toBe(false);
  });

  it('throws cancellation when aborted', () => {
    const c = new AbortController();
    c.abort();
    expect(() => checkAbort(c.signal)).toThrow(CancellationError);
    expect(() => checkAbort(undefined)).not.toThrow();
  });
});
