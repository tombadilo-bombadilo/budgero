/**
 * Restore invariant — shared by every path that replaces the local DB with a
 * server snapshot (DatabaseSync.downloadAndRestore hook, activation-time
 * bootstrap).
 *
 * A restore invalidates two pieces of derived sync state:
 *  - the applied/in-flight dedup sets (they record effects the restored DB
 *    no longer contains — keeping them makes catch-up SKIP those mutations
 *    forever),
 *  - the local effects of queued-but-unacked mutations (the restore erased
 *    them; the queue still delivers them to the server, but nothing would
 *    ever re-apply them locally — the sender never receives its own
 *    broadcast back).
 *
 * So: reset dedup, re-apply the queue locally, and re-mark each entry
 * in-flight so its eventual catch-up echo dedups instead of double-applying.
 */

import type { MutationPayload } from '../types';
import { errorMessage } from '../utils/diagnostics';

export interface ReapplyQueueParams {
  spaceId: string;
  offlineQueue: {
    resetForRestore(): void;
    getQueue(): Promise<MutationPayload[]>;
    addInFlight(mutationId: string): void;
  };
  executor: {
    execute(spec: {
      op: string;
      payload: Record<string, unknown>;
      mutationId: string;
      spaceId: string;
      meta: { skipUndo: boolean };
    }): Promise<unknown>;
  };
  persistLocalDatabase(): Promise<boolean>;
  log?(message: string, extra?: Record<string, unknown>): void;
}

export async function reapplyQueueAfterRestore(params: ReapplyQueueParams): Promise<void> {
  const { spaceId, offlineQueue, executor, persistLocalDatabase, log } = params;

  offlineQueue.resetForRestore();

  const queued = await offlineQueue.getQueue();
  for (const mutation of queued) {
    if (mutation.spaceId && mutation.spaceId !== spaceId) continue;
    try {
      await executor.execute({
        op: mutation.op,
        payload: mutation.args,
        mutationId: mutation.id,
        spaceId,
        meta: { skipUndo: true },
      });
    } catch (error) {
      log?.('Failed to re-apply queued mutation after restore', {
        id: mutation.id,
        op: mutation.op,
        error: errorMessage(error),
      });
    }
    offlineQueue.addInFlight(mutation.id);
  }

  await persistLocalDatabase();
}
