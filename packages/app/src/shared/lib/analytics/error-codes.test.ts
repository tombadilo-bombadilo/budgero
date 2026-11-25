import { describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/api-client';
import { runtimeMessageCode, toErrorCode } from './error-codes';

class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

class ServicesNotReadyError extends Error {
  constructor() {
    super('Services not initialized');
    this.name = 'ServicesNotReadyError';
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
    expect(toErrorCode(new DatabaseError('closed', 'closed'))).toBe('db_closed');
    expect(toErrorCode(new DatabaseError('schema', 'schema'))).toBe('db_schema');
    expect(toErrorCode(new DatabaseError('oom', 'out_of_memory'))).toBe('db_out_of_memory');
    expect(toErrorCode(new ServicesNotReadyError())).toBe('services_not_ready');
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

describe('runtimeMessageCode', () => {
  it('derives a fixed code from a runtime log message without keeping the text', () => {
    expect(
      runtimeMessageCode(
        'Decryption failed: invalid password or corrupted data',
        'snapshot_download_failed'
      )
    ).toBe('decryption_failed');
    expect(
      runtimeMessageCode(
        'OPFS write failed: QuotaExceededError',
        'failed_to_persist_local_database'
      )
    ).toBe('storage_error');
    expect(runtimeMessageCode('HTTP 409 {"error":"version_conflict"}', 'blob_upload_failed')).toBe(
      'conflict'
    );
    expect(runtimeMessageCode('HTTP 503', 'blob_upload_failed')).toBe('server_error');
    expect(runtimeMessageCode('Failed to fetch', 'catch_up_request_failed')).toBe('network');
    expect(runtimeMessageCode(undefined, 'catch_up_snapshot_recovery_failed')).toBe(
      'snapshot_download_failed'
    );
    expect(
      runtimeMessageCode('UNIQUE constraint failed: x.y', 'failed_to_apply_catch_up_mutation')
    ).toBe('db_constraint');
    expect(runtimeMessageCode('something odd', 'mystery_event')).toBe('unknown');
  });

  it('names a catch-up snapshot fallback as such, not as a failed upload', () => {
    // The event name contains "snapshot"; nothing is uploaded on this path.
    expect(runtimeMessageCode('apply_failed', 'catch_up_fallback_snapshot')).toBe(
      'snapshot_fallback'
    );
    expect(runtimeMessageCode('mutation_log_gap', 'catch_up_fallback_snapshot')).toBe(
      'snapshot_fallback'
    );
    expect(
      runtimeMessageCode(
        undefined,
        'local_replay_startup_unavailable_falling_back_to_full_snapshot'
      )
    ).toBe('snapshot_fallback');
    expect(runtimeMessageCode(undefined, 'blob_upload_failed_retry_armed')).toBe(
      'snapshot_upload_failed'
    );
    expect(runtimeMessageCode(undefined, 'out_of_band_blob_download_failed_retry_armed')).toBe(
      'snapshot_download_failed'
    );
    expect(runtimeMessageCode(undefined, 'queue_re_apply_after_snapshot_bootstrap_failed')).toBe(
      'mutation_error'
    );
  });

  it('codes a session wait as unauthorized', () => {
    expect(runtimeMessageCode('no auth token', 'sync_still_waiting_for_a_valid_session')).toBe(
      'unauthorized'
    );
    expect(runtimeMessageCode('handshake rejected', 'sync_still_waiting_for_a_valid_session')).toBe(
      'unauthorized'
    );
  });
});
