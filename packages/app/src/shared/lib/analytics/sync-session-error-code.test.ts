import { describe, expect, it } from 'vitest';
import { SYNC_SESSION_EXPIRED, SYNC_SESSION_REJECTED } from '@budgero/runtime';
import { syncErrorCode } from './error-codes';

describe('syncErrorCode', () => {
  it('maps the runtime session errors to unauthorized', () => {
    expect(syncErrorCode(SYNC_SESSION_EXPIRED)).toBe('unauthorized');
    expect(syncErrorCode(SYNC_SESSION_REJECTED)).toBe('unauthorized');
  });

  it('maps every runtime code to its own analytics code', () => {
    expect(syncErrorCode({ code: 'update_required' })).toBe('update_required');
    expect(syncErrorCode({ code: 'mutation_quarantined' })).toBe('mutation_quarantined');
    expect(syncErrorCode({ code: 'snapshot_unavailable' })).toBe('snapshot_unavailable');
    expect(syncErrorCode({ code: 'snapshot_upload_failed' })).toBe('snapshot_upload_failed');
    expect(syncErrorCode({ code: 'mutation_rejected' })).toBe('sync_rejected');
    expect(syncErrorCode({ code: 'something_new' })).toBe('unknown');
    expect(syncErrorCode(null)).toBe('unknown');
  });
});
