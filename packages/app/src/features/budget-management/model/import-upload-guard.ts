import { clearPendingImport, markPendingImport } from '@shared/runtime/pending-import';

/**
 * Keeps an out-of-band import invisible to the server until it is accepted:
 * snapshot uploads stay held from the first write until the budget is either
 * committed (then uploaded on purpose) or fully removed again. A durable
 * marker covers the tab dying in between (see pending-import).
 */
export interface ImportUploadGuard {
  /** The import created its budget: remember it in case the page dies. */
  trackBudget(budgetId: number, name: string): void;
  /** The budget was accepted: stop holding uploads (the caller uploads it). */
  commit(): void;
  /**
   * The import failed or was discarded: make sure its budget is gone, then
   * stop holding uploads. Keeps holding if the budget can't be removed.
   */
  rollBack(): void;
}

interface ImportUploadRuntime {
  getActiveSpaceId(): string | null;
  holdSnapshotUploads?(): () => void;
}

export function holdUploadsForImport(
  runtime: ImportUploadRuntime,
  deleteBudget: (budgetId: number) => void
): ImportUploadGuard {
  const release = runtime.holdSnapshotUploads?.() ?? (() => undefined);
  const spaceId = runtime.getActiveSpaceId();
  let budgetId: number | null = null;
  let settled = false;

  const finish = () => {
    settled = true;
    if (spaceId && budgetId !== null) clearPendingImport(spaceId, budgetId);
    release();
  };

  return {
    trackBudget(id, name) {
      budgetId = id;
      if (spaceId) markPendingImport({ spaceId, budgetId: id, name });
    },
    commit() {
      if (!settled) finish();
    },
    rollBack() {
      if (settled) return;
      if (budgetId !== null) {
        try {
          // Idempotent: the importer's own rollback usually removed it already.
          deleteBudget(budgetId);
        } catch (error) {
          console.warn('[ImportUploadGuard] Could not remove the unaccepted import', error);
          return;
        }
      }
      finish();
    },
  };
}
