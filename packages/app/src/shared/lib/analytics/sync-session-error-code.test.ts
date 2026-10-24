import { describe, expect, it } from 'vitest';
import { SYNC_SESSION_EXPIRED_MESSAGE, SYNC_SESSION_REJECTED_MESSAGE } from '@budgero/runtime';
import { syncErrorCode } from './error-codes';

describe('syncErrorCode for sync session errors', () => {
  it('maps the runtime session messages to unauthorized', () => {
    expect(syncErrorCode(SYNC_SESSION_EXPIRED_MESSAGE)).toBe('unauthorized');
    expect(syncErrorCode(SYNC_SESSION_REJECTED_MESSAGE)).toBe('unauthorized');
  });
});
