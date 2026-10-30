import { describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/api-client';
import { toErrorCode } from './error-codes';

class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

describe('toErrorCode', () => {
  it('maps the SQLite failure class of a DatabaseError, never its text', () => {
    expect(
      toErrorCode(new DatabaseError('UNIQUE constraint failed: payees.Name', 'constraint'))
    ).toBe('db_constraint');
    expect(toErrorCode(new DatabaseError('database is locked', 'locked'))).toBe('db_locked');
    expect(toErrorCode(new DatabaseError('malformed', 'corrupt'))).toBe('db_corrupt');
    expect(toErrorCode(new DatabaseError('readonly', 'readonly'))).toBe('db_readonly');
    expect(toErrorCode(new DatabaseError('full', 'full'))).toBe('db_full');
    expect(toErrorCode(new DatabaseError('anything else'))).toBe('db_error');
  });

  it('tells api-client timeouts and network failures apart (both use status 0)', () => {
    expect(toErrorCode(new ApiError('Request timeout', 0, 'timeout'))).toBe('timeout');
    expect(toErrorCode(new ApiError('Network error: TypeError', 0))).toBe('network');
    expect(toErrorCode(new ApiError('boom', 500))).toBe('server_error');
  });

  it('keeps a valid server request id on ApiError and drops anything else', () => {
    expect(new ApiError('x', 500, undefined, 'a1b2c3d4e5f6a7b8').requestId).toBe(
      'a1b2c3d4e5f6a7b8'
    );
    expect(new ApiError('x', 500, undefined, 'short').requestId).toBeUndefined();
    expect(new ApiError('x', 500, undefined, 'has space 1234567').requestId).toBeUndefined();
    expect(new ApiError('x', 500, undefined, null).requestId).toBeUndefined();
  });
});
