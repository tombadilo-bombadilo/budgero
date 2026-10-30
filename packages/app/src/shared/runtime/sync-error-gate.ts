import type { SyncStatus } from '@budgero/runtime';

/**
 * Decide which sync status updates the user (and analytics) should hear about:
 * one per error code until a sync actually succeeds. The reconnect replay
 * clears and re-sets the same error on every retry; without this gate one
 * failure produced a toast and an event every few seconds.
 */
export function createSyncErrorGate(): (status: SyncStatus) => boolean {
  let shownCode: string | null = null;
  let syncedAtError: number | null = null;
  return (status) => {
    const error = status.syncError;
    if (!error) {
      const syncedAt = status.lastSyncTime?.getTime() ?? null;
      if (shownCode && syncedAt !== null && syncedAt !== syncedAtError) shownCode = null;
      return false;
    }
    if (error.code === shownCode) return false;
    shownCode = error.code;
    syncedAtError = status.lastSyncTime?.getTime() ?? null;
    return true;
  };
}
