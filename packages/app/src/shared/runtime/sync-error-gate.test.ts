import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@budgero/runtime';
import { createSyncErrorGate } from './sync-error-gate';

const failed = (lastSyncTime: Date | null = null): SyncStatus => ({
  isSyncing: false,
  lastSyncTime,
  syncError: { code: 'snapshot_upload_failed', message: 'upload failed' },
});
const clearing = (lastSyncTime: Date | null): SyncStatus => ({
  isSyncing: true,
  lastSyncTime,
  syncError: null,
});

describe('createSyncErrorGate', () => {
  it('surfaces a retry loop once: clear + same error again is not news', () => {
    const gate = createSyncErrorGate();
    expect(gate(failed())).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(gate(clearing(null))).toBe(false); // replay starts, error cleared
      expect(gate(failed())).toBe(false); // ...and fails the same way
    }
  });

  it('surfaces a different error code right away', () => {
    const gate = createSyncErrorGate();
    expect(gate(failed())).toBe(true);
    expect(
      gate({
        isSyncing: false,
        lastSyncTime: null,
        syncError: { code: 'session_expired', message: 'expired' },
      })
    ).toBe(true);
  });

  it('re-arms after a successful sync', () => {
    const gate = createSyncErrorGate();
    const before = new Date(1000);
    expect(gate(failed(before))).toBe(true);
    expect(gate(clearing(before))).toBe(false); // cleared, but nothing synced yet
    expect(gate(failed(before))).toBe(false);
    expect(gate({ isSyncing: false, lastSyncTime: new Date(2000), syncError: null })).toBe(false);
    expect(gate(failed(new Date(2000)))).toBe(true); // a fresh failure after real progress
  });
});
